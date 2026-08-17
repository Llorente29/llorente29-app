-- Fase 3, A.1 (15/08/2026) -- corrección de Julio tras certificar con captura:
-- el tablero filtraba por connection_name='Folvy' y escondía cualquier OTRA
-- conexión hubrise activa de la location (ej. "Folvy Test" en zy9j2-0, token
-- ok, callback apuntando a producción, invisible en el tablero). Ese filtro
-- es correcto en hubrise_location_status (pantalla del cliente, solo le
-- interesa SU conexión estándar) pero es lo contrario del propósito de un
-- tablero de VIGILANCIA: una conexión viva que no se ve es exactamente el
-- fallo de visibilidad que esta pantalla existe para matar.
--
-- Ahora se muestra CUALQUIER conexión hubrise de la location que sea o bien
-- la estándar ("Folvy", incluida cuando está inactiva/revoke_pending -- eso
-- ya lo pedía el diseño original) o bien cualquier otra que esté ACTIVA
-- ahora mismo. Las bridges de plataforma desactivadas (Uber Eats/Glovo/Just
-- Eat, dormidas desde el 29/07) siguen sin mostrarse -- no son ruido nuevo,
-- son historial ya cerrado. Cada conexión no estándar lleva su propia
-- etiqueta ("conexión no estándar: <nombre>") para que el operador vea lo
-- que hay, no lo que debería haber.

create or replace function public.hubrise_ops_dashboard()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_locations jsonb;
  v_writers jsonb;
  v_alerts_48h integer;
