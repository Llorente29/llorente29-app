-- supabase/staging/sql/20261024_n7_laboral_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T0801_n7_laboral (payroll_cost.irpf,
-- payroll_cost.employee_ss y fuente_nominas_mes_v1), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Trabajadores y nóminas
-- inventados en la cuenta B de pruebas (una empresa) y uno en la A:
--
--   1. Se pasa dos veces (se puede reaplicar).
--   2. Septiembre de 2026 en B: en el local b2, uno con borrador y definitiva
--      (cuenta la definitiva) y otro solo con borrador y sin IRPF; uno sin
--      local (B tiene una sola empresa: cuenta, con local nulo). El de A no sale.
--   3. Sin desglose en una nómina del local: ss_trabajador e irpf nulos y
--      desglose_completo falso; deducciones = bruto − líquido igual.
--   4. Un IRPF negativo, parado (CHECK).
--   5. Otro mes: nada. Una empresa que no existe: P0002. Sin mes: 22023.
--   6. El usuario de B lee; el de A, 42501; anon no la ejecuta.
--   7. La vuelta atrás la quita, y para si ya hay IRPF apuntado.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N7: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Dos veces.
\i supabase/migrations/20261024T0801_n7_laboral.sql
\i supabase/migrations/20261024T0801_n7_laboral.sql

do $$
declare
  v_b   constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  v_a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_lb  constant uuid := 'c01b0000-0000-4000-8000-0000000000b2';
  v_la  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  e1 uuid := 'e7000000-0000-4000-8000-0000000000b1'; e2 uuid := 'e7000000-0000-4000-8000-0000000000b2';
  e3 uuid := 'e7000000-0000-4000-8000-0000000000b3'; ea uuid := 'e7000000-0000-4000-8000-0000000000a1';
begin
  if (select count(*) from public.company where account_id = v_b) <> 1
     or not exists (select 1 from public.company where id = v_e and account_id = v_b)
     or not exists (select 1 from public.locations where id = v_lb and account_id = v_b) then
    raise exception 'PRUEBA N7: la cuenta B no está como se midió el 24/10 (una empresa %, local %).', v_e, v_lb;
  end if;
  insert into public.employees (id, account_id, name, location_id) values
    (e1, v_b, 'Prueba N7 · uno', v_lb), (e2, v_b, 'Prueba N7 · dos', v_lb),
    (e3, v_b, 'Prueba N7 · sin local', null), (ea, v_a, 'Prueba N7 · de A', v_la);
  insert into public.payroll_cost (account_id, employee_id, period_year, period_month, status, gross, employer_ss, net, irpf, employee_ss, source) values
    (v_b, e1, 2026, 9, 'borrador',   1000, 300, 800, null, null, 'manual'),
    (v_b, e1, 2026, 9, 'definitiva', 1100, 330, 880, 150, 70, 'manual'),
    (v_b, e2, 2026, 9, 'borrador',    900, 270, 750, null, null, 'manual'),
    (v_b, e3, 2026, 9, 'definitiva',  500, 150, 420, 50, 30, 'manual'),
    (v_a, ea, 2026, 9, 'definitiva', 7777, 999, 6000, 1000, 500, 'manual');
end $$;

-- 2 y 3 · Lo de septiembre en B.
do $$
declare
  v_e  constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  v_lb constant uuid := 'c01b0000-0000-4000-8000-0000000000b2';
  r record; v_n int;
begin
  select count(*) into v_n from public.fuente_nominas_mes_v1(v_e, '2026-09-17');
  if v_n <> 2 then raise exception 'PRUEBA N7 · 2: salen % filas, no 2 (b2 y sin local).', v_n; end if;

  select * into r from public.fuente_nominas_mes_v1(v_e, '2026-09-01') f where f.local_id = v_lb;
  if r.mes <> '2026-09-01' or r.trabajadores <> 2 or r.borradores <> 1
     or r.bruto <> 2000 or r.ss_empresa <> 600 or r.liquido <> 1630 or r.deducciones <> 370 or r.coste_total <> 2600 then
    raise exception 'PRUEBA N7 · 2: el local b2 no cuadra (%).', r;
  end if;
  if r.ss_trabajador is not null or r.irpf is not null or r.desglose_completo then
    raise exception 'PRUEBA N7 · 3: con una nómina sin desglose, ss_trabajador o irpf no son nulos (%).', r;
  end if;

  select * into r from public.fuente_nominas_mes_v1(v_e, '2026-09-01') f where f.local_id is null;
  if r.trabajadores <> 1 or r.bruto <> 500 or r.ss_trabajador <> 30 or r.irpf <> 50 or not r.desglose_completo or r.coste_total <> 650 then
    raise exception 'PRUEBA N7 · 2: el sin local no cuadra (%).', r;
  end if;
  if exists (select 1 from public.fuente_nominas_mes_v1(v_e, '2026-09-01') f where f.bruto >= 7777) then
    raise exception 'PRUEBA N7 · 2: sale la nómina de la cuenta A.';
  end if;
  raise notice 'N7 · 1-3: se pasa dos veces; la definitiva gana al borrador; sin desglose, nulos y desglose_completo falso; el sin local cuenta; lo de A no sale';
