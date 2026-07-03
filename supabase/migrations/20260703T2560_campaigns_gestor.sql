-- 20260703T2560_campaigns_gestor.sql
-- Aplicada: (pendiente)
--
-- G2·D — Gestor ampliado (cierra G2a+). Requiere 2500..2550.
--   save_campaign: ampliado a kinds standard | item_percent | free_delivery, con
--     scope (campaign_scope), franja (weekdays/time), presupuesto (budget_max).
--     Transaccional (una función plpgsql = atómica). Reemplaza la firma de G1.
--   campaign_menu_tree(account): marcas→categorías→platos con price/cost/refPrice
--     (Ómnibus) + floorPct, para el picker de alcance y el impacto de margen del modal.
--
-- No se prueba en la tx que la crea.

begin;

-- Reemplazo de la firma antigua (G1, solo standard). Firma VIVA confirmada en pg_proc:
--   save_campaign(uuid, uuid, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer)
-- DROP IF EXISTS de AMBAS firmas (antigua 11-args y nueva 17-args) para re-ejecutabilidad.
drop function if exists public.save_campaign(uuid, uuid, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer);
drop function if exists public.save_campaign(uuid, uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer, smallint[], time, time, numeric, jsonb);

create or replace function public.save_campaign(
  p_account uuid, p_id uuid, p_kind text, p_name text, p_code text,
  p_discount_type text, p_value numeric, p_min_subtotal numeric,
  p_starts_at timestamptz, p_ends_at timestamptz, p_max_redemptions integer, p_max_per_customer integer,
  p_weekdays smallint[], p_time_from time, p_time_to time, p_budget_max numeric,
  p_scope jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name  text;
  v_code  text;
  v_mpc   integer;
  v_dtype text;
  v_value numeric;
  v_auto  boolean;
  v_existing coupon%rowtype;
  v_id    uuid;
  v_sc    jsonb;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  if p_kind not in ('standard','item_percent','free_delivery') then
    return jsonb_build_object('ok', false, 'reason', 'bad_kind');
  end if;

  v_name := nullif(btrim(p_name), '');
  v_mpc  := coalesce(p_max_per_customer, 1);
  if v_name is null then return jsonb_build_object('ok', false, 'reason', 'name_required'); end if;
  if v_mpc < 1 then return jsonb_build_object('ok', false, 'reason', 'bad_max_per'); end if;
  if p_min_subtotal is not null and p_min_subtotal < 0 then return jsonb_build_object('ok', false, 'reason', 'bad_min'); end if;
  if p_max_redemptions is not null and p_max_redemptions <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_max'); end if;
  if p_budget_max is not null and p_budget_max <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_budget'); end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end if;

  if p_kind = 'standard' then
    v_code := upper(nullif(btrim(p_code), ''));
    if v_code is null then return jsonb_build_object('ok', false, 'reason', 'code_required'); end if;
    if p_discount_type not in ('percent','fixed') then return jsonb_build_object('ok', false, 'reason', 'bad_type'); end if;
    if p_value is null or p_value <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
    if p_discount_type = 'percent' and p_value > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_percent'); end if;
    v_dtype := p_discount_type; v_value := p_value; v_auto := false;
  elsif p_kind = 'item_percent' then
    v_code := null; v_auto := false; v_dtype := 'percent';
    if p_value is null or p_value <= 0 or p_value > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
    v_value := p_value;
    if jsonb_typeof(p_scope) <> 'array' or jsonb_array_length(coalesce(p_scope,'[]'::jsonb)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'scope_required');
    end if;
  else  -- free_delivery: value/discount_type dummy (el descuento es el envío); auto.
    v_code := null; v_dtype := 'fixed'; v_value := 1; v_auto := true;
  end if;

  if p_id is null then
    begin
      insert into coupon (account_id, name, code, discount_type, value, applies_to,
                          first_order_only, auto_apply, max_per_customer, max_redemptions, min_subtotal,
                          starts_at, ends_at, active, kind, origin,
                          weekdays, time_from, time_to, budget_max, channels, created_by)
      values (p_account, v_name, v_code, v_dtype, v_value, 'subtotal',
              false, v_auto, v_mpc, p_max_redemptions, p_min_subtotal,
              p_starts_at, p_ends_at, true, p_kind, 'manual',
              p_weekdays, p_time_from, p_time_to, p_budget_max, '{shop}', auth.uid())
      returning id into v_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'reason',
        case when p_kind = 'free_delivery' then 'free_delivery_exists' else 'code_taken' end);
    end;
  else
    select * into v_existing from coupon where id = p_id and account_id = p_account;
    if v_existing.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    -- Sistema = bienvenida (standard auto/first) o frecuencia. item_percent/free_delivery editables.
    if v_existing.kind = 'frequency'
       or (v_existing.kind = 'standard' and (v_existing.auto_apply or v_existing.first_order_only)) then
      return jsonb_build_object('ok', false, 'reason', 'system');
    end if;
    begin
      update coupon set
        name             = v_name,
        code             = v_code,
        discount_type    = v_dtype,
        value            = v_value,
        min_subtotal     = p_min_subtotal,
        starts_at        = p_starts_at,
        ends_at          = p_ends_at,
        max_redemptions  = p_max_redemptions,
        max_per_customer = v_mpc,
        weekdays         = p_weekdays,
        time_from        = p_time_from,
        time_to          = p_time_to,
        budget_max       = p_budget_max,
        updated_at       = now()
      where id = p_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'reason',
        case when v_existing.kind = 'free_delivery' then 'free_delivery_exists' else 'code_taken' end);
    end;
    v_id := p_id;
  end if;

  -- Alcance (solo item_percent): reemplazar en bloque (atómico con el resto).
  if p_kind = 'item_percent' then
    delete from campaign_scope where coupon_id = v_id;
    for v_sc in select * from jsonb_array_elements(p_scope)
    loop
      insert into campaign_scope (coupon_id, brand_id, menu_category_id, menu_item_id)
      values (v_id,
        case when v_sc->>'type' = 'brand'    then (v_sc->>'id')::uuid else null end,
        case when v_sc->>'type' = 'category' then (v_sc->>'id')::uuid else null end,
        case when v_sc->>'type' = 'item'     then (v_sc->>'id')::uuid else null end);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

