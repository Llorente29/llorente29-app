-- supabase/migrations/20261103T0812_dm1_invitaciones.sql
--
-- DM1 · Accesos 1 · Una invitación que se acepta (03/11/2026).
-- Julio (03/11): «Accesos, principalmente al de la gestoría, pero también al
-- mío o a cualquiera que quiera crear». Decisiones del 03/11:
--   · la invitación se ACEPTA: a todos les llega un correo; con usuario nuevo
--     pone su contraseña, con usuario existente pulsa «Aceptar» y le aparecen
--     las empresas en el selector. Hasta entonces sale en «Pendientes», con
--     reenviar y anular;
--   · primero con los papeles que ya existen: Todo (admin) y Encargado
--     (manager). «Contable» y «Solo mirar» llegan en sus propios PR.
--
-- Hasta hoy invitar-persona (DM1 PR 1) daba el acceso en el acto y a quien ya
-- tenía usuario no le llegaba nada: no había nada pendiente que reenviar ni
-- anular. Esto SOLO AÑADE: la tabla y sus funciones. invitar-persona cambia en
-- su edge function (mismo PR).
--
-- No se funde con la invitación de la asesoría (tax_advisor_invitation,
-- conta_asesoria_*): aquella vincula la CUENTA del despacho con la empresa del
-- cliente, para presentar impuestos (Julio, 30/10: el despacho se queda como
-- está); esta da acceso a una PERSONA. En pantalla: «Invitar a una persona» y
-- «Vincular tu asesoría».
--
-- Ningún correo real en la base de pruebas ni en el repositorio (T11). El
-- enlace lleva un token de 32 bytes al azar; aquí solo su huella (sha256).
--
-- Vuelta atrás: supabase/vuelta-atras/20261103T0812_dm1_invitaciones.down.sql

-- ── La invitación: una fila por empresa ──────────────────────────────────────
create table if not exists public.invitacion (
  id                 uuid primary key default gen_random_uuid(),
  lote               uuid not null,
  correo             text not null check (correo = lower(btrim(correo)) and correo ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  rol                text not null check (rol in ('admin', 'manager')),
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'anulada')),
  token_hash         text not null,
  invitada_por       uuid,
  invitada_por_nombre text,
  creada_at          timestamptz not null default now(),
  caduca_at          timestamptz not null,
  envios             integer not null default 1,
  ultimo_envio_at    timestamptz not null default now(),
  aceptada_at        timestamptz,
  aceptada_por       uuid,
  anulada_at         timestamptz,
  anulada_por        uuid
);
comment on table public.invitacion is
  'DM1 Accesos 1 (03/11/2026). Invitaciones a una persona, una fila por empresa. Pendiente hasta que la acepta (invitacion_aceptar) o la anula un administrador. Caduca a los 7 días (caduca_at; reenviar la renueva). El token del enlace es por lote; aquí solo su huella.';
create unique index if not exists invitacion_una_pendiente on public.invitacion (correo, account_id) where estado = 'pendiente';
create index if not exists invitacion_por_token on public.invitacion (token_hash) where estado = 'pendiente';
create index if not exists invitacion_por_cuenta on public.invitacion (account_id, estado);
alter table public.invitacion enable row level security;
revoke all on public.invitacion from public, anon, authenticated;

-- ── Ayudantes ────────────────────────────────────────────────────────────────
-- ¿Es administrador activo de esa empresa quien llama?
create or replace function public._soy_admin_de(p_account_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles up
                  where up.user_id = auth.uid() and up.account_id = p_account_id
                    and up.role = 'admin' and up.active and up.suspended_at is null)
$$;

