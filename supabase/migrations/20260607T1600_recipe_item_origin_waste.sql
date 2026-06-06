-- 20260607T1600_recipe_item_origin_waste.sql
--
-- T2.1 ficha de ingrediente: dos campos nuevos en recipe_item.
--   · default_waste_pct (numeric): merma por defecto del ingrediente. El coste
--     real usa cantidad bruta; este % es el valor por defecto que arrastra a las
--     líneas de receta donde se usa.
--   · origin (text): procedencia / origen del producto (trazabilidad).
--
-- Idempotente (IF NOT EXISTS): seguro de re-ejecutar. Ya aplicado en la BBDD
-- viva el 07/06; este fichero solo cierra el drift (la migración no estaba
-- versionada). DDL puro, sin transacción explícita.

alter table recipe_item
  add column if not exists default_waste_pct numeric,
  add column if not exists origin text;
