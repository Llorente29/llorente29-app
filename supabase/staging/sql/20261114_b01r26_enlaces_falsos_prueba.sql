-- supabase/staging/sql/20261114_b01r26_enlaces_falsos_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r26 · los enlaces falsos de octubre. Todo en una
-- transacción con ROLLBACK, en la cuenta A, con un envío de mentira:
--   1. Sin Foodint, la migración no hace nada (los envíos de la cuenta A, igual).
--   2. El mecanismo que usa: un asiento con su envío «enlazado» NO va en el
--      traspaso; el mismo envío en «pendiente», sin la referencia de Diez, sí.
-- Que los 275 sean exactamente esos y que ninguno exista en Diez lo miden el
-- ensayo de producción (la guarda de Sumied) y la lectura de la C0008.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r26 enlaces: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

create temp table prueba_antes on commit drop as
  select (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a') envios,
         (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a' and status = 'pendiente') pendientes;
\i supabase/migrations/20261114T2041_b01r26_enlaces_falsos.sql

create temp table _r (clave text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- 1. Sin Foodint, nada.
do $$ begin
  if (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a') <> (select envios from prueba_antes)
     or (select count(*) from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a' and status = 'pendiente') <> (select pendientes from prueba_antes) then
    raise exception 'PRUEBA B01r26 enlaces 1: sin Foodint la migración ha tocado envíos de la cuenta A.';
  end if;
end $$;

-- 2. Un asiento a mano de la cuenta A…
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
  if c1 is null or c2 is null or v_y is null then raise exception 'PRUEBA B01r26 enlaces · siembra: A no tiene una 572, una 6 o el ejercicio 2026.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-15', 'Prueba B01r26 · enlace falso', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e, 1, c2, 3.21, 0, loc), (a, emp, e, 2, c1, 0, 3.21, loc);
  insert into _r values ('e', e);
end $$;

-- … que valida el usuario de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.journal_entry_validar((select id from _r where clave = 'e'));
reset role;
select set_config('request.jwt.claims', '', true);

do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  e uuid := (select id from _r where clave = 'e'); v_s uuid;
begin
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA B01r26 enlaces 2: el asiento no ha quedado validado.'; end if;
  insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status, ext_year, ext_series, ext_number)
  values (a, emp, e, 'asiento', 'prueba-b01r26-enlace', 'enlazado', '2026', '4', 990002) returning id into v_s;
  if public._conta_traspaso_va(e) then raise exception 'PRUEBA B01r26 enlaces 2: con su envío «enlazado», el asiento sigue yendo en el traspaso.'; end if;
  -- Lo que hace la migración con cada envío.
  update public.external_send set status = 'pendiente', next_try_at = null, sent_at = null, updated_at = now(),
         last_error = 'Enlace falso: PRUEBA', ext_year = null, ext_series = null, ext_number = null where id = v_s;
  if not public._conta_traspaso_va(e) then raise exception 'PRUEBA B01r26 enlaces 2: con el envío «pendiente», el asiento no vuelve al traspaso.'; end if;
end $$;

select 'PRUEBA B01r26 enlaces falsos: en verde' as resultado;
rollback;
