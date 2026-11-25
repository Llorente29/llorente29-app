-- supabase/migrations/20261124T1730_r18b_actualizar_bitrix.sql
--
-- R18 · paso 3 · El interruptor «Actualizar Bitrix24» y la clave para escribir (24/11). Solo AÑADE: tres
-- columnas que admiten nulos en conta_crm y cuatro funciones nuevas. No cambia nada de lo que existe.
--
--   · conta_crm.actualizar (null o false: apagado, que es lo de serie), con quién lo cambió y cuándo.
--   · conta_crm.escribir_ref: la clave para ESCRIBIR en el CRM (el webhook entrante que crea QBO), en Vault
--     («conta_crm:<crm>:<cuenta>:escribir»), aparte de la de leer: se quita una sin tocar la otra.
--   · conta_crm_actualizar_poner(cuenta, crm, sí/no, quién): ENCENDERLO solo un administrador de la plataforma
--     (Julio); apagarlo, también la administradora o la encargada de la cuenta (apagar nunca es peligroso).
--   · conta_crm_clave_escribir_guardar(cuenta, crm, dirección, quién): la administradora o la encargada de la
--     cuenta pega la clave; tiene que ser del MISMO portal que la conexión. No se devuelve nunca.
--   · conta_crm_actualizar_estado(cuenta, crm): lo que ve Ajustes (encendido o no, quién y cuándo, si hay clave).
--   · conta_crm_escribir_de_portal(portal): para el servidor, el interruptor de ese portal (y la dirección
--     para escribir, si la hay). Solo service_role.
-- Dónde se escribe en Bitrix24 y en qué fichas lo decide el código (conta-bitrix-pestana/puro.ts · puedeLlamar).
-- Se puede pasar dos veces. Vuelta atrás: supabase/vuelta-atras/20261124T1730_r18b_actualizar_bitrix.down.sql

alter table public.conta_crm add column if not exists actualizar boolean;
alter table public.conta_crm add column if not exists actualizar_por_name text;
alter table public.conta_crm add column if not exists actualizar_at timestamptz;
alter table public.conta_crm add column if not exists escribir_ref uuid;
alter table public.conta_crm add column if not exists escribir_por_name text;
alter table public.conta_crm add column if not exists escribir_at timestamptz;
comment on column public.conta_crm.actualizar is 'R18 · «Actualizar Bitrix24»: true, Sumied escribe en el CRM (solo en las fichas que deja el código); null o false, no (de serie). Lo enciende solo un administrador de la plataforma.';
comment on column public.conta_crm.escribir_ref is 'R18 · La clave para escribir en el CRM, en Vault (aparte de la de leer, url_ref). Nunca sale a la pantalla.';

create or replace function public._conta_es_admin_plataforma()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from public.platform_admins p where p.user_id = auth.uid() and p.active)
$$;
revoke all on function public._conta_es_admin_plataforma() from public, anon, authenticated;

