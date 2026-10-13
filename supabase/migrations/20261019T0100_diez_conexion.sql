-- C04b · T2 · La conexión con Diez, por empresa (12/10).
--
-- cambia: public.account_connector · prueba: supabase/staging/sql/20261019_diez_modelo_prueba.sql
--
-- Julio (respuesta 1): «credenciales por empresa con la misma forma que
-- account_connector: no hagas una segunda forma distinta; generaliza la que
-- hay para que sirva por empresa, con su prueba de que lo de hoy sigue igual».
--
-- account_connector ya era casi todo: config (lo no secreto), credentials_ref
-- (el secreto en Vault, con connector_secret_save/read/clear solo para
-- service_role), external_account_id (el identificador en el otro programa),
-- RLS de lectura por cuenta y de escritura por administrador. Le falta:
--
--   · el ámbito «company» y su company_id (en Diez cada empresa es una base de
--     datos: nombre_bd, que va en external_account_id; Llorente29 = C0008);
--   · el estado «down» (caída): la renovación del token falló y no se insiste;
--   · el token, que dura 14 días: también en Vault (token_ref) y su caducidad.
--
-- Lo de hoy no cambia: los ámbitos y estados de antes siguen valiendo, el
-- índice único de antes sigue, y ninguna columna nueva es obligatoria. Los
-- CHECK se quitan y se vuelven a poner AMPLIADOS (solo admiten más).
--
-- Los dos frenos de Diez (solo C0008 en lectura; C0001, la base personal de
-- Julio, nunca) viven en el cliente de Diez (tarea 3), no aquí.

-- 1. Por empresa ----------------------------------------------------------------
alter table public.account_connector add column if not exists company_id uuid references public.company(id) on delete cascade;
alter table public.account_connector add column if not exists token_ref text;
alter table public.account_connector add column if not exists token_expires_at timestamptz;

alter table public.account_connector drop constraint if exists account_connector_scope_check;
alter table public.account_connector add constraint account_connector_scope_check
  check (scope = any (array['account', 'brand', 'location', 'company']));

alter table public.account_connector drop constraint if exists account_connector_status_check;
alter table public.account_connector add constraint account_connector_status_check
  check (status = any (array['available', 'requested', 'connecting', 'connected', 'paused', 'error', 'down']));

-- Una conexión de empresa lleva su empresa, y solo ella.
alter table public.account_connector add constraint account_connector_company_scope
  check ((scope = 'company') = (company_id is not null));

-- Una conexión por empresa y conector (el índice único de antes no la cubre:
-- brand_id y location_id son nulos y los nulos no chocan).
create unique index if not exists account_connector_company_uq
  on public.account_connector (company_id, connector_id) where scope = 'company';

comment on column public.account_connector.company_id is 'Empresa de la conexión cuando scope = company (Diez: una empresa = una base de datos).';
comment on column public.account_connector.token_ref is 'Id en Vault del token de acceso vigente (Diez: 14 días). Nunca el token.';
comment on column public.account_connector.token_expires_at is 'Cuándo caduca el token de token_ref; se renueva antes.';

-- 2. Diez en el catálogo ---------------------------------------------------------
insert into public.connector (code, name, category, connection_type, managed_by, direction, description, config_schema, features, is_available, status, sort_order)
values ('diez', 'Diez (contabilidad)', 'other', 'credentials', 'client', 'bidirectional',
        'Trae la contabilidad de Diez y le envía los asientos y facturas validados en Folvy. Una conexión por empresa (base de datos de Diez).',
        jsonb_build_object('fields', jsonb_build_array(
          jsonb_build_object('key', 'nombre_bd', 'label', 'Base de datos de la empresa en Diez', 'type', 'text', 'required', true),
          jsonb_build_object('key', 'client_id', 'label', 'client_id', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'client_secret', 'label', 'client_secret', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'username', 'label', 'Usuario', 'type', 'secret', 'required', true),
          jsonb_build_object('key', 'password', 'label', 'Contraseña', 'type', 'secret', 'required', true))),
        jsonb_build_array('por_empresa'), true, 'active', 90)
on conflict (code) do nothing;

-- 3. El token, en Vault ----------------------------------------------------------
-- Solo service_role (el cliente de Diez en el servidor). Nadie más lo lee ni lo
-- escribe: ni el front ni authenticated.
create or replace function public.connector_token_save(p_account_connector_id uuid, p_token text, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_ref text;
begin
  if p_token is null or length(p_token) = 0 then raise exception 'Token vacío' using errcode = '22023'; end if;
  select token_ref into v_ref from public.account_connector where id = p_account_connector_id;
  if not found then raise exception 'Conexión % no encontrada', p_account_connector_id; end if;
  if v_ref is not null then
    perform vault.update_secret(v_ref::uuid, p_token);
  else
    v_ref := vault.create_secret(p_token, 'connector-token:' || p_account_connector_id::text, 'Token de acceso de una conexión (caduca)')::text;
  end if;
  update public.account_connector
     set token_ref = v_ref, token_expires_at = p_expires_at, last_error = null, updated_at = now(),
         status = case when status = 'down' then 'connected' else status end
   where id = p_account_connector_id;
end $$;

create or replace function public.connector_token_read(p_account_connector_id uuid)
returns jsonb language plpgsql security definer set search_path = public, vault as $$
declare
  v_ref text; v_exp timestamptz; v_tok text;
begin
  select token_ref, token_expires_at into v_ref, v_exp from public.account_connector where id = p_account_connector_id;
  if v_ref is null then return null; end if;
  select decrypted_secret into v_tok from vault.decrypted_secrets where id = v_ref::uuid;
  if v_tok is null then return null; end if;
  return jsonb_build_object('token', v_tok, 'expires_at', v_exp);
end $$;

-- La renovación falló: la conexión pasa a «caída» con su porqué, se borra el
-- token y NO se reintenta en bucle (respuesta 2, punto 6). Vuelve a «connected»
-- solo cuando alguien guarda credenciales o un token nuevo.
create or replace function public.connector_mark_down(p_account_connector_id uuid, p_error text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare
  v_ref text;
begin
  select token_ref into v_ref from public.account_connector where id = p_account_connector_id;
  if not found then raise exception 'Conexión % no encontrada', p_account_connector_id; end if;
  if v_ref is not null then delete from vault.secrets where id = v_ref::uuid; end if;
  update public.account_connector
     set status = 'down', token_ref = null, token_expires_at = null,
         last_error = left(coalesce(p_error, 'La renovación del token falló'), 500), updated_at = now()
   where id = p_account_connector_id;
end $$;

revoke all on function public.connector_token_save(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.connector_token_read(uuid) from public, anon, authenticated;
revoke all on function public.connector_mark_down(uuid, text) from public, anon, authenticated;
grant execute on function public.connector_token_save(uuid, text, timestamptz) to service_role;
grant execute on function public.connector_token_read(uuid) to service_role;
grant execute on function public.connector_mark_down(uuid, text) to service_role;
