-- supabase/staging/sql/20261114_b01r26_traspaso_cerrojo_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · el cerrojo de la tanda del traspaso (0757).
-- Todo en una transacción con ROLLBACK, en la cuenta A, con un traspaso de mentira.
--   1. Libre: la primera tanda lo toma (true); la segunda, no (false).
--   2. Soltado, se puede volver a tomar.
--   3. Caducado (una tanda cortada por un 504), se puede tomar.
--   4. Fuera de 10–600 segundos, para.
--   5. Un usuario por su cuenta no puede tomarlo ni soltarlo (solo el servidor).
--   6. La vuelta atrás quita la columna y las dos funciones.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 cerrojo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
\i supabase/migrations/20261114T0757_b01r26_traspaso_cerrojo.sql

create temp table _r (clave text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  t uuid; v_admin uuid; v_err text;
begin
  -- Un mes que no tiene traspaso en A (el de mentira, con estado «traspasando»).
  insert into public.conta_diez_traspaso (account_id, company_id, mes, estado) values (a, emp, '2031-03-01', 'traspasando') returning id into t;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = a and up.role = 'admin' and up.active order by up.user_id limit 1;
  insert into _r values ('t', t), ('admin', v_admin);

  -- 1
  if public.conta_traspaso_tomar_tanda(t, 90) is not true then raise exception 'PRUEBA B01r26 cerrojo 1: libre y no se toma.'; end if;
  if public.conta_traspaso_tomar_tanda(t, 90) is not false then raise exception 'PRUEBA B01r26 cerrojo 1: lo toman dos tandas a la vez.'; end if;
  -- 2
  perform public.conta_traspaso_soltar_tanda(t);
  if (select tanda_hasta from public.conta_diez_traspaso where id = t) is not null then raise exception 'PRUEBA B01r26 cerrojo 2: soltado y sigue puesto.'; end if;
  if public.conta_traspaso_tomar_tanda(t, 90) is not true then raise exception 'PRUEBA B01r26 cerrojo 2: soltado y no se puede tomar.'; end if;
  -- 3
  update public.conta_diez_traspaso set tanda_hasta = now() - interval '1 second' where id = t;
  if public.conta_traspaso_tomar_tanda(t, 90) is not true then raise exception 'PRUEBA B01r26 cerrojo 3: caducado y no se puede tomar.'; end if;
  -- 4
  begin perform public.conta_traspaso_tomar_tanda(t, 5); v_err := null; exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA B01r26 cerrojo 4: con 5 segundos no para.'; end if;
  begin perform public.conta_traspaso_tomar_tanda(t, 601); v_err := null; exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA B01r26 cerrojo 4: con 601 segundos no para.'; end if;
end $$;

-- 5 · como usuario (administrador de A): sin permiso.
select set_config('request.jwt.claims', json_build_object('sub', (select id from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_err text;
begin
  begin perform public.conta_traspaso_tomar_tanda((select id from _r where clave = 't'), 90); v_err := null; exception when insufficient_privilege then v_err := 'sin permiso'; end;
  if v_err is null then raise exception 'PRUEBA B01r26 cerrojo 5: un usuario toma el cerrojo.'; end if;
  begin perform public.conta_traspaso_soltar_tanda((select id from _r where clave = 't')); v_err := null; exception when insufficient_privilege then v_err := 'sin permiso'; end;
  if v_err is null then raise exception 'PRUEBA B01r26 cerrojo 5: un usuario suelta el cerrojo.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · la vuelta atrás, con el cerrojo puesto.
\i supabase/vuelta-atras/20261114T0757_b01r26_traspaso_cerrojo.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_traspaso' and column_name = 'tanda_hasta')
     or to_regprocedure('public.conta_traspaso_tomar_tanda(uuid, integer)') is not null
     or to_regprocedure('public.conta_traspaso_soltar_tanda(uuid)') is not null then
    raise exception 'PRUEBA B01r26 cerrojo 6: la vuelta atrás no lo quita todo.';
  end if;
end $$;

select 'PRUEBA B01r26 cerrojo de la tanda: en verde' as resultado;
rollback;
