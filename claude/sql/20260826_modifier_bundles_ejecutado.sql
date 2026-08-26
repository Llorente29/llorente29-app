-- 20260826_modifier_bundles_ejecutado.sql
-- EJECUTADO en produccion el 26-08-2026. Constancia, no re-ejecutable a ciegas.
--
-- Cierra el ultimo eslabon: los modifier-producto de los combos Smash.
-- Autorizado por Julio. Datos de las dos fichas dados por el.

-- ── 1) Bacon que faltaba en Double Smash Bacon Cheeseburger ──────────────
-- Hallazgo: su escandallo NO llevaba bacon, por eso costaba menos (2,9977 EUR)
-- que la doble normal (3,1124). Julio confirma 2 lonchas = 40 g.
insert into recipe_line (account_id, parent_item_id, child_item_id,
                         quantity_net, quantity_gross, unit_id, position)
select '51ad1792-6629-4ef7-833a-b57b09a86710',
       'cdbeef4a-153d-4ccf-85ba-33e2a84f2f8a',   -- Double Smash Bacon Cheeseburger
       'e27f3b44-3c2b-4334-9a77-02ec96f7b307',   -- Bacon Ahumado
       40, 40, (select id from kitchen_unit where abbreviation='g' limit 1), 13
where not exists (
  select 1 from recipe_line rl
   where rl.parent_item_id='cdbeef4a-153d-4ccf-85ba-33e2a84f2f8a'
     and rl.child_item_id='e27f3b44-3c2b-4334-9a77-02ec96f7b307');

-- ── 2) Recosteo ──────────────────────────────────────────────────────────
select public.kitchen_recompute_item('8dc46a08-69a6-4593-ba19-39fc22a5381d'); -- Salsa Mayo Harissa
select public.kitchen_recompute_item('f0d83895-05cb-4413-98df-7aa9a804a726'); -- Smash Bacon Cheeseburger
select public.kitchen_recompute_item('0fd7ae77-a1eb-47da-a3ca-70ebf5d21128'); -- Fried Chicken Burger
select public.kitchen_recompute_item('cdbeef4a-153d-4ccf-85ba-33e2a84f2f8a'); -- Double Smash Bacon
--
-- Resultado:
--   Smash Cheeseburger                2,3335  (sin cambio, referencia)
--   Smash Bacon Cheeseburger          2,7642  = 2,3335 + 40 g bacon
--   Double Smash Bacon Cheeseburger   3,4284  (era 2,9977; ya cuesta mas que
--                                              la doble normal, 3,1124)
--   Fried Chicken Burger              2,1135
--   Salsa Mayo Harissa                0,0037 EUR/g
--
-- batch_yield del PR #83 VERIFICADO: 750 g mayonesa x 0,003994 = 2,9955 EUR
-- entre 820 g de lote = 0,003653 EUR/g. Y la explosion da 27,4390 g de
-- mayonesa por 30 g de salsa (750 x 30/820). Correcto.

-- ── 3) Los 16 impactos 'bundle' ──────────────────────────────────────────
-- Modifier-producto: la opcion se llama igual que un producto vivo de su marca
-- (match unico por nombre normalizado). Sus componentes no llegan como
-- combo_item, asi que sin esto no descuenta nada.
with mods as (
  select distinct m.modifier_option_id, s.brand_id,
         public.sales_product_norm(m.product_name) as norm
    from sale_line m join sale s on s.id=m.sale_id
   where m.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and m.line_type='modifier' and m.menu_item_id is null and m.modifier_option_id is not null),
carta as (
  select mi.brand_id, public.sales_product_norm(mi.name) as norm,
         min(mi.recipe_item_id::text) as recipe_id, count(*) as n
    from menu_item mi
   where mi.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and mi.archived_at is null
     and mi.recipe_item_id is not null
   group by 1,2)
insert into modifier_recipe_impact
  (account_id, modifier_option_id, impact_type, target_recipe_item_id, quantity, unit_id,
   status, source, confidence, rationale, confirmed_by_name, confirmed_at)
select '51ad1792-6629-4ef7-833a-b57b09a86710', m.modifier_option_id, 'bundle',
       c.recipe_id::uuid, 1, ri.base_unit_id,
       'confirmed', 'import', 1,
       'Modifier-producto: la opcion se llama igual que un producto vivo de su marca (match unico por nombre normalizado). Sus componentes no llegan como combo_item, asi que sin esto no descuenta nada.',
       'Julio (via Claude)', now()
  from mods m
  join carta c on c.brand_id=m.brand_id and c.norm=m.norm and c.n=1
  join recipe_item ri on ri.id = c.recipe_id::uuid
 where not exists (select 1 from modifier_recipe_impact x
                    where x.modifier_option_id = m.modifier_option_id);
-- 16 filas.

-- ── VERIFICACION ─────────────────────────────────────────────────────────
-- Combo Duo Smash pasa de 0 raws a consumir dos Double Smash Cheeseburger
-- completas (12 filas: pan x2, carne x2, cheddar x2, cebolla x2, pepinillos x2,
-- mil islas x2). Comprobado con _sale_line_raw_consumption sobre una linea real.
--
-- Aviso de Cartas: 49 -> 42 sin escandallo; 5.105,18 -> 913,48 EUR.
-- 20 productos (27.269,68 EUR) pasan a declararse "consumen por modifiers".

-- ── PENDIENTE, NO TOCADO ─────────────────────────────────────────────────
-- "Pasta Harisa" (ebefab05-3baf-4f6e-a887-309ea36fd831) tiene base_unit = 'ud'
-- pero la receta la mide en 'g'. _qty_in_base devuelve NULL y la linea se cae
-- SIN AVISO de la explosion: la Salsa Mayo Harissa solo descuenta mayonesa.
-- Su coste es 0, asi que el importe no cambia — pero el stock de harissa nunca
-- baja. Cambiar la unidad base de un ingrediente afecta al almacen: decision
-- de Julio, no se toca aqui.
