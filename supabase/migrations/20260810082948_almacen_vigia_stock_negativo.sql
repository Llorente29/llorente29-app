alter table public.supply_settings
  add column if not exists neg_stock_rel_pct     numeric not null default 5,
  add column if not exists neg_stock_abs_qty      numeric not null default 5,
  add column if not exists neg_stock_window_days  integer not null default 60;

comment on column public.supply_settings.neg_stock_rel_pct is
  'Vigia de stock negativo: % del consumo reciente que debe superar |qty_on_hand| para contar como ALERTA (anti-ruido). Default 5.';
comment on column public.supply_settings.neg_stock_abs_qty is
  'Vigia de stock negativo: suelo absoluto en unidad base del articulo (evita ruido en articulos casi sin consumo). Default 5.';
comment on column public.supply_settings.neg_stock_window_days is
  'Vigia de stock negativo: ventana en dias para el consumo reciente; sin consumo en la ventana, se usa el consumo total historico. Default 60.';

create or replace function public.negative_stock_report(
  p_account  uuid,
  p_location uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rel_pct numeric;
  v_abs_qty numeric;
  v_window  integer;
  v_res     jsonb;
begin
  if not (current_user_is_admin() or current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'negative_stock_report: sin acceso a la cuenta %', p_account;
  end if;
  select coalesce(s.neg_stock_rel_pct, 5),
         coalesce(s.neg_stock_abs_qty, 5),
         coalesce(s.neg_stock_window_days, 60)
    into v_rel_pct, v_abs_qty, v_window
  from public.supply_settings s
  where s.account_id = p_account;
  v_rel_pct := coalesce(v_rel_pct, 5);
  v_abs_qty := coalesce(v_abs_qty, 5);
  v_window  := coalesce(v_window, 60);
  with universe as (
    select ri.id, ri.name, ku.abbreviation as unit_abbr,
           coalesce(rls.qty_on_hand, 0) as qty_on_hand,
           coalesce(rls.stock_value, 0) as value_eur
    from public.recipe_item ri
    left join public.kitchen_unit ku on ku.id = ri.base_unit_id
    left join public.recipe_item_location_stock rls
           on rls.recipe_item_id = ri.id
          and rls.location_id    = p_location
          and rls.account_id     = p_account
    where ri.account_id = p_account
      and ri.type = 'raw'
      and ri.is_active = true
  ),
  negativos as (
    select * from universe where qty_on_hand < 0
  ),
  mov_all as (
    select sm.recipe_item_id,
           coalesce(sum(sm.qty_base) filter (where sm.movement_type = 'recepcion'), 0)      as recepcion_total,
           count(*)                  filter (where sm.movement_type = 'recepcion')          as recepcion_count,
           coalesce(sum(abs(sm.qty_base)) filter (where sm.movement_type = 'consumo'), 0)    as consumo_total_abs
    from public.stock_movement sm
    where sm.account_id  = p_account
      and sm.location_id = p_location
      and sm.recipe_item_id in (select id from negativos)
    group by sm.recipe_item_id
  ),
  mov_window as (
    select sm.recipe_item_id,
           coalesce(sum(abs(sm.qty_base)), 0) as consumo_window_abs
    from public.stock_movement sm
    where sm.account_id     = p_account
      and sm.location_id    = p_location
      and sm.movement_type  = 'consumo'
      and sm.occurred_at   >= now() - make_interval(days => v_window)
      and sm.recipe_item_id in (select id from negativos)
    group by sm.recipe_item_id
  ),
  scored as (
    select n.id, n.name, n.unit_abbr, n.qty_on_hand, n.value_eur,
           coalesce(ma.recepcion_total, 0)   as recepcion_total,
           coalesce(ma.recepcion_count, 0)   as recepcion_count,
           coalesce(ma.consumo_total_abs, 0) as consumo_total_abs,
           case when coalesce(mw.consumo_window_abs, 0) > 0
                then mw.consumo_window_abs
                else coalesce(ma.consumo_total_abs, 0)
           end as consumo_ref_abs
    from negativos n
    left join mov_all    ma on ma.recipe_item_id = n.id
    left join mov_window mw on mw.recipe_item_id = n.id
  )
  select jsonb_build_object(
    'window_days',       v_window,
    'threshold_rel_pct', v_rel_pct,
    'threshold_abs_qty', v_abs_qty,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'recipe_item_id', s.id,
               'name',           s.name,
               'unit_abbr',      s.unit_abbr,
               'qty_on_hand',    s.qty_on_hand,
               'value_eur',      s.value_eur,
               'ratio_pct',      case when s.consumo_ref_abs > 0
                                       then round(abs(s.qty_on_hand) / s.consumo_ref_abs * 100, 1)
                                       else null end,
               'cause',          case
                                    when s.recepcion_count = 0 then 'sin_entradas'
                                    when s.consumo_total_abs > s.recepcion_total then 'compras_por_detras'
                                    else 'otras_salidas'
                                  end,
               'is_alert',       (abs(s.qty_on_hand) >= greatest(v_rel_pct / 100.0 * s.consumo_ref_abs, v_abs_qty))
             ) order by
               (case when s.consumo_ref_abs > 0
                     then abs(s.qty_on_hand) / s.consumo_ref_abs
                     else null end) desc nulls first,
               s.qty_on_hand asc)
      from scored s
    ), '[]'::jsonb)
  ) into v_res;
  return v_res;
end;
$function$;

revoke all on function public.negative_stock_report(uuid, uuid) from public, anon;
grant execute on function public.negative_stock_report(uuid, uuid) to authenticated;

do $guard$
declare
  v_no_definer         text;
  v_filtrable_por_anon text;
begin
  select string_agg(p.proname, ', ') into v_no_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'negative_stock_report'
    and not p.prosecdef;
  if v_no_definer is not null then
    raise exception 'MIGRACION FALLIDA: deberia ser SECURITY DEFINER: %', v_no_definer;
  end if;
  select string_agg(routine_name || '/' || grantee, ', ') into v_filtrable_por_anon
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = 'negative_stock_report'
    and grantee in ('anon', 'PUBLIC');
  if v_filtrable_por_anon is not null then
    raise exception 'MIGRACION FALLIDA: acceso indebido de anon/public: %', v_filtrable_por_anon;
  end if;
  if not exists (
    select 1 from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'negative_stock_report' and grantee = 'authenticated'
  ) then
    raise exception 'MIGRACION FALLIDA: authenticated no tiene EXECUTE sobre negative_stock_report';
  end if;
  raise notice 'OK - negative_stock_report es DEFINER, solo authenticated, columnas de umbral en supply_settings.';
end
$guard$;