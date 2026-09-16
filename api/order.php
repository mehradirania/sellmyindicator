<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/db.php';

const CD_RECIPIENT_TRC20 = 'TN9sBCbSbd4LSmEa9xJfTJJLVLWFyo4p4Y';
const CD_USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const CD_RECIPIENT_BEP20 = '0x85a5892979b85c28b49826703b75914be8022714';
const CD_USDT_BEP20 = '0x55d398326f99059ff775485246999027b3197955';
const CD_BSC_RPC = 'https://bsc-dataseed.binance.org/';
const CD_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

function cd_json(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function cd_fail(string $message, int $status = 400, array $extra = []): never {
    cd_json(array_merge(['ok'=>false,'error'=>$message], $extra), $status);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') cd_fail('Method not allowed', 405);

$raw = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) cd_fail('Invalid JSON body.');

$productId = trim((string)($body['product_id'] ?? ''));
$txHash = trim((string)($body['tx_hash'] ?? ''));
$network = strtoupper(trim((string)($body['network'] ?? '')));
$sender = trim((string)($body['sender'] ?? ''));

if ($productId === '' || $txHash === '') cd_fail('product_id and tx_hash are required.');
if (!in_array($network, ['TRC20','BEP20'], true)) cd_fail('network must be TRC20 or BEP20.');
if (!preg_match('/^[0-9a-fA-F]{64}$/', $network === 'TRC20' ? $txHash : ltrim($txHash, '0x'))) {
    cd_fail('Invalid transaction hash.');
}
if ($network === 'BEP20' && !preg_match('/^0x[0-9a-fA-F]{64}$/', $txHash)) cd_fail('BEP20 transaction hash must start with 0x.');
if ($network === 'TRC20' && str_starts_with($txHash, '0x')) cd_fail('TRC20 transaction hash must not start with 0x.');

$product = cd_product($productId);
if (!$product) cd_fail('Unknown product.', 404);

try {
    $check = $network === 'TRC20'
        ? cd_verify_trc20($txHash, $product)
        : cd_verify_bep20($txHash, $product);
} catch (Throwable $e) {
    error_log('Payment verification error: ' . $e->getMessage());
    cd_fail('Payment verification service is temporarily unavailable. Please try again.', 503, ['retryable'=>true]);
}

if (!$check['ok']) {
    $retryable = in_array($check['reason'] ?? '', ['tx_not_found','not_confirmed_yet','rpc_unreachable'], true);
    cd_fail('Payment could not be verified: ' . ($check['reason'] ?? 'unknown'), $retryable ? 422 : 422, ['retryable'=>$retryable]);
}

$normalizedTx = strtolower($txHash);
$pdo = cd_db();

/* Never release a product unless this exact transaction has passed server verification. */
$stmt = $pdo->prepare('SELECT * FROM orders WHERE network = :network AND tx_hash = :tx LIMIT 1');
$stmt->execute([':network'=>$network, ':tx'=>$normalizedTx]);
$existing = $stmt->fetch();

if ($existing) {
    if ((string)$existing['product_id'] !== $productId) cd_fail('This transaction was already used for another product.', 409);
    if ((int)$existing['verified'] !== 1) cd_fail('Payment is not verified yet.', 409, ['retryable'=>true]);
    $amount = (float)$existing['amount'];
} else {
    $stmt = $pdo->prepare('INSERT INTO orders
        (product_id,network,tx_hash,sender,recipient,amount,verified,created_at)
        VALUES (:product_id,:network,:tx,:sender,:recipient,:amount,1,:created_at)');
    $stmt->execute([
        ':product_id'=>$productId,
        ':network'=>$network,
        ':tx'=>$normalizedTx,
        ':sender'=>$check['sender'],
        ':recipient'=>$check['recipient'],
        ':amount'=>$check['amount'],
        ':created_at'=>time(),
    ]);
    $amount = $check['amount'];
}

cd_json([
    'ok'=>true,
    'verified'=>true,
    'product'=>$product['name'],
    'file'=>$product['file'],
    'amount'=>$amount,
    'tx_hash'=>$normalizedTx,
    'network'=>$network,
    'explorer'=>$network === 'TRC20'
        ? 'https://tronscan.org/#/transaction/'.$normalizedTx
        : 'https://bscscan.com/tx/'.$normalizedTx,
]);

function cd_http_json(string $url, string $method='GET', ?array $payload=null): array {
    $ch = curl_init($url);
    if ($ch === false) throw new RuntimeException('curl_init failed');
    $headers = ['Accept: application/json'];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER=>true,
        CURLOPT_FOLLOWLOCATION=>false,
        CURLOPT_CONNECTTIMEOUT=>5,
        CURLOPT_TIMEOUT=>12,
        CURLOPT_CUSTOMREQUEST=>$method,
        CURLOPT_HTTPHEADER=>$headers,
    ]);
    if ($payload !== null) {
        $json = json_encode($payload);
        if ($json === false) throw new RuntimeException('JSON encoding failed');
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }
    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false || $errno !== 0) throw new RuntimeException('HTTP request failed: '.$error);
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) throw new RuntimeException('Invalid JSON response.');
    return ['status'=>$status,'body'=>$decoded];
}

