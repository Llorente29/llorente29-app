-- supabase/migrations/20260810T1400_almacen_p1_pending_receptions.sql
--
-- ENCARGO P1 — Cerrar el ciclo de compra (pedido ↔ recepción ↔ estado ↔ aviso).
-- folvy_almacen_auditoria_profunda_20260810.md §F1 y §P1.
--
-- HALLAZGO (medido por MCP, 10/08): el esquema YA tiene la cadena completa
-- (goods_receipt.purchase_order_id, goods_receipt_line.purchase_order_line_id,
-- purchase_order.status/expected_date) y recompute_purchase_order_status YA
-- se llama automáticamente desde confirm_goods_receipt/void_goods_receipt
-- cuando la recepción trae purchase_order_id. Nada de eso se toca aquí — está
-- bien y ya aplicado. La causa real: la pantalla de recepción nunca preguntaba
-- de qué pedido venía el género, así que ese campo se quedaba vacío casi
-- siempre (1/101 recepciones enlazadas). El fix de ESE hueco es 100% cliente
-- (GoodsReceiptForm gana un selector "¿De qué pedido viene?" + auto-casado de
-- líneas por recipe_item_id) — no necesita ninguna migración.
--
-- Esta migración es SOLO la pieza que sí falta en el backend: el panel
-- "Pendiente de recepción" (Pedidos) necesita una lectura agregada
-- (pedido→líneas→recibido en base) que sería carísima fila-a-fila desde el
-- cliente. Mismo patrón ya validado de negative_stock_report:
-- SECURITY DEFINER + guard evaluado UNA vez + SET search_path + revoke anon.
--
-- pending_receptions_report(p_account, p_location):
--   Pedidos en estado 'enviado' o 'recibido_parcial' de ESE local (mismo
--   criterio de "pendiente" que ya usa OrderReceiveFlow en el cliente), con:
--     - código, proveedor, fecha, expected_date, días de retraso (0 si no
--       vencido o sin expected_date; positivo = vencido).
--     - por línea: recipe_item_id, nombre, unidad base, qty_ordered_base
--       (qty_ordered × qty_in_base del formato pedido) vs qty_received_base
--       (SUM de qty_in_base de goods_receipt_line CONFIRMADAS enlazadas a esa
--       línea) — comparación en UNIDAD BASE, no en el conteo de formato bruto
--       (dos formatos distintos del mismo pedido no deben compararse en crudo).
--
-- Validado por MCP contra datos reales de Foodint (función temporal, probada,
-- borrada — nada quedó aplicado): 4+4+16 = 24 pedidos colgados, exactamente
-- el número del hallazgo (incluidos los 4 de Plaza Castilla, local cerrado).
--
-- Solo lectura. Ningún UPDATE/INSERT/DELETE en todo este fichero.
-- Sin BEGIN/COMMIT. Se prueba DESDE LA APP (auth.uid() necesita sesión).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.pending_receptions_report(
  p_account  uuid,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if not (current_user_is_admin() or current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'pending_receptions_report: sin acceso a la cuenta %', p_account;
  end if;

  with pedidos as (
    select po.id, po.code, po.supplier_id, s.name as supplier_name,
           po.location_id, l.name as location_name,
           po.order_date, po.expected_date, po.status
    from public.purchase_order po
    left join public.supplier  s on s.id = po.supplier_id
    left join public.locations l on l.id = po.location_id
    where po.account_id = p_account
      and po.location_id = p_location
      and po.status in ('enviado', 'recibido_parcial')
  ),
  lineas as (
    select pol.id as line_id, pol.purchase_order_id, pol.recipe_item_id, pol.product_name,
           pol.qty_ordered,
           coalesce(f.qty_in_base, 1) as format_qty_in_base,
           ku.abbreviation as unit_abbr
    from public.purchase_order_line pol
    join pedidos p on p.id = pol.purchase_order_id
    left join public.recipe_item_purchase_format f on f.id = pol.purchase_format_id
    left join public.recipe_item ri on ri.id = pol.recipe_item_id
    left join public.kitchen_unit ku on ku.id = ri.base_unit_id
  ),
  recibido as (
    -- Solo recepciones CONFIRMADAS y líneas ya enlazadas (purchase_order_line_id).
    select grl.purchase_order_line_id as line_id,
           sum(grl.qty_in_base) as qty_received_base
    from public.goods_receipt_line grl
    join public.goods_receipt gr on gr.id = grl.goods_receipt_id
    where gr.status = 'confirmado'
      and grl.purchase_order_line_id is not null
    group by grl.purchase_order_line_id
  )
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id',       p.id,
               'code',           p.code,
               'supplier_id',    p.supplier_id,
               'supplier_name',  p.supplier_name,
               'location_id',    p.location_id,
               'location_name',  p.location_name,
               'order_date',     p.order_date,
               'expected_date',  p.expected_date,
               'status',         p.status,
               'days_overdue',   case when p.expected_date is not null and p.expected_date < current_date
                                       then (current_date - p.expected_date)
                                       else 0 end,
               'lines', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'recipe_item_id',    ln.recipe_item_id,
                          'product_name',      ln.product_name,
                          'unit_abbr',         ln.unit_abbr,
                          'qty_ordered_base',  round(ln.qty_ordered * ln.format_qty_in_base, 3),
                          'qty_received_base', round(coalesce(r.qty_received_base, 0), 3),
                          'complete',          coalesce(r.qty_received_base, 0) >= (ln.qty_ordered * ln.format_qty_in_base)
                        ) order by ln.product_name)
                 from lineas ln
                 left join recibido r on r.line_id = ln.line_id
                 where ln.purchase_order_id = p.id
               ), '[]'::jsonb)
             ) order by p.expected_date asc nulls last, p.order_date asc)
      from pedidos p
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$function$;

revoke all on function public.pending_receptions_report(uuid, uuid) from public, anon;
grant execute on function public.pending_receptions_report(uuid, uuid) to authenticated;

-- ── GUARD — seguridad y permisos exactamente como deben quedar ────────────
do $guard$
declare
  v_no_definer         text;
  v_filtrable_por_anon text;
begin
  select string_agg(p.proname, ', ') into v_no_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'pending_receptions_report'
    and not p.prosecdef;
  if v_no_definer is not null then
    raise exception 'MIGRACIÓN FALLIDA: debería ser SECURITY DEFINER: %', v_no_definer;
  end if;

  select string_agg(routine_name || '/' || grantee, ', ') into v_filtrable_por_anon
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'pending_receptions_report'
    and grantee in ('anon', 'PUBLIC');
  if v_filtrable_por_anon is not null then
    raise exception 'MIGRACIÓN FALLIDA: acceso indebido de anon/public: %', v_filtrable_por_anon;
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'pending_receptions_report' and grantee = 'authenticated'
  ) then
    raise exception 'MIGRACIÓN FALLIDA: authenticated no tiene EXECUTE sobre pending_receptions_report';
  end if;

  raise notice 'OK — pending_receptions_report es DEFINER, solo authenticated.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, tras aplicar):
--   - Solo se puede probar desde la app (auth.uid() es NULL en el SQL Editor).
--   - Almacén → Pedidos → "Pendiente de recepción" con Foodint Alcalá debe
--     enseñar ~16 pedidos colgados, algunos con más de 50 días de retraso en
--     rojo — esa es la prueba de que funciona (números malos visibles, no un
--     panel verde).
--   - Ninguna venta, consumo ni recepción se bloquea; esta función es de solo
--     lectura.
-- ════════════════════════════════════════════════════════════════════════════