create or replace function public.conta_crm_actualizar_poner(p_account uuid, p_crm text, p_on boolean, p_quien text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_fila public.conta_crm; v_nombre text := coalesce(nullif(trim(p_quien), ''), 'una persona de la cuenta');
begin
  select * into v_fila from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_fila.account_id is null then raise exception 'Esta cuenta no tiene conectado ese CRM.' using errcode = 'P0002'; end if;
  if p_on is true and not public._conta_es_admin_plataforma() then
    raise exception 'Solo Julio enciende «Actualizar Bitrix24».' using errcode = '42501';
  end if;
  if p_on is not true and not (public._conta_es_admin_plataforma() or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Solo la administradora o la encargada de la cuenta lo apaga.' using errcode = '42501';
  end if;
  if p_on is true and v_fila.escribir_ref is null then
    raise exception 'Antes de encenderlo, pega la clave para actualizar Bitrix24.' using errcode = '22023';
  end if;
  update public.conta_crm set actualizar = coalesce(p_on, false), actualizar_por_name = v_nombre, actualizar_at = now(), updated_at = now()
   where account_id = p_account and crm = p_crm;
  return jsonb_build_object('actualizar', coalesce(p_on, false),
    'frase', case when p_on then 'Encendido: Sumied actualiza Bitrix24 (solo en la ficha de prueba).' else 'Apagado: Bitrix24 no se actualiza.' end);
end $$;
revoke all on function public.conta_crm_actualizar_poner(uuid, text, boolean, text) from public, anon;
grant execute on function public.conta_crm_actualizar_poner(uuid, text, boolean, text) to authenticated, service_role;

create or replace function public.conta_crm_clave_escribir_guardar(p_account uuid, p_crm text, p_url text, p_quien text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, vault as $$
declare v_fila public.conta_crm; v_ref uuid; v_nombre text := 'conta_crm:' || p_crm || ':' || p_account::text || ':escribir';
  v_portal text := lower(substring(coalesce(trim(p_url), '') from '^https://([A-Za-z0-9.-]+)/rest/'));
begin
  if not (public.current_user_is_admin_or_manager_of(p_account) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo la administradora o la encargada de la cuenta.' using errcode = '42501';
  end if;
  select * into v_fila from public.conta_crm where account_id = p_account and crm = p_crm for update;
  if v_fila.account_id is null then raise exception 'Primero conecta el CRM.' using errcode = 'P0002'; end if;
  if p_crm <> 'bitrix24' or coalesce(trim(p_url), '') !~ '^https://[A-Za-z0-9.-]+/rest/[0-9]+/[A-Za-z0-9]+/?$' then
    raise exception 'La clave de Bitrix24 es como https://<tu portal>/rest/<número>/<clave>/ (Webhook entrante, con permiso de CRM).' using errcode = '22023';
  end if;
  if v_portal is distinct from lower(v_fila.portal) then
    raise exception 'Esa clave es de otro portal (%), no del conectado (%).', v_portal, v_fila.portal using errcode = '22023';
  end if;
  v_ref := v_fila.escribir_ref;
  if v_ref is null or not exists (select 1 from vault.secrets where id = v_ref) then select id into v_ref from vault.secrets where name = v_nombre; end if;
  if v_ref is not null then perform vault.update_secret(v_ref, trim(p_url), v_nombre, 'Clave para escribir en el CRM de una cuenta de Sumied');
  else v_ref := vault.create_secret(trim(p_url), v_nombre, 'Clave para escribir en el CRM de una cuenta de Sumied'); end if;
  update public.conta_crm set escribir_ref = v_ref, escribir_por_name = coalesce(nullif(trim(p_quien), ''), 'una persona de la cuenta'), escribir_at = now(), updated_at = now()
   where account_id = p_account and crm = p_crm;
  return jsonb_build_object('frase', 'Clave guardada. Bitrix24 sigue sin actualizarse hasta que Julio lo encienda.');
end $$;
revoke all on function public.conta_crm_clave_escribir_guardar(uuid, text, text, text) from public, anon;
grant execute on function public.conta_crm_clave_escribir_guardar(uuid, text, text, text) to authenticated, service_role;

create or replace function public.conta_crm_actualizar_estado(p_account uuid, p_crm text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not (public.belongs_to_account(p_account) or public._conta_es_admin_plataforma()) then null else (
    select jsonb_build_object('actualizar', coalesce(c.actualizar, false), 'quien', c.actualizar_por_name, 'cuando', c.actualizar_at,
             'clave', c.escribir_ref is not null, 'clave_quien', c.escribir_por_name, 'clave_cuando', c.escribir_at,
             'puede_encender', public._conta_es_admin_plataforma())
      from public.conta_crm c where c.account_id = p_account and c.crm = p_crm) end
$$;
revoke all on function public.conta_crm_actualizar_estado(uuid, text) from public, anon;
grant execute on function public.conta_crm_actualizar_estado(uuid, text) to authenticated, service_role;

create or replace function public.conta_crm_escribir_de_portal(p_portal text)
returns table(account_id uuid, actualizar boolean, url text) language plpgsql stable security definer set search_path = public, vault as $$
begin
  return query
  select c.account_id, coalesce(c.actualizar, false), s.decrypted_secret::text
    from public.conta_crm c left join vault.decrypted_secrets s on s.id = c.escribir_ref
   where c.crm = 'bitrix24' and lower(c.portal) = lower(p_portal);
end $$;
revoke all on function public.conta_crm_escribir_de_portal(text) from public, anon, authenticated;
grant execute on function public.conta_crm_escribir_de_portal(text) to service_role;
