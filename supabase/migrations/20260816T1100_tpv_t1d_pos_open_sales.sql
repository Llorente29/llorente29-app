-- Aplicada: SÍ — por Julio vía MCP, 11/08 ~22:20. Verificada con query
-- independiente (pos_open_sales/pos_pending_delivery_sales con EXECUTE para
-- authenticated y bloqueadas para anon; _modgroups_of_item devuelve
-- group_type) y con uso real: panel "Cuentas" mostró T001, se recuperó, se
-- cobró y se marcó Entregado — las tres cosas pasando por estas RPC.
--
-- ENCARGO TPV T1.d — cerrar el ciclo de venta, Tarea A.1 + apoyo de C/D.
--
-- ⚠️ RECON CONTRADICE PARCIALMENTE EL ENCARGO — no se calla, va aquí y en el
-- parte de vuelta: el commit 2961441 (T1 original, ANTES de esta sesión, no
-- de T1.c/T1.d) ya construyó del lado del cliente: lista de cuentas
-- abiertas + panel "Cuentas (N)", campo de nota de cocina en
-- PosItemConfigModal, botón Entregado, vaciado del carrito tras Cobrar.
-- Ninguna de esas piezas es nueva. Lo que SÍ falta, confirmado en vivo hoy:
--   · listOpenPosTickets/listChargedPendingDeliveryTickets consultan `sale`
--     DIRECTO desde el cliente (.from('sale')...), no vía RPC — rompe el
--     patrón _pos_can_operate que usa TODO lo demás del TPV (upsert_pos_sale,
--     pos_item_config). La RLS de sale ('sale_read': account_id = ANY
--     (current_user_account_ids())) es de CUENTA, no de LOCAL — un empleado
--     con acceso a un solo local podría, en teoría, leer ventas de OTRO
--     local de la misma cuenta sin que RLS lo impida (el filtro por
--     location_id hoy es solo un .eq() del cliente, no una restricción del
--     servidor). pos_open_sales cierra ese hueco real de arquitectura.
--   · El carrito NO se vacía tras Guardar/Comandar (código actual: el
--     `if (action === 'charge') { setCart([]); ... }` solo cubre charge) —
--     esto SÍ es el bug exacto que describe el encargo ("los dos productos
--     se quedan ahí"). Se arregla en el cliente (T1.d, tarea aparte de esta
--     migración).
--   · La venta T001/23,70€ que cita el encargo como evidencia de "0
--     movimientos de stock" hoy tiene order_status='cancelled' en vivo (no
--     lo que describe el encargo) — dato distinto al que él vio, no se
--     investiga más aquí, la verificación final usará una venta nueva.
--
-- ── Tarea A.1: pos_open_sales ────────────────────────────────────────────
-- Mismo patrón que upsert_pos_sale/pos_item_config: SECURITY DEFINER +
-- SET search_path + guard _pos_can_operate + REVOKE/GRANT explícitos.
-- Orden created_at asc (la más vieja primero, la que más urge cerrar,
-- tal como pide el encargo). Límite de 24h por defecto, parametrizable.
--
-- Incluye rawTab (sale.raw_tab, columna text — confirmado por MCP antes de
-- escribir esto: information_schema.columns dice 'text', no 'jsonb', así
-- que meterlo dentro de jsonb_build_object lo deja como string anidado,
-- exactamente lo que el cliente ya espera y parsea con JSON.parse en
-- parseRawTabLines — cero cambio de contrato) para que posSaleService.ts
-- pueda reconstruir el carrito al recuperar una cuenta sin una segunda
-- consulta a `sale`. Sin esto, la RPC no podría sustituir a la consulta
-- directa que hace listOpenPosTickets hoy, porque le faltarían las líneas.
--
-- ── Añadido no pedido literalmente, mismo principio aplicado con
-- consistencia (se dice, no se cuela mudo): pos_pending_delivery_sales,
-- hermana de pos_open_sales para la lista de "cobradas, pendientes de
-- entregar" — cierra el MISMO hueco de arquitectura para esa lista, que
-- hoy tiene el mismo problema (consulta directa a sale). Validado por MCP
-- contra datos reales: filtrar por order_status <> 'completed' (mi primer
-- intento) cuela ventas 'cancelled'/'rejected' que NO son "pendientes de
-- entregar" — corregido a order_status = 'accepted', el único estado real
-- que puede tener una venta cobrada sin entregar en este flujo (upsert_
-- pos_sale solo fija order_status a 'accepted' en command/charge, y solo
-- 'deliver' lo cambia, a 'completed').
--
-- ── Tarea C/D, apoyo: _modgroups_of_item gana 'group_type' ──────────────
-- CREATE OR REPLACE aditivo (mismo LANGUAGE sql, misma firma, sin cambiar
-- permisos — REPLACE conserva los GRANTs existentes, no los resetea).
-- Compartida por pos_item_config Y shop_item_config: Shop no lee la clave
-- nueva, cero cambio de comportamiento ahí. Sin esto, el modelo de Shop no
-- distinguía choice/extras/removal/cross_sell — confirmado en vivo con
-- "Burrito A Tu Manera": 3 choice + 1 extras + 1 cross_sell, coincide
-- exacto con la tabla del encargo.
--
-- Validado por MCP con nombres temporales antes de escribir este fichero
-- (creados, probados contra datos reales, borrados):
--   · pos_open_sales: devuelve exactamente la cuenta de 28,60€/T001/18:42
--     que el encargo cita como la que el contador no veía.
--   · pos_pending_delivery_sales: el bug de order_status <> 'completed'
--     descrito arriba, encontrado y corregido antes de escribir esto.
--   · _modgroups_of_item + group_type: confirmado contra "Burrito A Tu
--     Manera" real, coincide con la tabla del encargo.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='_pos_can_operate') then
    raise exception 'tpv_t1d_pos_open_sales: falta _pos_can_operate — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sale' and column_name='device_id') then
    raise exception 'tpv_t1d_pos_open_sales: falta sale.device_id (T1.c) — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='modifier_group' and column_name='group_type') then
    raise exception 'tpv_t1d_pos_open_sales: falta modifier_group.group_type — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='_modgroups_of_item') then
    raise exception 'tpv_t1d_pos_open_sales: falta _modgroups_of_item — RECON desactualizado, parar';
  end if;
