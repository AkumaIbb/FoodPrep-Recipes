-- =========================================================
-- Freezer Inventory – Example / Seed Data
-- =========================================================

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET sql_safe_updates = 0;

-- -----------------------------
-- 1) Container Type (Demo) + Container (Demo)
-- -----------------------------
INSERT INTO container_types (shape, volume_ml, height_mm, width_mm, length_mm, material, note)
VALUES ('RECT', 1000, 70, 120, 180, 'PLASTIC', 'Demo: 1.0L rechteckig')
ON DUPLICATE KEY UPDATE
  height_mm = VALUES(height_mm),
  width_mm  = VALUES(width_mm),
  length_mm = VALUES(length_mm),
  material  = VALUES(material),
  note      = VALUES(note);

INSERT INTO containers (container_code, container_type_id, is_active, note)
SELECT
  'BOX-01' AS container_code,
  ct.id    AS container_type_id,
  1        AS is_active,
  'Demo-Box' AS note
FROM container_types ct
WHERE ct.shape='RECT' AND ct.volume_ml=1000
ON DUPLICATE KEY UPDATE
  container_type_id = VALUES(container_type_id),
  is_active         = VALUES(is_active),
  note              = VALUES(note);

-- -----------------------------
-- 2) Demo Rezept
-- -----------------------------
INSERT INTO recipes (name, description, instructions, default_best_before_days)
VALUES ('Demo: Rouladen-Set', 'Seed-Daten für UI (kannst du löschen).', 'Nur Demo – keine echte Anleitung.', 90)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  instructions = VALUES(instructions),
  default_best_before_days = VALUES(default_best_before_days);

-- -----------------------------
-- 3) Demo Meal-Set (Bundle)
-- -----------------------------
INSERT INTO meal_sets (set_code, name, description, recipe_id, is_active)
SELECT
  'DEMO-SET' AS set_code,
  'Rouladen-Set (Demo)' AS name,
  'Beispiel: Protein + Beilage + Soße' AS description,
  r.id AS recipe_id,
  1 AS is_active
FROM recipes r
WHERE r.name = 'Demo: Rouladen-Set'
ON DUPLICATE KEY UPDATE
  name        = VALUES(name),
  description = VALUES(description),
  recipe_id   = VALUES(recipe_id),
  is_active   = VALUES(is_active);

-- Requirements: 1x P, 1x B, 1x S
INSERT INTO meal_set_requirements (meal_set_id, required_type, required_count, require_veggie)
SELECT ms.id, 'P', 1, 0
FROM meal_sets ms
WHERE ms.set_code='DEMO-SET'
ON DUPLICATE KEY UPDATE required_count = VALUES(required_count);

INSERT INTO meal_set_requirements (meal_set_id, required_type, required_count, require_veggie)
SELECT ms.id, 'B', 1, 0
FROM meal_sets ms
WHERE ms.set_code='DEMO-SET'
ON DUPLICATE KEY UPDATE required_count = VALUES(required_count);

INSERT INTO meal_set_requirements (meal_set_id, required_type, required_count, require_veggie)
SELECT ms.id, 'S', 1, 0
FROM meal_sets ms
WHERE ms.set_code='DEMO-SET'
ON DUPLICATE KEY UPDATE required_count = VALUES(required_count);

-- -----------------------------
-- 4) Demo Inventory Items
-- -----------------------------
-- P000 in BOX-01 (storage_type=BOX + container_id gesetzt)
INSERT INTO inventory_items
  (id_code, item_type, name, recipe_id, is_veggie, is_vegan,
   portion_text, weight_g, kcal,
   frozen_at, best_before_at,
   prep_notes, thaw_method, reheat_minutes,
   status, storage_type, container_id)
SELECT
  'P000', 'P', 'Roulade (Demo)', r.id, 0, 0,
  '1 Stück', 180, 420,
  (CURDATE() - INTERVAL 14 DAY), NULL,
  'Pfanne/Ofen, 8–10 min', 'PAN', 10,
  'IN_FREEZER', 'BOX', c.id
FROM recipes r
JOIN containers c ON c.container_code='BOX-01'
WHERE r.name='Demo: Rouladen-Set'
ON DUPLICATE KEY UPDATE
  name = VALUES(name);

-- B000 frei (ohne Container)
INSERT INTO inventory_items
  (id_code, item_type, name, recipe_id, is_veggie, is_vegan,
   portion_text, weight_g, kcal,
   frozen_at, best_before_at,
   prep_notes, thaw_method, reheat_minutes,
   status, storage_type, container_id)
SELECT
  'B000', 'B', 'Rotkohl (Demo)', r.id, 1, 1,
  '1 Portion', 200, 160,
  (CURDATE() - INTERVAL 10 DAY), NULL,
  'Mikro 3–4 min', 'MICROWAVE', 4,
  'IN_FREEZER', 'FREE', NULL
FROM recipes r
WHERE r.name='Demo: Rouladen-Set'
ON DUPLICATE KEY UPDATE
  name = VALUES(name);

-- S000 in FREEZER_BAG (storage_type=FREEZER_BAG + container_id NULL)
INSERT INTO inventory_items
  (id_code, item_type, name, recipe_id, is_veggie, is_vegan,
   portion_text, volume_ml, kcal,
   frozen_at, best_before_at,
   prep_notes, thaw_method, reheat_minutes,
   status, storage_type, container_id)
SELECT
  'S000', 'S', 'Rouladensoße (Demo)', r.id, 0, 0,
  '1 Portion', 80, 120,
  (CURDATE() - INTERVAL 7 DAY), NULL,
  'Sanft erwärmen', 'MICROWAVE', 2,
  'IN_FREEZER', 'FREEZER_BAG', NULL
FROM recipes r
WHERE r.name='Demo: Rouladen-Set'
ON DUPLICATE KEY UPDATE
  name = VALUES(name);

-- -----------------------------
-- 5) Zuordnung Items -> Meal-Set
-- role_type = item_type
-- -----------------------------
INSERT INTO meal_set_items (meal_set_id, inventory_item_id, role_type)
SELECT
  ms.id AS meal_set_id,
  ii.id AS inventory_item_id,
  ii.item_type AS role_type
FROM meal_sets ms
JOIN inventory_items ii ON ii.id_code IN ('P000','B000','S000')
WHERE ms.set_code='DEMO-SET'
ON DUPLICATE KEY UPDATE
  role_type = VALUES(role_type);

-- -----------------------------
-- 6) Optional: Rating für P000
-- -----------------------------
INSERT INTO ratings (inventory_item_id, ease_stars, fresh_stars, thawed_stars, notes)
SELECT
  ii.id, 3, 4, 4, 'Demo-Rating'
FROM inventory_items ii
WHERE ii.id_code='P000'
ON DUPLICATE KEY UPDATE
  ease_stars   = VALUES(ease_stars),
  fresh_stars  = VALUES(fresh_stars),
  thawed_stars = VALUES(thawed_stars),
  notes        = VALUES(notes);
