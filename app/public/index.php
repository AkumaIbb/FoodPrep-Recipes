<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use App\Config;
use App\ContainerRepository;
use App\ContainerTypeRepository;
use App\Db;
use App\InventoryRepository;
use App\MealSetRepository;
use App\RecipeRepository;
use App\SetRepository;
use App\Http\Api\RecipeController;
use App\Http\Api\SetController;

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

renderPage($path);

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
    $containerTypeRepo = new ContainerTypeRepository($pdo);
    $containerRepo = new ContainerRepository($pdo);
    $recipeRepo = new RecipeRepository($pdo);
    $setRepo = new SetRepository($pdo);
    $recipeController = new RecipeController($recipeRepo);
    $setController = new SetController($setRepo, $inventoryRepo, $containerRepo);

    if ($recipeController->handle($method, $path)) {
        return;
    }

    if ($setController->handle($method, $path)) {
        return;
    }

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

    if ($method === 'GET' && $path === '/api/container-types') {
        $items = $containerTypeRepo->listTypes();
        jsonResponse(['ok' => true, 'items' => $items]);
        return;
    }

    if ($method === 'POST' && $path === '/api/container-types') {
        try {
            $payload = readJson();
            $id = $containerTypeRepo->create($payload);
            jsonResponse(['ok' => true, 'id' => $id], 201);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    if ($method === 'GET' && $path === '/api/containers') {
        $active = (string)($_GET['active'] ?? '1');
        $free = (string)($_GET['free'] ?? '');
        if (!in_array($active, ['1', '0', 'all'], true)) {
            $active = '1';
        }
        if ($free === '1') {
            $items = $containerRepo->listFreeContainers();
        } else {
            $items = $containerRepo->listContainers($active);
        }
        jsonResponse(['ok' => true, 'items' => $items]);
        return;
    }

    if ($method === 'POST' && $path === '/api/containers') {
        try {
            $payload = readJson();
            $id = $containerRepo->create($payload);
            jsonResponse(['ok' => true, 'id' => $id], 201);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    if ($method === 'PATCH' && preg_match('#^/api/containers/(\d+)$#', $path, $m)) {
        $id = (int)$m[1];
        try {
            $payload = readJson();
            $containerRepo->update($id, $payload);
            jsonResponse(['ok' => true]);
        } catch (RuntimeException $e) {
            jsonResponse(['error' => $e->getMessage()], 422);
        }
        return;
    }

    if ($method === 'GET' && $path === '/api/storage-standards') {
        jsonResponse(['ok' => true, 'items' => ['FREE', 'FREEZER_BAG', 'VACUUM_BAG']]);
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

function renderPage(string $path): void
{
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');

    $normalized = rtrim($path, '/') ?: '/';
    if ($normalized === '/recipes') {
        $page = 'recipes';
    } elseif ($normalized === '/sets') {
        $page = 'sets';
    } elseif (in_array($normalized, ['/containers', '/boxen', '/box-inventar'], true)) {
        $page = 'containers';
    } else {
        $page = 'inventory';
    }
    ?>
<!doctype html>
<html lang="de">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Freezer Inventory</title>
    <link rel="stylesheet" href="/assets/css/app.css" />
</head>
<body data-page="<?= htmlspecialchars($page) ?>">
    <header class="topbar">
        <div class="brand">Freezer Inventory</div>
        <div class="menu">
            <button id="burger" aria-label="Menü">☰</button>
            <div id="menu-drawer" class="menu-drawer hidden">
                <a href="/">Inventar</a>
                <a href="/containers">Box-Inventar</a>
                <a href="/sets">Sets</a>
                <a href="/recipes">Rezepte</a>
            </div>
        </div>
    </header>

    <?php if ($page === 'inventory'): ?>
    <section class="panel">
        <div class="filters">
            <button class="pill" data-filter="view" data-value="meals" aria-pressed="true">Meals</button>
            <button class="pill" data-filter="view" data-value="single">Einzel</button>
            <button class="pill" data-filter="view" data-value="ingredient">Zutaten</button>
            <button class="pill" data-filter="veggie">Veggie</button>
            <button class="pill" data-filter="expiring">Läuft bald ab</button>
            <div class="search">
                <input id="search" type="search" placeholder="Suche" />
            </div>
        </div>
        <div id="grid" class="card-grid"></div>
    </section>

    <div id="modal" class="modal hidden" role="dialog" aria-modal="true">
        <div class="modal-content">
            <button id="modal-close" class="close">×</button>
            <div id="modal-body"></div>
        </div>
    </div>
    <?php elseif ($page === 'sets'): ?>
    <main class="sets-page">
        <h1>Sets</h1>
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2>Set-Builder</h2>
                    <p class="sub">Komponenten planen und reale Boxen packen</p>
                </div>
                <div class="panel-actions">
                    <button id="new-set-btn" class="primary-btn">Neues Set</button>
                </div>
            </div>
            <div id="sets-error" class="error-banner hidden"></div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Notiz</th>
                            <th>Aktualisiert</th>
                            <th>Boxen</th>
                        </tr>
                    </thead>
                    <tbody id="sets-body">
                        <tr class="empty-row"><td colspan="4">Keine Sets vorhanden.</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

        <div id="set-modal" class="modal hidden" role="dialog" aria-modal="true">
            <div class="modal-content wide">
                <button id="set-modal-close" class="close">×</button>
                <h2>Set bauen</h2>
                <div id="set-modal-error" class="error-banner hidden"></div>
                <div class="wizard-steps">
                    <button type="button" class="pill active" data-step-target="1">1. Komponenten</button>
                    <button type="button" class="pill" data-step-target="2">2. Boxen</button>
                </div>

                <div id="set-step-1" class="wizard-step">
                    <form id="set-form" class="form-grid set-form-grid">
                        <label class="wide">Name
                            <input type="text" name="name" maxlength="200" required />
                        </label>
                        <label class="wide">Notiz
                            <textarea name="note" rows="2" maxlength="500"></textarea>
                        </label>
                    </form>
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Typ</th>
                                    <th>Quelle</th>
                                    <th>Menge</th>
                                    <th>kcal gesamt</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="components-body">
                                <tr class="empty-row"><td colspan="5">Keine Komponenten hinzugefügt.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <form id="component-form" class="component-form">
                        <label>Typ
                            <select name="component_type">
                                <option value="MEAL">Meal</option>
                                <option value="PROTEIN">Protein</option>
                                <option value="SAUCE">Sauce</option>
                                <option value="SIDE">Beilage</option>
                                <option value="BASE">Base</option>
                                <option value="BREAKFAST">Frühstück</option>
                                <option value="DESSERT">Dessert</option>
                                <option value="MISC">Misc</option>
                            </select>
                        </label>
                        <label>Quelle
                            <select name="source_type" id="component-source">
                                <option value="RECIPE">Rezept</option>
                                <option value="FREE">Freitext</option>
                            </select>
                        </label>
                        <label id="component-recipe-field">Rezept
                            <select name="recipe_id" id="component-recipe"></select>
                        </label>
                        <label id="component-free-field" class="hidden">Freitext
                            <input type="text" name="free_text" maxlength="255" />
                        </label>
                        <label>Menge
                            <input type="text" name="amount_text" maxlength="100" />
                        </label>
                        <label>Kcal gesamt
                            <input type="number" name="kcal_total" min="0" />
                        </label>
                        <div class="wizard-actions">
                            <button type="button" id="add-component-btn" class="secondary-btn">Komponente hinzufügen</button>
                        </div>
                    </form>
                    <div class="wizard-actions">
                        <button type="button" id="step1-next" class="primary-btn" disabled>Weiter</button>
                    </div>
                </div>

                <div id="set-step-2" class="wizard-step hidden">
                    <p>Freie Container: <span id="free-container-count">–</span></p>
                    <form id="box-form" class="box-form-grid">
                        <label>Container
                            <select name="container_id" id="box-container"></select>
                        </label>
                        <label>Box-Typ
                            <select name="box_type">
                                <option value="PROTEIN">Protein</option>
                                <option value="SIDE">Beilage</option>
                                <option value="SAUCE">Sauce</option>
                                <option value="BASE">Base</option>
                                <option value="BREAKFAST">Frühstück</option>
                                <option value="DESSERT">Dessert</option>
                                <option value="MISC">Misc</option>
                            </select>
                        </label>
                        <label>Portion-Faktor
                            <input type="number" step="0.1" min="0" name="portion_factor" />
                        </label>
                        <label>Portion-Text
                            <input type="text" name="portion_text" maxlength="50" />
                        </label>
                        <div class="checklist" id="component-checklist"></div>
                        <div class="wizard-actions">
                            <button type="button" id="add-box-btn" class="secondary-btn">Box hinzufügen</button>
                        </div>
                    </form>
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Typ</th>
                                    <th>Container</th>
                                    <th>Portionen</th>
                                    <th>Komponenten</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody id="boxes-body">
                                <tr class="empty-row"><td colspan="5">Noch keine Boxen hinzugefügt.</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div class="wizard-actions">
                        <button type="button" id="back-to-components" class="secondary-btn">Zurück</button>
                        <button type="button" id="pack-set-btn" class="primary-btn">Packen</button>
                    </div>
                </div>
            </div>
        </div>
    </main>
    <?php elseif ($page === 'recipes'): ?>
    <main class="recipes-page">
        <h1>Rezepte</h1>
        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2>Suche &amp; Filter</h2>
                    <p class="sub">Rezepte nach Typ und Ernährungsform durchsuchen</p>
                </div>
                <div class="panel-actions">
                    <button id="new-recipe-btn" class="primary-btn">Neues Rezept</button>
                </div>
            </div>
            <div class="filters recipes-filters">
                <div class="search">
                    <input id="recipe-search" type="search" placeholder="Suche nach Name, Zutaten, Tags" />
                </div>
                <label>Type
                    <select id="recipe-type-filter">
                        <option value="">Alle</option>
                        <option value="MEAL">Meal</option>
                        <option value="PROTEIN">Protein</option>
                        <option value="SAUCE">Sauce</option>
                        <option value="SIDE">Beilage</option>
                        <option value="BASE">Base</option>
                        <option value="BREAKFAST">Frühstück</option>
                        <option value="DESSERT">Dessert</option>
                        <option value="MISC">Misc</option>
                    </select>
                </label>
                <label>Sortierung
                    <select id="recipe-sort">
                        <option value="name">Name</option>
                        <option value="updated">Letzte Änderung</option>
                    </select>
                </label>
                <label class="checkbox">
                    <input type="checkbox" id="recipe-veggie-filter" /> Veggie
                </label>
                <label class="checkbox">
                    <input type="checkbox" id="recipe-vegan-filter" /> Vegan
                </label>
            </div>
            <div id="recipe-error" class="error-banner hidden"></div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Typ</th>
                            <th>Flags</th>
                            <th>Portionen</th>
                            <th>kcal/Portion</th>
                            <th>Aktualisiert</th>
                        </tr>
                    </thead>
                    <tbody id="recipes-body">
                        <tr class="empty-row"><td colspan="6">Keine Rezepte vorhanden.</td></tr>
                    </tbody>
                </table>
            </div>
        </section>

        <div id="recipe-modal" class="modal hidden" role="dialog" aria-modal="true">
            <div class="modal-content">
                <button id="recipe-modal-close" class="close">×</button>
                <h2 id="recipe-modal-title">Neues Rezept</h2>
                <div id="recipe-modal-error" class="error-banner hidden"></div>
                <form id="recipe-form" class="form-grid recipe-form-grid">
                    <label class="wide">Name
                        <input type="text" name="name" required maxlength="200" />
                    </label>
                    <label>Typ
                        <select name="recipe_type">
                            <option value="MEAL">Meal</option>
                            <option value="PROTEIN">Protein</option>
                            <option value="SAUCE">Sauce</option>
                            <option value="SIDE">Beilage</option>
                            <option value="BASE">Base</option>
                            <option value="BREAKFAST">Frühstück</option>
                            <option value="DESSERT">Dessert</option>
                            <option value="MISC">Misc</option>
                        </select>
                    </label>
                    <label>Portionen
                        <input type="number" name="yield_portions" min="1" />
                    </label>
		    <label>Kcal/Portion
		      <input type="number" name="kcal_per_portion" min="0" />
		    </label>
		    <div class="gpt-row">
		      <button type="button" id="kcal-estimate" class="secondary-btn">Kalorien mit ChatGPT schätzen</button>
		    </div>
                    <label>Haltbarkeit (Tage)
                        <input type="number" name="default_best_before_days" min="0" />
                    </label>
                    <label>Tags (Komma-separiert)
                        <input type="text" name="tags_text" maxlength="200" />
                    </label>
		    <div class="check-row wide">
		        <label class="checkbox">
		           <input type="checkbox" name="is_veggie" /> Veggie
			</label>
    			<label class="checkbox">
        		   <input type="checkbox" name="is_vegan" /> Vegan
    			</label>
		    </div>
		    <label class="wide">Zutaten
                        <textarea name="ingredients_text" rows="4" placeholder="500 g Kartoffeln, mehligkochend&#10;1 Ei&#10;Salz, Pfeffer, Muskat&#10;1 EL Sonnenblumenöl"></textarea>
                    </label>
                    <label class="wide">Zubereitung
                        <textarea name="prep_text" rows="4"></textarea>
                    </label>
                    <label class="wide">Auftauen &amp; Aufwärmen
                        <textarea name="reheat_text" rows="3"></textarea>
                    </label>
                    <div class="form-actions wide">
                        <button type="submit" class="primary-btn">Speichern</button>
                    </div>
                </form>
            </div>
        </div>
    </main>
    <div id="toast" class="toast hidden" role="status" aria-live="polite"></div>
    <?php else: ?>
    <main class="container-page">
        <h1>Box-Inventar</h1>

        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2>Container Types</h2>
                    <p class="sub">Form, Volumen und Material je Typ</p>
                </div>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Shape</th>
                            <th>Vol. (ml)</th>
                            <th>Maße (mm)</th>
                            <th>Material</th>
                            <th>Notiz</th>
                        </tr>
                    </thead>
                    <tbody id="container-types-body">
                        <tr class="empty-row"><td colspan="5">Keine Typen erfasst.</td></tr>
                    </tbody>
                </table>
            </div>
            <form id="container-type-form" class="inline-form">
                <div class="form-grid">
                    <label>Shape
                        <select name="shape" required>
                            <option value="">-- wählen --</option>
                            <option value="RECT">Rechteck</option>
                            <option value="ROUND">Rund</option>
                            <option value="OVAL">Oval</option>
                        </select>
                    </label>
                    <label>Volume (ml)
                        <input type="number" name="volume_ml" min="1" required />
                    </label>
                    <label>Height (mm)
                        <input type="number" name="height_mm" min="1" />
                    </label>
                    <label>Width (mm)
                        <input type="number" name="width_mm" min="1" />
                    </label>
                    <label>Length (mm)
                        <input type="number" name="length_mm" min="1" />
                    </label>
                    <label>Material
                        <select name="material">
                            <option value="">-- optional --</option>
                            <option value="PLASTIC">Plastic</option>
                            <option value="GLASS">Glass</option>
                        </select>
                    </label>
                    <label class="wide">Notiz
                        <input type="text" name="note" maxlength="100" />
                    </label>
                </div>
                <button type="submit">Neuer Typ</button>
            </form>
        </section>

        <section class="panel">
            <div class="panel-header">
                <div>
                    <h2>Container</h2>
                    <p class="sub">Aktive Boxen und Zuordnung zu Typen</p>
                </div>
                <div class="panel-actions">
                    <label>Filter
                        <select id="container-filter-active">
                            <option value="1">Aktiv</option>
                            <option value="0">Inaktiv</option>
                            <option value="all">Alle</option>
                        </select>
                    </label>
                </div>
            </div>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Code</th>
                            <th>Typ</th>
                            <th>Vol. (ml)</th>
                            <th>Material</th>
                            <th>Status</th>
                            <th>Notiz</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="containers-body">
                        <tr class="empty-row"><td colspan="7">Keine Container angelegt.</td></tr>
                    </tbody>
                </table>
            </div>
            <form id="container-form" class="inline-form">
                <div class="form-grid">
                    <label>Code
                        <input type="text" name="container_code" required />
                    </label>
                    <label>Typ
                        <select name="container_type_id" id="container-type-select">
                            <option value="">-- optional --</option>
                        </select>
                    </label>
                    <label>Notiz
                        <input type="text" name="note" maxlength="200" />
                    </label>
                    <label class="checkbox">
                        <input type="checkbox" name="is_active" checked /> Aktiv
                    </label>
                </div>
                <button type="submit">Neue Box</button>
                <p class="muted">Hinweis: Boxen können später einer Inventar-ID zugeordnet werden. Wenn storage_type ≠ BOX, bleibt container_id leer.</p>
            </form>
        </section>
    </main>
    <?php endif; ?>

    <script src="/assets/js/app.js"></script>
</body>
</html>
<?php
}
