-- supabase/staging/sql/20261110_gd_al_dia_prueba.sql
--
-- SOLO STAGING. La 2308 del GD (Clientes y cuotas al día con Realtime):
--   1. conta_gestoria_lectura entra en la publicación de Realtime (si la base la tiene).
--   2. La seguridad por cuenta que Realtime aplica a cada suscriptor (la RLS de la tabla, con su sesión): una
--      persona que no es de la plataforma ve las lecturas de su cuenta abierta y NINGUNA de otra cuenta.
--   3. La vuelta atrás la saca de la publicación.
-- Todo acaba en ROLLBACK. Lecturas inventadas (T11).
-- usuario: la persona de prueba p01.laura, con su sesión (set local role authenticated), para medir la RLS.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T2308_gd_al_dia_lecturas.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated;

-- 1 · En la publicación de Realtime (donde la hay).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conta_gestoria_lectura') then
      raise exception 'GD · 1: conta_gestoria_lectura no está en supabase_realtime.';
    end if;
    raise notice 'GD · 1: conta_gestoria_lectura está en la publicación de Realtime. OK';
  else
    raise notice 'GD · 1: esta base no tiene supabase_realtime (base local): no hay nada que comprobar.';
  end if;
end $$;

-- La persona de prueba, administradora de la demo; y otra cuenta de la que no es nada.
insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
select id, 'de000000-0000-4000-8000-0000000000a0', 'admin', true, 'Administración GD (prueba)', now(), now() from auth.users where email = 'p01.laura@p01-prueba.test'
on conflict do nothing;
do $$
declare v_u uuid; v_otra uuid;
begin
  select id into v_u from auth.users where email = 'p01.laura@p01-prueba.test';
  if v_u is null then raise exception 'PRUEBA GD: no está el usuario de prueba p01.laura en staging.'; end if;
  select a.id into v_otra from public.accounts a
   where a.id <> 'de000000-0000-4000-8000-0000000000a0' and not exists (select 1 from public.user_profiles p where p.account_id = a.id and p.user_id = v_u)
   order by a.id limit 1;
  if v_otra is null then raise exception 'PRUEBA GD: no hay otra cuenta en esta base.'; end if;
  insert into _p values ('usuario', v_u::text), ('otra', v_otra::text);
  -- Una lectura acabada en cada cuenta.
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, quien_name, acabada_at, estado, mensaje)
  values ('de000000-0000-4000-8000-0000000000a0', 'crm', 'pruebas', 'aviso', 'Prueba GD', now(), 'bien', 'PRUEBA GD · la de la demo'),
         (v_otra, 'crm', 'pruebas', 'aviso', 'Prueba GD', now(), 'bien', 'PRUEBA GD · la de otra cuenta');
end $$;

-- 2 · Con la sesión de la persona de prueba: la suya sí, la de otra cuenta no.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'usuario'), 'role', 'authenticated')::text, true);
-- Con la demo abierta, como la abre la app (DM1: «usuario:cuenta»): fuera de la plataforma, solo se ve la cuenta abierta.
select set_config('folvy.cuenta_activa', (select v from _p where clave = 'usuario') || ':de000000-0000-4000-8000-0000000000a0', true);
set local role authenticated;
do $$
declare v_mia int; v_ajena int;
begin
  if public.current_user_is_admin() then raise exception 'PRUEBA GD: la persona de prueba es de la plataforma; la prueba no mediría nada.'; end if;
  select count(*) into v_mia from public.conta_gestoria_lectura where mensaje = 'PRUEBA GD · la de la demo';
  select count(*) into v_ajena from public.conta_gestoria_lectura where mensaje = 'PRUEBA GD · la de otra cuenta';
  if v_mia <> 1 then raise exception 'GD · 2: la persona no ve la lectura de su cuenta (%).', v_mia; end if;
  if v_ajena <> 0 then raise exception 'GD · 2: la persona VE una lectura de otra cuenta (%).', v_ajena; end if;
  if exists (select 1 from public.conta_gestoria_lectura where account_id = (select v::uuid from _p where clave = 'otra')) then
    raise exception 'GD · 2: la persona ve alguna lectura de otra cuenta.';
  end if;
  raise notice 'GD · 2: con su sesión, ve la lectura de su cuenta y ninguna de otra cuenta. OK';
end $$;
reset role;

-- 3 · La vuelta atrás.
\i supabase/vuelta-atras/20261109T2308_gd_al_dia_lecturas.down.sql
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conta_gestoria_lectura') then
    raise exception 'GD · 3: conta_gestoria_lectura sigue en la publicación.';
  end if;
  raise notice 'GD · 3: la vuelta atrás la saca de la publicación. OK';
end $$;

rollback;
