-- ============================================================================
-- B01 Revolut · PR 1 · 1 · CONECTAR REVOLUT BUSINESS Y LEER SUS MOVIMIENTOS
-- ----------------------------------------------------------------------------
-- Encargo B01 (Revolut Business en Sumied), respuestas 1 y 2 (31/10/2026).
-- SOLO AÑADE, y se puede pasar dos veces. No toca datos que existan ni nada
-- del camino del pedido.
--
--   1. revolut_conexion, NUEVA: una fila por empresa, con el estado del
--      asistente (certificado → autorizar → conectada; desconectada, o
--      retirada desde Revolut), el certificado PÚBLICO (lo que la persona pega
--      en Revolut), la dirección de vuelta, el permiso dado (READ en el PR 1),
--      desde cuándo traer el histórico y cómo fue la última lectura.
--      Lo secreto NO va aquí: la llave privada, el client_id y el token de
--      renovación van al Vault, uno por empresa (2).
--   2. Los secretos, en el Vault (vault.create_secret, nunca un INSERT
--      crudo), con el nombre revolut:<empresa>:<qué> (privada, client_id,
--      renovacion y aviso, el secreto con que firma sus avisos). Tres funciones, SOLO
--      para la clave de servicio (las funciones conta-revolut-*): poner, leer
--      y quitar todos los de una empresa. Nadie más los lee: ni la pantalla,
--      ni un administrador, ni conta_lectura.
--   3. conta_revolut_desconectar(empresa, quién): la conexión pasa a
--      desconectada (o retirada, si fue desde Revolut), se borran sus secretos
--      y sus cuentas dejan de estar conectadas (bank_aggregator_link). Lo que
--      ya entró se queda.
--   4. El despertador: conta_revolut_despertar y su cron (cada hora, a los
--      17): si hay alguna conexión conectada, llama a conta-revolut-leer, la
--      lectura de respaldo del aviso de Revolut. La dirección del proyecto sale
--      del Vault (project_url), no de aquí (W10: staging no llama a
--      producción). Sin project_url o sin cron_secret, falla en voz alta.
--
-- Que bank_aggregator_link admita el proveedor «revolut» CAMBIA (su CHECK
-- amplía): va aparte, en la 2211.
-- Vuelta atrás: supabase/vuelta-atras/20261031T2210_b01rv_revolut_conexion.down.sql
-- Prueba: supabase/staging/sql/20261031_b01rv_revolut_prueba.sql
-- ============================================================================

-- ── 1 · La conexión de cada empresa ────────────────────────────────────────
create table if not exists public.revolut_conexion (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete cascade,
  entorno              text not null check (entorno in ('sandbox', 'produccion')),
  estado               text not null default 'certificado'
                       check (estado in ('certificado', 'autorizar', 'conectada', 'desconectada', 'retirada')),
  certificado          text not null check (certificado like '-----BEGIN CERTIFICATE-----%'),
  certificado_huella   text not null check (certificado_huella ~ '^[0-9a-f]{64}$'),
  vuelta               text not null check (vuelta ~ '^https://[a-z0-9.-]+/bancos/revolut/vuelta$'),
  permisos             text,
  desde_historico      date,
  estado_oauth_huella  text,
  estado_oauth_at      timestamptz,
  conectada_at         timestamptz,
  conectada_por        uuid,
  conectada_por_nombre text,
  desconectada_at      timestamptz,
  desconectada_por_nombre text,
  last_run_at          timestamptz,
  last_ok_at           timestamptz,
  last_error           text,
  webhook_id           text,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  created_by_name      text,
  constraint revolut_conexion_una unique (company_id)
);
comment on table public.revolut_conexion is
  'B01 Revolut. La conexión de una empresa con Revolut Business: el estado del asistente, el certificado PÚBLICO que se pega en Revolut, la dirección de vuelta (la de la marca: app.sumied.com o app.folvy.app), el permiso dado y cómo fue la última lectura. Lo secreto (llave privada, client_id, token de renovación) va en el Vault, nunca aquí.';
comment on column public.revolut_conexion.estado is
  'B01 Revolut. certificado: creado, falta pegarlo y traer el client_id · autorizar: falta autorizar en Revolut · conectada · desconectada: desde Sumied · retirada: desde Revolut (la renovación del token falló porque el permiso ya no vale).';
comment on column public.revolut_conexion.estado_oauth_huella is
  'B01 Revolut. SHA-256 del «state» de la autorización en curso (la vuelta solo vale si lo trae, y una vez). Nunca el valor.';
comment on column public.revolut_conexion.webhook_id is
  'B01 Revolut. El id del aviso (webhook) registrado en Revolut, si se pudo registrar (pide el permiso WRITE). Su secreto de firma, en el Vault (aviso).';
comment on column public.revolut_conexion.desde_historico is
  'B01 Revolut. Desde qué día se trae el histórico la primera vez (lo dice la persona en el asistente).';

alter table public.revolut_conexion enable row level security;
drop policy if exists revolut_conexion_select on public.revolut_conexion;
create policy revolut_conexion_select on public.revolut_conexion for select using ((select public.belongs_to_account(account_id)));
grant select on public.revolut_conexion to authenticated;
-- Solo escriben las funciones conta-revolut-* (clave de servicio).
grant all on public.revolut_conexion to service_role;

-- ── 2 · Los secretos, en el Vault ──────────────────────────────────────────
create or replace function public._revolut_nombre_secreto(p_company uuid, p_que text)
returns text language plpgsql immutable as $$
begin
  if p_que not in ('privada', 'client_id', 'renovacion', 'aviso') then
    raise exception 'Revolut no guarda «%» en el Vault.', p_que using errcode = '22023';
  end if;
  return 'revolut:' || p_company::text || ':' || p_que;
