-- supabase/staging/sql/20261024_n3_local_empresa_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T0630_n3_local_empresa (public.location_company,
-- public.empresa_del_local), con \i dentro de la transacción y ROLLBACK: staging
-- no cambia. Con las cuentas de prueba como están el 24/10: A con dos empresas
-- y dos locales, B con una empresa y un local, C con un local y sin empresa.
--
--   1. B (una empresa): su local queda de esa empresa, «unica_empresa».
--   2. A (dos empresas): sus locales se quedan SIN empresa: no se adivina.
--   3. C (sin empresa): nada.
--   4. Un local y una empresa de cuentas distintas no se pueden unir.
--   5. Pasarla otra vez no cambia nada.
--   6. Como usuario de A: ve las suyas y no las de B; empresa_del_local del de
--      B le da NULL; y no puede escribir en la tabla.
--   7. La vuelta atrás quita la tabla y las dos funciones.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261024T0630_n3_local_empresa.sql

create temp table _n3_antes on commit drop as select * from public.location_company;

do $$
declare
  v_a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  v_c constant uuid := 'c01c0000-0000-4000-8000-00000000000c';
  v_emp_b uuid; v_loc_b uuid; v_loc_a uuid; v_n int;
begin
  if (select count(*) from public.company where account_id = v_a) < 2 or (select count(*) from public.company where account_id = v_b) <> 1 then
    raise exception 'PRUEBA N3: las cuentas de prueba no están como se midieron (A con 2 empresas, B con 1).';
  end if;
  select id into v_emp_b from public.company where account_id = v_b;
  select id into v_loc_b from public.locations where account_id = v_b order by created_at limit 1;
  select id into v_loc_a from public.locations where account_id = v_a order by created_at limit 1;

  -- 1 · B.
  if public.empresa_del_local(v_loc_b) is distinct from v_emp_b
     or (select source from public.location_company where location_id = v_loc_b) is distinct from 'unica_empresa' then
    raise exception 'PRUEBA N3 · 1: el local de B no ha quedado de su única empresa.';
  end if;
  -- 2 · A.
  select count(*) into v_n from public.location_company where account_id = v_a;
  if v_n <> 0 then raise exception 'PRUEBA N3 · 2: se ha adivinado la empresa de % local(es) de A, que tiene dos.', v_n; end if;
  -- 3 · C.
  if exists (select 1 from public.location_company where account_id = v_c) then
    raise exception 'PRUEBA N3 · 3: la cuenta C, sin empresa, tiene filas.';
  end if;
  -- 4 · Cuentas distintas.
  begin
    insert into public.location_company (location_id, company_id, account_id) values (v_loc_a, v_emp_b, v_a);
    raise exception 'PRUEBA N3 · 4: se ha unido un local de A con una empresa de B.';
  exception when check_violation then null;
  end;
  begin
    insert into public.location_company (location_id, company_id, account_id) values (v_loc_a, v_emp_b, v_b);
    raise exception 'PRUEBA N3 · 4: se ha unido un local de A con una empresa de B (con la cuenta de B).';
  exception when check_violation then null;
  end;
  raise notice 'N3 · 1-4: B a su única empresa; A (dos empresas) sin adivinar; C nada; cuentas distintas, paradas';
end $$;

-- 5 · Otra vez.
\i supabase/migrations/20261024T0630_n3_local_empresa.sql
do $$ begin
  if exists (select * from public.location_company except select * from _n3_antes)
     or exists (select * from _n3_antes except select * from public.location_company) then
    raise exception 'PRUEBA N3 · 5: pasarla otra vez ha cambiado las filas.';
  end if;
  raise notice 'N3 · 5: pasarla otra vez no cambia nada';
end $$;

-- 6 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_n int;
begin
  -- Como A no ve ninguna fila (A no tiene, y las de B no se ven).
  select count(*) into v_n from public.location_company;
  if v_n <> 0 then raise exception 'PRUEBA N3 · 6: el usuario de A ve % fila(s) que no son suyas.', v_n; end if;
  begin
    insert into public.location_company (location_id, company_id, account_id)
      values ('c01a0000-0000-4000-8000-0000000000a2', (select id from public.company limit 1), 'c01a0000-0000-4000-8000-00000000000a');
    raise exception 'PRUEBA N3 · 6: un usuario ha podido escribir en location_company.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'N3 · 6: el usuario de A no ve lo de B y no puede escribir';
end $$;
reset role;
do $$ begin
  -- empresa_del_local del local de B, preguntado como A: NULL.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;
do $$ begin
  if exists (select 1 from public.locations l where l.account_id = 'c01b0000-0000-4000-8000-00000000000b' and public.empresa_del_local(l.id) is not null) then
    raise exception 'PRUEBA N3 · 6: empresa_del_local le da a A la empresa de un local de B.';
  end if;
end $$;
reset role;

-- 7 · La vuelta atrás.
\i supabase/vuelta-atras/20261024T0630_n3_local_empresa.down.sql
do $$ begin
  if to_regclass('public.location_company') is not null
     or to_regprocedure('public.empresa_del_local(uuid)') is not null
     or to_regprocedure('public.location_company_misma_cuenta()') is not null then
    raise exception 'PRUEBA N3 · 7: la vuelta atrás no lo ha quitado todo.';
  end if;
  raise notice 'PRUEBA N3 en verde: el maestro local → empresa sin adivinar, por cuenta, sin escritura desde la API; se puede pasar dos veces; la vuelta atrás lo quita.';
end $$;

rollback;