grant execute on function public.save_campaign(uuid, uuid, text, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer, smallint[], time, time, numeric, jsonb) to authenticated;

-- ── campaign_menu_tree: marcas→categorías→platos + margen/Ómnibus para el modal ─
create or replace function public.campaign_menu_tree(p_account uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_floor numeric;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select shop_coupon_margin_floor_pct into v_floor from accounts where id = p_account;

  return jsonb_build_object(
    'floorPct', v_floor,
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'name', b.name,
               'categories', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', c.id, 'name', c.name,
                          'items', coalesce((
                            select jsonb_agg(jsonb_build_object(
                                     'id', mi.id, 'name', mi.name, 'price', mi.price,
                                     'cost', case when ri.computed_cost is not null
                                                  then round(ri.computed_cost + coalesce(mi.packaging_cost,0), 4) else null end,
                                     'costed', (mi.recipe_item_id is not null and ri.computed_cost is not null),
                                     'refPrice', public.omnibus_ref_price(mi.id))
                                   order by mi.position nulls last, mi.name)
                            from menu_item mi
                            left join recipe_item ri on ri.id = mi.recipe_item_id
                            where mi.menu_category_id = c.id and mi.account_id = p_account
                              and mi.is_active is not false and mi.archived_at is null
                              and mi.mirror_of_item_id is null
                          ), '[]'::jsonb))
                        order by c.position nulls last, c.name)
                 from menu_category c
                 where c.brand_id = b.id and c.account_id = p_account
               ), '[]'::jsonb))
             order by b.name)
      from brand b
      where b.account_id = p_account and b.is_active and b.archived_at is null
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.campaign_menu_tree(uuid) to authenticated;

-- ── list_campaigns: isSystem excluye item_percent/free_delivery (editables aquí) ─
CREATE OR REPLACE FUNCTION public.list_campaigns(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id',                 c.id,
             'name',               c.name,
             'code',               c.code,
             'kind',               c.kind,
             'discountType',       c.discount_type,
             'value',              c.value,
             'minSubtotal',        c.min_subtotal,
             'firstOrderOnly',     c.first_order_only,
             'autoApply',          c.auto_apply,
             'frequencyThreshold', c.frequency_threshold,
             'startsAt',           c.starts_at,
             'endsAt',             c.ends_at,
             'maxRedemptions',     c.max_redemptions,
             'maxPerCustomer',     c.max_per_customer,
             'active',             c.active,
             'pausedAt',           c.paused_at,
             'origin',             c.origin,
             'budgetMax',          c.budget_max,
             'weekdays',           c.weekdays,
             'timeFrom',           c.time_from,
             'timeTo',             c.time_to,
             'channels',           c.channels,
             'status', case
               when c.paused_at is not null then 'paused'
               when not c.active then 'paused'
               when c.ends_at is not null and c.ends_at <= now() then 'expired'
               when c.budget_max is not null and coalesce(p.sum_disc, 0) >= c.budget_max then 'exhausted'
               when c.starts_at is not null and c.starts_at > now() then 'scheduled'
               else 'active' end,
             -- Sistema = bienvenida (standard auto/first) o frecuencia. item_percent y
             -- free_delivery son campañas EDITABLES aquí (aunque free_delivery sea auto).
             'isSystem', (c.kind = 'frequency' or (c.kind = 'standard' and (c.auto_apply or c.first_order_only))),
             'redemptions',  coalesce(p.n, 0),
             'discounted',   coalesce(p.sum_disc, 0),
             'avgMarginPct', p.avg_margin_pct
           )
           order by (c.kind = 'frequency' or (c.kind = 'standard' and (c.auto_apply or c.first_order_only))) desc, c.created_at desc)
    from coupon c
    cross join lateral (
      select count(*) as n,
             sum(cr.discount_amount) as sum_disc,
             round(avg(cr.margin_after / nullif(cr.reference_subtotal - cr.discount_amount, 0))
                     filter (where cr.margin_after is not null) * 100, 1) as avg_margin_pct
      from coupon_redemption cr
      join sale s on s.id = cr.sale_id
      where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
    ) p
    where c.account_id = p_account
  ), '[]'::jsonb);
end;
$function$;

commit;
