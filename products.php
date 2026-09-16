<?php
/**
 * CryptoDirect — products endpoint (JSON)
 * Download links are never exposed here; only api/order.php can release them.
 */

declare(strict_types=1);

require_once __DIR__ . '/../includes/db.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$products = array_map(static fn(array $p): array => [
    'id'          => $p['id'],
    'name'        => $p['name'],
    'description' => $p['description'],
    'price'       => (float)$p['price'],
    'image'       => $p['image'],
    'wallet'      => $p['wallet'],
    'created_at'  => (int)$p['created_at'],
], cd_products());

echo json_encode(['products' => $products], JSON_UNESCAPED_SLASHES);
