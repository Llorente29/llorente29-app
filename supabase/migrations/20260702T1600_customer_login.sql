-- 20260702T1600_customer_login.sql
-- CRM F2 — Login de cliente por código mágico (OTP) + sesión persistente.
--
-- Arquitectura (decidida por RECON): sesión de cliente PROPIA por token, NO
-- Supabase Auth. Calca el patrón ya en producción de shop_order_status(p_token):
-- RPCs SECURITY DEFINER que leen por token no adivinable. El comensal NUNCA es
-- auth.users -> aislado del personal, sin tocar la RLS existente.
--
-- Piezas:
--   1) customer += email_verified, last_login_at
--   2) customer_otp     — códigos de un solo uso (corta vida, anti-abuso)
--   3) customer_session — sesión persistente por token (larga vida)
--   4) RPCs (todas SECURITY DEFINER, GRANT anon):
--        customer_request_login  -> acuña un OTP (devuelve el código para que la
--                                    Edge lo envíe por email; NO expone nada más)
--        customer_verify_login   -> valida OTP, crea sesión, devuelve session_token
--        customer_session_me     -> valida session_token, devuelve la ficha básica
--        customer_logout         -> revoca la sesión
--
-- NOTA: las RPCs de login las llama la Edge shop-customer-auth (service-role),
-- no el front directamente, salvo customer_session_me / customer_logout que el
-- front sí puede llamar con la anon key (solo exponen/revocan por token propio).
--
-- SECURITY DEFINER -> NO probar en SQL Editor; verificar desde la app/Edge.
-- DDL: aplicar tal cual, sin BEGIN/COMMIT ni SELECT de prueba.

-- ─────────────────────────────────────────────────────────────────────
-- 1) customer: verificación de email + rastro de login
-- ─────────────────────────────────────────────────────────────────────
alter table public.customer add column if not exists email_verified boolean not null default false;
alter table public.customer add column if not exists last_login_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────
-- 2) customer_otp — código de un solo uso (vida corta)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.customer_otp (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  email        text not null,
  code_hash    text not null,           -- guardamos hash del código, no el código
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists customer_otp_lookup_idx
  on public.customer_otp (account_id, lower(email), created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- 3) customer_session — sesión persistente por token no adivinable
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.customer_session (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customer(id) on delete cascade,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  token         text not null unique,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index if not exists customer_session_customer_idx on public.customer_session (customer_id);

-- OTP y sesión: sin políticas de acceso público directo (RLS ON, sin policy =
-- nadie las lee por PostgREST). Solo se tocan vía las RPCs SECURITY DEFINER de
-- abajo y la Edge con service-role. El personal no necesita verlas.
alter table public.customer_otp enable row level security;
alter table public.customer_session enable row level security;

-- ─────────────────────────────────────────────────────────────────────
-- 4a) customer_request_login(slug, email)
--     Acuña un OTP de 6 dígitos para (cuenta del slug, email). Crea el customer
--     si no existe (ficha mínima). Devuelve el CÓDIGO en claro para que la Edge
--     lo envíe por email; NO lo persiste en claro (guarda su hash).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.customer_request_login(p_slug text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  -- Anti-abuso: máximo 5 códigos por email/cuenta en la última hora.
  select count(*) into v_recent
  from customer_otp
  where account_id = v_acc and lower(email) = v_email
    and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- Código de 6 dígitos.
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');

  insert into customer_otp (account_id, email, code_hash, expires_at)
  values (v_acc, v_email, encode(digest(v_code || v_email, 'sha256'), 'hex'),
          now() + interval '10 minutes');

  -- La Edge usará el código para el email. El nombre (si el customer existe) se
  -- devuelve para personalizar el correo.
  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'name', (select name from customer where account_id = v_acc and lower(email) = v_email limit 1)
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4b) customer_verify_login(slug, email, code, ttl_days)
--     Valida el OTP; si es correcto crea/vincula el customer, lo marca
--     email_verified, crea una customer_session y devuelve su token.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.customer_verify_login(p_slug text, p_email text, p_code text, p_ttl_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  -- OTP más reciente no consumido y no caducado.
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

  -- Crear/vincular customer.
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

  -- Sesión persistente.
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

-- ─────────────────────────────────────────────────────────────────────
-- 4c) customer_session_me(session_token) — ficha básica del cliente logueado
--     La llama el front con la anon key. Solo expone lo del propio token.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.customer_session_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cust customer%rowtype;
  v_sess customer_session%rowtype;
begin
  select * into v_sess from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;

  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  update customer_session set last_seen_at = now() where id = v_sess.id;

  select * into v_cust from customer where id = v_sess.customer_id;

  return jsonb_build_object(
    'ok', true,
    'customerId', v_cust.id,
    'name', v_cust.name,
    'email', v_cust.email,
    'phone', v_cust.phone
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- 4d) customer_logout(session_token) — revoca la sesión
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.customer_logout(p_token text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  update customer_session set revoked_at = now()
  where token = nullif(btrim(p_token),'') and revoked_at is null
  returning jsonb_build_object('ok', true);
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- Grants: request/verify las llama la Edge (service-role, ya tiene acceso);
-- me/logout las llama el front con anon.
-- ─────────────────────────────────────────────────────────────────────
revoke all on function public.customer_request_login(text, text) from public;
revoke all on function public.customer_verify_login(text, text, text, int) from public;
grant execute on function public.customer_session_me(text) to anon, authenticated;
grant execute on function public.customer_logout(text) to anon, authenticated;
grant execute on function public.customer_request_login(text, text) to service_role;
grant execute on function public.customer_verify_login(text, text, text, int) to service_role;
