-- 20260703T2630_free_item_gestor.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote B1 — GESTOR de free_item (plato de regalo desde X€).
--
-- save_campaign acepta kind='free_item':
--   * scope = EXACTAMENTE un plato (el regalado) -> campaign_scope (item).
--   * min_subtotal OBLIGATORIO = el "desde X€" (subtotal sin el regalo).
--   * auto_apply=true (se aplica solo, como free_delivery), discount_type/value dummy.
-- El motor (lane en place_shop_order) llega en B2. El CHECK ya admite 'free_item'
-- (2590). Misma firma 17-args (CREATE OR REPLACE, sin cambio de firma; regla:
-- 2590 está APLICADA, así que esto va en migración NUEVA). GRANT re-emitido.
--
-- Reproducción fiel de save_campaign (2590) + rama free_item. Transaccional.
-- No se prueba en la tx que la crea (auth.uid() null en SQL Editor).

begin;

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

  if p_kind not in ('standard','item_percent','free_delivery','bogo','free_item') then
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
  elsif p_kind in ('item_percent','bogo') then
    -- item_percent: % de cada unidad en scope. bogo: % de la 2ª unidad de cada par
    -- (100 = 2x1). Ambos: value 1..100, scope obligatorio, auto_apply=false.
    v_code := null; v_auto := false; v_dtype := 'percent';
    if p_value is null or p_value <= 0 or p_value > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
    v_value := p_value;
    if jsonb_typeof(p_scope) <> 'array' or jsonb_array_length(coalesce(p_scope,'[]'::jsonb)) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'scope_required');
    end if;
  elsif p_kind = 'free_item' then
    -- Regalo: 1 plato en scope + mínimo obligatorio ("desde X€"); auto, value dummy.
    v_code := null; v_dtype := 'fixed'; v_value := 1; v_auto := true;
    if p_min_subtotal is null or p_min_subtotal <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'min_required');
    end if;
    if jsonb_typeof(p_scope) <> 'array'
       or jsonb_array_length(coalesce(p_scope,'[]'::jsonb)) <> 1
       or (p_scope->0->>'type') <> 'item' then
      return jsonb_build_object('ok', false, 'reason', 'gift_item_required');
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
        case when p_kind = 'free_delivery' then 'free_delivery_exists'
             when p_kind = 'free_item'     then 'free_item_exists'
             else 'code_taken' end);
    end;
  else
    select * into v_existing from coupon where id = p_id and account_id = p_account;
    if v_existing.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    -- Sistema = bienvenida (standard auto/first) o frecuencia. item_percent/free_delivery/bogo/free_item editables.
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
        case when v_existing.kind = 'free_delivery' then 'free_delivery_exists'
             when v_existing.kind = 'free_item'     then 'free_item_exists'
             else 'code_taken' end);
    end;
    v_id := p_id;
  end if;

  -- Alcance (item_percent, bogo y free_item): reemplazar en bloque (atómico).
  if p_kind in ('item_percent','bogo','free_item') then
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

commit;