function cd_verify_trc20(string $txHash, array $product): array {
    try {
        $txRes = cd_http_json('https://api.trongrid.io/wallet/gettransactionbyid?value='.rawurlencode($txHash));
        $tx = $txRes['body'];
        if (empty($tx['txID'])) return ['ok'=>false,'reason'=>'tx_not_found'];

        $infoRes = cd_http_json('https://api.trongrid.io/wallet/gettransactioninfobyid?value='.rawurlencode($txHash));
        $info = $infoRes['body'];
        if (empty($info['id']) || empty($info['receipt'])) return ['ok'=>false,'reason'=>'not_confirmed_yet'];
        if (($info['receipt']['result'] ?? '') !== 'SUCCESS') return ['ok'=>false,'reason'=>'tx_failed'];

        $contract = $tx['raw_data']['contract'][0] ?? null;
        if (($contract['type'] ?? '') !== 'TriggerSmartContract') return ['ok'=>false,'reason'=>'not_contract_call'];
        $value = $contract['parameter']['value'] ?? [];
        $data = strtolower((string)($value['data'] ?? ''));
        if (!preg_match('/^a9059cbb[0-9a-f]{128}$/', $data)) return ['ok'=>false,'reason'=>'not_trc20_transfer'];

        $contractHex = strtolower(ltrim((string)($value['contract_address'] ?? ''), '0x'));
        $expectedContractHex = strtolower(ltrim(cd_tron_to_hex(CD_USDT_TRC20), '0x'));
        if ($contractHex !== $expectedContractHex) return ['ok'=>false,'reason'=>'wrong_contract'];

        $recipient = cd_tron_base58check('41'.substr($data, 8+24, 40));
        $expectedRecipient = (string)($product['wallet'] ?: CD_RECIPIENT_TRC20);
        if ($recipient !== $expectedRecipient) return ['ok'=>false,'reason'=>'wrong_recipient'];

        $amountSmallest = cd_hex_to_dec(substr($data, 72, 64));
        $required = cd_usdt_smallest((string)$product['price'], 6);
        if (bccomp($amountSmallest, $required, 0) < 0) return ['ok'=>false,'reason'=>'underpaid'];

        $ownerHex = strtolower(ltrim((string)($value['owner_address'] ?? ''), '0x'));
        $sender = cd_tron_base58check('41'.substr($ownerHex, -40));
        return ['ok'=>true,'amount'=>(float)bcdiv($amountSmallest,'1000000',6),'recipient'=>$recipient,'sender'=>$sender];
    } catch (Throwable $e) {
        error_log('TRON verify: '.$e->getMessage());
        return ['ok'=>false,'reason'=>'rpc_unreachable'];
    }
}

