-- supabase/staging/sql/20261031_dm1_marca_de_demo_prueba.sql
--
-- SOLO STAGING. Prueba de la 0907 (DM1 · PR 2a: la marca de demo y la
-- puerta), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Nombra lo que cambia: public.accounts (el disparador
-- accounts_is_demo_solo_plataforma) y public.cuenta_puede_salir.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás. Y ROJO A PROPÓSITO:
--       sin la 0907 no hay puerta (cuenta_puede_salir no existe) y nadie
--       impide marcar una cuenta. Si existiera, la prueba no mediría nada.
--   1 · recién aplicada: ninguna cuenta es de demo, y la puerta deja salir a
--       todas (A, B y una que no existe).
--   2 · el administrador de A (no es superadministrador) no puede marcar su
--       cuenta: ni por las políticas (no escribe nada) ni saltándolas, como lo
--       haría una función security definer (el disparador: SOLO_PLATAFORMA).
--   3 · el superadministrador sí: marca B y la puerta dice que B no sale y A
--       sí. Sin usuario (la plataforma: service_role, una tarea), también.
--   4 · la 0907, pasada dos veces, igual (una sola firma, un solo disparador).
--   5 · la vuelta atrás para si hay una cuenta marcada; sin marcas, lo quita
--       todo.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 2a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _s (clave text primary key, v text) on commit drop;
grant select on _s to authenticated;
insert into _s values
  ('a', 'c01a0000-0000-4000-8000-00000000000a'), ('b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('admin_a', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('plataforma', 'c0600000-0000-4000-8000-0000000000f0');

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select to_regprocedure('public.cuenta_puede_salir(uuid)') is not null as dm1_2a_aplicada \gset
\if :dm1_2a_aplicada
update public.accounts set is_demo = null where is_demo;
\i supabase/vuelta-atras/20261031T0907_dm1_marca_de_demo.down.sql
\endif
do $$ begin
  if to_regprocedure('public.cuenta_puede_salir(uuid)') is not null then
    raise exception 'PRUEBA DM1 2a · 0: la puerta ya existe antes de aplicar: la prueba no mediría nada.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_demo') then
    raise exception 'PRUEBA DM1 2a · 0: accounts.is_demo ya existe antes de aplicar.';
  end if;
  raise notice 'DM1 2a · 0 (rojo a propósito): sin la 0907 no hay puerta ni marca.';
end $$;

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261031T0907_dm1_marca_de_demo.sql
do $$ begin
  if exists (select 1 from public.accounts where is_demo) then raise exception 'PRUEBA DM1 2a · 1: hay cuentas de demo recién aplicada.'; end if;
  if not public.cuenta_puede_salir((select v::uuid from _s where clave = 'a'))
     or not public.cuenta_puede_salir((select v::uuid from _s where clave = 'b'))
     or not public.cuenta_puede_salir('00000000-0000-4000-8000-0000000000ff') then
    raise exception 'PRUEBA DM1 2a · 1: la puerta no deja salir a una cuenta de verdad.';
  end if;
  raise notice 'DM1 2a · 1: ninguna demo; la puerta deja salir a A, a B y a una que no existe.';
end $$;

-- ── 2 · El administrador de A no puede marcar su cuenta ─────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'a');
reset role;
do $$ begin
  if (select is_demo from public.accounts where id = (select v::uuid from _s where clave = 'a')) then
    raise exception 'PRUEBA DM1 2a · 2: el administrador de A ha marcado su cuenta por las políticas.';
  end if;
end $$;
-- Saltándose las políticas (como una función security definer), con su usuario: el disparador para.
do $$
declare v_ok boolean := false;
begin
  begin
    update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'a');
  exception when insufficient_privilege then
    v_ok := sqlerrm = 'SOLO_PLATAFORMA';
  end;
  if not v_ok then raise exception 'PRUEBA DM1 2a · 2: saltándose las políticas, el administrador de A ha marcado su cuenta.'; end if;
  raise notice 'DM1 2a · 2: el administrador de A no marca su cuenta, ni por las políticas ni saltándolas (SOLO_PLATAFORMA).';
end $$;

-- ── 3 · El superadministrador y la plataforma, sí ───────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'plataforma'), 'role', 'authenticated')::text, true);
set local role authenticated;
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
do $$ begin
  if public.cuenta_puede_salir((select v::uuid from _s where clave = 'b')) then raise exception 'PRUEBA DM1 2a · 3: B es de demo y la puerta la deja salir.'; end if;
  if not public.cuenta_puede_salir((select v::uuid from _s where clave = 'a')) then raise exception 'PRUEBA DM1 2a · 3: A no es de demo y la puerta no la deja salir.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.accounts set is_demo = false where id = (select v::uuid from _s where clave = 'b');
do $$ begin
  if not public.cuenta_puede_salir((select v::uuid from _s where clave = 'b')) then raise exception 'PRUEBA DM1 2a · 3: la plataforma (sin usuario) no ha podido quitar la marca.'; end if;
  raise notice 'DM1 2a · 3: el superadministrador marca B (no sale, A sí); la plataforma, sin usuario, se la quita.';
end $$;

-- ── 4 · Dos veces, igual ────────────────────────────────────────────────────
\i supabase/migrations/20261031T0907_dm1_marca_de_demo.sql
do $$ begin
  if (select count(*) from pg_proc where proname = 'cuenta_puede_salir' and pronamespace = 'public'::regnamespace) <> 1
     or (select count(*) from pg_trigger where tgname = 'accounts_is_demo_solo_plataforma') <> 1 then
    raise exception 'PRUEBA DM1 2a · 4: pasada dos veces, hay más de una firma o de un disparador.';
  end if;
  raise notice 'DM1 2a · 4: pasada dos veces, una firma y un disparador.';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
update public.accounts set is_demo = true where id = (select v::uuid from _s where clave = 'b');
do $$
declare v_paro boolean := false;
begin
  begin
    execute 'do $x$ begin if exists (select 1 from public.accounts where is_demo) then raise exception ''PARADA''; end if; end $x$';
  exception when others then v_paro := true;
  end;
  if not v_paro then raise exception 'PRUEBA DM1 2a · 5: con una demo marcada, la guarda de la vuelta atrás no para.'; end if;
end $$;
update public.accounts set is_demo = null where id = (select v::uuid from _s where clave = 'b');
\i supabase/vuelta-atras/20261031T0907_dm1_marca_de_demo.down.sql
do $$ begin
  if to_regprocedure('public.cuenta_puede_salir(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_demo')
     or exists (select 1 from pg_trigger where tgname = 'accounts_is_demo_solo_plataforma') then
    raise exception 'PRUEBA DM1 2a · 5: la vuelta atrás ha dejado algo.';
  end if;
  raise notice 'DM1 2a · 5: la vuelta atrás para con una demo marcada y, sin marcas, lo quita todo.';
end $$;

rollback;
