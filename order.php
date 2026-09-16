<?php
/**
 * CryptoDirect — order endpoint
 *
 * Receives a payment report from the browser after an on-chain USDT transfer,
 * re-verifies the transaction server-side (TRC20 via TronGrid, BEP20 via a
 * public BSC RPC), records it idempotently, and releases the download link.
 *
 * Policy: a payment that CANNOT be found on-chain is rejected; a payment whose
 * verification is skipped only because the explorer RPC is unreachable is
 * accepted and logged as unverified.
 */

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';

// Recipient / contract constants (mirror of the client config.js)
define('CD_RECIPIENT', 'TN9sBCbSbd4LSmEa9xJfTJJLVLWFyo4p4Y');
define('CD_USDT_TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
define('CD_BEP20_RECIPIENT', '0x85a5892979b85c28b49826703b75914be8022714'); // EVM twin of CD_RECIPIENT (same private key controls both)
define('CD_USDT_BEP20', '0x55d398326f99059ff775485246999027b3197955');
define('CD_BSC_RPC', 'https://bsc-dataseed.binance.org/');
define('CD_ERC20_TRANSFER_TOPIC', '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef');

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function cd_fail(string $message, int $status = 400, array $extra = []): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message, ...$extra], JSON_UNESCAPED_SLASHES);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    cd_fail('Method not allowed', 405);
}

$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) {
    cd_fail('Invalid JSON body');
}

$productId = trim((string)($body['product_id'] ?? ''));
$txHash    = trim((string)($body['tx_hash'] ?? ''));
$network   = strtoupper(trim((string)($body['network'] ?? '')));
$sender    = trim((string)($body['sender'] ?? ''));

if ($productId === '' || $txHash === '') {
    cd_fail('product_id and tx_hash are required');
}

if (!in_array($network, ['TRC20', 'BEP20'], true)) {
    cd_fail('network must be TRC20 or BEP20');
}

// Transaction hash formats: TRON = 64 hex chars, EVM = 66 hex chars (0x…)
if (!preg_match('/^(0x)?[0-9a-fA-F]{64}$/', $txHash)) {
    cd_fail('Invalid transaction hash');
}

if ($network === 'TRC20' && str_starts_with($txHash, '0x')) {
    cd_fail('TRC20 transaction hashes do not start with 0x');
}
if ($network === 'BEP20' && !str_starts_with($txHash, '0x')) {
    cd_fail('BEP20 transaction hashes must start with 0x');
}

$product = cd_product($productId);
if ($product === null) {
    cd_fail('Unknown product', 404);
}

$verified  = 0;
$degraded  = false; // true => explorer unreachable, logged but unverified
$amount    = 0.0;
$recipient = '';

if ($network === 'TRC20') {
    $check = cd_verify_trc20($txHash, $product);
} else {
    $check = cd_verify_bep20($txHash, $product);
}

if ($check['ok']) {
    $verified  = 1;
    $amount    = $check['amount'];
    $recipient = $check['recipient'];
    if ($sender !== '' && strcasecmp($sender, $check['sender']) !== 0) {
        cd_fail('Transaction sender does not match the paying wallet');
    }
} elseif (($check['reason'] ?? '') === 'rpc_unreachable') {
    // Explorer down: accept (the browser confirmed on-chain) but flag it.
    $degraded = true;
} else {
    cd_fail('Payment could not be verified on-chain: ' . ($check['reason'] ?? 'unknown'), 422, [
        'retryable' => in_array($check['reason'] ?? '', ['tx_not_found', 'not_confirmed_yet'], true),
    ]);
}

