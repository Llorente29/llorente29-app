-- supabase/staging/sql/20261113_b01r26_subcuentas_creadas_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · las subcuentas creadas en Diez (1850). Todo
-- en una transacción con ROLLBACK, en la cuenta A, con un traspaso de mentira:
--   1. El servidor apunta una subcuenta creada; la misma otra vez, no (única por
--      empresa, base y código).
--   2. La C0001 no vale nunca, ni un código que no es de cifras.
--   3. Un usuario de la cuenta la lee; no puede escribir.
--   4. La vuelta atrás quita la tabla, con filas dentro.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 SUBCUENTAS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
\i supabase/migrations/20261113T1850_b01r26_subcuentas_creadas.sql

create temp table _r (clave text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  t uuid; v_admin uuid; v_err text;
begin
  select up.user_id into v_admin from public.user_profiles up where up.account_id = a and up.active order by up.user_id limit 1;
  if v_admin is null then raise exception 'PRUEBA B01r26 SUBCUENTAS · siembra: A no tiene usuarios.'; end if;
  insert into public.conta_diez_traspaso (account_id, company_id, mes, estado) values (a, emp, date '2026-10-01', 'traspasando') returning id into t;
  -- 1. Apuntar una; la misma otra vez, no.
  insert into public.conta_diez_subcuenta_creada (account_id, company_id, traspaso_id, base, codigo, nombre, creada_por, creada_por_nombre)
  values (a, emp, t, 'C0009', '47200010', 'IVA soportado 10 %', v_admin, 'PRUEBA');
  begin
    insert into public.conta_diez_subcuenta_creada (account_id, company_id, traspaso_id, base, codigo, nombre) values (a, emp, t, 'C0009', '47200010', 'Otra vez');
    raise exception 'PRUEBA B01r26 SUBCUENTAS 1: se ha apuntado dos veces la misma subcuenta.';
  exception when unique_violation then null;
  end;
  -- 2. La C0001 y un código que no es de cifras.
  begin
    insert into public.conta_diez_subcuenta_creada (account_id, company_id, traspaso_id, base, codigo, nombre) values (a, emp, t, 'C0001', '47200021', 'X');
    raise exception 'PRUEBA B01r26 SUBCUENTAS 2: ha aceptado la C0001.';
  exception when check_violation then null;
  end;
  begin
    insert into public.conta_diez_subcuenta_creada (account_id, company_id, traspaso_id, base, codigo, nombre) values (a, emp, t, 'C0009', '4720A010', 'X');
    raise exception 'PRUEBA B01r26 SUBCUENTAS 2: ha aceptado un código que no es de cifras.';
  exception when check_violation then null;
  end;
  insert into _r values ('admin', v_admin);
end $$;

-- 3. Un usuario de la cuenta la lee; no puede escribir.
select set_config('request.jwt.claims', json_build_object('sub', (select id from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.conta_diez_subcuenta_creada where codigo = '47200010') <> 1 then
    raise exception 'PRUEBA B01r26 SUBCUENTAS 3: un usuario de la cuenta no ve la subcuenta creada.';
  end if;
  begin
    insert into public.conta_diez_subcuenta_creada (account_id, company_id, traspaso_id, base, codigo, nombre)
    select account_id, company_id, traspaso_id, base, '47200021', 'X' from public.conta_diez_subcuenta_creada limit 1;
    raise exception 'PRUEBA B01r26 SUBCUENTAS 3: un usuario ha podido apuntar una subcuenta.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1850_b01r26_subcuentas_creadas.down.sql
do $$ begin
  if to_regclass('public.conta_diez_subcuenta_creada') is not null then raise exception 'PRUEBA B01r26 SUBCUENTAS 4: la vuelta atrás no quita la tabla.'; end if;
end $$;

select 'PRUEBA B01r26 subcuentas creadas: en verde' as resultado;
rollback;
