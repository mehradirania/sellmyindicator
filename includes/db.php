<?php
/**
 * CryptoDirect — SQLite database bootstrap
 *
 * The database lives OUTSIDE the webroot so it can never be downloaded
 * through the web server.
 */

declare(strict_types=1);

define('CD_DB_PATH', dirname(__DIR__, 2) . '/private_data/cryptodirect.sqlite');

/**
 * Lazily create/open the SQLite database, ensuring schema + seed data exist.
 */
function cd_db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dir = dirname(CD_DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }

    $isNew = !file_exists(CD_DB_PATH);

    $pdo = new PDO('sqlite:' . CD_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    cd_migrate($pdo);

    if ($isNew) {
        cd_seed($pdo);
    }

    return $pdo;
}

function cd_migrate(PDO $pdo): void
{
    $pdo->exec('
        CREATE TABLE IF NOT EXISTS products (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT "",
            price       REAL NOT NULL,
            image       TEXT NOT NULL DEFAULT "",
            file        TEXT NOT NULL DEFAULT "",
            wallet      TEXT NOT NULL DEFAULT "",
            created_at  INTEGER NOT NULL DEFAULT 0
        )
    ');

    $pdo->exec('
        CREATE TABLE IF NOT EXISTS orders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            network    TEXT NOT NULL,
            tx_hash    TEXT NOT NULL,
            sender     TEXT NOT NULL DEFAULT "",
            recipient  TEXT NOT NULL DEFAULT "",
            amount     REAL NOT NULL DEFAULT 0,
            verified   INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
    ');

    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tx ON orders (tx_hash)');
}

/**
 * Seed with the original CryptoDirect product.
 */
function cd_seed(PDO $pdo): void
{
    $stmt = $pdo->prepare('
        INSERT OR IGNORE INTO products (id, name, description, price, image, file, wallet, created_at)
        VALUES (:id, :name, :description, :price, :image, :file, :wallet, :created_at)
    ');

    $stmt->execute([
        ':id'          => 'A7kD9sBfP2LmQxT4V',
        ':name'        => 'PST Trend Indicator',
        ':description' => "The best trend-detection indicator in the world, built on Mehrad Irani's eleven years of professional experience in Forex and Cryptocurrency markets. PST analyzes every layer of the market using a multi-timeframe matrix and shows you exactly why its analysis is trustworthy.\n\nWith real-time entry and exit lines displayed directly on the chart, PST gives you the confidence to enter trades with zero hesitation.\n\nAdditionally, by following a strict 1:2 risk-to-reward ratio, PST protects your capital automatically. You only set your account usage, and PST handles the analysis and risk management for you.\n\nThis is the ultimate indicator for traders who want accuracy, confidence, and professional-level risk control.",
        ':price'       => 299.0,
        ':image'       => 'https://raw.githubusercontent.com/mehradirania/CryptoDirect/main/IMG_20260621_174250_857.jpg',
        ':file'        => 'https://www.dropbox.com/scl/fo/lccpf7saii8ynchui9r8x/AOnz6Th0xNLpeiF3goca09A?rlkey=olpr9mmnxfftscygt3iuuv372&st=nuxealqn&dl=0',
        ':wallet'      => 'TN9sBCbSbd4LSmEa9xJfTJJLVLWFyo4p4Y',
        ':created_at'  => 1726200000,
    ]);
}

/**
 * All products, newest first.
 */
function cd_products(): array
{
    return cd_db()
        ->query('SELECT * FROM products ORDER BY created_at DESC')
        ->fetchAll();
}

/**
 * A single product by id.
 */
function cd_product(string $id): ?array
{
    $stmt = cd_db()->prepare('SELECT * FROM products WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    return $row ?: null;
}
