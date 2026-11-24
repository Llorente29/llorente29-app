-- supabase/migrations/20261124T2311_r18d_pestana_sin_usuario.sql
--
-- R18d · La pestaña de Sumied en Bitrix24, para TODAS las personas del portal (Julio, 24/11): sin invitaciones,
-- sin contraseñas y sin correos. Solo AÑADE: una columna que admite nulos en conta_crm, una tabla pequeña y tres
-- funciones nuevas. No cambia conta_bitrix_pestana_leer (la de quien tiene usuario de Sumied) ni ningún permiso.
--
--   1. El portal se une a SU cuenta una sola vez, al instalar o reinstalar la aplicación (lo pulsa la administradora
--      del Bitrix24; la función comprueba antes con Bitrix24 que el token es de la aplicación de Sumied):
--      conta_bitrix_portal_unir(portal, quién) pone conta_crm.pestana_portal_at. Solo si ese portal está conectado
--      a UNA cuenta de Sumied (la conexión la hizo antes una administradora de Sumied pegando su dirección de leer).
--   2. Al abrir la pestaña, la función comprueba con Bitrix24 quién es (user.current) y que viene de ese portal, y
--      llama a conta_bitrix_pestana_leer_portal(portal, id y nombre de Bitrix24, ficha): SOLO LEE la cuenta unida,
--      con los permisos de la primera administradora activa de la cuenta, solo en esta transacción. Nunca escribe
--      nada de la cuenta: «solo_lectura».
--   3. Quién ha mirado queda en conta_bitrix_pestana_persona (portal, id y nombre de Bitrix24, primera y última vez).
--   4. Si no se puede (portal sin unir, sin conexión o en dos cuentas, cuenta sin administradora), lo dice con su
--      estado para que la pestaña diga a quién avisar.
-- Vuelta atrás: supabase/vuelta-atras/20261124T2311_r18d_pestana_sin_usuario.down.sql

alter table public.conta_crm add column if not exists pestana_portal_at timestamptz;
alter table public.conta_crm add column if not exists pestana_portal_por text;
comment on column public.conta_crm.pestana_portal_at is
  'R18d · Cuándo se unió el portal a esta cuenta para la pestaña (al instalar la aplicación de Sumied en Bitrix24). Con fecha, todas las personas del portal ven la pestaña, solo leyendo.';

create table if not exists public.conta_bitrix_pestana_persona (
  account_id   uuid not null references public.accounts(id) on delete cascade,
  portal       text not null,
  usuario_id   text not null check (usuario_id ~ '^[0-9]{1,18}$'),
  nombre       text,
  primera_at   timestamptz not null default now(),
  ultima_at    timestamptz not null default now(),
  veces        integer not null default 1,
  primary key (account_id, portal, usuario_id)
);
comment on table public.conta_bitrix_pestana_persona is
  'R18d · Quién ha abierto la pestaña de Sumied desde Bitrix24 sin usuario de Sumied: su id y su nombre de Bitrix24 (nunca su correo ni su token).';
alter table public.conta_bitrix_pestana_persona enable row level security;
revoke all on table public.conta_bitrix_pestana_persona from public, anon, authenticated;
grant select on table public.conta_bitrix_pestana_persona to authenticated;
grant all on table public.conta_bitrix_pestana_persona to service_role;
drop policy if exists conta_bitrix_pestana_persona_leer on public.conta_bitrix_pestana_persona;
create policy conta_bitrix_pestana_persona_leer on public.conta_bitrix_pestana_persona for select to authenticated using (public.belongs_to_account(account_id));

-- 1 · Unir el portal a su cuenta (al instalar). Solo el servidor.
create or replace function public.conta_bitrix_portal_unir(p_portal text, p_quien text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_portal text := lower(trim(coalesce(p_portal, ''))); v_n int;
begin
  select count(*) into v_n from public.conta_crm c where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'portal_desconocido'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas'); end if;
  update public.conta_crm c set pestana_portal_at = coalesce(c.pestana_portal_at, now()),
         pestana_portal_por = coalesce(c.pestana_portal_por, nullif(trim(coalesce(p_quien, '')), '')), updated_at = now()
   where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  return jsonb_build_object('estado', 'ok');
end $$;
revoke all on function public.conta_bitrix_portal_unir(text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_portal_unir(text, text) to service_role;

-- 2 · Leer como el portal, sin usuario de Sumied. Solo el servidor (que ya comprobó con Bitrix24 quién mira).
create or replace function public.conta_bitrix_pestana_leer_portal(p_portal text, p_usuario text, p_nombre text, p_tipo text, p_id text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_usuario text := trim(coalesce(p_usuario, ''));
  v_nombre text := nullif(left(trim(coalesce(p_nombre, '')), 120), '');
  v_n int; v_cuenta uuid; v_unido timestamptz; v_admin uuid; v_cliente uuid; v_de_empresa text;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then return jsonb_build_object('estado', 'ficha_rara'); end if;
  if v_usuario !~ '^[0-9]{1,18}$' then return jsonb_build_object('estado', 'no_es_sumied'); end if;
  select count(*), min(c.account_id::text)::uuid, max(c.pestana_portal_at) into v_n, v_cuenta, v_unido
    from public.conta_crm c where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'portal_desconocido'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas'); end if;
  if v_unido is null then return jsonb_build_object('estado', 'portal_sin_unir'); end if;

  -- Con los permisos de la primera administradora activa de la cuenta, solo para LEER y solo en esta transacción.
  select up.user_id into v_admin from public.user_profiles up
   where up.account_id = v_cuenta and up.active and up.role = 'admin' order by up.created_at limit 1;
  if v_admin is null then return jsonb_build_object('estado', 'cuenta_sin_administradora'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || v_cuenta::text, true);

  insert into public.conta_bitrix_pestana_persona (account_id, portal, usuario_id, nombre)
  values (v_cuenta, v_portal, v_usuario, v_nombre)
  on conflict (account_id, portal, usuario_id) do update set nombre = coalesce(excluded.nombre, conta_bitrix_pestana_persona.nombre), ultima_at = now(),
     veces = conta_bitrix_pestana_persona.veces + 1;

  select f.party_id, f.de_empresa into v_cliente, v_de_empresa
    from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id, '' into v_cliente, v_de_empresa from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null then
    return jsonb_build_object('estado', 'sin_enlazar', 'solo_lectura', true, 'cuenta', v_cuenta, 'quien', v_nombre,
      'cuenta_nombre', (select a.name from public.accounts a where a.id = v_cuenta));
  end if;
  return jsonb_build_object(
    'estado', 'ok', 'solo_lectura', true,
    'cuenta', v_cuenta, 'cuenta_nombre', (select a.name from public.accounts a where a.id = v_cuenta),
    'quien', v_nombre,
    'cliente', v_cliente,
    'cliente_nombre', (select p.name from public.party p where p.id = v_cliente and p.account_id = v_cuenta),
    'de_empresa', nullif(v_de_empresa, ''),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(c.trade_name, ''), c.legal_name)) order by c.created_at)
        from public.company c where c.account_id = v_cuenta and c.is_active), '[]'::jsonb),
    'clientes', public.conta_pantalla_clientes(v_cuenta),
    'ficha', public.conta_pantalla_ficha(v_cuenta, v_cliente));
end $$;
revoke all on function public.conta_bitrix_pestana_leer_portal(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_leer_portal(text, text, text, text, text) to service_role;
