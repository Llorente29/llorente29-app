-- cambia: public.current_user_account_ids · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_is_admin_of · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_is_admin_or_manager_of · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_is_employee · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_ve_persona · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_is_office · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_user_location_ids · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
-- cambia: public.current_employee_and_account · prueba: supabase/staging/sql/20261030_dm1_cuenta_activa_prueba.sql
--
-- supabase/migrations/20261030T1951_dm1_permisos_de_la_activa.sql
--
-- DM1 · PR 1 · Un usuario en varias empresas (30/10/2026), segundo fichero:
-- CAMBIA EN CALIENTE las ocho funciones con las que las políticas deciden quién
-- lee y escribe (más de 600 políticas las usan). Misma firma y mismo
-- «stable security definer»; cada una, guardada antes con _respaldar_funcion.
-- Está en el camino del pedido: lleva el «autorizo» de Julio.
--
-- Qué cambia: donde miraban «cualquier cuenta de la persona», miran solo la
-- abierta (_cuenta_activa, de la 1950). Así una persona en dos cuentas ve y
-- escribe solo en la abierta, aunque sea administradora de las dos.
--   · current_user_account_ids: la abierta (antes, todas las suyas).
--   · current_user_is_admin_of, current_user_is_admin_or_manager_of,
--     current_user_is_employee: además, que la cuenta sea la abierta.
--   · current_user_ve_persona: lo mismo en su rama de encargado (las otras dos
--     ramas llaman a las de arriba).
--   · current_user_is_office: su rol en la abierta (antes, en cualquiera).
--   · current_user_location_ids: los locales de la abierta.
--   · current_employee_and_account: la ficha de la abierta, sin «limit 1» al
--     azar (decisión 1, condición 3).
--
-- Qué NO cambia, y por qué:
--   · Con una sola cuenta, la abierta es esa: para las 15 personas de hoy (una
--     cuenta cada una, medido el 30/10) el resultado es el mismo.
--   · El superadministrador sigue entrando por current_user_is_admin(), que no
--     se toca: ve todas las cuentas, como antes.
--   · Sin usuario (tareas programadas, service_role): auth.uid() es NULL, como
--     antes no hay perfiles que mirar y las funciones devuelven lo mismo que
--     antes: '{}' y falso.
--
-- Vuelta atrás: supabase/vuelta-atras/20261030T1951_dm1_permisos_de_la_activa.down.sql

select public._respaldar_funcion('public.current_user_account_ids()', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_is_admin_of(uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_is_admin_or_manager_of(uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_is_employee(uuid,uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_ve_persona(uuid,uuid)', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_is_office()', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_user_location_ids()', '20261030T1951_dm1_permisos_de_la_activa');
select public._respaldar_funcion('public.current_employee_and_account()', '20261030T1951_dm1_permisos_de_la_activa');

create or replace function public.current_user_account_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_is_admin() then
      -- Superadmin de plataforma: ve todas las cuentas.
      (select coalesce(array_agg(id), '{}') from public.accounts)
    else
      -- DM1 (30/10): la cuenta abierta (con una sola cuenta, esa).
      coalesce(array_remove(array[public._cuenta_activa()], null), '{}')
  end;
$$;

create or replace function public.current_user_is_admin_of(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = auth.uid()
      and account_id = p_account_id
      and account_id = public._cuenta_activa()   -- DM1: solo en la abierta
      and role = 'admin'
      and active = true
  ) or public.current_user_is_admin();
$$;

create or replace function public.current_user_is_admin_or_manager_of(p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles me
    where me.user_id = auth.uid()
      and me.account_id = p_account_id
      and me.account_id = public._cuenta_activa()   -- DM1: solo en la abierta
      and me.role = any (array['admin', 'manager'])
      and me.active = true
  ) or public.current_user_is_admin();
$$;

create or replace function public.current_user_is_employee(p_employee_id uuid, p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.account_id = p_account_id
      and up.account_id = public._cuenta_activa()   -- DM1: solo en la abierta
      and up.employee_id = p_employee_id
      and up.active = true
  );
$$;

create or replace function public.current_user_ve_persona(p_employee_id uuid, p_account_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_is_admin_of(p_account_id)
      or public.current_user_is_employee(p_employee_id, p_account_id)
      or (exists (select 1 from public.user_profiles up
                   where up.user_id = auth.uid() and up.account_id = p_account_id
                     and up.account_id = public._cuenta_activa()   -- DM1: solo en la abierta
                     and up.role = 'manager' and up.active)
          and exists (select 1 from public.employees e
                       where e.id = p_employee_id and e.account_id = p_account_id
                         and (e.location_id = any (public.current_user_location_ids())
                              or coalesce(e.assigned_locations, '{}'::uuid[]) && public.current_user_location_ids())))
$$;

create or replace function public.current_user_is_office()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_profiles up
    where up.user_id = auth.uid()
      and up.active = true
      and up.account_id = public._cuenta_activa()   -- DM1: su rol en la abierta
      and up.role = any (array['admin', 'manager'])
  ) or public.current_user_is_admin();
$$;

create or replace function public.current_user_location_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_is_admin() then
      (select coalesce(array_agg(id), '{}'::uuid[]) from public.locations)
    when exists (
      select 1 from public.manager_locations ml
      join public.user_profiles up on up.id = ml.user_profile_id
      where up.user_id = auth.uid() and up.active = true
        and up.account_id = public._cuenta_activa()   -- DM1: los de la abierta
    ) then
      (select coalesce(array_agg(distinct ml.location_id), '{}'::uuid[])
         from public.manager_locations ml
         join public.user_profiles up on up.id = ml.user_profile_id
        where up.user_id = auth.uid() and up.active = true
          and up.account_id = public._cuenta_activa())
    when exists (
      select 1 from public.user_profiles up
      where up.user_id = auth.uid() and up.active = true and up.role = 'admin'
        and up.account_id = public._cuenta_activa()
    ) then
      (select coalesce(array_agg(l.id), '{}'::uuid[]) from public.locations l
        where l.account_id = any(public.current_user_account_ids()))
    else '{}'::uuid[]
  end;
$$;

create or replace function public.current_employee_and_account(out employee_id uuid, out account_id uuid)
returns record language sql stable security definer set search_path = public as $$
  -- DM1 (30/10): la ficha de la cuenta abierta, sin «limit 1» al azar.
  select up.employee_id, up.account_id
  from public.user_profiles up
  where up.user_id = auth.uid()
    and up.active = true
    and up.employee_id is not null
    and up.account_id = public._cuenta_activa();
$$;
