<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use App\Config;
use App\Db;
use App\InventoryRepository;
use App\MealSetRepository;

$pdo = Db::pdo();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

if ($path === '/health') {
    echo json_encode(healthCheck(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (str_starts_with($path, '/api/')) {
    handleApi($method, $path, $pdo);
    exit;
}

renderPage();

function jsonResponse(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function healthCheck(): array
{
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
}

function handleApi(string $method, string $path, PDO $pdo): void
{
    $mealRepo = new MealSetRepository($pdo);
    $inventoryRepo = new InventoryRepository($pdo);

    if ($method === 'GET' && $path === '/api/meal_sets') {
        $filters = collectFilters($_GET ?? []);
        $limit = (int)($_GET['limit'] ?? 20);
        $offset = (int)($_GET['offset'] ?? 0);
        $data = $mealRepo->listSets($filters, $limit, $offset);
        jsonResponse(['items' => $data]);
        return;
    }

    if ($method === 'GET' && preg_match('#^/api/meal_sets/(\d+)$#', $path, $m)) {
        $id = (int)$m[1];
        $filters = collectFilters($_GET ?? []);
        $set = $mealRepo->getSet($id, $filters);
        if (!$set) {
            jsonResponse(['error' => 'not_found'], 404);
            return;
        }
        jsonResponse($set);
        return;
    }

    if ($method === 'POST' && preg_match('#^/api/meal_sets/(\d+)/takeout$#', $path, $m)) {
        $id = (int)$m[1];
        $body = readJson();
        $itemIds = $body['item_ids'] ?? null;
        if (empty($itemIds)) {
            $itemIds = $mealRepo->chooseFifoItemsForSingleSet($id);
        }

        if (empty($itemIds)) {
            jsonResponse(['error' => 'no_items_available'], 422);
            return;
        }

        try {
            $changed = $inventoryRepo->takeoutItems($itemIds);
            jsonResponse(['ok' => true, 'item_ids' => $changed]);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    if ($method === 'GET' && $path === '/api/inventory') {
        $filters = collectFilters($_GET ?? []);
        $limit = (int)($_GET['limit'] ?? 20);
        $offset = (int)($_GET['offset'] ?? 0);
        $view = $_GET['view'] ?? 'single';
        $data = $inventoryRepo->listItems($view, $filters, $limit, $offset);
        jsonResponse(['items' => $data]);
        return;
    }

    if ($method === 'POST' && $path === '/api/inventory') {
        try {
            $payload = readJson();
            $created = $inventoryRepo->createItem($payload);
            jsonResponse($created, 201);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    if ($method === 'POST' && $path === '/api/inventory/takeout') {
        $body = readJson();
        $ids = $body['item_ids'] ?? [];
        if (empty($ids)) {
            jsonResponse(['error' => 'no_items_selected'], 422);
            return;
        }

        try {
            $changed = $inventoryRepo->takeoutItems($ids);
            jsonResponse(['ok' => true, 'item_ids' => $changed]);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    jsonResponse(['error' => 'not_found'], 404);
}

function collectFilters(array $input): array
{
    return [
        'q' => trim((string)($input['q'] ?? '')),
        'veggie' => !empty($input['veggie']),
        'expiring' => !empty($input['expiring']),
    ];
}

function readJson(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function renderPage(): void
{
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    ?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Freezer Inventory</title>
    <link rel="stylesheet" href="/assets/css/app.css" />
</head>
<body>
    <header class="topbar">
        <div class="filters">
            <button class="pill" data-filter="view" data-value="meals" aria-pressed="true">Meals</button>
            <button class="pill" data-filter="view" data-value="single">Einzel</button>
            <button class="pill" data-filter="view" data-value="ingredient">Zutaten</button>
            <button class="pill" data-filter="veggie">Veggie</button>
            <button class="pill" data-filter="expiring">Läuft bald ab</button>
        </div>
        <div class="search">
            <input id="search" type="search" placeholder="Suche" />
        </div>
        <div class="menu">
            <button id="burger" aria-label="Menü">☰</button>
            <div id="menu-drawer" class="menu-drawer hidden">
                <a href="#">Neuanlage</a>
                <a href="#">Rezepte</a>
                <a href="#">Inventar</a>
                <a href="#">Box-Inventar</a>
            </div>
        </div>
    </header>

    <main>
        <div id="grid" class="card-grid"></div>
    </main>

    <div id="modal" class="modal hidden" role="dialog" aria-modal="true">
        <div class="modal-content">
            <button id="modal-close" class="close">×</button>
            <div id="modal-body"></div>
        </div>
    </div>

    <script src="/assets/js/app.js"></script>
</body>
</html>
<?php
}
