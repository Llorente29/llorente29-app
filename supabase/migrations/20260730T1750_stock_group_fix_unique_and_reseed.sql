-- 20260730T1750_stock_group_fix_unique_and_reseed.sql
-- ============================================================================
-- CORRECTIVA — 20260730T1720 dejó 38 filas en stock_group (19 hubrise_ref
-- duplicados x2). CAUSA RAÍZ: uq_stock_group_hubrise_ref (compuesto
-- account_id, hubrise_ref) no existía de verdad en la BBDD viva pese a que
-- 20260730T1700 reportó "Success" — el ON CONFLICT del seed no tenía nada
-- que machear, así que la segunda ejecución insertó los 19 grupos otra vez.
--
-- REQUIERE (aplicadas ANTES que esta, por timestamp):
--   · 20260730T1712 — reconstruye trg_menu_item_inherit_stock_group (el
--     trigger de auto-herencia TAMPOCO existía pese a "Success" en 1710).
--   · 20260730T1713 — reconstruye uq_stock_group_hubrise_ref.
-- Esta migración YA NO crea esos objetos (lo hacen 1712/1713, aisladas y con
-- su propio guard) — solo verifica que existen antes de tocar datos, y hace
-- el reset+reseed. Ningún "Success" se da por bueno sin comprobar pg_catalog.
--
-- Folvy es multi-tenant: el índice es COMPUESTO (account_id, hubrise_ref).
--
-- FIX de esta migración en concreto:
--   1) GUARD de prerrequisitos: aborta si el índice O el trigger no existen
--      de verdad (pg_indexes / pg_trigger) — no asume nada de migraciones
--      previas, aunque hayan reportado éxito.
--   2) Reset limpio: apagar el trigger (condicional — solo si existe, aunque
--      el guard del punto 1 ya lo garantiza; belt-and-suspenders), nular
--      menu_item.stock_group_id (FK sin ON DELETE CASCADE -> desligar antes
--      de borrar), borrar TODO stock_group, reencender el trigger (condicional).
--   3) Re-sembrar los 19 grupos con ON CONFLICT (account_id, hubrise_ref) DO
--      NOTHING (ahora sí idempotente de verdad) y reasignar stock_group_id.
--
-- Mismos external_id exactos que 20260730T1720 (clasificación de Julio, un
-- grupo por external_id, sin fusionar). hubrise_ref = shr_<external_id> (sin
-- hash) — alineado al reseed manual que quedó vivo en la BBDD (drift-0: este
-- fichero reproduce lo que hay realmente).
--
-- No se edita 20260730T1700/1710/1720 (ya "aplicadas"). Todo en una
-- transacción: si algo falla, no queda el reset a medias.
-- Aplicada: —
-- ============================================================================

begin;

-- 1) GUARD de prerrequisitos: ambos objetos deben existir de VERDAD (no
--    fiarse de que 1712/1713 dijeran "Success").
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'stock_group'
      and indexname = 'uq_stock_group_hubrise_ref'
      and indexdef ilike '%(account_id, hubrise_ref)%'
  ) then
    raise exception 'Prerrequisito ausente: uq_stock_group_hubrise_ref (account_id, hubrise_ref) no existe. Aplica 20260730T1713 primero.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_menu_item_inherit_stock_group'
      and tgrelid = 'public.menu_item'::regclass
  ) then
    raise exception 'Prerrequisito ausente: trg_menu_item_inherit_stock_group no existe en menu_item. Aplica 20260730T1712 primero.';
  end if;
end $$;

-- 2) Apagar el trigger de auto-herencia durante el reset (condicional, por
--    si acaso — el guard de arriba ya lo garantiza, pero no cuesta nada).
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_menu_item_inherit_stock_group'
      and tgrelid = 'public.menu_item'::regclass
  ) then
    execute 'alter table public.menu_item disable trigger trg_menu_item_inherit_stock_group';
  end if;
end $$;

-- 3) Desligar menu_item de stock_group antes de borrar (FK sin ON DELETE CASCADE).
update public.menu_item set stock_group_id = null where stock_group_id is not null;

-- 4) Borrar TODOS los grupos (limpio, desde cero — evita arrastrar duplicados).
delete from public.stock_group;

