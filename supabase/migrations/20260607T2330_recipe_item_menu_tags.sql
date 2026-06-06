-- 20260607T2330_recipe_item_menu_tags.sql
--
-- Etiquetas de cara al MENÚ en el ingrediente (picante, vegano, sin gluten...).
-- Son atributos comerciales que luego se heredan/agregan al plato y alimentan
-- la carta (Glovo/web). Distintas de los alérgenos (que son declaración legal):
-- estas son reclamo de menú.
--
-- text[] con un set curado (no campos a medida): la IA las propone y el cocinero
-- confirma. Aditivo (default '{}'), no rompe nada existente. DDL idempotente.

alter table recipe_item
  add column if not exists menu_tags text[] not null default '{}';
