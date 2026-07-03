-- 20260703T2410_campaigns_rpcs.sql
-- Aplicada: (pendiente)
--
-- G1 — RPCs del gestor de campañas. SECURITY DEFINER + guard current_user_account_ids()
-- (patrón save_welcome_offer). NO tocan place_shop_order (CRUD + lectura).
--
--   list_campaigns(account)    -> array de TODAS las campañas de la cuenta con estado
--                                 derivado + rendimiento REAL (canjes VIVOS: mismo filtro
--                                 join sale coalesce(status,'')<>'cancelled' de la 2200).
--   save_campaign(...)         -> crea/edita SOLO cupones estándar de CÓDIGO (manual).
--                                 Los de sistema (bienvenida/frecuencia) se editan en sus
--                                 settings -> reason 'system'. Código único -> 'code_taken'.
--   toggle_campaign(...)       -> pausar/reactivar (active + paused_at). Permitido también
--                                 sobre los de sistema (pausar la bienvenida es legítimo).
--
-- No se prueba en la tx que las crea.

begin;

-- ── list_campaigns ──────────────────────────────────────────────────────────
create or replace function public.list_campaigns(p_account uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
             'status', case
               when c.paused_at is not null then 'paused'
               when not c.active then 'paused'
               when c.ends_at is not null and c.ends_at <= now() then 'expired'
               when c.starts_at is not null and c.starts_at > now() then 'scheduled'
               else 'active' end,
             'isSystem', (c.kind = 'frequency' or c.auto_apply or c.first_order_only),
             'redemptions',  coalesce(p.n, 0),
             'discounted',   coalesce(p.sum_disc, 0),
             'avgMarginPct', p.avg_margin_pct
           )
           order by (c.kind = 'frequency' or c.auto_apply or c.first_order_only) desc, c.created_at desc)
    from coupon c
    cross join lateral (
      -- Rendimiento REAL: solo canjes con venta NO cancelada (calcado de la 2200).
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
$fn$;

-- ── save_campaign (solo estándar de CÓDIGO, origin manual) ──────────────────
create or replace function public.save_campaign(
  p_account uuid, p_id uuid, p_name text, p_code text, p_discount_type text,
  p_value numeric, p_min_subtotal numeric, p_starts_at timestamptz, p_ends_at timestamptz,
  p_max_redemptions integer, p_max_per_customer integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text;
  v_code text;
  v_mpc  integer;
  v_existing coupon%rowtype;
  v_id   uuid;
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  v_name := nullif(btrim(p_name), '');
  v_code := upper(nullif(btrim(p_code), ''));
  v_mpc  := coalesce(p_max_per_customer, 1);

  if v_name is null then return jsonb_build_object('ok', false, 'reason', 'name_required'); end if;
  if v_code is null then return jsonb_build_object('ok', false, 'reason', 'code_required'); end if;
  if p_discount_type not in ('percent','fixed') then return jsonb_build_object('ok', false, 'reason', 'bad_type'); end if;
  if p_value is null or p_value <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_value'); end if;
  if p_discount_type = 'percent' and p_value > 100 then return jsonb_build_object('ok', false, 'reason', 'bad_percent'); end if;
  if p_min_subtotal is not null and p_min_subtotal < 0 then return jsonb_build_object('ok', false, 'reason', 'bad_min'); end if;
  if p_max_redemptions is not null and p_max_redemptions <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_max'); end if;
  if v_mpc < 1 then return jsonb_build_object('ok', false, 'reason', 'bad_max_per'); end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'reason', 'bad_window');
  end if;

  if p_id is null then
    begin
      insert into coupon (account_id, name, code, discount_type, value, applies_to,
                          first_order_only, auto_apply, max_per_customer, max_redemptions,
                          min_subtotal, starts_at, ends_at, active, kind, origin, created_by)
      values (p_account, v_name, v_code, p_discount_type, p_value, 'subtotal',
              false, false, v_mpc, p_max_redemptions,
              p_min_subtotal, p_starts_at, p_ends_at, true, 'standard', 'manual', auth.uid())
      returning id into v_id;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'reason', 'code_taken');
    end;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  -- Edición: debe existir en la cuenta y NO ser de sistema.
  select * into v_existing from coupon where id = p_id and account_id = p_account;
  if v_existing.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_existing.kind = 'frequency' or v_existing.auto_apply or v_existing.first_order_only then
    return jsonb_build_object('ok', false, 'reason', 'system');
  end if;

  begin
    update coupon set
      name            = v_name,
      code            = v_code,
      discount_type   = p_discount_type,
      value           = p_value,
      min_subtotal    = p_min_subtotal,
      starts_at       = p_starts_at,
      ends_at         = p_ends_at,
      max_redemptions = p_max_redemptions,
      max_per_customer = v_mpc,
      updated_at      = now()
    where id = p_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'code_taken');
  end;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$fn$;

-- ── toggle_campaign (pausar/reactivar; permitido en los de sistema) ─────────
create or replace function public.toggle_campaign(p_account uuid, p_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_existing coupon%rowtype;
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;

  select * into v_existing from coupon where id = p_id and account_id = p_account;
  if v_existing.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if coalesce(p_active, false) then
    update coupon set active = true, paused_at = null, updated_at = now() where id = p_id;
  else
    update coupon set active = false, paused_at = now(), updated_at = now() where id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'active', coalesce(p_active, false));
end;
$fn$;

grant execute on function public.list_campaigns(uuid) to authenticated;
grant execute on function public.save_campaign(uuid, uuid, text, text, text, numeric, numeric, timestamptz, timestamptz, integer, integer) to authenticated;
grant execute on function public.toggle_campaign(uuid, uuid, boolean) to authenticated;

commit;
