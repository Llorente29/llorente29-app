-- ============================================================================
-- ALTA HubRise · Foodint Alcalá · cuenta 1b6p8 (EUR)
-- Sustituye al viejo scripts/alta_hubrise_alcala.sql (cuenta wee56, YA BORRADA).
-- ----------------------------------------------------------------------------
-- QUÉ HACE: registra en Folvy las conexiones HubRise de las 9 marcas folvy de
--   Alcalá, para que hubrise-catalog-publish pueda publicar sus cartas y el
--   webhook/estado enrutar pedidos.
--
-- CÓMO USARLO: rellena SOLO los <<...>>. Todo lo interno (account_id, brand_id,
--   location_id) ya va puesto y verificado contra BBDD (24/07/2026).
--   Ejecutar a mano en el SQL Editor de Supabase (NO db push — regla del proyecto).
--
-- IDs DE LOCATION CONFIRMADOS (panel HubRise, 24/07): Alcalá = 1b6p8-0 (YA puesto
--   abajo) · Carabanchel = 1b6p8-2 · Plaza Castilla = 1b6p8-1.  (Este script es de Alcalá.)
-- LO QUE FALTA (al crear las conexiones de 1b6p8):
--   <<ORG_UUID>>  = external_org_id (uuid interno HubRise de la cuenta)  [opcional]
--   Por marca: connection_name, external_catalog_id, access_token
--     · Si HubRise da UN token/catálogo por conexión de marca -> uno distinto por fila.
--     · Si comparte token para toda la location -> repite el mismo en las 9 filas.
--   ⚠️ MODELO DE CATÁLOGO POR CONFIRMAR: hoy la cuenta tiene 1 catálogo "Foodint - bnnpd"
--      (vacío); nuestro publicador necesita 1 catálogo POR MARCA (9). Pendiente de correo
--      a Janaina/Antoine. Sin los 9 catalog_id no se rellena la matriz de abajo.
-- ============================================================================

begin;

-- (Opcional pero recomendado) idempotencia: limpia altas previas de esta location
-- delete from external_brand_map   where source='hubrise' and external_location_id='1b6p8-0';
-- delete from external_integration where source='hubrise' and external_location_id='1b6p8-0';
-- delete from external_location_map where source='hubrise' and external_location_id='1b6p8-0';

-- 1) LOCATION MAP (una fila para Alcalá) ------------------------------------
insert into external_location_map
  (source, external_location_id, account_id, location_id, is_active, external_location_name)
values
  ('hubrise', '1b6p8-0',
   '51ad1792-6629-4ef7-833a-b57b09a86710',           -- Foodint (cuenta interna)
   '38158159-cd71-4056-950b-53425afac1ce',           -- Alcalá (Florencio Llorente 29)
   true, 'Alcalá')
on conflict do nothing;

-- 2) MATRIZ DE MARCAS -> CONEXIÓN -------------------------------------------
--    Rellena connection_name / external_catalog_id / access_token por marca.
--    (brand_id y nombre ya verificados; no los toques.)
with data(brand_id, brand_name, connection_name, external_catalog_id, access_token) as (values
  ('95635ce3-055f-4333-b3ec-1b4e9b2a0170'::uuid, 'Bendito Burrito',        '<<CONN_BENDITO>>',  '<<CAT_BENDITO>>',  '<<TOK_BENDITO>>'),
  ('ca05894b-6d3c-466b-8064-04cc0c70a578'::uuid, 'Dirty Burger',           '<<CONN_DIRTY>>',    '<<CAT_DIRTY>>',    '<<TOK_DIRTY>>'),
  ('99dff23e-98a8-46ab-af54-0cc19d036b72'::uuid, 'Lovers Burgers',         '<<CONN_LOVERS>>',   '<<CAT_LOVERS>>',   '<<TOK_LOVERS>>'),
  ('cc89c6eb-afb8-4308-884e-9aac83986b22'::uuid, 'Meraki Pita',            '<<CONN_MERAKI>>',   '<<CAT_MERAKI>>',   '<<TOK_MERAKI>>'),
  ('0229a52b-bfc6-4c6b-b29b-22b7288138e5'::uuid, 'Mila''s Sandwiches',     '<<CONN_MILAS>>',    '<<CAT_MILAS>>',    '<<TOK_MILAS>>'),
  ('501ffd59-19e1-4d75-81dd-70c5a1a2b1de'::uuid, 'Milanesa House',         '<<CONN_MILANESA>>', '<<CAT_MILANESA>>', '<<TOK_MILANESA>>'),
  ('2b160122-c763-4ca5-8fd5-b74d06c910c5'::uuid, 'Scandal Burgers',        '<<CONN_SCANDAL>>',  '<<CAT_SCANDAL>>',  '<<TOK_SCANDAL>>'),
  ('43d305cd-6b48-4a8d-b292-7d3aa09e9657'::uuid, 'Smash Brothers Burgers', '<<CONN_SMASH>>',    '<<CAT_SMASH>>',    '<<TOK_SMASH>>'),
  ('5a230c99-1de4-47ca-82fb-65d4af589176'::uuid, 'The Urban Kebab',        '<<CONN_KEBAB>>',    '<<CAT_KEBAB>>',    '<<TOK_KEBAB>>')
)

-- 2a) external_integration (token + catálogo por conexión) ------------------
, ins_integ as (
  insert into external_integration
    (account_id, source, external_org_id, organization_name,
     external_location_id, connection_name, external_catalog_id, access_token,
     is_active, push_status_enabled)
  select
    '51ad1792-6629-4ef7-833a-b57b09a86710', 'hubrise',
    nullif('<<ORG_UUID>>','<<ORG_UUID>>')::uuid,      -- opcional; queda NULL si no lo rellenas
    'Foodint (1b6p8)',
    '1b6p8-0', d.connection_name, d.external_catalog_id, d.access_token,
    true, true
  from data d
  returning 1
)

-- 2b) external_brand_map (marca -> connection_name) -------------------------
insert into external_brand_map
  (account_id, source, external_location_id, external_brand_id, brand_id)
select
  '51ad1792-6629-4ef7-833a-b57b09a86710', 'hubrise',
  '1b6p8-0', d.connection_name, d.brand_id
from data d;

commit;

-- 3) VERIFICACIÓN (read-only) — debe devolver 9 filas listas ----------------
select b.name,
       ei.connection_name,
       ei.external_catalog_id,
       left(ei.access_token,6)||'…' as token,
       ei.is_active, ei.push_status_enabled
from external_brand_map bm
join brand b               on b.id = bm.brand_id
join external_integration ei
  on ei.account_id = bm.account_id and ei.source='hubrise'
 and ei.external_location_id = bm.external_location_id
 and ei.connection_name = bm.external_brand_id
where bm.source='hubrise' and bm.external_location_id = '1b6p8-0'
order by b.name;
-- Tras esto: en Folvy, botón "Publicar" por marca (o invocar hubrise-catalog-publish
-- con {brand_id}) para las 9. Y un pedido real de prueba.
