-- supabase/staging/sql/20261113_s01p_recibida_fecha_prueba.sql
--
-- SOLO STAGING. Prueba de la 0913 (S01p·18.2: la fecha con la que se apunta una
-- factura recibida, para que la pantalla la enseñe y la proponga igual que la
-- base). Todo en una transacción con ROLLBACK, en la cuenta A. Nombra lo que
-- toca, para el analizador: conta_recibida_fecha, _conta_recibida_no_antes_de_entrar,
-- conta_primer_dia_iva_abierto, tax_return, fiscal_period_lock.
--
--   1. Una factura del 31/10, con el 4T sin presentar: el 31/10, sin aviso.
--   2. Un mes cerrado por una persona (agosto, «manual»): su fecha (no frena).
--   3. El 2T con el 303 presentado: el primer día abierto, con el aviso
--      «… ya está presentado …»; y es lo mismo que propone la base
--      (_conta_recibida_no_antes_de_entrar), con la misma fecha.
--   4. Sin ejercicio para esa fecha: sin fecha, y lo dice.
--   5. Quien no es de la cuenta, no; sin fecha, no.
--   6. La vuelta atrás: la función, fuera.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18.2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '60s';

select to_regprocedure('public.conta_recibida_fecha(uuid,date)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T0913_s01p_recibida_fecha.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;

-- La siembra: el ejercicio 2026 de A (si no lo tiene), agosto cerrado a mano y el 303 del 2T presentado.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid := (select v::uuid from _p where clave = 'empresa'); y uuid;
begin
  if c is null then raise exception 'PRUEBA S01p·18.2 · siembra: la cuenta A no tiene empresa.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-05-10' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, 'P182-2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  update public.fiscal_year set status = 'open' where id = y and status <> 'open';
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = '2026-08-01' and reopened_at is null) then
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name) values (a, c, y, '2026-08-01', 'manual', 'PRUEBA S01p·18.2');
  end if;
  delete from public.tax_return where company_id = c and form_code = '303' and fiscal_year = 2026 and period = '4T' and status <> 'draft';
  if public.conta_iva_presentado(c, '2026-05-10') is null then
    insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
    values (a, c, '303', 2026, 'quarterly', '2T', '2026-07-20', 'filed', 'zero', 0, '2026-07-15 10:00+02', 'outside', 'PRUEBAS01P182');
  end if;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare c uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; b jsonb;
begin
  -- 1. La del 31/10, con el 4T sin presentar: su fecha.
  r := public.conta_recibida_fecha(c, '2026-10-31');
  if r->>'fecha' <> '2026-10-31' or r->>'aviso' is not null then raise exception 'PRUEBA S01p·18.2 · 1: la del 31/10 sale %.', r; end if;
  raise notice '1 · la del 31/10: el %, sin aviso', r->>'fecha';
  -- 2. Agosto, cerrado por una persona: su fecha.
  r := public.conta_recibida_fecha(c, '2026-08-10');
  if r->>'fecha' <> '2026-08-10' then raise exception 'PRUEBA S01p·18.2 · 2: el mes cerrado a mano la mueve: %.', r; end if;
  raise notice '2 · agosto cerrado a mano: el %', r->>'fecha';
  -- 3. El 2T presentado: el primer día abierto, con su aviso; igual que al proponer.
  r := public.conta_recibida_fecha(c, '2026-05-10');
  if (r->>'fecha')::date < date '2026-07-01' or coalesce(r->>'aviso', '') !~ 'ya está presentado' then
    raise exception 'PRUEBA S01p·18.2 · 3: el 2T presentado sale %.', r;
  end if;
  raise notice '3 · el 2T presentado: el %, «%»', r->>'fecha', r->>'aviso';
end $$;
reset role;
do $$
declare c uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; b jsonb;
begin
  r := public.conta_recibida_fecha(c, '2026-05-10');
  b := public._conta_recibida_no_antes_de_entrar(c, jsonb_build_object('source_type', 'supplier_invoice', 'fecha', '2026-05-10'));
  if r->>'fecha' <> b->>'fecha' or r->>'aviso' is distinct from b->>'aviso' then
    raise exception 'PRUEBA S01p·18.2 · 3: la pantalla (%) y la base al proponer (%) no dicen lo mismo.', r, b;
  end if;
  raise notice '3 · la pantalla y la base al proponer, lo mismo: el %', r->>'fecha';
  -- 4. Sin ejercicio para esa fecha (2031): sin fecha, y lo dice.
  r := public.conta_recibida_fecha(c, '2031-03-01');
  if r->>'fecha' is not null or coalesce(r->>'aviso', '') !~ 'No hay ningún día abierto' then raise exception 'PRUEBA S01p·18.2 · 4: sin ejercicio sale %.', r; end if;
  raise notice '4 · sin ejercicio: «%»', r->>'aviso';
end $$;

-- 5. Quien no es de la cuenta, no; sin fecha, no.
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_recibida_fecha((select v::uuid from _p where clave = 'empresa'), '2026-10-31');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01p·18.2 · 5: alguien sin cuenta lo lee.'; end if;
  raise notice '5 · sin cuenta, no («%»)', v_err;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin perform public.conta_recibida_fecha((select v::uuid from _p where clave = 'empresa'), null); raise exception 'PRUEBA S01p·18.2 · 5: acepta una fecha vacía.';
  exception when sqlstate '22023' then null; end;
  raise notice '5 · sin fecha, no';
end $$;
reset role;

-- 6. La vuelta atrás.
\i supabase/vuelta-atras/20261113T0913_s01p_recibida_fecha.down.sql
do $$ begin
  if to_regprocedure('public.conta_recibida_fecha(uuid,date)') is not null then raise exception 'PRUEBA S01p·18.2 · 6: la vuelta atrás la deja.'; end if;
  raise notice '6 · la vuelta atrás: fuera conta_recibida_fecha';
end $$;
\i supabase/migrations/20261113T0913_s01p_recibida_fecha.sql

rollback;
