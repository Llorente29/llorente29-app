-- 20260730T1720_stock_group_seed_colisiones.sql
-- ============================================================================
-- SEED — 19 grupos COMPARTIDOS de las 28 colisiones de external_id (Fase B).
-- external_id EXACTOS dados por Julio (no se clasifica por nombre). Los 9
-- POR-MARCA restantes (Doritos Loaded ×3, K-Fingers, Cheese-Sticks, Porky
-- Fries, Street Fries & Truffle, Fried Sweet Potatoes, Patatas Clásicas) NO
-- se tocan: quedan con stock_group_id NULL (por-marca, se namespacean solos
-- {brandSlug}:{external_id} — es el default seguro, no hace falta fila aquí).
--
-- hubrise_ref = shr_<external_id>, NUNCA por nombre: hay pares con el mismo
-- nombre y external_id DISTINTO (ej. "Coca Cola" / "Coca Cola (2)") que Julio
-- deja EXPLÍCITAMENTE sin fusionar — un grupo por external_id. El ref es
-- external_id tal cual (sin hash): sigue siendo único por external_id, más
-- simple, y coincide con el reseed manual que quedó vivo en la BBDD (drift-0:
-- este fichero reproduce lo que hay realmente).
--
-- FIX (revisión tras fallo en vivo, mismo patrón de bug del 28/07): un UPDATE
-- ... FROM x JOIN y ON (...) no puede referenciar la tabla objetivo del
-- UPDATE dentro del ON del JOIN — "mi" no está en scope ahí todavía. La
-- condición sg.account_id = mi.account_id se mueve al WHERE (donde "mi" SÍ
-- está en scope, por ser la tabla objetivo).
--
-- ATOMICIDAD: PASO 2 y PASO 3 van dentro de BEGIN/COMMIT — si algo falla a
-- mitad, se deshace TODO (no quedan grupos a medias). Además cada paso es
-- idempotente por su cuenta (ON CONFLICT DO NOTHING / guard stock_group_id IS
-- NULL), así que re-ejecutar el fichero completo tras un fallo es seguro.
--
-- ── PASO 1 — VERIFICACIÓN OBLIGATORIA (ejecutar ANTES del resto del fichero,
-- revisar el resultado a mano) ────────────────────────────────────────────
--
-- select mi.external_id, count(*) as miembros, count(distinct mi.brand_id) as marcas,
--        array_agg(distinct b.name order by b.name) as marcas_nombre, min(mi.name) as producto
-- from menu_item mi
-- join brand b on b.id = mi.brand_id
-- where mi.external_source = 'lastapp' and mi.archived_at is null
-- group by mi.external_id
-- having count(distinct mi.brand_id) > 1
-- order by marcas desc;
--
-- Debe devolver 28 filas. Comprobar:
--   (a) las 19 external_id de la lista de abajo aparecen, todas con marcas>=2
--   (b) las 9 por-marca (Doritos x3/K-Fingers/Cheese-Sticks/Porky Fries/
--       Street Fries & Truffle/Fried Sweet Potatoes/Patatas Clásicas)
--       aparecen TAMBIÉN aquí (colisionan) pero NO están en la lista de
--       compartidos de abajo -> se quedan sin grupo, aisladas.
--   (c) ningún external_id de la lista de compartidos sale con 0 filas.
-- Si algo no cuadra, PARAR aquí y avisar — no seguir con el paso 2.
--
-- ── PASO 2+3 — crear los stock_group y asignarlos (transacción) ─────────────
-- Aplicada: —
-- ============================================================================

begin;

-- PASO 2: crear los stock_group (uno por external_id, account_id derivado de
-- los datos reales — nunca hardcodeado).
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

-- PASO 3: asignar stock_group_id a TODOS los miembros de cada grupo.
-- sg.account_id = mi.account_id va en el WHERE (no en el ON del JOIN): "mi"
-- es la tabla objetivo del UPDATE y no está en scope dentro del ON.
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

commit;

-- ── PASO 4 — VERIFICACIÓN POST (ejecutar y revisar) ─────────────────────────
--
-- select sg.name, sg.hubrise_ref, count(mi.id) as miembros,
--        count(distinct mi.brand_id) as marcas
-- from stock_group sg
-- left join menu_item mi on mi.stock_group_id = sg.id
-- group by sg.id, sg.name, sg.hubrise_ref
-- order by sg.name;
--
-- Debe devolver 19 filas, ninguna con miembros=0 ni marcas=1 (si una tiene
-- marcas=1, algo fue mal: revisar antes de re-publicar catálogos).