function cd_verify_bep20(string $txHash, array $product): array {
    try {
        $res = cd_http_json(CD_BSC_RPC, 'POST', ['jsonrpc'=>'2.0','id'=>1,'method'=>'eth_getTransactionReceipt','params'=>[$txHash]]);
        $receipt = $res['body']['result'] ?? null;
        if ($receipt === null) return ['ok'=>false,'reason'=>'tx_not_found'];
        if (strtolower((string)($receipt['status'] ?? '')) !== '0x1') return ['ok'=>false,'reason'=>'tx_reverted'];

        $expectedRecipient = strtolower(CD_RECIPIENT_BEP20);
        $required = cd_usdt_smallest((string)$product['price'], 18);

        foreach ((array)($receipt['logs'] ?? []) as $log) {
            if (strtolower((string)($log['address'] ?? '')) !== strtolower(CD_USDT_BEP20)) continue;
            $topics = $log['topics'] ?? [];
            if (count($topics) < 3 || strtolower((string)$topics[0]) !== CD_TRANSFER_TOPIC) continue;
            $to = '0x'.substr(strtolower((string)$topics[2]), -40);
            if ($to !== $expectedRecipient) continue;
            $valueHex = preg_replace('/^0x/i','',(string)($log['data'] ?? '0x0'));
            $value = cd_hex_to_dec($valueHex);
            if (bccomp($value,$required,0) < 0) return ['ok'=>false,'reason'=>'underpaid'];
            $sender = '0x'.substr(strtolower((string)$topics[1]), -40);
            return ['ok'=>true,'amount'=>(float)bcdiv($value,bcpow('10','18',0),18),'recipient'=>$to,'sender'=>$sender];
        }
        return ['ok'=>false,'reason'=>'no_usdt_transfer_to_recipient'];
    } catch (Throwable $e) {
        error_log('BSC verify: '.$e->getMessage());
        return ['ok'=>false,'reason'=>'rpc_unreachable'];
    }
}

function cd_usdt_smallest(string $price, int $decimals): string {
    if (!preg_match('/^\d+(?:\.\d+)?$/', $price)) throw new InvalidArgumentException('Invalid price');
    [$whole,$fraction] = array_pad(explode('.',$price,2),2,'');
    if (strlen($fraction)>$decimals) $fraction=substr($fraction,0,$decimals);
    return bcadd(bcmul($whole,bcpow('10',(string)$decimals,0),0),str_pad($fraction,$decimals,'0'),0);
}
function cd_hex_to_dec(string $hex): string {
    $hex = preg_replace('/^0x/i','',$hex);
    $dec='0';
    foreach (str_split(strtolower($hex)) as $c) $dec=bcadd(bcmul($dec,'16',0),(string)hexdec($c),0);
    return $dec;
}
function cd_tron_to_hex(string $base58): string {
    $bytes=cd_base58_decode($base58);
    return bin2hex(substr($bytes,0,21));
}
function cd_base58_decode(string $input): string {
    $alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $n='0';
    foreach (str_split($input) as $char) {
        $pos=strpos($alphabet,$char); if($pos===false) throw new InvalidArgumentException('Invalid Base58');
        $n=bcadd(bcmul($n,'58',0),(string)$pos,0);
    }
    $hex='';
    while (bccomp($n,'0',0)>0) { $r=(int)bcmod($n,'256'); $n=bcdiv($n,'256',0); $hex=str_pad(dechex($r),2,'0',STR_PAD_LEFT).$hex; }
    $leading=0; for($i=0;$i<strlen($input)&&$input[$i]==='1';$i++)$leading++;
    return str_repeat("\0",$leading).($hex!==''?hex2bin($hex):'');
}
function cd_tron_base58check(string $hex): string {
    $hex=preg_replace('/^0x/i','',$hex); if(strlen($hex)%2!==0) return '';
    $binary=hex2bin($hex); if($binary===false) return '';
    $checksum=substr(hash('sha256',hash('sha256',$binary,true),true),0,4);
    return cd_base58_encode($binary.$checksum);
}
function cd_base58_encode(string $bytes): string {
    $alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    $n=cd_hex_to_dec(bin2hex($bytes)); $out='';
    while(bccomp($n,'0',0)>0){$r=(int)bcmod($n,'58');$n=bcdiv($n,'58',0);$out=$alphabet[$r].$out;}
    for($i=0;$i<strlen($bytes)&&$bytes[$i]==="\0";$i++)$out='1'.$out;
    return $out;
}