-- 5) Re-sembrar los 19 grupos compartidos.
with compartidos(external_id, etiqueta) as (
  values
    ('afa81c48-cc1c-4478-8578-b0e72c490b36'::text, 'Agua 50 CL'),
    ('ab27f27e-ad7c-467c-886d-c661179dd998'::text, 'Agua pet.'),
    ('4d421802-8f35-45e7-94fe-241dfd59f4b8'::text, 'Mahou 5 Estrellas'),
    ('ec807d42-b811-4f78-be71-dc2eefef6890'::text, 'Coca-Cola Original'),
    ('d1116bc9-2345-40c7-8dc0-2b427ab79b29'::text, 'Coca Cola (2)'),
    ('3b98507c-f4ea-4df1-9f73-fafb95d2cd09'::text, 'Coca-Cola Zero'),
    ('dba4d05c-66fc-43a8-b59c-5deef9a74793'::text, 'Coca Cola Zero (2)'),
    ('fe012a63-030d-4677-b3fb-930e898a3c4a'::text, 'Fanta Naranja'),
    ('0baf4e74-5281-4a17-89c6-64cd6e6464df'::text, 'Fanta Naranja (2)'),
    ('0514b7be-d9e1-4b7b-b333-716797b3c500'::text, 'Fanta Limón'),
    ('be041609-1f43-4a45-8dfc-d26134ccef65'::text, 'Fanta Limón (2)'),
    ('4fe712ee-05a9-4781-975e-f3389fff4cf6'::text, 'Nestea Limón'),
    ('05398b5f-ff6a-4888-9a09-482554d2a526'::text, 'Tres Leches'),
    ('5fc2ba1b-0c79-4835-b451-4e59f4e0a316'::text, 'Tarta 3 Leches'),
    ('964e0f9f-2a5a-4528-a7de-acdf4e9d96bc'::text, 'Cheesecake de Nutella'),
    ('b955a917-bcad-4241-99cc-4aef81cd5548'::text, 'Cheesecake de Nutella (2)'),
    ('118ac42d-4b5a-40f9-ad1f-51bea1dcb7a5'::text, 'Tequeños'),
    ('15fcac38-5ca1-4810-b43b-99017be08ba4'::text, 'Alitas Crispy Spicy'),
    ('3c59664f-7ff5-43b7-884d-58d4fa70952a'::text, 'Rollitos de Queso Feta')
),
owners as (
  select c.external_id, c.etiqueta, mi.account_id
  from compartidos c
  join menu_item mi on mi.external_id = c.external_id and mi.archived_at is null
  group by c.external_id, c.etiqueta, mi.account_id
)
insert into public.stock_group (account_id, name, hubrise_ref)
select account_id, etiqueta, 'shr_' || external_id
from owners
on conflict (account_id, hubrise_ref) do nothing;

-- 6) Re-asignar stock_group_id a TODOS los miembros de cada grupo.
with compartidos(external_id, etiqueta) as (
  values
    ('afa81c48-cc1c-4478-8578-b0e72c490b36'::text, 'Agua 50 CL'),
    ('ab27f27e-ad7c-467c-886d-c661179dd998'::text, 'Agua pet.'),
    ('4d421802-8f35-45e7-94fe-241dfd59f4b8'::text, 'Mahou 5 Estrellas'),
    ('ec807d42-b811-4f78-be71-dc2eefef6890'::text, 'Coca-Cola Original'),
    ('d1116bc9-2345-40c7-8dc0-2b427ab79b29'::text, 'Coca Cola (2)'),
    ('3b98507c-f4ea-4df1-9f73-fafb95d2cd09'::text, 'Coca-Cola Zero'),
    ('dba4d05c-66fc-43a8-b59c-5deef9a74793'::text, 'Coca Cola Zero (2)'),
    ('fe012a63-030d-4677-b3fb-930e898a3c4a'::text, 'Fanta Naranja'),
    ('0baf4e74-5281-4a17-89c6-64cd6e6464df'::text, 'Fanta Naranja (2)'),
    ('0514b7be-d9e1-4b7b-b333-716797b3c500'::text, 'Fanta Limón'),
    ('be041609-1f43-4a45-8dfc-d26134ccef65'::text, 'Fanta Limón (2)'),
    ('4fe712ee-05a9-4781-975e-f3389fff4cf6'::text, 'Nestea Limón'),
    ('05398b5f-ff6a-4888-9a09-482554d2a526'::text, 'Tres Leches'),
    ('5fc2ba1b-0c79-4835-b451-4e59f4e0a316'::text, 'Tarta 3 Leches'),
    ('964e0f9f-2a5a-4528-a7de-acdf4e9d96bc'::text, 'Cheesecake de Nutella'),
    ('b955a917-bcad-4241-99cc-4aef81cd5548'::text, 'Cheesecake de Nutella (2)'),
    ('118ac42d-4b5a-40f9-ad1f-51bea1dcb7a5'::text, 'Tequeños'),
    ('15fcac38-5ca1-4810-b43b-99017be08ba4'::text, 'Alitas Crispy Spicy'),
    ('3c59664f-7ff5-43b7-884d-58d4fa70952a'::text, 'Rollitos de Queso Feta')
)
update menu_item mi
set stock_group_id = sg.id
from compartidos c
join stock_group sg
  on sg.hubrise_ref = 'shr_' || c.external_id
where mi.external_id = c.external_id
  and mi.archived_at is null
  and mi.stock_group_id is null
  and sg.account_id = mi.account_id;

-- 7) Reencender el trigger de auto-herencia (condicional).
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgname = 'trg_menu_item_inherit_stock_group'
      and tgrelid = 'public.menu_item'::regclass
  ) then
    execute 'alter table public.menu_item enable trigger trg_menu_item_inherit_stock_group';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN FINAL (ejecutar y revisar) ─────────────────────────────────
--
-- select count(*) as filas, count(distinct hubrise_ref) as refs, count(distinct name) as nombres
-- from stock_group;
-- Debe dar 19, 19, 19.
--
-- select mi.external_id, count(distinct mi.stock_group_id) as grupos
-- from menu_item mi
-- where mi.stock_group_id is not null
-- group by mi.external_id
-- having count(distinct mi.stock_group_id) > 1;
-- Debe devolver 0 filas (ningún external_id repartido entre más de un grupo).
--
-- select sg.name, sg.hubrise_ref, count(mi.id) as miembros, count(distinct mi.brand_id) as marcas
-- from stock_group sg
-- left join menu_item mi on mi.stock_group_id = sg.id
-- group by sg.id, sg.name, sg.hubrise_ref
-- order by sg.name;
-- Debe dar 19 filas, ninguna con miembros=0 ni marcas=1.
--
-- select tgname, tgenabled from pg_trigger
-- where tgrelid = 'public.menu_item'::regclass and tgname = 'trg_menu_item_inherit_stock_group';
-- tgenabled debe ser 'O' (origin, activo) — confirma que quedó reencendido.
