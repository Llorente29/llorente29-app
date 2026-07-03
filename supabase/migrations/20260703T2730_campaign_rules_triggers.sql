-- 20260703T2730_campaign_rules_triggers.sql
-- Aplicada: (pendiente)
--
-- G2d sub-lote 3 — Disparadores weak_brand + stalled_dish en el evaluador. 2720 está
-- APLICADA (no se edita); esto es CREATE OR REPLACE del evaluador (misma firma) con
-- las dos ramas nuevas + inyección de scope desde el objetivo del disparador.
--
--   weak_brand  {days:7, weeks:4, dropPct:25}: ventas de la MARCA (via
--     sale_line->menu_item.brand_id) en los últimos `days` vs la media de esa ventana
--     en las `weeks` previas; dispara si cae > dropPct. Requiere brand_id.
--   stalled_dish {days:7, stockMin, salesMax}: PLATO con recipe_item.is_stockable y
--     current_stock >= stockMin y unidades vendidas en `days` <= salesMax. Requiere
--     menu_item_id.
--
-- Scope de la campaña encendida: de action_template.scope si viene; si no, se deriva
-- del objetivo (menu_item_id -> item; brand_id -> marca). Resto igual que 2720.
--
-- No se prueba en la tx que la crea.

begin;

create or replace function public.evaluate_campaign_rules()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r            campaign_rule%rowtype;
  v_now        timestamptz := now();
  v_fh         numeric; v_weeks int; v_drop numeric; v_days int;
  v_stock      numeric; v_stock_min numeric; v_sales_max numeric; v_sold numeric;
  v_cur        numeric; v_mean numeric;
  v_fires      boolean; v_reason jsonb;
  v_active_acct int; v_active_rule int;
  v_coupon_id  uuid; v_lit int := 0;
  v_sc         jsonb; v_kind text; v_val numeric;
