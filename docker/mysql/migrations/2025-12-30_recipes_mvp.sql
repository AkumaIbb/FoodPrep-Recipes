-- Migration: extend recipes table for richer metadata
-- Run manually against existing databases

ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS recipe_type ENUM('MEAL','PROTEIN','SAUCE','SIDE','BASE','BREAKFAST','DESSERT','MISC') NOT NULL DEFAULT 'MEAL' AFTER name,
    ADD COLUMN IF NOT EXISTS ingredients_text MEDIUMTEXT NULL AFTER recipe_type,
    ADD COLUMN IF NOT EXISTS prep_text MEDIUMTEXT NULL AFTER ingredients_text,
    ADD COLUMN IF NOT EXISTS reheat_text MEDIUMTEXT NULL AFTER prep_text,
    ADD COLUMN IF NOT EXISTS yield_portions SMALLINT UNSIGNED NULL AFTER reheat_text,
    ADD COLUMN IF NOT EXISTS kcal_per_portion SMALLINT UNSIGNED NULL AFTER yield_portions,
    ADD COLUMN IF NOT EXISTS is_veggie TINYINT(1) NOT NULL DEFAULT 0 AFTER kcal_per_portion,
    ADD COLUMN IF NOT EXISTS is_vegan TINYINT(1) NOT NULL DEFAULT 0 AFTER is_veggie,
    ADD COLUMN IF NOT EXISTS tags_text VARCHAR(200) NULL AFTER is_vegan;

ALTER TABLE recipes
    ADD INDEX IF NOT EXISTS idx_recipes_type (recipe_type),
    ADD INDEX IF NOT EXISTS idx_recipes_flags (is_veggie, is_vegan);