end $$;

-- 4 · Un IRPF negativo, parado.
do $$ begin
  begin
    update public.payroll_cost set irpf = -1 where employee_id = 'e7000000-0000-4000-8000-0000000000b3';
    raise exception 'PRUEBA N7 · 4: un IRPF negativo ha entrado.';
  exception when check_violation then null;
  end;
end $$;

-- 5 · Otro mes, otra empresa, sin mes.
do $$
declare v_e constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
begin
  if exists (select 1 from public.fuente_nominas_mes_v1(v_e, '2026-08-01')) then
    raise exception 'PRUEBA N7 · 5: agosto, sin nóminas, devuelve filas.';
  end if;
  begin
    perform public.fuente_nominas_mes_v1('00000000-0000-4000-8000-0000000000ff', '2026-09-01');
    raise exception 'PRUEBA N7 · 5: una empresa que no existe no para.';
  exception when no_data_found then null;
  end;
  begin
    perform public.fuente_nominas_mes_v1(v_e, null);
    raise exception 'PRUEBA N7 · 5: sin mes no para.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'N7 · 4-5: IRPF negativo parado; otro mes, nada; empresa que no existe y sin mes, parados';
end $$;

-- 6 · Quién la ejecuta.
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.fuente_nominas_mes_v1('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', '2026-09-01')) <> 2 then
    raise exception 'PRUEBA N7 · 6: el usuario de B no lee las nóminas de su empresa.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.fuente_nominas_mes_v1('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', '2026-09-01');
    raise exception 'PRUEBA N7 · 6: el usuario de A ha leído las nóminas de B.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  begin
    perform public.fuente_nominas_mes_v1('7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', '2026-09-01');
    raise exception 'PRUEBA N7 · 6: anon ha ejecutado fuente_nominas_mes_v1.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'N7 · 6: B lee lo suyo; A no lee lo de B; anon no la ejecuta';
end $$;
reset role;

-- 7 · La vuelta atrás: con IRPF apuntado (arriba), para y no quita nada.
savepoint antes_de_frenar;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261024T0801_n7_laboral.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_de_frenar;
select (:'LAST_ERROR_MESSAGE' = 'N7 · vuelta atrás: hay nóminas con IRPF o SS del trabajador. No se quitan las columnas.') as freno_n7_ok \gset
\echo 'El freno de la vuelta atrás dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_n7_ok
\else
  do $$ begin raise exception 'PRUEBA N7 · 7: con IRPF apuntado, la vuelta atrás NO ha parado.'; end $$;
\endif
do $$ begin
  if to_regprocedure('public.fuente_nominas_mes_v1(uuid, date)') is null then
    raise exception 'PRUEBA N7 · 7: con IRPF apuntado, la vuelta atrás ha quitado la función.';
  end if;
end $$;
-- Sin IRPF ni SS apuntados, lo quita todo.
update public.payroll_cost set irpf = null, employee_ss = null
 where employee_id in (select id from public.employees where name like 'Prueba N7 · %');
\i supabase/vuelta-atras/20261024T0801_n7_laboral.down.sql
do $$ begin
  if to_regprocedure('public.fuente_nominas_mes_v1(uuid, date)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payroll_cost' and column_name in ('irpf', 'employee_ss')) then
    raise exception 'PRUEBA N7 · 7: la vuelta atrás no lo ha quitado todo.';
  end if;
  raise notice 'PRUEBA N7 en verde: las columnas y fuente_nominas_mes_v1 leen lo de cada empresa y solo eso; se puede pasar dos veces; la vuelta atrás para con datos y sin ellos lo quita.';
end $$;

rollback;
