<?php
declare(strict_types=1);
require_once __DIR__ . '/includes/db.php';

try {
    $products = cd_products();
} catch (Throwable $e) {
    http_response_code(500);
    exit('Store initialization failed. Check PHP PDO_SQLITE and directory permissions.');
}

$publicProducts = array_map(static fn(array $p): array => [
    'id' => $p['id'], 'name' => $p['name'], 'description' => $p['description'],
    'price' => (float)$p['price'], 'image' => $p['image'], 'wallet' => $p['wallet'],
    'created_at' => (int)$p['created_at'],
], $products);

$productsJson = json_encode($publicProducts, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
if ($productsJson === false) $productsJson = '[]';

function cd_e(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CryptoDirect – Crypto Store</title>
<meta name="description" content="Crypto payment store for digital products.">
<link rel="stylesheet" href="assets/css/style.css?v=11">
<script src="https://cdn.jsdelivr.net/npm/@walletconnect/sign-client@2.23.4/dist/index.umd.js"></script>
<script>window["@walletconnect/sign-client"]=window.SignClient;</script>
<script src="https://cdn.jsdelivr.net/npm/@tronweb3/tronwallet-adapters@1.3.3/lib/umd/index.js"></script>
<script src="https://cdn.jsdelivr.net/npm/tronweb@5.3.0/dist/TronWeb.js"></script>
<script src="https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.umd.min.js"></script>
<script src="assets/js/config.js?v=11"></script>
<script src="assets/js/utils.js?v=11"></script>
<script src="assets/js/payment.js?v=11"></script>
<script src="assets/js/bep20.js?v=11"></script>
<script src="assets/js/app.js?v=11"></script>
</head>
<body>
<script id="productsData" type="application/json"><?= $productsJson ?></script>
<header class="header"><h1>🪙 CryptoDirect</h1><p>Crypto Payment Store</p></header>
<div class="wallet-status" id="walletStatus">
  <div class="wallet-info"><span class="wallet-dot disconnected" id="walletDot"></span><span id="walletText">Wallet not connected</span></div>
  <button class="connect-wallet-btn" id="connectWalletBtn" type="button">Connect Wallet</button>
</div>
<div id="warningContainer"></div>
<main class="products-container" id="productsContainer">
<?php foreach ($products as $p): ?>
<article class="product-card" data-product-id="<?= cd_e((string)$p['id']) ?>">
  <div class="product-image"><img src="<?= cd_e((string)$p['image']) ?>" alt="<?= cd_e((string)$p['name']) ?>" loading="lazy"></div>
  <div class="product-body">
    <div class="product-name"><?= cd_e((string)$p['name']) ?></div>
    <div class="product-desc"><?= cd_e((string)$p['description']) ?></div>
    <div class="product-price">$<?= number_format((float)$p['price'], 2) ?> USDT</div>
    <button class="product-btn" type="button">Buy Now</button>
  </div>
</article>
<?php endforeach; ?>
<?php if (!$products): ?><div class="no-products">No products available yet.</div><?php endif; ?>
</main>
<div class="modal" id="paymentModal" aria-hidden="true">
  <div class="modal-content" role="dialog" aria-modal="true">
    <div class="modal-header"><button class="modal-close" id="closeModal" type="button" aria-label="Close">&times;</button><div class="modal-title" id="modalTitle">Product Details</div></div>
    <div class="modal-body" id="modalBody"></div>
  </div>
</div>
</body>
</html>
