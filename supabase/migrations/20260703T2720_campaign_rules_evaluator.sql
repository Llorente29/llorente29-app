-- 20260703T2720_campaign_rules_evaluator.sql
-- Aplicada: (pendiente)
--
-- G2d sub-lote 2 — EVALUADOR del motor de reglas + disparador VALLE HORARIO, con
-- pg_cron cada 15 min. Requiere 2710 (modelo). weak_brand / stalled_dish llegan en
-- el sub-lote 3 (aquí sus ramas están declaradas pero no evalúan).
--
-- evaluate_campaign_rules(): por cada regla activa comprueba, en orden, los LÍMITES
-- (kill switch) y luego el disparador:
--   * tope GLOBAL: máx 3 campañas origin='rule' activas por cuenta.
--   * max_active por regla.
--   * cooldown (now - last_fired_at >= cooldown_minutes).
--   * valle horario: ventas de la franja actual [now-franjaHoras, now) vs la media de
--     esa misma franja+día de semana en las últimas N semanas; dispara si
--     current < mean*(1-dropPct/100).
-- Si dispara: NACE una campaña item_percent/bogo desde action_template, origin='rule',
-- budget_max de la regla, time-boxed (ends_at = now + duration_minutes); registra el
-- disparo en campaign_rule_firing con el "por qué" (reason) y fija last_fired_at.
--
-- Acción v1 = crear-desde-plantilla (aprobado). Se limita a kinds del motor de ofertas
-- (item_percent/bogo, auto_apply=false, se aplican por scope+ventana) para no chocar
-- con el índice único de "un auto por kind". Verificación: Julio corre
-- select evaluate_campaign_rules() en el editor (postgres) tras crear una regla.
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
  v_fh         numeric; v_weeks int; v_drop numeric;
  v_cur        numeric; v_mean numeric;
  v_fires      boolean; v_reason jsonb;
  v_active_acct int; v_active_rule int;
  v_coupon_id  uuid; v_lit int := 0;
  v_sc         jsonb; v_kind text; v_val numeric;
begin
  for r in select * from campaign_rule where active loop
    -- ── Límites (freno de mano) ─────────────────────────────────────────────
    select count(*) into v_active_acct from coupon
      where account_id = r.account_id and origin = 'rule' and active
        and (ends_at is null or ends_at > v_now);
    if v_active_acct >= 3 then continue; end if;             -- tope GLOBAL por cuenta

    select count(*) into v_active_rule from coupon c
      join campaign_rule_firing f on f.coupon_id = c.id
      where f.rule_id = r.id and c.active and (c.ends_at is null or c.ends_at > v_now);
    if v_active_rule >= r.max_active then continue; end if;

    if r.last_fired_at is not null
       and v_now - r.last_fired_at < make_interval(mins => r.cooldown_minutes) then continue; end if;

    -- ── Disparador ──────────────────────────────────────────────────────────
    v_fires := false; v_reason := null;

    if r.trigger_type = 'hourly_valley' then
      v_fh    := coalesce((r.condition->>'franjaHoras')::numeric, 2);
      v_weeks := coalesce((r.condition->>'weeks')::int, 4);
      v_drop  := coalesce((r.condition->>'dropPct')::numeric, 30);

      select coalesce(sum(s.total), 0) into v_cur
      from sale s
      where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
        and s.sold_at >= v_now - make_interval(hours => v_fh::int) and s.sold_at < v_now
        and (r.location_id is null or s.location_id = r.location_id)
        and (r.brand_id is null or exists (
          select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id
          where sl.sale_id = s.id and mi.brand_id = r.brand_id));

      select avg(wk.s) into v_mean from (
        select (
          select coalesce(sum(s.total), 0)
          from sale s
          where s.account_id = r.account_id and s.source = 'folvy_shop' and coalesce(s.status,'') <> 'cancelled'
            and s.sold_at >= v_now - make_interval(weeks => w) - make_interval(hours => v_fh::int)
            and s.sold_at <  v_now - make_interval(weeks => w)
            and (r.location_id is null or s.location_id = r.location_id)
            and (r.brand_id is null or exists (
              select 1 from sale_line sl join menu_item mi on mi.id = sl.menu_item_id
              where sl.sale_id = s.id and mi.brand_id = r.brand_id))
        ) as s
        from generate_series(1, v_weeks) w
      ) wk;

      if v_mean is not null and v_mean > 0 and v_cur < v_mean * (1 - v_drop / 100.0) then
        v_fires  := true;
        v_reason := jsonb_build_object('trigger','hourly_valley','franjaHoras',v_fh,'weeks',v_weeks,
                    'dropPct',v_drop,'mean',round(v_mean,2),'current',round(v_cur,2));
      end if;
    end if;

    -- weak_brand / stalled_dish -> sub-lote 3 (aún no evalúan).

    -- ── Encender la campaña (nace origin='rule') ────────────────────────────
    if v_fires then
      v_kind := coalesce(r.action_template->>'kind', 'item_percent');
      if v_kind not in ('item_percent', 'bogo') then v_kind := 'item_percent'; end if;  -- v1: kinds del motor de ofertas
      v_val  := coalesce((r.action_template->>'value')::numeric, 10);

      insert into coupon (account_id, name, code, discount_type, value, applies_to,
        first_order_only, auto_apply, max_per_customer, min_subtotal,
        starts_at, ends_at, active, kind, origin,
        weekdays, time_from, time_to, budget_max, channels, created_by)
      values (r.account_id, coalesce(nullif(btrim(r.action_template->>'name'),''), r.name), null, 'percent', v_val, 'subtotal',
        false, false, 1, null,
        v_now, v_now + make_interval(mins => r.duration_minutes), true, v_kind, 'rule',
        null, null, null, r.budget_max, '{shop}', r.created_by)
      returning id into v_coupon_id;

      if jsonb_typeof(r.action_template->'scope') = 'array' then
        for v_sc in select * from jsonb_array_elements(r.action_template->'scope') loop
          insert into campaign_scope (coupon_id, brand_id, menu_category_id, menu_item_id)
          values (v_coupon_id,
            case when v_sc->>'type' = 'brand'    then (v_sc->>'id')::uuid else null end,
            case when v_sc->>'type' = 'category' then (v_sc->>'id')::uuid else null end,
            case when v_sc->>'type' = 'item'     then (v_sc->>'id')::uuid else null end);
        end loop;
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

-- pg_cron cada 15 min (patrón de expire-unpaid-shop-orders). Idempotente.
do $$ begin perform cron.unschedule('evaluate-campaign-rules'); exception when others then null; end $$;
select cron.schedule('evaluate-campaign-rules', '*/15 * * * *', 'select public.evaluate_campaign_rules();');

commit;
