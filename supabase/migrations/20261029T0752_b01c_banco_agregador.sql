-- ============================================================================
-- B01c · LOS MOVIMIENTOS DEL BANCO ENTRAN SOLOS (open-banking.io), solo Foodint
-- ----------------------------------------------------------------------------
-- Encargo B01c (29/10/2026). La función conta-banco-agregador corre cada noche
-- a las 03:00 de Madrid: pide al banco lo nuevo, lo mete en Bancos por
-- bank_importar (lo ya subido por Norma 43 se reconoce por la huella suave) y
-- apunta cómo ha ido. Bancos lo enseña en cada cuenta: «Conectada con BBVA ·
-- actualizada hoy a las 03:00» o «Caduca el permiso en 7 días · Renovar».
--
--   1. bank_aggregator_connection, NUEVA: qué empresa trae sus movimientos por
--      un proveedor, con qué secreto de las funciones (el credentials.json) y
--      dónde se renueva el permiso. Solo la escribe esta migración: no hay
--      pantalla para darse de alta. Una fila: Foodint (Llorente29 Food, S.L.),
--      open-banking.io, secreto OPEN_BANKING_IO_CREDENTIALS. En staging no
--      entra (no existe esa empresa).
--   2. bank_aggregator_link, la del B01 (0150), que YA EXISTE (vacía, sin
--      pantalla, la leen la puerta del V02 y el agente): columnas nuevas que
--      admiten nulos con la última pasada y cómo fue (al día / sin
--      movimientos / permiso caducado / fallo, con su porqué), el saldo que dio
--      el banco, lo que entró y dónde se renueva. last_sync_at sigue siendo la
--      última vez que se leyó bien, como la leen la puerta y el agente.
--   3. bank_agregador_apuntar (NUEVA): apunta una cuenta. La función nocturna
--      (clave de servicio) o un administrador o encargado de la cuenta (la
--      e2e, con su proveedor simulado). bank_agregador_conexion_apuntar
--      (NUEVA, solo la clave de servicio): la pasada de la empresa, o por qué
--      no se pudo ni abrir. bank_agregador_quitar (NUEVA): deja una cuenta sin
--      conexión (la limpieza de la e2e).
--   4. Lo que CAMBIA va aparte, en la 0753: _bank_cuenta_de_empresa deja
--      pasar a la clave de servicio, y el proveedor open_banking_io. Este
--      fichero SOLO AÑADE y se puede pasar dos veces.
--   5. El despertador: conta_banco_agregador_despertar y su cron (cada hora;
--      solo actúa a las 3 de Madrid, guarda del cambio de hora). Solo en
--      producción: necesita el cron_secret del Vault.
--
-- No toca datos que existan ni nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261029T0752_b01c_banco_agregador.down.sql
-- Prueba: supabase/staging/sql/20261029_b01c_banco_agregador_prueba.sql
-- ============================================================================

-- ── 1 · Qué empresa trae sus movimientos sola ──────────────────────────────
create table if not exists public.bank_aggregator_connection (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  provider     text not null check (provider ~ '^[a-z0-9-]+$'),
  bank_name    text not null check (length(trim(bank_name)) > 0),
  secret_name  text not null check (secret_name ~ '^[A-Z][A-Z0-9_]*$'),
  renew_url    text check (renew_url is null or renew_url ~ '^https://'),
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  last_error   text,
  created_at   timestamptz not null default now(),
  constraint bank_aggregator_connection_una unique (company_id, provider)
);
comment on table public.bank_aggregator_connection is
  'B01c. Qué empresa trae los movimientos de sus bancos sola, por qué proveedor, con qué secreto de las funciones (el credentials.json; aquí solo su NOMBRE) y dónde se renueva el permiso. Solo la escribe una migración: no se ofrece a otros clientes todavía. last_error: por qué no se pudo ni abrir la conexión la última noche (null si se abrió).';

