-- 20260827T1400_hubrise_codigos_plataforma_backfill.sql
-- APLICADA en produccion el 27-08-2026, autorizada por Julio en el encargo.
-- Cambio de datos historicos. Va en transaccion (apply_migration la abre).
--
-- RELLENO DE `platform_order_code` / `pos_short_code` EN LAS VENTAS DE HUBRISE.
-- ============================================================================
-- Repara los 14 dias de regresion (13/08 20:05 UTC -> 27/08). El dato NUNCA se
-- perdio: `collection_code` viene en el payload y esta guardado entero en
-- `sale.raw_tab`. Solo faltaba copiarlo a su columna.
--
-- ── ALCANCE MEDIDO (27-08, antes de ejecutar) ────────────────────────────
--   ventas hubrise sin platform_order_code ......... 152
--     de ellas, con collection_code en raw_tab ..... 150   <- se rellenan
--     sin collection_code .............................. 2   <- no se tocan
--   Las 2 son de 18 y 19/06 (12,50 EUR, 'open'), payload viejo sin `ref` ni
--   `collection_code`: no hay de donde sacarlo. Se quedan en NULL a proposito.
--
--   ventas hubrise con codigo pero sin pos_short_code .. 57  <- se completan
--   (pos_short_code nunca se genero para HubRise; no es regresion, es que
--    no existia. Se rellena aqui para que el campo sea uniforme.)
--
-- ── LA REGLA, VERIFICADA CONTRA LOS 57 QUE SI LO TUVIERON ────────────────
--   platform_order_code = collection_code   (identico en 57 de 57, sin tocar)
--     Uber Eats  "DC034" / "52766" / "759E0"
--     Just Eat   "189793329"
--   pos_short_code      = inicial del canal || collection_code
--     "U52766" / "J189793329" — la forma de Last (canal + numero), compuesta
--     aqui porque HubRise no manda ningun campo equivalente.
--
-- Misma logica, letra por letra, que buildPlatformCodes() en
-- supabase/functions/hubrise-webhook/index.ts. Si una cambia, la otra tambien.
--
-- Idempotente (is distinct from) y transaccional. Solo toca source='hubrise'.
-- ============================================================================

with calc as (
  select s.id,
         nullif(btrim(s.raw_tab::jsonb ->> 'collection_code'), '') as code,
         case
           when lower(coalesce(s.external_channel_text,'')) like '%glovo%'     then 'G'
           when lower(coalesce(s.external_channel_text,'')) like '%uber%'      then 'U'
           when lower(coalesce(s.external_channel_text,'')) like '%just%'      then 'J'
           when lower(coalesce(s.external_channel_text,'')) like '%deliveroo%' then 'D'
           else upper(left(btrim(coalesce(s.external_channel_text,'')), 1))
         end as inicial
    from public.sale s
   where s.source = 'hubrise'
     and s.raw_tab is not null
)
update public.sale s
   set platform_order_code = c.code,
       pos_short_code      = c.inicial || c.code
  from calc c
 where c.id = s.id
   and c.code is not null
   and (s.platform_order_code is distinct from c.code
     or s.pos_short_code      is distinct from c.inicial || c.code);

-- Verificacion (a correr aparte, tras aplicar):
--   select count(*) as ventas, count(platform_order_code) as con_codigo,
--          count(*) filter (where platform_order_code is null) as sin_codigo,
--          count(pos_short_code) as con_corto
--     from public.sale where source = 'hubrise';
--   Esperado: 209 / 207 / 2 / 207
