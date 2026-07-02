-- 20260702T2300_shop_early_consent.sql
-- Aplicada: (pendiente)
--
-- CRM — Captura ANTICIPADA de consentimiento. Hoy el contacto+consentimiento solo
-- nace al PAGAR (dentro de place_shop_order); si el comensal marca la casilla pero
-- no paga, se pierde el permiso (el activo del Motor de Crecimiento). Esta pieza
-- registra el consentimiento EN EL MOMENTO en que se marca la casilla, sin esperar
-- al pedido.
--
-- (1) register_shop_consent(slug, email, name, phone, consent, terms_version):
--     pública (anon). Reutiliza la dedup de place_shop_order (email -> phone).
--     REGLAS LEGALES:
--       · Sin email válido -> no hace nada (no se guarda contacto sin dato de contacto).
--       · consent=false y el cliente NO existe -> NO crea nada (marcar es la acción
--         afirmativa; teclear el correo sin marcar no debe crear registro — RGPD).
--       · Solo la acción afirmativa (marcar) crea/actualiza el cliente + consent.
--       · Loguea SOLO los cambios reales (granted/revoked), idempotente.
--     Retirar (desmarcar) un consentimiento existente lo pone a false + log 'revoked'
--     (tan fácil como darlo — RGPD art. 7.3).
--
-- (2) customer_session_me amplía la respuesta con `consented` (marketing_email
--     actual), para que el checkout OCULTE la casilla a quien ya consintió (no a
--     todos: un cliente nuevo o que la desmarcó debe seguir viéndola).
--
-- SECURITY DEFINER. register_shop_consent es pública por slug (no usa auth.uid()).

create or replace function public.register_shop_consent(
  p_slug text, p_email text, p_name text, p_phone text,
  p_consent boolean, p_terms_version text default 'shop-privacy-v1'
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_acc      uuid;
  v_email    text;
  v_phone    text;
  v_name     text;
  v_customer uuid;
  v_prev     boolean;
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  v_email := lower(nullif(btrim(p_email), ''));
  v_phone := nullif(btrim(p_phone), '');
  v_name  := nullif(btrim(p_name),  '');

  -- Regla de hierro: sin email válido no se guarda nada.
  if v_email is null or position('@' in v_email) = 0 or position('.' in v_email) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'needs_email');
  end if;

  -- Dedup igual que place_shop_order: email -> phone.
  select id into v_customer from customer
  where account_id = v_acc and lower(email) = v_email limit 1;
  if v_customer is null and v_phone is not null then
    select id into v_customer from customer
    where account_id = v_acc and phone = v_phone limit 1;
  end if;

  if not coalesce(p_consent, false) then
    -- Desmarcar: si el cliente no existe, NO se crea nada (sin registro sin acción
    -- afirmativa). Si existe y estaba consentido, se revoca + log.
    if v_customer is null then
      return jsonb_build_object('ok', true, 'consented', false);
    end if;
    select marketing_email into v_prev from customer_consent where customer_id = v_customer;
    if coalesce(v_prev, false) then
      update customer_consent set marketing_email = false, updated_at = now()
      where customer_id = v_customer;
      insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
      values (v_customer, v_acc, 'revoked', 'email', 'shop_checkbox', p_terms_version);
    end if;
    return jsonb_build_object('ok', true, 'consented', false);
  end if;

  -- consent = true (acción afirmativa): crear/actualizar el cliente.
  if v_customer is null then
    insert into customer (account_id, email, phone, name)
    values (v_acc, v_email, v_phone, v_name)
    returning id into v_customer;
  else
    update customer set
      email        = coalesce(email, v_email),
      phone        = coalesce(phone, v_phone),
      name         = coalesce(name,  v_name),
      last_seen_at = now(),
      updated_at   = now()
    where id = v_customer;
  end if;

  -- Upsert consent + log SOLO si antes no estaba consentido (idempotente).
  select marketing_email into v_prev from customer_consent where customer_id = v_customer;
  if not coalesce(v_prev, false) then
    insert into customer_consent (customer_id, account_id, marketing_email, updated_at)
    values (v_customer, v_acc, true, now())
    on conflict (customer_id) do update set marketing_email = true, updated_at = now();
    insert into customer_consent_log (customer_id, account_id, action, channel, source, terms_version)
    values (v_customer, v_acc, 'granted', 'email', 'shop_checkbox', p_terms_version);
  end if;

  return jsonb_build_object('ok', true, 'consented', true, 'customerId', v_customer);
end;
$$;

grant execute on function public.register_shop_consent(text, text, text, text, boolean, text) to anon, authenticated;


-- customer_session_me + consented (para ocultar la casilla a quien ya consintió).
create or replace function public.customer_session_me(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cust      customer%rowtype;
  v_sess      customer_session%rowtype;
  v_consented boolean;
begin
  select * into v_sess from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;
  update customer_session set last_seen_at = now() where id = v_sess.id;
  select * into v_cust from customer where id = v_sess.customer_id;
  select marketing_email into v_consented from customer_consent where customer_id = v_cust.id;
  return jsonb_build_object(
    'ok', true,
    'customerId', v_cust.id,
    'name', v_cust.name,
    'email', v_cust.email,
    'phone', v_cust.phone,
    'consented', coalesce(v_consented, false)
  );
end;
$function$;