-- ── 2 · Cada cuenta conectada: la tabla del B01 (0150), que ya existe ─────
-- Hasta hoy vacía y sin pantalla. Se le añade cómo fue la última pasada. Que
-- el proveedor admita open_banking_io va en la 0753 (cambia: el CHECK amplía).
alter table public.bank_aggregator_link add column if not exists bank_name text;
alter table public.bank_aggregator_link add column if not exists renew_url text check (renew_url is null or renew_url ~ '^https://');
alter table public.bank_aggregator_link add column if not exists last_run_at timestamptz;
alter table public.bank_aggregator_link add column if not exists last_status text check (last_status is null or last_status in ('al_dia', 'sin_movimientos', 'permiso_caducado', 'fallo'));
alter table public.bank_aggregator_link add column if not exists last_message text;
alter table public.bank_aggregator_link add column if not exists bank_balance numeric(14,2);
alter table public.bank_aggregator_link add column if not exists bank_balance_date date;
alter table public.bank_aggregator_link add column if not exists last_new integer;
alter table public.bank_aggregator_link add column if not exists last_repeated integer;
alter table public.bank_aggregator_link add column if not exists last_from date;
alter table public.bank_aggregator_link add column if not exists last_to date;
comment on column public.bank_aggregator_link.last_run_at is 'B01c. La última pasada de la noche, haya ido bien o mal (last_sync_at: la última que leyó bien).';
comment on column public.bank_aggregator_link.last_status is 'B01c. Cómo fue la última pasada: al_dia, sin_movimientos, permiso_caducado o fallo (los dos últimos siempre con last_message).';
comment on column public.bank_aggregator_link.bank_balance is 'B01c. El saldo contable que dio el banco en la última pasada (bank_balance_date: de qué día).';
comment on column public.bank_aggregator_link.bank_name is 'B01c. El banco, como se enseña: «Conectada con BBVA».';
comment on column public.bank_aggregator_link.renew_url is 'B01c. Dónde se renueva el permiso (el botón «Renovar»).';

alter table public.bank_aggregator_connection enable row level security;
drop policy if exists bank_aggregator_connection_select on public.bank_aggregator_connection;
create policy bank_aggregator_connection_select on public.bank_aggregator_connection for select using ((select public.belongs_to_account(account_id)));
grant select on public.bank_aggregator_connection to authenticated;

-- ── 3 · Apuntar cómo ha ido ────────────────────────────────────────────────
create or replace function public.bank_agregador_apuntar(p_treasury uuid, p_proveedor text, p_cuenta_proveedor text, p_conexion text, p_banco text, p_caduca timestamptz,
                                                         p_renovar text, p_estado text, p_mensaje text, p_saldo_banco numeric, p_saldo_fecha date,
                                                         p_nuevos integer, p_repetidos integer, p_desde date, p_hasta date)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account; v_cuenta uuid; v_prov text := replace(coalesce(p_proveedor, ''), '-', '_'); v_bien boolean := p_estado in ('al_dia', 'sin_movimientos');
        v_caduca timestamptz;
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public._bank_cuenta_de_empresa(v_t.company_id);
  if v_t.kind <> 'bank' then raise exception 'Solo un banco se conecta: «%» no lo es.', v_t.name using errcode = '23514'; end if;
  if p_estado in ('fallo', 'permiso_caducado') and coalesce(trim(p_mensaje), '') = '' then
    raise exception 'Un fallo o un permiso caducado se apuntan con su porqué.' using errcode = '23514';
  end if;
  -- Sin fecha nueva, la que ya tenía (el NOT NULL se mira antes del «on conflict»: hay que dársela aquí).
  v_caduca := coalesce(p_caduca, (select consent_valid_until from public.bank_aggregator_link where provider = v_prov and external_account_id = p_cuenta_proveedor));
  if v_caduca is null then
    raise exception 'El banco no dice hasta cuándo vale el permiso de «%»: no se puede apuntar la conexión.', v_t.name using errcode = '23502';
  end if;
  insert into public.bank_aggregator_link as l (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until, status,
                                                last_sync_at, created_by, created_by_name, bank_name, renew_url, last_run_at, last_status, last_message,
                                                bank_balance, bank_balance_date, last_new, last_repeated, last_from, last_to)
  values (v_cuenta, v_t.company_id, p_treasury, v_prov, p_cuenta_proveedor, coalesce(nullif(trim(p_conexion), ''), p_cuenta_proveedor), v_caduca,
          case when p_estado = 'permiso_caducado' then 'caducado' else 'activo' end,
          case when v_bien then now() end, auth.uid(), public.conta_nombre_actor(), nullif(trim(p_banco), ''), p_renovar, now(), p_estado, nullif(trim(p_mensaje), ''),
          p_saldo_banco, p_saldo_fecha, p_nuevos, p_repetidos, p_desde, p_hasta)
  on conflict (provider, external_account_id) do update set
    treasury_account_id = excluded.treasury_account_id, consent_id = excluded.consent_id,
    consent_valid_until = excluded.consent_valid_until, status = excluded.status,
    last_sync_at = coalesce(excluded.last_sync_at, l.last_sync_at), bank_name = coalesce(excluded.bank_name, l.bank_name), renew_url = excluded.renew_url, last_run_at = excluded.last_run_at,
    last_status = excluded.last_status, last_message = excluded.last_message,
    bank_balance = coalesce(excluded.bank_balance, l.bank_balance), bank_balance_date = coalesce(excluded.bank_balance_date, l.bank_balance_date),
    last_new = excluded.last_new, last_repeated = excluded.last_repeated, last_from = excluded.last_from, last_to = excluded.last_to;
