-- 20260703T1010_customer_account_rpcs.sql
-- Aplicada: (pendiente)
--
-- F4·T1 — RPCs de "Mi cuenta" del Folvy Shop, TODAS validando SOLO el token de
-- customer_session (patrón customer_session_me): resuelven customer_id + account_id
-- desde customer_session where token=p_token and revoked_at is null and expires_at>now();
-- si no hay sesión válida → {ok:false, reason:'session'}. NUNCA delegan en RPCs con
-- guard auth.uid(): replican el SELECT necesario. SECURITY DEFINER, search_path
-- 'public' (ninguna usa pgcrypto/extensions).
--
-- Funciones:
--   customer_orders(p_token, p_limit)                 -> histórico con fotos + marcas
--   customer_reorder_payload(p_token, p_sale_id)      -> {locationId, mode, lines} (strip)
--   customer_set_consent(p_token, p_consent)          -> baja/alta consentimiento (RGPD 7.3)
--   customer_update_profile(p_token, p_name, p_phone) -> editar nombre/teléfono
--   customer_addresses(p_token)                       -> lista de direcciones
--   customer_save_address(p_token, ...)               -> alta/edición (+ predeterminada)
--   customer_delete_address(p_token, p_id)            -> borrar (+ promover otra a default)
--
-- NO se prueban aquí (no invocar SECURITY DEFINER en la tx que las crea): la
-- verificación es DESDE LA APP (punto 6 del encargo).

begin;

-- ── a) Histórico de pedidos ───────────────────────────────────────────────
create or replace function public.customer_orders(p_token text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  return jsonb_build_object(
    'ok', true,
    'orders', coalesce((
      select jsonb_agg(o.j order by o.created_at desc)
      from (
        select
          jsonb_build_object(
            'saleId',       s.id,
            'code',         s.platform_order_code,
            'date',         s.created_at,
            'total',        s.total,
            'discount',     s.discount_amount,
            'orderStatus',  s.order_status,
            'mode',         nullif(s.raw_tab,'')::jsonb ->> 'mode',
            'brands', coalesce((
              select jsonb_agg(distinct jsonb_build_object(
                       'name', b.name, 'logoUrl', b.logo_url, 'color', b.color))
              from sale_line sl
              join menu_item mi on mi.id = sl.menu_item_id
              join brand b on b.id = mi.brand_id
              where sl.sale_id = s.id and sl.line_type = 'product'
            ), '[]'::jsonb),
            'lines', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'name', sl.product_name, 'qty', sl.quantity, 'photoUrl', mi.photo_url)
                     order by sl.created_at)
              from sale_line sl
              left join menu_item mi on mi.id = sl.menu_item_id
              where sl.sale_id = s.id and sl.line_type = 'product'
            ), '[]'::jsonb),
            'thumbnailUrl', (
              select mi.photo_url
              from sale_line sl
              join menu_item mi on mi.id = sl.menu_item_id
              where sl.sale_id = s.id and sl.line_type = 'product' and mi.photo_url is not null
              order by sl.created_at
              limit 1
            )
          ) as j,
          s.created_at as created_at
        from sale s
        where s.customer_id = v_customer and s.source = 'folvy_shop'
        order by s.created_at desc
        limit greatest(1, coalesce(p_limit, 20))
      ) o
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ── b) Payload de reorder (STRIP a {locationId, mode, lines}) ──────────────
create or replace function public.customer_reorder_payload(p_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
  v_sale     sale%rowtype;
  v_raw      jsonb;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select * into v_sale from sale where id = p_sale_id;
  if v_sale.id is null or v_sale.customer_id is distinct from v_customer or v_sale.source <> 'folvy_shop' then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_raw := nullif(v_sale.raw_tab,'')::jsonb;
  return jsonb_build_object(
    'ok', true,
    'payload', jsonb_build_object(
      'locationId', v_raw ->> 'locationId',
      'mode',       coalesce(v_raw ->> 'mode', 'delivery'),
      'lines',      coalesce(v_raw -> 'lines', '[]'::jsonb)
    )
  );
end;
$fn$;

-- ── c) Consentimiento desde "Mi cuenta" (RGPD art. 7.3) ────────────────────
create or replace function public.customer_set_consent(p_token text, p_consent boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
  v_prev     boolean;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select marketing_email into v_prev from customer_consent where customer_id = v_customer;

  -- Solo si hay cambio real: upsert + log (append-only prueba legal).
  if coalesce(v_prev, false) is distinct from coalesce(p_consent, false) then
    insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
    values (v_customer, v_acc, coalesce(p_consent, false), now())
    on conflict (customer_id) do update set marketing_email = excluded.marketing_email, updated_at = now();

    insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
    values (v_customer, v_acc,
            case when coalesce(p_consent, false) then 'granted' else 'revoked' end,
            'email', 'account_page', 'shop-privacy-v1');
  end if;

  return jsonb_build_object('ok', true, 'consented', coalesce(p_consent, false));
end;
$fn$;

-- ── d) Editar nombre/teléfono (email NO se toca aquí) ──────────────────────
create or replace function public.customer_update_profile(p_token text, p_name text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
  v_name     text;
  v_phone    text;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  v_name  := nullif(btrim(p_name),  '');
  v_phone := nullif(btrim(p_phone), '');

  -- Teléfono único por cuenta (índice único parcial (account_id, phone)).
  if v_phone is not null and exists (
        select 1 from customer
        where account_id = v_acc and phone = v_phone and id <> v_customer
     ) then
    return jsonb_build_object('ok', false, 'reason', 'phone_taken');
  end if;

  begin
    update customer set name = v_name, phone = v_phone, updated_at = now()
    where id = v_customer;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'phone_taken');
  end;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ── e1) Listar direcciones ─────────────────────────────────────────────────