end $$;
revoke all on function public._revolut_nombre_secreto(uuid, text) from public, anon, authenticated;

create or replace function public.conta_revolut_secreto_poner(p_company uuid, p_que text, p_valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_nombre text := public._revolut_nombre_secreto(p_company, p_que); v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo las funciones de Revolut guardan sus secretos.' using errcode = '42501'; end if;
  if coalesce(p_valor, '') = '' then raise exception 'Un secreto vacío no se guarda.' using errcode = '22023'; end if;
  select id into v_id from vault.secrets where name = v_nombre;
  if v_id is null then
    perform vault.create_secret(p_valor, v_nombre, 'B01 Revolut · ' || p_que);
  else
    perform vault.update_secret(v_id, p_valor, v_nombre, 'B01 Revolut · ' || p_que);
  end if;
end $$;
revoke all on function public.conta_revolut_secreto_poner(uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_revolut_secreto_poner(uuid, text, text) to service_role;

create or replace function public.conta_revolut_secreto(p_company uuid, p_que text)
returns text language plpgsql stable security definer set search_path = public, vault as $$
declare v text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo las funciones de Revolut leen sus secretos.' using errcode = '42501'; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = public._revolut_nombre_secreto(p_company, p_que);
  return v;
end $$;
revoke all on function public.conta_revolut_secreto(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_revolut_secreto(uuid, text) to service_role;

create or replace function public._revolut_secretos_quitar(p_company uuid)
returns integer language plpgsql security definer set search_path = public, vault as $$
declare n integer;
begin
  delete from vault.secrets where name like 'revolut:' || p_company::text || ':%';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public._revolut_secretos_quitar(uuid) from public, anon, authenticated;

-- ── 3 · Desconectar ────────────────────────────────────────────────────────
-- p_desde_revolut: la renovación del token falló porque el permiso ya no vale
-- (se quitó el certificado en Revolut): «retirada». Si no, desde Sumied.
create or replace function public.conta_revolut_desconectar(p_company uuid, p_quien uuid, p_quien_nombre text, p_desde_revolut boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.revolut_conexion; v_secretos integer; v_cuentas integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Solo la función de Revolut desconecta.' using errcode = '42501'; end if;
  select * into v from public.revolut_conexion where company_id = p_company for update;
  if v.id is null then raise exception 'Esta empresa no tiene Revolut conectado.' using errcode = 'P0002'; end if;
  v_secretos := public._revolut_secretos_quitar(p_company);
  delete from public.bank_aggregator_link where company_id = p_company and provider = 'revolut';
  get diagnostics v_cuentas = row_count;
  update public.revolut_conexion
     set estado = case when p_desde_revolut then 'retirada' else 'desconectada' end,
         desconectada_at = now(), desconectada_por_nombre = nullif(trim(p_quien_nombre), ''),
         estado_oauth_huella = null, estado_oauth_at = null, permisos = null,
         last_error = case when p_desde_revolut then 'Revolut ya no acepta el permiso: se ha quitado el certificado en Revolut o ha caducado.' else last_error end
   where id = v.id;
  return jsonb_build_object('estado', case when p_desde_revolut then 'retirada' else 'desconectada' end, 'cuentas', v_cuentas, 'secretos', v_secretos, 'quien', p_quien);
end $$;
comment on function public.conta_revolut_desconectar(uuid, uuid, text, boolean) is
  'B01 Revolut. Deja la empresa sin Revolut: borra sus secretos del Vault y sus cuentas conectadas (bank_aggregator_link). Lo que ya entró se queda. Desde Sumied: desconectada; desde Revolut (el permiso ya no vale): retirada.';
revoke all on function public.conta_revolut_desconectar(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.conta_revolut_desconectar(uuid, uuid, text, boolean) to service_role;

-- ── 4 · El despertador: la lectura de respaldo, cada hora ──────────────────
create or replace function public.conta_revolut_despertar()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text; v_url text;
begin
  if not exists (select 1 from public.revolut_conexion where estado = 'conectada') then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  select rtrim(decrypted_secret, '/') into v_url from vault.decrypted_secrets
   where name = 'project_url' and decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co/?$';
  if v_secreto is null or v_url is null then
    raise exception 'Falta cron_secret o project_url en el Vault: no se puede despertar a conta-revolut-leer.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := v_url || '/functions/v1/conta-revolut-leer',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"por":"cron"}'::jsonb, timeout_milliseconds := 150000);
end $$;
comment on function public.conta_revolut_despertar() is
  'B01 Revolut · Cada hora (cron conta-revolut-despertar): si hay alguna empresa con Revolut conectado, llama a conta-revolut-leer. La dirección, de project_url en el Vault (W10). Si falta algo, falla (cron lo apunta como failed), no calla.';
revoke all on function public.conta_revolut_despertar() from public, anon, authenticated;

do $$
begin
  -- Anidado: sin pg_cron (la base local del W09) no se mira ni el Vault.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from vault.secrets where name = 'cron_secret') then
      if exists (select 1 from cron.job where jobname = 'conta-revolut-despertar') then
        perform cron.unschedule('conta-revolut-despertar');
      end if;
      perform cron.schedule('conta-revolut-despertar', '17 * * * *', $cron$select public.conta_revolut_despertar()$cron$);
    end if;
  end if;
end $$;

-- conta_lectura (los agentes) lee la conexión (nunca los secretos), si existe el rol.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on public.revolut_conexion to conta_lectura;
  end if;
end $$;
