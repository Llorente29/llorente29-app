-- 20260703T2300_frequency_reward.sql
-- Aplicada: (pendiente)
--
-- F4·T3 — Motor de recompensa por FRECUENCIA + progreso real (goal-gradient).
-- El hostelero configura "cada N pedidos, un premio X" viendo el margen real; el
-- premio se otorga SOLO (deuda-0). El progreso NO se materializa: se CALCULA
-- (fuente única, sin drift) = nº de pedidos del Shop NO cancelados desde el último
-- canje VIVO del cupón de frecuencia.
--
-- MODELO:
--   coupon += kind ('standard'|'frequency') + frequency_threshold (>=2 | null).
--     La bienvenida sigue siendo kind='standard' (semántica intacta). El cupón de
--     frecuencia NO usa auto_apply ni first_order_only: se valida por progreso.
--     max_per_customer NO limita el ciclo (es recurrente: cada N pedidos vuelve a
--     ganarse); su valor en el cupón de frecuencia es irrelevante (la validación de
--     frecuencia no lo mira).
--   Índice único parcial: UN solo coupon activo kind='frequency' por cuenta
--     (mismo patrón que coupon_account_one_auto).
--
-- DECISIÓN (más allá del modelo listado, justificada por el RECON de índices):
--   coupon_redemption tenía un índice ÚNICO `coupon_redemption_once_per_customer`
--   sobre (coupon_id, customer_id) WHERE customer_id IS NOT NULL. Ese "una vez por
--   cliente" es correcto para la bienvenida pero IMPEDIRÍA el 2º canje de un cupón
--   RECURRENTE (rompe el ciclo). Solución limpia y sin drift: se añade
--   coupon_redemption.is_cycle (default false) y el índice único pasa a excluir los
--   canjes de ciclo:  ... WHERE (customer_id IS NOT NULL AND NOT is_cycle). Así:
--     · la protección de carrera de la bienvenida se mantiene intacta (is_cycle=false);
--     · el motor de frecuencia inserta filas is_cycle=true, exentas, permitiendo
--       tantos ciclos como el cliente gane, SIN borrar histórico;
--     · el "último canje VIVO" (max ts con venta no cancelada) da el corte de
--       progreso correcto y, si el pedido que ganó el premio se cancela, el corte
--       cae solo al canje vivo anterior (coherente con la 2200).
--
-- place_shop_order: rama ADITIVA de frecuencia en la resolución del cupón (solo sin
--   código; gana el de MAYOR descuento entre estándar y frecuencia; suelo de margen
--   DURO como un cupón normal no-bienvenida). Regresión: bienvenida y códigos intactos.
-- customer_coupons: devuelve además `progress` y expone el cupón de frecuencia como
--   tarjeta disponible SOLO cuando earned=true (se excluye de la cascada estándar,
--   cuyo per_customer lo ocultaría por error).
--
-- Base = versión VIVA post-2200 (leída con pg_get_functiondef). Cambios quirúrgicos.
-- No se prueba en la tx que la crea.

begin;

-- ── Modelo ──────────────────────────────────────────────────────────────────
alter table public.coupon add column if not exists kind text not null default 'standard';
alter table public.coupon add column if not exists frequency_threshold integer;

alter table public.coupon drop constraint if exists coupon_kind_check;
alter table public.coupon add constraint coupon_kind_check check (kind in ('standard','frequency'));

alter table public.coupon drop constraint if exists coupon_frequency_threshold_check;
alter table public.coupon add constraint coupon_frequency_threshold_check
  check (frequency_threshold is null or frequency_threshold >= 2);

-- Un solo cupón de frecuencia activo por cuenta (patrón coupon_account_one_auto).
create unique index if not exists coupon_account_one_frequency
  on public.coupon (account_id) where (kind = 'frequency' and active);

-- ── coupon_redemption: is_cycle + índice único que lo excluye ────────────────
alter table public.coupon_redemption add column if not exists is_cycle boolean not null default false;

drop index if exists public.coupon_redemption_once_per_customer;
create unique index coupon_redemption_once_per_customer
  on public.coupon_redemption (coupon_id, customer_id)
  where (customer_id is not null and not is_cycle);

