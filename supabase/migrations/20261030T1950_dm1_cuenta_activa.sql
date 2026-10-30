-- supabase/migrations/20261030T1950_dm1_cuenta_activa.sql
--
-- DM1 · PR 1 · Un usuario en varias empresas (30/10/2026), primer fichero:
-- SOLO AÑADE y se puede pasar dos veces. Lo que cambia las funciones de
-- permisos va en la 1951.
--
-- La base ya admite a una persona en varias cuentas: una fila de user_profiles
-- por persona y cuenta, con su rol (único user_id + account_id). Lo que falta
-- es saber CUÁL tiene abierta, para que vea esa y nada de la otra (decisión 1
-- de la respuesta 1 al DM1). Esto añade:
--
--   1. user_active_account: la cuenta abierta de cada persona (una fila por
--      usuario). Solo se escribe con cambiar_empresa.
--   2. _cuenta_activa(): la abierta, si la persona sigue siendo miembro activo;
--      si no hay ninguna guardada (o ya no vale), su cuenta más antigua. Con
--      una sola cuenta es siempre esa: para las 15 personas de hoy no cambia
--      nada. Sin usuario (tareas programadas, service_role): NULL. Se calcula
--      una vez por transacción: las políticas la llaman fila a fila.
--   3. mis_empresas(): las cuentas de la persona, con su rol, sus productos y
--      sus sociedades (para el selector de la cabecera, que agrupa las
--      sociedades por cuenta: decisión 7). Lee aunque la cuenta no esté
--      abierta, y solo las de la persona.
--   4. cambiar_empresa(cuenta): abre otra cuenta de la persona. Comprueba que
--      es miembro activo; si no, NO_AUTORIZADO.
--   5. _usuario_por_correo: para invitar, el usuario de un correo si ya existe.
--      Solo el servidor.
--
-- Vuelta atrás: supabase/vuelta-atras/20261030T1950_dm1_cuenta_activa.down.sql

create table if not exists public.user_active_account (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  updated_at timestamptz not null default now()
);
comment on table public.user_active_account is
  'DM1 (30/10/2026). La cuenta que tiene abierta cada persona con varias. Solo la escribe cambiar_empresa. La lee _cuenta_activa, y de ella current_user_account_ids y las funciones de permisos (1951).';
alter table public.user_active_account enable row level security;
drop policy if exists user_active_account_read on public.user_active_account;
create policy user_active_account_read on public.user_active_account for select to authenticated using (user_id = auth.uid());
revoke all on public.user_active_account from anon, authenticated;
grant select on public.user_active_account to authenticated;

create or replace function public._cuenta_activa()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_memo text := current_setting('folvy.cuenta_activa', true);
  v_cuenta uuid;
begin
  if v_uid is null then return null; end if;
  -- Las políticas la llaman fila a fila: se calcula una vez por transacción y
  -- usuario, y se guarda en un ajuste local de la transacción (con el usuario
  -- delante, por si cambia dentro de la misma). Medido el 30/10: sin esto, las
  -- consultas de ventas tardaban entre el doble y el triple.
  if v_memo like v_uid::text || ':%' then
    return nullif(split_part(v_memo, ':', 2), '')::uuid;
  end if;
  select coalesce(
    (select a.account_id
       from public.user_active_account a
       join public.user_profiles up on up.user_id = a.user_id and up.account_id = a.account_id and up.active
      where a.user_id = v_uid),
    (select up.account_id
       from public.user_profiles up
      where up.user_id = v_uid and up.active and up.account_id is not null
      order by up.created_at, up.account_id
      limit 1)) into v_cuenta;
  perform set_config('folvy.cuenta_activa', v_uid::text || ':' || coalesce(v_cuenta::text, ''), true);
  return v_cuenta;
end $$;
comment on function public._cuenta_activa() is
  'DM1 (30/10/2026). La cuenta abierta de quien llama: la guardada si sigue siendo miembro activo; si no, la más antigua. NULL sin usuario. Se calcula una vez por transacción (folvy.cuenta_activa).';
revoke all on function public._cuenta_activa() from public, anon;
grant execute on function public._cuenta_activa() to authenticated;

create or replace function public.mis_empresas()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id,
      'nombre', a.name,
      'slug', a.slug,
      'logo', a.logo_url,
      'rol', up.role,
      'solo_sumied', a.product_brand is not null,
      'activa', a.id = public._cuenta_activa(),
      'sociedades', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id,
                 'nombre', coalesce(nullif(c.trade_name, ''), c.legal_name),
                 'razon_social', c.legal_name,
                 'color', c.color,
                 'logo', c.logo_path)
               order by coalesce(nullif(c.trade_name, ''), c.legal_name))
          from public.company c
         where c.account_id = a.id and coalesce(c.is_active, true)), '[]'::jsonb))
    order by a.name), '[]'::jsonb)
  from public.user_profiles up
  join public.accounts a on a.id = up.account_id
  where up.user_id = auth.uid() and up.active and up.account_id is not null
$$;
comment on function public.mis_empresas() is
  'DM1 (30/10/2026). Las cuentas de quien llama, con su rol, si es solo Sumied, si está abierta y sus sociedades. Para el selector de empresa.';
revoke all on function public.mis_empresas() from public, anon;
grant execute on function public.mis_empresas() to authenticated;

create or replace function public.cambiar_empresa(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_nombre text;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION' using errcode = '42501', hint = 'Hay que entrar para cambiar de empresa.';
  end if;
  select a.name into v_nombre
    from public.user_profiles up join public.accounts a on a.id = up.account_id
   where up.user_id = auth.uid() and up.account_id = p_account_id and up.active;
  if v_nombre is null then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'No tienes acceso a esa empresa.';
  end if;
  insert into public.user_active_account (user_id, account_id, updated_at)
  values (auth.uid(), p_account_id, now())
  on conflict (user_id) do update set account_id = excluded.account_id, updated_at = excluded.updated_at;
  -- La de esta transacción, también: lo que se lea después ya es de la nueva.
  perform set_config('folvy.cuenta_activa', auth.uid()::text || ':' || p_account_id::text, true);
  return jsonb_build_object('account_id', p_account_id, 'nombre', v_nombre);
end $$;
comment on function public.cambiar_empresa(uuid) is
  'DM1 (30/10/2026). Abre otra cuenta de quien llama, si es miembro activo. Después la pantalla se recarga.';
revoke all on function public.cambiar_empresa(uuid) from public, anon;
grant execute on function public.cambiar_empresa(uuid) to authenticated;

-- 5. Para invitar (función invitar-persona): el usuario de un correo, si ya
--    existe. Solo el servidor (service_role): nadie con sesión puede preguntar
--    por el correo de otro.
create or replace function public._usuario_por_correo(p_correo text)
returns uuid language sql stable security definer set search_path = public, auth as $$
  select u.id from auth.users u where lower(u.email) = lower(trim(p_correo)) limit 1
$$;
comment on function public._usuario_por_correo(text) is
  'DM1 (30/10/2026). El usuario de un correo, si existe. Solo service_role (invitar-persona).';
revoke all on function public._usuario_por_correo(text) from public, anon, authenticated;
grant execute on function public._usuario_por_correo(text) to service_role;