begin
  for r in select * from campaign_rule where active loop
    -- ── Límites (freno de mano) ─────────────────────────────────────────────
    select count(*) into v_active_acct from coupon
      where account_id = r.account_id and origin = 'rule' and active and (ends_at is null or ends_at > v_now);
    if v_active_acct >= 3 then continue; end if;

    select count(*) into v_active_rule from coupon c
      join campaign_rule_firing f on f.coupon_id = c.id
      where f.rule_id = r.id and c.active and (c.ends_at is null or c.ends_at > v_now);
    if v_active_rule >= r.max_active then continue; end if;

    if r.last_fired_at is not null and v_now - r.last_fired_at < make_interval(mins => r.cooldown_minutes) then continue; end if;

    -- ── Disparadores ────────────────────────────────────────────────────────
    v_fires := false; v_reason := null;

    if r.trigger_type = 'hourly_valley' then
      v_fh := coalesce((r.condition->>'franjaHoras')::numeric, 2);
      v_weeks := coalesce((r.condition->>'weeks')::int, 4);
      v_drop := coalesce((r.condition->>'dropPct')::numeric, 30);
      select coalesce(sum(s.total), 0) into v_cur from sale s
      where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
        and s.sold_at >= v_now - make_interval(hours => v_fh::int) and s.sold_at < v_now
        and (r.location_id is null or s.location_id = r.location_id)
        and (r.brand_id is null or exists (select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id where sl.sale_id = s.id and mi.brand_id = r.brand_id));
      select avg(wk.s) into v_mean from (
        select (select coalesce(sum(s.total), 0) from sale s
          where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
            and s.sold_at >= v_now - make_interval(weeks => w) - make_interval(hours => v_fh::int) and s.sold_at < v_now - make_interval(weeks => w)
            and (r.location_id is null or s.location_id = r.location_id)
            and (r.brand_id is null or exists (select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id where sl.sale_id = s.id and mi.brand_id = r.brand_id))) as s
        from generate_series(1, v_weeks) w) wk;
      if v_mean is not null and v_mean > 0 and v_cur < v_mean * (1 - v_drop / 100.0) then
        v_fires := true;
        v_reason := jsonb_build_object('trigger','hourly_valley','franjaHoras',v_fh,'weeks',v_weeks,'dropPct',v_drop,'mean',round(v_mean,2),'current',round(v_cur,2));
      end if;

    elsif r.trigger_type = 'weak_brand' and r.brand_id is not null then
      v_days := coalesce((r.condition->>'days')::int, 7);
      v_weeks := coalesce((r.condition->>'weeks')::int, 4);
      v_drop := coalesce((r.condition->>'dropPct')::numeric, 25);
      select coalesce(sum(sl.line_total), 0) into v_cur
      from sale s join sale_line sl on sl.sale_id = s.id and coalesce(sl.line_type,'product') = 'product'
      join menu_item mi on mi.id = sl.menu_item_id
      where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
        and mi.brand_id = r.brand_id and s.sold_at >= v_now - make_interval(days => v_days) and s.sold_at < v_now
        and (r.location_id is null or s.location_id = r.location_id);
      select avg(wk.s) into v_mean from (
        select (select coalesce(sum(sl.line_total), 0)
          from sale s join sale_line sl on sl.sale_id = s.id and coalesce(sl.line_type,'product') = 'product'
          join menu_item mi on mi.id = sl.menu_item_id
          where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
            and mi.brand_id = r.brand_id
            and s.sold_at >= v_now - make_interval(days => (w + 1) * v_days) and s.sold_at < v_now - make_interval(days => w * v_days)
            and (r.location_id is null or s.location_id = r.location_id)) as s
        from generate_series(1, v_weeks) w) wk;
      if v_mean is not null and v_mean > 0 and v_cur < v_mean * (1 - v_drop / 100.0) then
        v_fires := true;
        v_reason := jsonb_build_object('trigger','weak_brand','days',v_days,'dropPct',v_drop,'mean',round(v_mean,2),'current',round(v_cur,2),'brandId',r.brand_id);
      end if;

    elsif r.trigger_type = 'stalled_dish' and r.menu_item_id is not null then
      v_days := coalesce((r.condition->>'days')::int, 7);
      v_stock_min := coalesce((r.condition->>'stockMin')::numeric, 0);
      v_sales_max := coalesce((r.condition->>'salesMax')::numeric, 0);
      select ri.current_stock into v_stock
      from menu_item mi join recipe_item ri on ri.id = mi.recipe_item_id
      where mi.id = r.menu_item_id and ri.is_stockable;
      select coalesce(sum(sl.quantity), 0) into v_sold
      from sale s join sale_line sl on sl.sale_id = s.id and coalesce(sl.line_type,'product') = 'product'
      where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
        and sl.menu_item_id = r.menu_item_id and s.sold_at >= v_now - make_interval(days => v_days) and s.sold_at < v_now
        and (r.location_id is null or s.location_id = r.location_id);
      if v_stock is not null and v_stock >= v_stock_min and v_sold <= v_sales_max then
        v_fires := true;
        v_reason := jsonb_build_object('trigger','stalled_dish','days',v_days,'stockMin',v_stock_min,'salesMax',v_sales_max,'stock',round(v_stock,2),'soldUnits',round(v_sold,2),'menuItemId',r.menu_item_id);
      end if;
    end if;

    -- ── Encender la campaña (nace origin='rule') ────────────────────────────
    if v_fires then
      v_kind := coalesce(r.action_template->>'kind', 'item_percent');
      if v_kind not in ('item_percent', 'bogo') then v_kind := 'item_percent'; end if;
      v_val := coalesce((r.action_template->>'value')::numeric, 10);

      insert into coupon (account_id, name, code, discount_type, value, applies_to,
        first_order_only, auto_apply, max_per_customer, min_subtotal,
        starts_at, ends_at, active, kind, origin, weekdays, time_from, time_to, budget_max, channels, created_by)
      values (r.account_id, coalesce(nullif(btrim(r.action_template->>'name'),''), r.name), null, 'percent', v_val, 'subtotal',
        false, false, 1, null, v_now, v_now + make_interval(mins => r.duration_minutes), true, v_kind, 'rule',
        null, null, null, r.budget_max, '{shop}', r.created_by)
      returning id into v_coupon_id;

      -- Scope: de la plantilla; si no trae, se deriva del objetivo del disparador.
      if jsonb_typeof(r.action_template->'scope') = 'array' and jsonb_array_length(r.action_template->'scope') > 0 then
        for v_sc in select * from jsonb_array_elements(r.action_template->'scope') loop
          insert into campaign_scope (coupon_id, brand_id, menu_category_id, menu_item_id)
          values (v_coupon_id,
            case when v_sc->>'type' = 'brand'    then (v_sc->>'id')::uuid else null end,
            case when v_sc->>'type' = 'category' then (v_sc->>'id')::uuid else null end,
            case when v_sc->>'type' = 'item'     then (v_sc->>'id')::uuid else null end);
        end loop;
      elsif r.menu_item_id is not null then
        insert into campaign_scope (coupon_id, brand_id, menu_category_id, menu_item_id) values (v_coupon_id, null, null, r.menu_item_id);
      elsif r.brand_id is not null then
        insert into campaign_scope (coupon_id, brand_id, menu_category_id, menu_item_id) values (v_coupon_id, r.brand_id, null, null);
      end if;

      insert into campaign_rule_firing (rule_id, account_id, coupon_id, fired_at, reason)
      values (r.id, r.account_id, v_coupon_id, v_now, v_reason);

      update campaign_rule set last_fired_at = v_now, updated_at = v_now where id = r.id;
      v_lit := v_lit + 1;
    end if;
  end loop;

  return v_lit;
end;
$fn$;

commit;