begin
  if not current_user_is_admin() then
    raise exception 'Acceso denegado: solo platform admins pueden ver el tablero de operación HubRise.';
  end if;

  with loc_ids as (
    select distinct location_id, account_id
    from external_integration
    where source = 'hubrise' and location_id is not null
    union
    select distinct location_id, account_id
    from external_location_map
    where source = 'hubrise' and location_id is not null
    union
    select distinct location_id, account_id
    from hubrise_oauth_state
    where kind = 'location' and location_id is not null
      and created_at > now() - interval '15 minutes'
  )
  select coalesce(jsonb_agg(row_json order by
      row_json->>'account_name', row_json->>'location_name',
      (row_json->>'is_standard_connection')::boolean desc nulls last,
      row_json->>'connection_name'
    ), '[]'::jsonb)
  into v_locations
  from (
    select jsonb_build_object(
      'account_id', a.id,
      'account_name', a.name,
      'location_id', l.id,
      'location_name', l.name,
      'integration_id', ei.id,
      'connection_name', ei.connection_name,
      'is_standard_connection', (ei.id is null or ei.connection_name = 'Folvy'),
      'status', case
          when not l.active then 'local_inactivo'
          when exists (
            select 1 from hubrise_oauth_state hos
            where hos.account_id = l.account_id and hos.kind = 'location' and hos.location_id = l.id
              and hos.created_at > now() - interval '15 minutes'
          ) then 'conectando'
          when ei.id is null or not ei.is_active then 'sin_conectar'
          when ei.token_status = 'invalid' then 'token_invalido'
          else 'conectado'
        end,
      'external_location_id', coalesce(ei.external_location_id, elm.external_location_id),
      'external_account_name', ei.external_account_name,
      'external_location_name', ei.external_location_name,
      'token_status', ei.token_status,
      'token_checked_at', ei.token_checked_at,
      'callback_status', ei.callback_status,
      'callback_checked_at', ei.callback_checked_at,
      'revoke_pending', coalesce(ei.revoke_pending, false),
      'last_order_at', lo.last_order_at,
      'brand_diff', (coalesce(jsonb_array_length(bd.catalog_only), 0) > 0 or coalesce(jsonb_array_length(bd.mapped_only), 0) > 0),
      'brands_catalog_only', coalesce(bd.catalog_only, '[]'::jsonb),
      'brands_mapped_only', coalesce(bd.mapped_only, '[]'::jsonb)
    ) as row_json
    from loc_ids li
    join locations l on l.id = li.location_id
    join accounts a on a.id = li.account_id
    -- CUALQUIER conexión de la location que sea la estándar (Folvy, incluida
    -- inactiva -- revoke_pending/desconectada) O cualquier otra que esté
    -- ACTIVA ahora mismo. Produce una fila por conexión encontrada; si no
    -- hay ninguna, el LEFT JOIN deja una fila con ei todo NULL (sin_conectar).
    left join external_integration ei
      on ei.account_id = l.account_id and ei.source = 'hubrise' and ei.location_id = l.id
     and (ei.connection_name = 'Folvy' or ei.is_active = true)
    left join external_location_map elm
      on elm.account_id = l.account_id and elm.source = 'hubrise' and elm.location_id = l.id
     and elm.is_active = true
    left join lateral (
      select max(created_at) as last_order_at
      from sale
      where account_id = l.account_id and location_id = l.id and source = 'hubrise'
    ) lo on true
    left join lateral (
      select
        (select coalesce(jsonb_agg(distinct b.name order by b.name), '[]'::jsonb)
           from brand_hubrise_catalog bhc
           join brand b on b.id = bhc.brand_id
           where bhc.account_id = l.account_id and bhc.location_id = l.id
             and not exists (
               select 1 from external_brand_map ebm
               where ebm.account_id = l.account_id and ebm.source = 'hubrise'
                 and ebm.external_location_id = coalesce(ei.external_location_id, elm.external_location_id)
                 and ebm.brand_id = bhc.brand_id
                 and not coalesce(ebm.is_ignored, false)
             )
        ) as catalog_only,
        (select coalesce(jsonb_agg(distinct b.name order by b.name), '[]'::jsonb)
           from external_brand_map ebm
           join brand b on b.id = ebm.brand_id
           where ebm.account_id = l.account_id and ebm.source = 'hubrise'
             and ebm.external_location_id = coalesce(ei.external_location_id, elm.external_location_id)
             and not coalesce(ebm.is_ignored, false)
             and not exists (
               select 1 from brand_hubrise_catalog bhc
               where bhc.account_id = l.account_id and bhc.location_id = l.id
                 and bhc.brand_id = ebm.brand_id
             )
        ) as mapped_only
    ) bd on true
  ) t;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'account_id', a.id,
      'account_name', a.name,
      'hubrise_account_id', hwc.hubrise_account_id,
      'token_status', hwc.token_status,
      'token_checked_at', hwc.token_checked_at,
      'connected_at', hwc.connected_at
    ) order by a.name
  ), '[]'::jsonb)
  into v_writers
  from hubrise_writer_connection hwc
  join accounts a on a.id = hwc.account_id;

  select count(*)
  into v_alerts_48h
  from system_alert_queue
  where kind in ('hubrise-connection-health', 'hubrise-callback', 'hubrise-revoke-pending')
    and created_at > now() - interval '48 hours';

  return jsonb_build_object(
    'locations', v_locations,
    'writers', v_writers,
    'alerts_48h', v_alerts_48h,
    'generated_at', now()
  );
end;
$function$;

comment on function public.hubrise_ops_dashboard() is
$cmt$Tablero de vigilancia HubRise (Fase 3, A.1) -- SUPERADMIN-ONLY (platform admin,
gateado por current_user_is_admin(), RAISE EXCEPTION si no lo es). Cruza TODAS las
cuentas -- distinto de hubrise_location_status (SECURITY INVOKER, admin de UNA
cuenta, pantalla de ajustes del cliente). Devuelve jsonb: locations[] (una fila
POR CONEXIÓN hubrise de cada cuenta x local -- la conexión estándar "Folvy"
siempre, más cualquier otra conexión que esté ACTIVA ahora mismo, etiquetada
como no estándar; corregido 15/08 tras certificación de Julio: filtrar solo por
connection_name='Folvy' escondía conexiones vivas reales, ej. "Folvy Test" en
el laboratorio), writers[] (una fila por escritora de cuenta), y alerts_48h
(contador global de system_alert_queue, sin atribuir a fila -- esa tabla no
tiene account_id/location_id estructurado; parsear el mensaje de texto sería
fabricar fragilidad, decisión de Julio 15/08). Deuda declarada: el día que se
toque system-alert por otro motivo, añadirle account_id/location_id
estructurados y entonces el tablero podrá atribuir alertas por fila.$cmt$;