-- Da el acceso de una invitación a un usuario (una fila de user_profiles por
-- empresa). Quien ya terminó su bienvenida en otra empresa no la repite. Si ya
-- entraba, no se cambia nada ahí. Devuelve los nombres de las empresas nuevas.
create or replace function public._invitacion_dar_acceso(p_ids uuid[], p_user_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare r record; v_bienvenida record; v_nombres text[] := '{}';
begin
  select welcome_completed_at, terms_accepted_at into v_bienvenida
    from public.user_profiles where user_id = p_user_id and welcome_completed_at is not null
   order by welcome_completed_at limit 1;
  for r in select i.*, a.name from public.invitacion i join public.accounts a on a.id = i.account_id
            where i.id = any (p_ids) and i.estado = 'pendiente' and i.caduca_at > now()
            for update of i loop
    if exists (select 1 from public.user_profiles where user_id = p_user_id and account_id = r.account_id) then
      update public.user_profiles
         set active = true, role = case when active then role else r.rol end, updated_at = now(),
             welcome_completed_at = coalesce(welcome_completed_at, v_bienvenida.welcome_completed_at),
             terms_accepted_at = coalesce(terms_accepted_at, v_bienvenida.terms_accepted_at)
       where user_id = p_user_id and account_id = r.account_id;
    else
      insert into public.user_profiles (user_id, account_id, role, active, welcome_completed_at, terms_accepted_at)
      values (p_user_id, r.account_id, r.rol, true, v_bienvenida.welcome_completed_at, v_bienvenida.terms_accepted_at);
    end if;
    update public.invitacion set estado = 'aceptada', aceptada_at = now(), aceptada_por = p_user_id where id = r.id;
    v_nombres := v_nombres || r.name;
  end loop;
  return v_nombres;
end $$;

-- ── Crear y reenviar (solo invitar-persona, con la clave de servicio) ────────
-- Crea una invitación por empresa, o renueva la pendiente que ya hubiera para
-- ese correo y esa empresa (otro rol, otro enlace, otros 7 días). Quien invita
-- tiene que ser administrador activo de cada una. Devuelve el lote.
create or replace function public.invitacion_crear(p_correo text, p_cuentas jsonb, p_token_hash text, p_invita uuid, p_invita_nombre text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_lote uuid := gen_random_uuid(); c jsonb; v_correo text := lower(btrim(p_correo)); v_acc uuid; v_rol text;
begin
  if jsonb_typeof(p_cuentas) is distinct from 'array' or jsonb_array_length(p_cuentas) = 0 then
    raise exception 'Elige al menos una empresa.';
  end if;
  for c in select * from jsonb_array_elements(p_cuentas) loop
    v_acc := (c->>'account_id')::uuid; v_rol := c->>'rol';
    if not exists (select 1 from public.user_profiles up where up.user_id = p_invita and up.account_id = v_acc
                     and up.role = 'admin' and up.active and up.suspended_at is null) then
      raise exception 'Solo puedes invitar a las empresas de las que eres administrador.';
    end if;
    update public.invitacion set lote = v_lote, rol = v_rol, token_hash = p_token_hash, invitada_por = p_invita,
           invitada_por_nombre = p_invita_nombre, caduca_at = now() + interval '7 days',
           envios = envios + 1, ultimo_envio_at = now()
     where correo = v_correo and account_id = v_acc and estado = 'pendiente';
    if not found then
      insert into public.invitacion (lote, correo, account_id, rol, token_hash, invitada_por, invitada_por_nombre, caduca_at)
      values (v_lote, v_correo, v_acc, v_rol, p_token_hash, p_invita, p_invita_nombre, now() + interval '7 days');
    end if;
  end loop;
  return v_lote;
end $$;

-- Reenviar una pendiente: otro enlace y otros 7 días. Quien reenvía, administrador de esa empresa.
create or replace function public.invitacion_reenviar(p_id uuid, p_token_hash text, p_invita uuid)
returns table (correo text, empresa text, rol text) language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.invitacion i join public.user_profiles up on up.account_id = i.account_id
                  where i.id = p_id and i.estado = 'pendiente' and up.user_id = p_invita and up.role = 'admin'
                    and up.active and up.suspended_at is null) then
    raise exception 'Esa invitación no está pendiente o no eres administrador de su empresa.';
  end if;
  update public.invitacion set token_hash = p_token_hash, caduca_at = now() + interval '7 days',
         envios = envios + 1, ultimo_envio_at = now(), lote = gen_random_uuid()
   where id = p_id;
  return query select i.correo, a.name, i.rol from public.invitacion i join public.accounts a on a.id = i.account_id where i.id = p_id;
end $$;

-- Lo que hay detrás de un enlace (la página de bienvenida, sin sesión): las
-- empresas pendientes y si el correo ya tiene usuario. Nada más.
create or replace function public.invitacion_por_token(p_token_hash text)
returns table (id uuid, correo text, empresa text, rol text, invita text, tiene_usuario boolean)
language sql stable security definer set search_path = '' as $$
  select i.id, i.correo, a.name, i.rol, i.invitada_por_nombre,
         exists (select 1 from auth.users u where lower(u.email) = i.correo)
    from public.invitacion i join public.accounts a on a.id = i.account_id
   where i.token_hash = p_token_hash and i.estado = 'pendiente' and i.caduca_at > now()
$$;

-- ── Lo que hace la persona con sesión ────────────────────────────────────────
-- Mis invitaciones: las pendientes a MI correo, sin caducar.
create or replace function public.mis_invitaciones()
returns table (id uuid, empresa text, rol text, invita text, creada_at timestamptz, caduca_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select i.id, a.name, i.rol, i.invitada_por_nombre, i.creada_at, i.caduca_at
    from public.invitacion i join public.accounts a on a.id = i.account_id
   where i.estado = 'pendiente' and i.caduca_at > now()
     and i.correo = lower((select u.email from auth.users u where u.id = auth.uid()))
   order by i.creada_at
$$;

-- Aceptar las mías (todas, o las que diga). Solo a MI correo.
create or replace function public.invitacion_aceptar(p_ids uuid[] default null)
returns text[] language plpgsql security definer set search_path = '' as $$
declare v_correo text := lower((select u.email from auth.users u where u.id = auth.uid())); v_ids uuid[];
begin
  if auth.uid() is null or v_correo is null then raise exception 'Entra con tu usuario para aceptar.'; end if;
  select array_agg(i.id) into v_ids from public.invitacion i
   where i.correo = v_correo and i.estado = 'pendiente' and i.caduca_at > now()
     and (p_ids is null or i.id = any (p_ids));
  if v_ids is null then raise exception 'No tienes invitaciones pendientes.'; end if;
  return public._invitacion_dar_acceso(v_ids, auth.uid());
end $$;

-- ── Lo que hace el administrador de una empresa ──────────────────────────────
-- Las pendientes de una empresa.
create or replace function public.invitaciones_de_cuenta(p_account_id uuid)
returns table (id uuid, correo text, rol text, invita text, creada_at timestamptz, caduca_at timestamptz, envios integer, caducada boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._soy_admin_de(p_account_id) then raise exception 'Solo el administrador de la empresa ve sus invitaciones.'; end if;
  return query select i.id, i.correo, i.rol, i.invitada_por_nombre, i.creada_at, i.caduca_at, i.envios, i.caduca_at <= now()
                 from public.invitacion i where i.account_id = p_account_id and i.estado = 'pendiente'
                order by i.creada_at desc;
end $$;

create or replace function public.invitacion_anular(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_correo text; v_acc uuid;
begin
  select correo, account_id into v_correo, v_acc from public.invitacion where id = p_id and estado = 'pendiente';
  if v_acc is null then raise exception 'Esa invitación ya no está pendiente.'; end if;
  if not public._soy_admin_de(v_acc) then raise exception 'Solo el administrador de la empresa puede anularla.'; end if;
  update public.invitacion set estado = 'anulada', anulada_at = now(), anulada_por = auth.uid() where id = p_id;
  return v_correo;
end $$;

-- Quién tiene acceso a una empresa (con su correo, que solo ve su administrador).
create or replace function public.accesos_de_cuenta(p_account_id uuid)
returns table (user_id uuid, correo text, nombre text, rol text, activo boolean, ultimo_acceso timestamptz, soy_yo boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public._soy_admin_de(p_account_id) then raise exception 'Solo el administrador de la empresa ve quién tiene acceso.'; end if;
  return query select up.user_id, u.email::text, up.display_name, up.role, up.active, up.last_login_at, up.user_id = auth.uid()
                 from public.user_profiles up join auth.users u on u.id = up.user_id
                where up.account_id = p_account_id and up.role in ('admin', 'manager')
                order by up.active desc, up.role, u.email;
end $$;

-- Quitar el acceso a alguien: deja de estar activo en esa empresa (no se borra
-- su historia). Ni a uno mismo ni al último administrador.
create or replace function public.acceso_quitar(p_account_id uuid, p_user_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_rol text; v_correo text;
begin
  if not public._soy_admin_de(p_account_id) then raise exception 'Solo el administrador de la empresa puede quitar accesos.'; end if;
  if p_user_id = auth.uid() then raise exception 'No puedes quitarte el acceso a ti mismo.'; end if;
  select up.role, u.email into v_rol, v_correo from public.user_profiles up join auth.users u on u.id = up.user_id
   where up.account_id = p_account_id and up.user_id = p_user_id and up.active;
  if v_rol is null then raise exception 'Esa persona ya no tiene acceso a esta empresa.'; end if;
  if v_rol = 'admin' and (select count(*) from public.user_profiles where account_id = p_account_id and role = 'admin' and active) <= 1 then
    raise exception 'Es el único administrador: la empresa se quedaría sin nadie que la lleve.';
  end if;
  update public.user_profiles set active = false, updated_at = now() where account_id = p_account_id and user_id = p_user_id;
  return v_correo;
end $$;

-- ── Permisos ─────────────────────────────────────────────────────────────────
revoke all on function public._soy_admin_de(uuid) from public, anon;
grant execute on function public._soy_admin_de(uuid) to authenticated, service_role;
revoke all on function public._invitacion_dar_acceso(uuid[], uuid) from public, anon, authenticated;
grant execute on function public._invitacion_dar_acceso(uuid[], uuid) to service_role;
revoke all on function public.invitacion_crear(text, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function public.invitacion_crear(text, jsonb, text, uuid, text) to service_role;
revoke all on function public.invitacion_reenviar(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.invitacion_reenviar(uuid, text, uuid) to service_role;
revoke all on function public.invitacion_por_token(text) from public, anon, authenticated;
grant execute on function public.invitacion_por_token(text) to service_role;
revoke all on function public.mis_invitaciones() from public, anon;
grant execute on function public.mis_invitaciones() to authenticated;
revoke all on function public.invitacion_aceptar(uuid[]) from public, anon;
grant execute on function public.invitacion_aceptar(uuid[]) to authenticated;
revoke all on function public.invitaciones_de_cuenta(uuid) from public, anon;
grant execute on function public.invitaciones_de_cuenta(uuid) to authenticated;
revoke all on function public.invitacion_anular(uuid) from public, anon;
grant execute on function public.invitacion_anular(uuid) to authenticated;
revoke all on function public.accesos_de_cuenta(uuid) from public, anon;
grant execute on function public.accesos_de_cuenta(uuid) to authenticated;
revoke all on function public.acceso_quitar(uuid, uuid) from public, anon;
grant execute on function public.acceso_quitar(uuid, uuid) to authenticated;