end $$;
comment on function public.bank_agregador_apuntar(uuid, text, text, text, text, timestamptz, text, text, text, numeric, date, integer, integer, date, date) is
  'B01c. Cómo ha ido la pasada de una cuenta conectada (la escribe conta-banco-agregador cada noche). Un fallo o un permiso caducado llevan siempre su porqué.';
revoke all on function public.bank_agregador_apuntar(uuid, text, text, text, text, timestamptz, text, text, text, numeric, date, integer, integer, date, date) from public, anon;
grant execute on function public.bank_agregador_apuntar(uuid, text, text, text, text, timestamptz, text, text, text, numeric, date, integer, integer, date, date) to authenticated, service_role;

create or replace function public.bank_agregador_conexion_apuntar(p_conexion uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo la función de cada noche apunta la pasada.' using errcode = '42501'; end if;
  update public.bank_aggregator_connection set last_run_at = now(), last_error = nullif(trim(p_error), '') where id = p_conexion;
  if not found then raise exception 'Esa conexión no existe.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.bank_agregador_conexion_apuntar(uuid, text) from public, anon, authenticated;
grant execute on function public.bank_agregador_conexion_apuntar(uuid, text) to service_role;

create or replace function public.bank_agregador_quitar(p_treasury uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_t public.treasury_account;
begin
  select * into v_t from public.treasury_account where id = p_treasury;
  if v_t.id is null then raise exception 'Esa cuenta del banco no existe.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_t.company_id);
  delete from public.bank_aggregator_link where treasury_account_id = p_treasury and provider in ('simulado', 'open_banking_io');
end $$;
revoke all on function public.bank_agregador_quitar(uuid) from public, anon;
grant execute on function public.bank_agregador_quitar(uuid) to authenticated, service_role;

-- ── 1b · Foodint, la única ─────────────────────────────────────────────────
-- Anclada por el id de la cuenta y de la empresa (regla 9), no por el nombre.
insert into public.bank_aggregator_connection (account_id, company_id, provider, bank_name, secret_name, renew_url)
select c.account_id, c.id, 'open-banking-io', 'BBVA', 'OPEN_BANKING_IO_CREDENTIALS', 'https://open-banking.io/app'
  from public.company c
 where c.id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
on conflict (company_id, provider) do nothing;

-- ── 5 · El despertador ─────────────────────────────────────────────────────
create or replace function public.conta_banco_agregador_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  if extract(hour from (now() at time zone 'Europe/Madrid')) <> 3 then return; end if;
  if not exists (select 1 from public.bank_aggregator_connection where enabled) then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-banco-agregador.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-banco-agregador',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_banco_agregador_despertar() is
  'B01c · Cada hora (cron conta-banco-agregador-despertar, solo en producción): a las 3 de Madrid, si hay alguna empresa conectada, llama a conta-banco-agregador. Si falta el secreto, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_banco_agregador_despertar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'conta-banco-agregador-despertar') then
      perform cron.unschedule('conta-banco-agregador-despertar');
    end if;
    perform cron.schedule('conta-banco-agregador-despertar', '2 * * * *', $cron$select public.conta_banco_agregador_despertar()$cron$);
  end if;
end $$;

-- conta_lectura (los agentes) lee la tabla nueva, si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.bank_aggregator_connection to conta_lectura;
  end if;
end $$;