create or replace function public.customer_addresses(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer uuid;
  v_acc      uuid;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  return jsonb_build_object(
    'ok', true,
    'addresses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'label', a.label, 'address', a.address, 'detail', a.detail,
               'lat', a.lat, 'lng', a.lng, 'isDefault', a.is_default)
             order by a.is_default desc, a.created_at)
      from customer_address a
      where a.customer_id = v_customer
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ── e2) Guardar dirección (alta o edición) ─────────────────────────────────
create or replace function public.customer_save_address(
  p_token text, p_id uuid, p_label text, p_address text, p_detail text,
  p_lat numeric, p_lng numeric, p_is_default boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer     uuid;
  v_acc          uuid;
  v_addr         text;
  v_id           uuid;
  v_n            integer;
  v_make_default boolean;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  v_addr := nullif(btrim(p_address), '');
  if v_addr is null then
    return jsonb_build_object('ok', false, 'reason', 'address_required');
  end if;

  -- La primera dirección del cliente nace como predeterminada aunque no se pida.
  if p_id is null then
    select count(*) into v_n from customer_address where customer_id = v_customer;
    v_make_default := coalesce(p_is_default, false) or v_n = 0;
  else
    v_make_default := coalesce(p_is_default, false);
  end if;

  -- Si va a ser la predeterminada, desmarcar las demás ANTES (índice único parcial).
  if v_make_default then
    update customer_address set is_default = false, updated_at = now()
    where customer_id = v_customer and is_default;
  end if;

  if p_id is null then
    insert into customer_address (customer_id, account_id, label, address, detail, lat, lng, is_default)
    values (v_customer, v_acc, nullif(btrim(p_label),''), v_addr, nullif(btrim(p_detail),''),
            p_lat, p_lng, v_make_default)
    returning id into v_id;
  else
    update customer_address set
      label      = nullif(btrim(p_label),''),
      address    = v_addr,
      detail     = nullif(btrim(p_detail),''),
      lat        = p_lat,
      lng        = p_lng,
      is_default = v_make_default,
      updated_at = now()
    where id = p_id and customer_id = v_customer
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

-- ── e3) Borrar dirección ───────────────────────────────────────────────────
create or replace function public.customer_delete_address(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_customer     uuid;
  v_acc          uuid;
  v_was_default  boolean;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  delete from customer_address
  where id = p_id and customer_id = v_customer
  returning is_default into v_was_default;

  -- Si borramos la predeterminada y quedan otras, promover la más reciente.
  if coalesce(v_was_default, false) then
    update customer_address set is_default = true, updated_at = now()
    where id = (
      select id from customer_address
      where customer_id = v_customer
      order by created_at desc
      limit 1
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- ── GRANTs: el comensal usa la anon key (no es auth.users) ─────────────────
grant execute on function public.customer_orders(text, integer)                              to anon, authenticated;
grant execute on function public.customer_reorder_payload(text, uuid)                        to anon, authenticated;
grant execute on function public.customer_set_consent(text, boolean)                         to anon, authenticated;
grant execute on function public.customer_update_profile(text, text, text)                   to anon, authenticated;
grant execute on function public.customer_addresses(text)                                    to anon, authenticated;
grant execute on function public.customer_save_address(text, uuid, text, text, text, numeric, numeric, boolean) to anon, authenticated;
grant execute on function public.customer_delete_address(text, uuid)                         to anon, authenticated;

commit;