end $$;

-- ── pos_open_sales ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.pos_open_sales(p_account_id uuid, p_location_id uuid, p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'pos_open_sales: sin acceso a esta cuenta/local';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'posShortCode', s.pos_short_code,
           'status', s.status,
           'orderStatus', s.order_status,
           'paymentStatus', s.payment_status,
           'brandId', s.brand_id,
           'total', s.total,
           'openedAt', coalesce(s.opened_at, s.created_at),
           'rawTab', s.raw_tab,
           'lineCount', (select count(*) from sale_line sl where sl.sale_id = s.id and sl.parent_sale_line_id is null),
           'createdByName', s.created_by_name,
           'deviceId', s.device_id
         ) order by coalesce(s.opened_at, s.created_at) asc), '[]'::jsonb)
    into v_result
  from sale s
  where s.account_id = p_account_id
    and s.location_id = p_location_id
    and s.source = 'folvy_pos'
    and s.status = 'open'
    and coalesce(s.opened_at, s.created_at) >= now() - (greatest(p_hours, 1) || ' hours')::interval;

  return v_result;
end;
$function$;

comment on function public.pos_open_sales(uuid, uuid, integer) is
  'Cuentas abiertas (status=open) del TPV para el panel "Cuentas" (11/08,
   TPV T1.d Tarea A.1) — sustituye la consulta directa a sale que hacía el
   cliente, que rompía el patrón _pos_can_operate. Orden created_at asc: la
   más vieja primero. Límite de 24h por defecto (parametrizable).';

revoke all on function public.pos_open_sales(uuid, uuid, integer) from public, anon;
grant execute on function public.pos_open_sales(uuid, uuid, integer) to authenticated, service_role;

