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
    raise exception 'MIGRACION FALLIDA: deberia ser SECURITY DEFINER: %', v_no_definer;
  end if;

  select string_agg(routine_name || '/' || grantee, ', ') into v_filtrable_por_anon
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'pending_receptions_report'
    and grantee in ('anon', 'PUBLIC');
  if v_filtrable_por_anon is not null then
    raise exception 'MIGRACION FALLIDA: acceso indebido de anon/public: %', v_filtrable_por_anon;
  end if;

  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'pending_receptions_report' and grantee = 'authenticated'
  ) then
    raise exception 'MIGRACION FALLIDA: authenticated no tiene EXECUTE sobre pending_receptions_report';
  end if;

  raise notice 'OK - pending_receptions_report es DEFINER, solo authenticated.';
end
$guard$;