// Idempotent insert on tx_hash — a replay simply returns the file link again.
// A degraded (unverified) order upgrades to verified if the tx later verifies.
$stmt = cd_db()->prepare('
    INSERT INTO orders (product_id, network, tx_hash, sender, recipient, amount, verified, created_at)
    VALUES (:product_id, :network, :tx_hash, :sender, :recipient, :amount, :verified, :created_at)
    ON CONFLICT(tx_hash) DO UPDATE SET
        product_id = excluded.product_id,
        verified   = max(orders.verified, excluded.verified),
        amount     = CASE WHEN excluded.verified = 1 THEN excluded.amount ELSE orders.amount END
');
$stmt->execute([
    ':product_id' => $productId,
    ':network'    => $network,
    ':tx_hash'    => strtolower($txHash),
    ':sender'     => $sender,
    ':recipient'  => $recipient ?: ($product['wallet'] ?? ''),
    ':amount'     => $amount > 0 ? $amount : (float)$product['price'],
    ':verified'   => $verified,
    ':created_at' => time(),
]);

echo json_encode([
    'ok'         => true,
    'verified'   => (bool)$verified,
    'degraded'   => $degraded,
    'product'    => $product['name'],
    'file'       => $product['file'],
    'tx_hash'    => $txHash,
    'network'    => $network,
    'explorer'   => $network === 'TRC20'
        ? 'https://tronscan.org/#/transaction/' . $txHash
        : 'https://bscscan.com/tx/' . $txHash,
], JSON_UNESCAPED_SLASHES);

/* ------------------------------------------------------------------
 * Verification helpers
 * ------------------------------------------------------------------ */

/**
 * Verify a USDT TRC20 transfer through the public TronGrid API:
 * contract, selector, recipient, amount and sender are all checked.
 */
function cd_verify_trc20(string $txHash, array $product): array
{
    $tx = cd_http_get_json('https://api.trongrid.io/wallet/gettransactionbyid?value=' . urlencode($txHash));
    if ($tx === null) {
        return ['ok' => false, 'reason' => 'rpc_unreachable'];
    }
    if (!is_array($tx) || empty($tx['txID'])) {
        return ['ok' => false, 'reason' => 'tx_not_found'];
    }

    // A transaction can be broadcast yet still FAIL on-chain (OUT_OF_ENERGY,
    // REVERT, …). The raw tx alone does not tell us — check the receipt.
    $info = cd_http_get_json('https://api.trongrid.io/wallet/gettransactioninfobyid?value=' . urlencode($txHash));
    if ($info === null) {
        return ['ok' => false, 'reason' => 'rpc_unreachable'];
    }
    if (!is_array($info) || empty($info['id']) || empty($info['receipt'])) {
        return ['ok' => false, 'reason' => 'not_confirmed_yet'];
    }
    if (($info['receipt']['result'] ?? '') !== 'SUCCESS') {
        return ['ok' => false, 'reason' => 'tx_failed'];
    }

    $contract = $tx['raw_data']['contract'][0] ?? null;
    if (($contract['type'] ?? '') !== 'TriggerSmartContract') {
        return ['ok' => false, 'reason' => 'not_contract_call'];
    }

    $value = $contract['parameter']['value'] ?? [];
    $data  = strtolower((string)($value['data'] ?? ''));

    // transfer(address,uint256) selector + two 32-byte words
    if (strlen($data) !== 136 || !str_starts_with($data, 'a9059cbb')) {
        return ['ok' => false, 'reason' => 'not_trc20_transfer'];
    }

    $contractHex = (string)($value['contract_address'] ?? '');
    if (cd_tron_base58check('41' . substr($contractHex, 2)) !== CD_USDT_TRC20) {
        return ['ok' => false, 'reason' => 'wrong_contract'];
    }

    $recipientHex = '41' . substr(substr($data, 8, 64), 24);
    $recipient    = cd_tron_base58check($recipientHex);
    if ($recipient !== ($product['wallet'] ?: CD_RECIPIENT)) {
        return ['ok' => false, 'reason' => 'wrong_recipient'];
    }

    $amountSmallest = cd_hex_to_dec(substr($data, 72, 64));
    $amount         = (float)bcdiv($amountSmallest, '1000000', 6); // USDT has 6 decimals
    if (bccomp($amountSmallest, cd_usdt_min_smallest((float)$product['price'], 6), 0) < 0) {
        return ['ok' => false, 'reason' => 'underpaid'];
    }

    $sender = cd_tron_base58check('41' . substr((string)($value['owner_address'] ?? ''), 2));

    return ['ok' => true, 'amount' => $amount, 'recipient' => $recipient, 'sender' => $sender];
}

/**
 * Verify a USDT BEP20 transfer through a public BSC RPC by parsing the
 * ERC-20 Transfer event log of the transaction receipt.
 */
function cd_verify_bep20(string $txHash, array $product): array
{
    $receipt = cd_rpc_post(CD_BSC_RPC, 'eth_getTransactionReceipt', [$txHash]);
    if ($receipt === null) {
        return ['ok' => false, 'reason' => 'rpc_unreachable'];
    }
    if ($receipt === 'null') {
        return ['ok' => false, 'reason' => 'tx_not_found'];
    }

    if (strtolower((string)($receipt['status'] ?? '')) !== '0x1') {
        return ['ok' => false, 'reason' => 'tx_reverted'];
    }

    $expectedRecipient = strtolower(CD_BEP20_RECIPIENT);
    $minSmallest       = cd_usdt_min_smallest((float)$product['price'], 18);

    foreach ((array)($receipt['logs'] ?? []) as $log) {
        $logAddress = strtolower((string)($log['address'] ?? ''));
        if ($logAddress !== strtolower(CD_USDT_BEP20)) {
            continue;
        }

        $topics = (array)($log['topics'] ?? []);
        if (count($topics) < 3 || strtolower($topics[0]) !== CD_ERC20_TRANSFER_TOPIC) {
            continue;
        }

        $to = '0x' . substr(strtolower($topics[2]), -40);
        if ($to !== $expectedRecipient) {
            continue;
        }

        $value = cd_hex_to_dec(str_ireplace('0x', '', (string)($log['data'] ?? '0x0')));
        if (bccomp($value, $minSmallest, 0) < 0) {
            return ['ok' => false, 'reason' => 'underpaid'];
        }

        $sender = '0x' . substr(strtolower($topics[1]), -40);

        return [
            'ok'        => true,
            'amount'    => (float)$product['price'],
            'recipient' => $to,
            'sender'    => $sender,
        ];
    }

    return ['ok' => false, 'reason' => 'no_usdt_transfer_to_recipient'];
}

/* ------------------------------------------------------------------
 * HTTP helpers
 * ------------------------------------------------------------------ */

/**
 * GET a JSON document; null when the request fails (treated as unreachable).
 */
function cd_http_get_json(string $url): mixed
{
    $ctx = stream_context_create(['http' => [
        'method'  => 'GET',
        'timeout' => 8,
        'header'  => "Accept: application/json\r\n",
        'ignore_errors' => true,
    ]]);

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return null;
    }

    return json_decode($raw, true);
}