-- ── Admin: guardar el motor de frecuencia (patrón save_welcome_offer) ────────
create or replace function public.save_frequency_reward(
  p_account uuid, p_active boolean, p_threshold integer, p_discount_type text, p_value numeric
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_id uuid;
begin
  if not (p_account = any(current_user_account_ids())) then
    raise exception 'forbidden';
  end if;
  if p_discount_type not in ('percent','fixed') then raise exception 'bad_type'; end if;
  if p_value is null or p_value <= 0 then raise exception 'bad_value'; end if;
  if p_discount_type = 'percent' and p_value > 100 then raise exception 'bad_percent'; end if;
  if p_threshold is null or p_threshold < 2 then raise exception 'bad_threshold'; end if;

  -- Cupón de frecuencia canónico de la cuenta (uno por cuenta; se reutiliza).
  select id into v_id from coupon
  where account_id = p_account and kind = 'frequency'
  limit 1;

  if v_id is null then
    insert into coupon (account_id, name, code, discount_type, value, applies_to,
                        auto_apply, first_order_only, max_per_customer, min_subtotal,
                        active, kind, frequency_threshold, created_by)
    values (p_account, 'Bono por fidelidad', null, p_discount_type, p_value, 'subtotal',
            false, false, 1, null, coalesce(p_active,true), 'frequency', p_threshold, auth.uid())
    returning id into v_id;
  else
    update coupon set discount_type = p_discount_type, value = p_value,
                      frequency_threshold = p_threshold, active = coalesce(p_active,true),
                      updated_at = now()
    where id = v_id;
  end if;

  return jsonb_build_object('ok', true, 'couponId', v_id);
end;
$fn$;

grant execute on function public.save_frequency_reward(uuid, boolean, integer, text, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- place_shop_order  (base post-2200 + rama de frecuencia)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.place_shop_order(p_slug text, p_payload jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_acc        uuid;
  v_channel    uuid;
  v_location   uuid;
  v_mode       text;
  v_service    text;
  v_pay_mode   text;
  v_line       jsonb;
  v_repr       jsonb;
  v_subtotal   numeric := 0;
  v_delivery   numeric := 0;
  v_total      numeric := 0;
  v_preview    jsonb := '[]'::jsonb;
  v_sale_id    uuid;
  v_code       text;
  v_token      text;
  v_brand_arr  uuid[];
  v_expected   timestamptz;
  v_addr       text;
  v_is_cash    boolean;
  v_email      text;
  v_phone      text;
  v_name       text;
  v_consent    boolean;
  v_terms      text;
  v_customer   uuid;
  v_seed_addr  text;               -- F4·T1: dirección a sembrar en customer_address
  -- F3: coste/margen
  v_line_cost    numeric;
  v_line_qty     numeric;
  v_cost_known   numeric := 0;      -- suma de costes de líneas con coste conocido
  v_cost_has_null boolean := false; -- alguna línea sin computed_cost
  -- F3: cupón
  v_coupon_code  text;
  v_coupon       coupon%rowtype;
  v_cust_existing uuid;
  v_discount     numeric := 0;
  v_reason       text := null;      -- por qué NO se aplicó (o null si aplicó)
  v_neto         numeric;
  v_margin_eur   numeric;
  v_margin_pct   numeric;
  v_margin_warn  boolean := false;
  v_floor        numeric;
  v_is_welcome   boolean;
  v_coupon_json  jsonb := jsonb_build_object('applied', false);
  -- F4·T3: frecuencia
  v_freq          coupon%rowtype;
  v_freq_discount numeric := 0;
  v_progress      integer := 0;
  v_is_frequency  boolean := false;
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  if jsonb_typeof(p_payload->'lines') <> 'array'
     or jsonb_array_length(p_payload->'lines') = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  v_location := nullif(p_payload->>'locationId','')::uuid;
  v_mode     := coalesce(p_payload->>'mode', 'delivery');
  v_service  := case when v_mode = 'pickup' then 'pickup' else 'own_delivery' end;
  v_delivery := case when v_mode = 'pickup' then 0
                     else coalesce((p_payload#>>'{delivery,deliveryFee}')::numeric, 0) end;
  v_expected := nullif(p_payload->>'expectedTime','')::timestamptz;
  v_pay_mode := coalesce(p_payload#>>'{payment,mode}','simulated');
  v_is_cash  := (v_pay_mode = 'cash');

  select id into v_channel
  from sales_channel
  where account_id = v_acc and slug = 'shop' and is_active and archived_at is null
  limit 1;

  -- ── Reprecio + acumulación de coste por línea (F3 sub-paso 2) ──────────
  for v_line in select * from jsonb_array_elements(p_payload->'lines')
  loop
    v_repr := public._shop_reprice_line(v_acc, v_line);
    v_subtotal := v_subtotal + coalesce((v_repr->>'lineTotal')::numeric, 0);
    v_preview := v_preview || jsonb_build_array(jsonb_build_object(
      'name', v_repr->>'name',
      'quantity', (v_repr->>'quantity')::numeric,
      'unitPrice', (v_repr->>'unitPrice')::numeric,
      'lineTotal', (v_repr->>'lineTotal')::numeric,
      'valid', (v_repr->>'valid')::boolean
    ));

    v_line_qty := coalesce((v_repr->>'quantity')::numeric, 0);
    select ri.computed_cost into v_line_cost
    from menu_item mi
    left join recipe_item ri on ri.id = mi.recipe_item_id
    where mi.id = nullif(v_line->>'menuItemId','')::uuid
      and mi.account_id = v_acc
    limit 1;

    if v_line_cost is null then
      v_cost_has_null := true;
    else
      v_cost_known := v_cost_known + (v_line_cost * v_line_qty);
    end if;
  end loop;
  v_total := v_subtotal + v_delivery;

  -- ── Cupón: resolución + validación + guardarraíl (F3 sub-paso 3) ───────
  v_coupon_code := nullif(p_payload#>>'{coupon,code}','');
  v_email := lower(nullif(btrim(p_payload#>>'{customer,email}'), ''));
  v_phone := nullif(btrim(p_payload#>>'{customer,phone}'), '');
  v_consent := coalesce((p_payload#>>'{consent,marketing}')::boolean, false);

  select * into v_coupon
  from coupon
  where account_id = v_acc and active
    and (
      (v_coupon_code is not null and lower(code) = lower(v_coupon_code))
      or (v_coupon_code is null and auto_apply)
    )
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  order by (v_coupon_code is not null) desc
  limit 1;

  if v_coupon.id is not null then
    v_is_welcome := v_coupon.first_order_only or v_coupon.auto_apply;

    if v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_coupon.min_subtotal is not null and v_subtotal < v_coupon.min_subtotal then
      v_reason := 'min';
    elsif v_is_welcome and (v_email is null or not v_consent) then
      v_reason := 'needs_contact';
    elsif v_coupon.first_order_only and v_cust_existing is not null and exists (
            select 1 from sale
            where customer_id = v_cust_existing
              and coalesce(status,'') <> 'cancelled'
          ) then
      v_reason := 'not_first';
    elsif v_coupon.max_redemptions is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_redemptions then
      v_reason := 'exhausted';
    elsif v_cust_existing is not null and (
            select count(*) from coupon_redemption cr
            join sale s on s.id = cr.sale_id
            where cr.coupon_id = v_coupon.id and cr.customer_id = v_cust_existing
              and coalesce(s.status,'') <> 'cancelled'
          ) >= v_coupon.max_per_customer then
      v_reason := 'per_customer';
    end if;

    if v_reason is null then
      v_discount := case v_coupon.discount_type
        when 'percent' then round(v_subtotal * v_coupon.value / 100, 2)
        else least(v_coupon.value, v_subtotal) end;
      if v_discount < 0 then v_discount := 0; end if;

      if v_cost_has_null then
        v_margin_warn := true;
      else
        v_neto       := v_subtotal - v_discount;
        v_margin_eur := v_neto - v_cost_known;
        v_margin_pct := case when v_neto > 0 then v_margin_eur / v_neto * 100 else null end;
        v_floor      := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);

        if v_floor is not null and v_margin_pct is not null and v_margin_pct < v_floor then
          if v_is_welcome then
            v_margin_warn := true;
          else
            v_reason := 'margin';
            v_discount := 0;
          end if;
        end if;
      end if;
    end if;

    v_coupon_json := jsonb_build_object(
      'applied', (v_discount > 0),
      'code', v_coupon.code,
      'label', v_coupon.name,
      'discount', round(v_discount,2),
      'discountType', v_coupon.discount_type,
      'discountValue', v_coupon.value,
      'reason', v_reason,
      'marginWarning', v_margin_warn,
      'isWelcome', v_is_welcome,
      'isFrequency', false
    );
  end if;

  -- ── F4·T3: cupón por FRECUENCIA (aditivo; solo sin código) ─────────────
  -- No usa auto_apply/first_order: se gana por PROGRESO (pedidos no cancelados
  -- desde el último canje VIVO). Guardarraíl: suelo DURO (como cupón no-bienvenida).
  -- Prioridad: gana el de MAYOR descuento entre el estándar ya resuelto y este.
  if v_coupon_code is null then
    -- Asegurar el cliente (puede no haberse resuelto si no había cupón estándar).
    if v_cust_existing is null and v_email is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_cust_existing is null and v_phone is not null then
      select id into v_cust_existing from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_cust_existing is not null then
      select * into v_freq
      from coupon
      where account_id = v_acc and active and kind = 'frequency'
        and (starts_at is null or starts_at <= now())
        and (ends_at   is null or ends_at   >  now())
      limit 1;

      if v_freq.id is not null and v_freq.frequency_threshold is not null then
        -- PROGRESO (fuente única; calcado en customer_coupons).
        select count(*) into v_progress
        from sale s
        where s.customer_id = v_cust_existing and s.source = 'folvy_shop'
          and coalesce(s.status,'') <> 'cancelled'
          and s.created_at > coalesce((
            select max(cr.ts) from coupon_redemption cr
            join sale cs on cs.id = cr.sale_id
            where cr.coupon_id = v_freq.id and cr.customer_id = v_cust_existing
              and coalesce(cs.status,'') <> 'cancelled'
          ), '-infinity'::timestamptz);

        if v_progress >= v_freq.frequency_threshold then
          v_freq_discount := case v_freq.discount_type
            when 'percent' then round(v_subtotal * v_freq.value / 100, 2)
            else least(v_freq.value, v_subtotal) end;
          if v_freq_discount < 0 then v_freq_discount := 0; end if;

          -- Suelo de margen DURO (si el coste es conocido).
          if v_freq_discount > 0 and not v_cost_has_null then
            v_floor := (select shop_coupon_margin_floor_pct from accounts where id = v_acc);
            if v_floor is not null then
              v_neto := v_subtotal - v_freq_discount;
              v_margin_pct := case when v_neto > 0 then (v_neto - v_cost_known) / v_neto * 100 else null end;
              if v_margin_pct is not null and v_margin_pct < v_floor then
                v_freq_discount := 0;   -- caería por debajo del suelo: no aplica
              end if;
            end if;
          end if;

          -- Prioridad: gana el de MAYOR descuento.
          if v_freq_discount > v_discount then
            v_coupon       := v_freq;
            v_is_frequency := true;
            v_discount     := v_freq_discount;
            v_reason       := null;
            v_margin_warn  := v_cost_has_null;
            v_coupon_json  := jsonb_build_object(
              'applied', (v_freq_discount > 0),
              'code', v_freq.code,
              'label', v_freq.name,
              'discount', round(v_freq_discount,2),
              'discountType', v_freq.discount_type,
              'discountValue', v_freq.value,
              'reason', null,
              'marginWarning', v_cost_has_null,
              'isWelcome', false,
              'isFrequency', true
            );
          end if;
        end if;
      end if;
    end if;
  end if;

  -- Ajustar total con el descuento (nunca sobre envío).
  v_total := v_subtotal - v_discount + v_delivery;

  -- ── Dry-run: previsualización (no persiste) ───────────────────────────
  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'subtotal', round(v_subtotal,2),
      'deliveryFee', round(v_delivery,2),
      'discount', round(v_discount,2),
      'total', round(v_total,2),
      'lines', v_preview,
      'coupon', v_coupon_json
    );
  end if;

  v_addr := nullif(btrim(
              coalesce(p_payload#>>'{delivery,address}','') || ' · ' ||
              coalesce(p_payload#>>'{delivery,detail}',''),
              ' ·'), '');

  v_sale_id := gen_random_uuid();
  v_code    := 'FS' || upper(left(replace(v_sale_id::text,'-',''), 5));
  v_token   := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  insert into sale (id, account_id, channel_id, location_id, source,
                    sold_at, total, delivery_cost, discount_amount, service_type,
                    status, order_status, platform_order_code, public_token,
                    customer_name, customer_phone, delivery_address, customer_note,
                    expected_time, payment_method, payment_status, dispatch_mode, raw_tab, created_by_name)
  values (v_sale_id, v_acc, v_channel, v_location, 'folvy_shop',
          now(), round(v_total,2), round(v_delivery,2), round(v_discount,2), v_service,
          'open', 'new', v_code, v_token,
          nullif(p_payload#>>'{customer,name}',''),
          nullif(p_payload#>>'{customer,phone}',''),
          v_addr,
          nullif(p_payload#>>'{delivery,note}',''),
          v_expected,
          v_pay_mode,
          case when v_is_cash then 'pending' else 'pending' end,
          'auto',
          p_payload::text,
          'Folvy Shop');

  perform public.adapt_folvy_shop_order(v_sale_id);

  perform public.compute_sale_line_cost(sl.id)
  from sale_line sl
  where sl.sale_id = v_sale_id and coalesce(sl.line_type,'product') = 'product';

  select array_agg(distinct mi.brand_id)
  into v_brand_arr
  from sale_line sl
  join menu_item mi on mi.id = sl.menu_item_id
  where sl.sale_id = v_sale_id and sl.line_type = 'product' and mi.brand_id is not null;

  update sale
  set brand_id = case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end
  where id = v_sale_id;

  -- ── Customer + consentimiento (Pata 2) ────────────────────────────────
  v_name    := nullif(btrim(p_payload#>>'{customer,name}'), '');
  v_terms   := nullif(p_payload#>>'{consent,termsVersion}', '');

  if v_email is not null or v_phone is not null then
    if v_email is not null then
      select id into v_customer from customer
      where account_id = v_acc and lower(email) = v_email limit 1;
    end if;
    if v_customer is null and v_phone is not null then
      select id into v_customer from customer
      where account_id = v_acc and phone = v_phone limit 1;
    end if;

    if v_customer is null then
      insert into customer (account_id, phone, email, name, first_brand_id, first_location_id)
      values (v_acc, v_phone, v_email, v_name,
              case when coalesce(array_length(v_brand_arr,1),0) = 1 then v_brand_arr[1] else null end,
              v_location)
      returning id into v_customer;
    else
      update customer set
        email      = coalesce(email, v_email),
        phone      = coalesce(phone, v_phone),
        name       = coalesce(name, v_name),
        last_seen_at = now(),
        updated_at   = now()
      where id = v_customer;
    end if;

    update sale set customer_id = v_customer where id = v_sale_id;

    if v_consent and v_email is not null then
      insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
      values (v_customer, v_acc, true, now())
      on conflict (customer_id) do update set marketing_email = true, updated_at = now();

      insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
      values (v_customer, v_acc, 'granted', 'email', 'shop', v_terms);
    end if;
  end if;

  -- ── F4·T1: SIEMBRA SILENCIOSA de dirección ────────────────────────────
  if v_customer is not null and v_mode = 'delivery' then
    v_seed_addr := nullif(btrim(p_payload#>>'{delivery,address}'), '');
    if v_seed_addr is not null then
      begin
        update customer_address set
          detail     = coalesce(nullif(btrim(p_payload#>>'{delivery,detail}'),''), detail),
          lat        = coalesce(nullif(p_payload#>>'{delivery,lat}','')::numeric, lat),
          lng        = coalesce(nullif(p_payload#>>'{delivery,lng}','')::numeric, lng),
          updated_at = now()
        where customer_id = v_customer and lower(address) = lower(v_seed_addr);

        if not found then
          insert into customer_address (customer_id, account_id, address, detail, lat, lng, is_default)
          values (v_customer, v_acc, v_seed_addr,
                  nullif(btrim(p_payload#>>'{delivery,detail}'),''),
                  nullif(p_payload#>>'{delivery,lat}','')::numeric,
                  nullif(p_payload#>>'{delivery,lng}','')::numeric,
                  not exists (select 1 from customer_address where customer_id = v_customer));
        end if;
      exception when others then null;
      end;
    end if;
  end if;

  -- ── Canje del cupón ───────────────────────────────────────────────────
  if v_coupon.id is not null and v_discount > 0 then
    if v_is_frequency then
      -- F4·T3: canje RECURRENTE con is_cycle=true (exento del único once-per-customer,
      -- que solo protege cupones estándar) -> sin conflicto, insert directo. El
      -- histórico se conserva; el corte de progreso avanza al nuevo canje vivo.
      insert into coupon_redemption (
        coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
        discount_amount, reference_subtotal, margin_after, is_cycle)
      values (
        v_coupon.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
        round(v_discount,2), round(v_subtotal,2),
        case when v_cost_has_null then null else round(v_subtotal - v_discount - v_cost_known, 2) end,
        true);
    else
      -- Estándar (bienvenida/código): borrar canje MUERTO (2200) + insert con handler.
      if v_customer is not null then
        delete from coupon_redemption cr using sale s
        where cr.coupon_id = v_coupon.id and cr.customer_id = v_customer
          and s.id = cr.sale_id and coalesce(s.status,'') = 'cancelled';
      end if;

      begin
        insert into coupon_redemption (
          coupon_id, account_id, sale_id, customer_id, customer_email, customer_phone,
          discount_amount, reference_subtotal, margin_after)
        values (
          v_coupon.id, v_acc, v_sale_id, v_customer, v_email, v_phone,
          round(v_discount,2), round(v_subtotal,2),
          case when v_cost_has_null then null else round(v_subtotal - v_discount - v_cost_known, 2) end);
      exception when unique_violation then
        update sale set discount_amount = 0, total = round(v_subtotal + v_delivery, 2)
        where id = v_sale_id;
        v_discount := 0;
        v_total := v_subtotal + v_delivery;
        v_coupon_json := jsonb_build_object('applied', false, 'reason', 'per_customer');
      end;
    end if;
  end if;

  if v_is_cash then
    update sale set order_status = 'accepted' where id = v_sale_id and order_status = 'new';
  end if;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'saleId', v_sale_id,
    'code', v_code,
    'publicToken', v_token,
    'accepted', v_is_cash,
    'subtotal', round(v_subtotal,2),
    'deliveryFee', round(v_delivery,2),
    'discount', round(v_discount,2),
    'total', round(v_total,2),
    'coupon', v_coupon_json
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- customer_coupons  (base post-2200 + progress + tarjeta de frecuencia ganada)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.customer_coupons(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer    uuid;
  v_acc         uuid;
  v_has_consent boolean;
  v_freq        coupon%rowtype;
  v_progress    integer := 0;
  v_available   jsonb;
  v_progress_json jsonb;
begin
  select customer_id, account_id into v_customer, v_acc
  from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_customer is null then
    return jsonb_build_object('ok', false, 'reason', 'session');
  end if;

  select marketing_email into v_has_consent from customer_consent where customer_id = v_customer;
  v_has_consent := coalesce(v_has_consent, false);

  -- ── Frecuencia + progreso (mismo SQL que place_shop_order) ──────────────
  select * into v_freq
  from coupon
  where account_id = v_acc and active and kind = 'frequency'
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >  now())
  limit 1;

  if v_freq.id is not null and v_freq.frequency_threshold is not null then
    select count(*) into v_progress
    from sale s
    where s.customer_id = v_customer and s.source = 'folvy_shop'
      and coalesce(s.status,'') <> 'cancelled'
      and s.created_at > coalesce((
        select max(cr.ts) from coupon_redemption cr
        join sale cs on cs.id = cr.sale_id
        where cr.coupon_id = v_freq.id and cr.customer_id = v_customer
          and coalesce(cs.status,'') <> 'cancelled'
      ), '-infinity'::timestamptz);
  end if;

  -- ── Disponibles (cascada estándar; se EXCLUYE la frecuencia) ────────────
  v_available := coalesce((
    select jsonb_agg(jsonb_build_object(
             'couponId',      c.id,
             'name',          c.name,
             'code',          c.code,
             'discountType',  c.discount_type,
             'discountValue', c.value,
             'minSubtotal',   c.min_subtotal,
             'endsAt',        c.ends_at,
             'autoApply',     c.auto_apply,
             'isWelcome',     (c.first_order_only or c.auto_apply),
             'isFrequency',   false,
             'eligible',      (r.reason is null),
             'reason',        r.reason)
           order by (r.reason is null) desc, c.created_at)
    from coupon c
    cross join lateral (
      select case
        when (c.first_order_only or c.auto_apply) and not v_has_consent
          then 'needs_consent'
        when c.first_order_only and exists (
               select 1 from sale s
               where s.customer_id = v_customer and coalesce(s.status,'') <> 'cancelled'
             )
          then 'not_first'
        when c.max_redemptions is not null and (
               select count(*) from coupon_redemption cr
               join sale s on s.id = cr.sale_id
               where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
             ) >= c.max_redemptions
          then 'exhausted'
        when (
               select count(*) from coupon_redemption cr
               join sale s on s.id = cr.sale_id
               where cr.coupon_id = c.id and cr.customer_id = v_customer
                 and coalesce(s.status,'') <> 'cancelled'
             ) >= c.max_per_customer
          then 'per_customer'
        else null
      end as reason
    ) r
    where c.account_id = v_acc and c.active and c.kind <> 'frequency'
      and (c.starts_at is null or c.starts_at <= now())
      and (c.ends_at   is null or c.ends_at   >  now())
      and r.reason is distinct from 'per_customer'
  ), '[]'::jsonb);

  -- La frecuencia solo aparece como disponible cuando está GANADA (earned).
  if v_freq.id is not null and v_freq.frequency_threshold is not null
     and v_progress >= v_freq.frequency_threshold then
    v_available := jsonb_build_array(jsonb_build_object(
      'couponId',      v_freq.id,
      'name',          v_freq.name,
      'code',          v_freq.code,
      'discountType',  v_freq.discount_type,
      'discountValue', v_freq.value,
      'minSubtotal',   v_freq.min_subtotal,
      'endsAt',        v_freq.ends_at,
      'autoApply',     false,
      'isWelcome',     false,
      'isFrequency',   true,
      'eligible',      true,
      'reason',        null
    )) || v_available;
  end if;

  -- ── Progreso (goal-gradient) ────────────────────────────────────────────
  v_progress_json := case
    when v_freq.id is null or v_freq.frequency_threshold is null then jsonb_build_object('active', false)
    else jsonb_build_object(
      'active',    true,
      'threshold', v_freq.frequency_threshold,
      'current',   least(v_progress, v_freq.frequency_threshold),
      'reward',    jsonb_build_object('discountType', v_freq.discount_type, 'discountValue', v_freq.value, 'name', v_freq.name),
      'earned',    v_progress >= v_freq.frequency_threshold)
  end;

  return jsonb_build_object(
    'ok', true,
    -- Usados: solo canjes con venta NO cancelada (2200).
    'used', coalesce((
      select jsonb_agg(jsonb_build_object(
               'couponId',       c.id,
               'name',           c.name,
               'code',           c.code,
               'discountType',   c.discount_type,
               'discountValue',  c.value,
               'discountAmount', cr.discount_amount,
               'ts',             cr.ts)
             order by cr.ts desc)
      from coupon_redemption cr
      join coupon c on c.id = cr.coupon_id
      join sale s on s.id = cr.sale_id
      where cr.customer_id = v_customer and coalesce(s.status,'') <> 'cancelled'
    ), '[]'::jsonb),
    'available', v_available,
    'progress', v_progress_json
  );
end;
$function$;

commit;
