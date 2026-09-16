# sellmyindicator
<?php
/**
 * CryptoDirect – Crypto Store
 * A simple and secure crypto store for digital products with USDT TRC20/BEP20 payments.
 */

declare(strict_types=1);

require_once __DIR__ . '/includes/db.php';

$products = cd_products();

// Client-visible product data — the download "file" link is deliberately
// omitted: it is only released by api/order.php after an on-chain payment.
$productsJson = json_encode(
    array_map(fn(array $p): array => [
        'id'          => $p['id'],
        'name'        => $p['name'],
        'description' => $p['description'],
        'price'       => (float)$p['price'],
        'image'       => $p['image'],
        'wallet'      => $p['wallet'],
        'created_at'  => (int)$p['created_at'],
    ], $products),
    JSON_UNESCAPED_SLASHES
);
// Escape "</" so product names can never break out of the <script> element
$productsJson = str_replace('</', '<\/', $productsJson);

function cd_e(?string $s): string
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>CryptoDirect – Crypto Store</title>
    <meta name="description" content="Crypto Payment Store - Pay with USDT TRC20">

    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🪙</text></svg>">

    <link rel="stylesheet" href="assets/css/style.css?v=5">

    <!-- Configuration -->
    <script src="assets/js/config.js?v=5"></script>

    <!-- Buffer polyfill (dist/ path of this package does not exist — use +esm) -->
    <script type="module">
        import bufferPolyfill from "https://cdn.jsdelivr.net/npm/buffer-polyfill@6.0.3/+esm";
        window.Buffer = window.Buffer || bufferPolyfill;
    </script>

    <!-- WalletConnect sign client -->
    <script src="https://cdn.jsdelivr.net/npm/@walletconnect/sign-client@2.23.4/dist/index.umd.js"></script>

    <!-- The tronwallet-adapters UMD reads its dependency from
         window["@walletconnect/sign-client"], but the sign-client UMD exposes
         window.SignClient — bridge it BEFORE the adapters script runs. -->
    <script>
        window["@walletconnect/sign-client"] = window.SignClient;
    </script>

    <!-- TRON wallet adapters (UMD global: window["@tronweb3/tronwallet-adapters"]) -->
    <script src="https://cdn.jsdelivr.net/npm/@tronweb3/tronwallet-adapters@1.3.3/lib/umd/index.js"></script>

    <!-- TronWeb (v6 has no dist/TronWeb.js — v5 UMD defines window.TronWeb) -->
    <script src="https://cdn.jsdelivr.net/npm/tronweb@5.3.0/dist/TronWeb.js"></script>

    <!-- ethers (BEP20 / EVM wallets) -->
    <script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>

    <!-- CryptoDirect -->
    <script src="assets/js/payment.js?v=5"></script>
    <script src="assets/js/bep20.js?v=5"></script>
    <script src="assets/js/app.js?v=5"></script>
</head>

<body>

    <!-- Product data for the client app (download links excluded) -->
    <script id="productsData" type="application/json"><?= $productsJson ?></script>

    <div class="header">
        <h1>🪙 CryptoDirect</h1>
        <p>Crypto Payment Store - Pay with USDT TRC20</p>
    </div>

    <div class="wallet-status" id="walletStatus">
        <div class="wallet-info">
            <span class="wallet-dot disconnected" id="walletDot"></span>
            <span id="walletText">Wallet not connected</span>
        </div>

        <button
            class="connect-wallet-btn"
            id="connectWalletBtn"
            type="button"
        >
            Connect Wallet
        </button>
    </div>

    <div id="warningContainer"></div>

    <div class="products-container" id="productsContainer">
        <?php foreach ($products as $p): ?>
        <div class="product-card" onclick="app.openPaymentModal('<?= cd_e($p['id']) ?>')">
            <div class="product-image">
                <img src="<?= cd_e($p['image']) ?>" alt="<?= cd_e($p['name']) ?>" loading="lazy"
                     onerror="this.closest('.product-image').classList.add('no-image'); this.remove();">
            </div>
            <div class="product-body">
                <div class="product-name"><?= cd_e($p['name']) ?></div>
                <div class="product-desc"><?= cd_e($p['description']) ?></div>
                <div class="product-price">$<?= number_format((float)$p['price'], 2) ?> USDT</div>
                <button class="product-btn" type="button">Buy Now</button>
            </div>
        </div>
        <?php endforeach; ?>
        <?php if (!$products): ?>
        <div class="no-products">No products available yet.</div>
        <?php endif; ?>
    </div>

    <div class="modal" id="paymentModal">

        <div class="modal-content">

            <div class="modal-header">
                <button
                    class="modal-close"
                    id="closeModal"
                    type="button"
                >
                    &times;
                </button>

                <div class="modal-title" id="modalTitle">
                    Product Details
                </div>
            </div>

            <div class="modal-body" id="modalBody"></div>

        </div>

    </div>

</body>
</html>
