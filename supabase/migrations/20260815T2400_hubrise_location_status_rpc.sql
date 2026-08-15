-- 20260815T2400_hubrise_location_status_rpc.sql
-- ENCARGO CODE — módulo de conexión HubRise, 2.4 (15/08/2026).
--
-- RPC hubrise_location_status(p_account_id) -- contrato de la pantalla de
-- estado de Fase 3, no una consulta suelta. Por cada `locations` de la
-- cuenta (conectados y sin conectar): estado, external_location_id,
-- external_account_name, external_location_name, marcas mapeadas, último
-- pedido recibido, token_status y token_checked_at.
--
-- Requiere la migración previa 20260815T2350 (GRANT SELECT de columna en
-- external_integration para anon/authenticated) -- sin ella, SECURITY
-- INVOKER + RLS deja la policy lastapp_integration_read inerte y esta RPC
-- devuelve vacío para cualquier usuario real (verificado impersonando, no
-- solo probado como superusuario vía MCP).
--
-- Cinco estados (fijados por Julio):
--   local_inactivo -> locations.active = false (pisa a todo lo demás)
--   conectando     -> hay un nonce vivo (kind='location', <15 min) para esa
--                     cuenta+local en hubrise_oauth_state
--   sin_conectar   -> sin fila en external_integration (connection_name='Folvy')
--   token_invalido -> external_integration.token_status = 'invalid'
--   conectado      -> el resto (token_status 'ok' o 'unknown')
--
-- Catálogo + lista de clientes que exige la guía de HubRise: se satisface
-- con `brands` (marcas mapeadas vía brand_hubrise_catalog) -- más
-- informativo que el catálogo por defecto de la location, decisión de Julio
-- para justificarlo así a Antoine. NO es una traducción literal 1:1 de
-- "lista de clientes" -- es el argumento que se le da.
--
-- `brands` sale RLS-asimétrico a propósito: brand_hubrise_catalog solo la
-- lee admin/manager de la cuenta (brand_hubrise_catalog_rw), a diferencia de
-- locations/external_integration/external_location_map/sale que cualquier
-- miembro de la cuenta puede leer. Un usuario "worker" ve el resto de la fila
-- completo pero `brands=[]` -- verificado impersonando ambos roles, no es
-- un bug de esta RPC, es la RLS de esa tabla haciendo su trabajo.
--
-- hubrise_oauth_state sigue SIN grant para anon/authenticated (nonces
-- efímeros, no deben ser legibles por clientes bajo ningún concepto) -- por
-- eso el estado "conectando" pasa por un helper SECURITY DEFINER estrecho
-- (_hubrise_location_pending_connect) que solo devuelve un booleano y
-- verifica autorización el mismo (nunca expone la tabla ni el nonce en sí).
create or replace function public._hubrise_location_pending_connect(p_account_id uuid, p_location_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select case
    when p_account_id = any (public.current_user_account_ids()) then
      exists (
        select 1 from public.hubrise_oauth_state
        where account_id = p_account_id and kind = 'location' and location_id = p_location_id
          and created_at > now() - interval '15 minutes'
      )
    else false
  end;
$fn$;

create or replace function public.hubrise_location_status(p_account_id uuid)
returns table (
  location_id uuid,
  location_name text,
  status text,
  external_location_id text,
  external_account_name text,
  external_location_name text,
  token_status text,
  token_checked_at timestamptz,
  brands jsonb,
  last_order_at timestamptz
)
language sql
security invoker
stable
as $fn$
  select
    l.id as location_id,
    l.name as location_name,
    case
      when not l.active then 'local_inactivo'
      when public._hubrise_location_pending_connect(l.account_id, l.id) then 'conectando'
      when ei.id is null then 'sin_conectar'
      when ei.token_status = 'invalid' then 'token_invalido'
      else 'conectado'
    end as status,
    elm.external_location_id,
    ei.external_account_name,
    ei.external_location_name,
    ei.token_status,
    ei.token_checked_at,
    coalesce(br.brands, '[]'::jsonb) as brands,
    lo.last_order_at
  from public.locations l
  left join public.external_location_map elm
    on elm.account_id = l.account_id and elm.source = 'hubrise'
   and elm.location_id = l.id and elm.is_active = true
  left join public.external_integration ei
    on ei.account_id = l.account_id and ei.source = 'hubrise'
   and ei.external_location_id = elm.external_location_id
   and ei.connection_name = 'Folvy'
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'brand_id', bhc.brand_id,
      'brand_name', b.name,
      'external_catalog_id', bhc.external_catalog_id,
      'hubrise_catalog_name', bhc.hubrise_catalog_name
    ) order by b.name) as brands
    from public.brand_hubrise_catalog bhc
    join public.brand b on b.id = bhc.brand_id
    where bhc.account_id = l.account_id and bhc.location_id = l.id
  ) br on true
  left join lateral (
    select max(created_at) as last_order_at
    from public.sale
    where account_id = l.account_id and location_id = l.id and source = 'hubrise'
  ) lo on true
  where l.account_id = p_account_id
  order by l.name;
$fn$;
