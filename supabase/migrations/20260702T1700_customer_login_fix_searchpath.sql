-- 20260702T1700_customer_login_fix_searchpath.sql
-- FIX: customer_request_login / customer_verify_login usan digest() de pgcrypto,
-- que vive en el schema `extensions` (no en `public`). Como las funciones tenían
-- search_path='public', no encontraban digest() -> la RPC fallaba (reason 'rpc').
-- Solución: añadir 'extensions' al search_path. Se recrean idénticas salvo esa
-- línea. (customer_session_me y customer_logout no usan digest -> no se tocan.)
--
-- DDL: aplicar tal cual, sin BEGIN/COMMIT ni SELECT de prueba.

create or replace function public.customer_request_login(p_slug text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_acc    uuid;
  v_email  text;
  v_code   text;
  v_recent int;
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  v_email := lower(nullif(btrim(p_email), ''));
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;

  select count(*) into v_recent
  from customer_otp
  where account_id = v_acc and lower(email) = v_email
    and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into customer_otp (account_id, email, code_hash, expires_at)
  values (v_acc, v_email, encode(digest(v_code || v_email, 'sha256'), 'hex'),
          now() + interval '10 minutes');

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'name', (select name from customer where account_id = v_acc and lower(email) = v_email limit 1)
  );
end;
$function$;

create or replace function public.customer_verify_login(p_slug text, p_email text, p_code text, p_ttl_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_acc      uuid;
  v_email    text;
  v_otp      customer_otp%rowtype;
  v_customer uuid;
  v_token    text;
  v_ttl      int;
begin
  select id into v_acc from accounts where slug = p_slug;
  if v_acc is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  v_email := lower(nullif(btrim(p_email), ''));
  if v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'email');
  end if;

  v_ttl := greatest(1, least(coalesce(p_ttl_days, 90), 365));

  select * into v_otp
  from customer_otp
  where account_id = v_acc and lower(email) = v_email
    and consumed_at is null and expires_at > now()
  order by created_at desc
  limit 1;

  if v_otp.id is null then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_otp.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_otp.code_hash <> encode(digest(coalesce(p_code,'') || v_email, 'sha256'), 'hex') then
    update customer_otp set attempts = attempts + 1 where id = v_otp.id;
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;

  update customer_otp set consumed_at = now() where id = v_otp.id;

  select id into v_customer from customer
  where account_id = v_acc and lower(email) = v_email limit 1;

  if v_customer is null then
    insert into customer (account_id, email, email_verified, last_login_at)
    values (v_acc, v_email, true, now())
    returning id into v_customer;
  else
    update customer set email_verified = true, last_login_at = now(), updated_at = now()
    where id = v_customer;
  end if;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into customer_session (customer_id, account_id, token, expires_at)
  values (v_customer, v_acc, v_token, now() + (v_ttl || ' days')::interval);

  return jsonb_build_object(
    'ok', true,
    'sessionToken', v_token,
    'customerId', v_customer,
    'name', (select name from customer where id = v_customer),
    'email', v_email
  );
end;
$function$;