-- ── pos_pending_delivery_sales (hermana, mismo hueco cerrado) ───────────

CREATE OR REPLACE FUNCTION public.pos_pending_delivery_sales(p_account_id uuid, p_location_id uuid, p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'pos_pending_delivery_sales: sin acceso a esta cuenta/local';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'posShortCode', s.pos_short_code,
           'status', s.status,
           'orderStatus', s.order_status,
           'paymentStatus', s.payment_status,
           'brandId', s.brand_id,
           'total', s.total,
           'openedAt', coalesce(s.opened_at, s.created_at),
           'rawTab', s.raw_tab,
           'lineCount', (select count(*) from sale_line sl where sl.sale_id = s.id and sl.parent_sale_line_id is null),
           'createdByName', s.created_by_name,
           'deviceId', s.device_id
         ) order by coalesce(s.opened_at, s.created_at) asc), '[]'::jsonb)
    into v_result
  from sale s
  where s.account_id = p_account_id
    and s.location_id = p_location_id
    and s.source = 'folvy_pos'
    and s.status = 'closed'
    -- order_status='accepted' a propósito, no "<> 'completed'" (probado y
    -- descartado: coincidencia de datos reales cuela cancelled/rejected,
    -- que no son "pendientes de entregar" — ver cabecera del fichero).
    and s.order_status = 'accepted'
    and coalesce(s.opened_at, s.created_at) >= now() - (greatest(p_hours, 1) || ' hours')::interval;

  return v_result;
end;
$function$;

comment on function public.pos_pending_delivery_sales(uuid, uuid, integer) is
  'Ventas cobradas (status=closed) pendientes de marcar Entregado (11/08,
   TPV T1.d) — hermana de pos_open_sales, mismo hueco de arquitectura
   cerrado (antes: consulta directa a sale desde el cliente). order_status
   filtrado a ''accepted'' explícitamente, no ''<> completed'': evita colar
   ventas cancelled/rejected como si estuvieran pendientes de entregar.';

revoke all on function public.pos_pending_delivery_sales(uuid, uuid, integer) from public, anon;
grant execute on function public.pos_pending_delivery_sales(uuid, uuid, integer) to authenticated, service_role;

-- ── _modgroups_of_item: + group_type (Tarea C/D, apoyo) ──────────────────

CREATE OR REPLACE FUNCTION public._modgroups_of_item(p_menu_item_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mg.id,
           'name', mg.name,
           'min', mg.min_selections,
           'max', mg.max_selections,
           'allow_repetition', mg.allow_repetition,
           'group_type', mg.group_type,
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', mo.id,
                      'name', mo.name,
                      'price_impact', mo.price_impact,
                      'is_default', mo.is_default,
                      'allergens', _allergens_of_recipe(mo.recipe_item_id)
                    ) order by mo.position nulls last, mo.name), '[]'::jsonb)
             from modifier_option mo
             where mo.modifier_group_id = mg.id and mo.is_active
           )
         ) order by mga.position nulls last), '[]'::jsonb)
  from modifier_group_assignment mga
  join modifier_group mg on mg.id = mga.modifier_group_id
  where mga.menu_item_id = p_menu_item_id and mg.is_active;
$function$;

comment on function public._modgroups_of_item(uuid) is
  'Grupos de modificadores de un menu_item, compartida por pos_item_config
   y shop_item_config. Gana ''group_type'' (11/08, TPV T1.d Tarea C/D
   apoyo) — aditivo, Shop no la lee, cero cambio de comportamiento ahí.';

notify pgrst, 'reload schema';

-- ── Verificación (§6 del encargo) ────────────────────────────────────────
--
-- select pos_open_sales('51ad1792-6629-4ef7-833a-b57b09a86710'::uuid, '<location_id>'::uuid);
--   -- debe incluir la cuenta T001/28,60€ si sigue abierta.
-- select has_function_privilege('authenticated', 'public.pos_open_sales(uuid,uuid,integer)', 'execute'); -- true
-- select has_function_privilege('anon', 'public.pos_open_sales(uuid,uuid,integer)', 'execute'); -- false
