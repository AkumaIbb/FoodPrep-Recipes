<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use App\Db;
use App\Config;
use App\Http\Router;

$router = new Router();

$router->get('/', function () {
    return [
        'ok' => true,
        'service' => 'freezer-inventory',
        'hint' => 'try /health',
    ];
});

$router->get('/health', function () {
    $started = microtime(true);

    $dbOk = false;
    $dbError = null;

    try {
        $pdo = Db::pdo();
        $pdo->query('SELECT 1')->fetch();
        $dbOk = true;
    } catch (Throwable $e) {
        $dbOk = false;
        $dbError = $e->getMessage();
    }

    return [
        'ok' => $dbOk,
        'service' => 'freezer-inventory',
        'env' => Config::env('APP_ENV', 'dev'),
        'time' => date('c'),
        'db' => [
            'ok' => $dbOk,
            'host' => Config::env('DB_HOST', 'mysql'),
            'name' => Config::env('DB_NAME', 'freezer_inventory'),
            'error' => $dbError,
        ],
        'latency_ms' => (int) round((microtime(true) - $started) * 1000),
    ];
});

$router->dispatch();
