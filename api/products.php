<?php
declare(strict_types=1);
require_once __DIR__ . '/../includes/db.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
try {
    $products = array_map(static fn(array $p): array => [
        'id'=>$p['id'],'name'=>$p['name'],'description'=>$p['description'],'price'=>(float)$p['price'],
        'image'=>$p['image'],'wallet'=>$p['wallet'],'created_at'=>(int)$p['created_at']
    ], cd_products());
    echo json_encode(['ok'=>true,'products'=>$products], JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok'=>false,'error'=>'Could not load products.']);
}
