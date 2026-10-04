-- ============================================================================
-- R02 · 2/4 · LAS FILAS MIGRADAS: lo que decide hoy, escrito celda a celda
-- ----------------------------------------------------------------------------
-- Respuesta 1 de Julio, punto 1: «la migración escribe una fila por marca ×
-- plataforma que reproduce lo que hace hoy resolve_dispatch: interruptor
-- encendido → own en todas las plataformas; apagado → platform en todas.
-- source='migrated', nota «del interruptor antiguo». Así el resultado de la
-- resolución antes y después es idéntico».
--
-- QUÉ ES «LO QUE HACE HOY», medido el 04/10 (docs/reparto/R02_comprobaciones_previas.md §3):
-- un pedido lo reparte Folvy si y solo si
--   (a) entra como own_delivery: la herencia channel_delivery_policy
--       (cuenta, plataforma, tipo de marca) dice own_delivery, y
--   (b) resolve_dispatch no lo corta: marca_reparte_propio(b), es decir
--       coalesce(own_delivery_enabled, ownership_type = 'own').
-- Así que la celda es `own` cuando (a) y (b), y `platform` en cualquier otro
-- caso. En Foodint coincide con la regla de Julio en las 54 celdas (las tres
-- herencias de marca propia dicen own_delivery; las de cedida, platform). Se
-- escribe la conjunción y no la regla a secas para que, si en otra cuenta una
-- herencia dijese platform con el interruptor encendido, la migración no
-- cambie nada tampoco ahí.
--
-- QUÉ CELDAS: cada marca de la cuenta × cada canal de reparto de la cuenta
-- (sales_channel con channel_type = 'delivery' y slug). Una fila por celda,
-- para todos los locales (UUID cero). Hoy no hay herencias por local
-- (0 filas con location_id en producción y en staging), así que no hace
-- falta ninguna fila por local.
--
-- SOLO AÑADE, y se puede repetir: ON CONFLICT DO NOTHING. Si una persona ya
-- ha decidido una celda, su fila se queda.
--
-- Se lee `own_delivery_enabled` por ÚLTIMA vez aquí. La columna se elimina en
-- el fichero aparte 20261005T0200 (con su vuelta atrás), no en este.
-- ============================================================================

insert into public.brand_delivery_policy
  (account_id, brand_id, channel_slug, location_id, delivery_by, source, decided_by_name, note)
select
  b.account_id,
  b.id,
  sc.slug,
  '00000000-0000-0000-0000-000000000000'::uuid,
  case
    when pol.service_type = 'own_delivery'
     and coalesce(b.own_delivery_enabled, b.ownership_type = 'own')
      then 'own'
    else 'platform'
  end,
  'migrated',
  'Migración R02',
  'del interruptor antiguo: interruptor '
    || case when b.own_delivery_enabled is null then 'sin poner (' || coalesce(b.ownership_type, '?') || ')'
            when b.own_delivery_enabled then 'encendido'
            else 'apagado' end
    || ' · herencia ' || coalesce(pol.service_type, 'sin fila')
from public.brand b
join public.sales_channel sc
  on sc.account_id = b.account_id
 and sc.channel_type = 'delivery'
 and coalesce(btrim(sc.slug), '') <> ''
left join public.channel_delivery_policy pol
  on pol.account_id = b.account_id
 and pol.channel_slug = sc.slug
 and pol.ownership_type = coalesce(b.ownership_type, 'own')
 and pol.location_id is null
on conflict (account_id, brand_id, channel_slug, location_id) do nothing;
