-- supabase/staging/sql/20261113_b01r26_liberar_octubre_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · liberar octubre (1745). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con un envío de mentira:
--   1. Sin Foodint, la migración no hace nada (los envíos de la cuenta A, igual).
--   2. El mecanismo que usa: un asiento con su envío «enviado» NO va en el
--      traspaso (_conta_traspaso_va = false) y no admite otro envío; el mismo
--      envío en «rechazado» deja que vaya (true) y que la cola le cree uno nuevo
--      (external_send_entry_uq y external_send_ext_uq excluyen lo rechazado),
--      con la misma referencia de Diez.
-- Lo de las anulaciones (con el original «rechazado», no viaja ninguno de los
-- dos) lo mide el ensayo de producción con los datos reales (cuenta 5).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table prueba_antes on commit drop as
  select (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a') envios,
         (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a' and status = 'rechazado') rechazados;
\i supabase/migrations/20261113T1745_b01r26_liberar_octubre.sql

create temp table _r (clave text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- 1. Sin Foodint, nada.
do $$ begin
  if (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a') <> (select envios from prueba_antes)
     or (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a' and status = 'rechazado') <> (select rechazados from prueba_antes) then
    raise exception 'PRUEBA B01r26 1: sin Foodint la migración ha tocado envíos de la cuenta A.';
  end if;
end $$;

-- 2. Un asiento a mano de la cuenta A (el dueño lo escribe en borrador, como la S02)…
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c1 uuid; c2 uuid; v_y uuid; e uuid;
begin
  select id into c1 from public.company_account where company_id = emp and account_id = a and code like '572%' and status <> 'cerrada' order by code limit 1;
  select id into c2 from public.company_account where company_id = emp and account_id = a and code like '6%' and status <> 'cerrada' order by code limit 1;
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  if c1 is null or c2 is null or v_y is null then raise exception 'PRUEBA B01r26 · siembra: A no tiene una 572, una 6 o el ejercicio 2026.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-15', 'Prueba B01r26 · a mano', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, c2, 3.21, 0, loc), (a, emp, e, 2, c1, 0, 3.21, loc);
  insert into _r values ('e', e);
end $$;

-- … y lo valida el usuario de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.journal_entry_validar((select id from _r where clave = 'e'));
reset role;
select set_config('request.jwt.claims', '', true);

-- El mecanismo de la 1745, sobre un envío de mentira de ese asiento.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  e uuid := (select id from _r where clave = 'e'); v_s uuid;
begin
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA B01r26 2: el asiento de la prueba no ha quedado validado.'; end if;
  if not public._conta_traspaso_va(e) then raise exception 'PRUEBA B01r26 2: un asiento validado sin envío no va en el traspaso.'; end if;

  insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status, ext_year, ext_series, ext_number)
  values (a, emp, e, 'asiento', 'prueba-b01r26', 'enviado', '2026', '4', 990001) returning id into v_s;
  if public._conta_traspaso_va(e) then raise exception 'PRUEBA B01r26 2: con su envío «enviado», el asiento sigue yendo en el traspaso.'; end if;
  begin
    insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status)
    values (a, emp, e, 'asiento', 'prueba-b01r26-otro', 'pendiente');
    raise exception 'PRUEBA B01r26 2: con un envío «enviado», se ha podido crear otro del mismo asiento.';
  exception when unique_violation then null;
  end;

  -- Lo que hace la 1745 con cada envío.
  update public.external_send set status = 'rechazado', next_try_at = null, updated_at = now(),
         last_error = 'Borrado en Diez (C0008) por Julio; PRUEBA' where id = v_s;
  if not public._conta_traspaso_va(e) then raise exception 'PRUEBA B01r26 2: con el envío «rechazado», el asiento no vuelve al traspaso.'; end if;
  -- Y la cola o el traspaso pueden crearle otro, con la misma referencia de Diez.
  insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status, ext_year, ext_series, ext_number)
  values (a, emp, e, 'asiento', 'prueba-b01r26-nuevo', 'enviado', '2026', '4', 990001);
end $$;

select 'PRUEBA B01r26 liberar octubre: en verde' as resultado;
rollback;