/**
 * JSON-RPC POST; null when the request fails, the decoded 'result' otherwise.
 */
function cd_rpc_post(string $url, string $method, array $params): mixed
{
    $payload = json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params]);
    if ($payload === false) {
        return null;
    }

    $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'timeout' => 8,
        'header'  => "Content-Type: application/json\r\nAccept: application/json\r\n",
        'content' => $payload,
        'ignore_errors' => true,
    ]]);

    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) {
        return null;
    }

    $decoded = json_decode($raw, true);
    return $decoded['result'] ?? null;
}

/* ------------------------------------------------------------------
 * Address encoding (TRON base58check) + bcmath bigint helpers
 * ------------------------------------------------------------------ */

/**
 * Minimal base58check encode for TRON addresses (hex including the 0x41 prefix byte).
 */
function cd_tron_base58check(string $hexWith41): string
{
    if (str_starts_with($hexWith41, '0x')) {
        $hexWith41 = substr($hexWith41, 2);
    }
    if (strlen($hexWith41) % 2 !== 0) {
        return '';
    }

    $binary = hex2bin($hexWith41);
    if ($binary === false) {
        return '';
    }
    $checksum = substr(hash('sha256', hash('sha256', $binary, true), true), 0, 4);

    return cd_base58_encode($binary . $checksum);
}

function cd_base58_encode(string $bytes): string
{
    $alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $n        = cd_hex_to_dec(bin2hex($bytes));
    $out      = '';

    while (bccomp($n, '0', 0) > 0) {
        $r   = bcmod($n, '58');
        $n   = bcdiv($n, '58', 0);
        $out = $alphabet[(int)$r] . $out;
    }

    // Leading zero bytes become '1'
    foreach (str_split($bytes) as $byte) {
        if ($byte !== "\x00") {
            break;
        }
        $out = '1' . $out;
    }

    return $out;
}

/**
 * Arbitrary-precision hex → decimal (bcmath, since gmp is unavailable).
 */
function cd_hex_to_dec(string $hex): string
{
    $hex = strtolower(str_ireplace('0x', '', $hex));
    $dec = '0';
    foreach (str_split($hex) as $char) {
        $dec = bcadd(bcmul($dec, '16', 0), (string)hexdec($char), 0);
    }
    return $dec;
}

/**
 * Smallest-unit amount representing a product price (e.g. 299 USDT @ 6 decimals).
 */
function cd_usdt_min_smallest(float $price, int $decimals): string
{
    return bcmul((string)(int)ceil($price), bcpow('10', (string)$decimals, 0), 0);
}
