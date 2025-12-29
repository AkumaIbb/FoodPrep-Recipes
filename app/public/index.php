<?php
declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use App\Db;

$db = Db::pdo();

echo "<h1>Freezer Inventory</h1>";
echo "<p>DB OK ✅</p>";
