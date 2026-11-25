-- supabase/staging/sql/20261125_x33b_un_cobro_por_factura_prueba.sql
--
-- SOLO STAGING. Prueba del X33b (20261125T1320): una factura con cobro nunca lleva dos asientos de cobro. Todo en una
-- transacción con ROLLBACK. Nombra los objetos que cambian: public._conta_gc_asientos_plan,
-- public.conta_gc_asientos_preparar y public.conta_gc_asientos_del_mes.
--
-- En la gestoría del núcleo (semilla K02), con su usuario, todo inventado (T11), noviembre de 2026:
--   1. Cliente Uno: su factura de noviembre emitida en Sumied (y otra de octubre por lo mismo, traída de ERP10), sin
--      cobro. Preparar: un asiento de cobro (57200002 / 43000101, «2026/1/2745-…») y el cobro apuntado en la factura de
--      NOVIEMBRE con ese asiento; la de octubre, sin tocar.
--   2. Cliente Dos: su factura de noviembre ya cobrada en Sumied, con su asiento (el camino del G05 al emitir).
--      Preparar: ningún asiento nuevo; la fila señala el asiento que ya tiene y lo dice en su nota.
--   3. Otra vez: nada nuevo, y cada factura con un solo cobro.
--   4. La vuelta atrás: las funciones de antes y sin las columnas nuevas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X33b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_gc_factura_de_cobro(uuid,uuid,numeric,date)') is null then
    raise exception 'PRUEBA X33b · 0: falta la 20261125T1320.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v_y uuid;
  v_gasto uuid; v_caja uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-04' between starts_on and ends_on;
  if v_y is null then raise exception 'PRUEBA X33b: la empresa del núcleo no tiene ejercicio 2026 (semilla K02).'; end if;
  insert into public.party (id, account_id, name) values
    ('c0f33b00-0000-4000-8000-0000000000b1', a, 'Cliente de Prueba X33b Uno, S.L.'),
    ('c0f33b00-0000-4000-8000-0000000000b2', a, 'Cliente de Prueba X33b Dos, S.L.');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values
    (emp, 'CU0X33BA', a, 'Cliente de Prueba X33b Uno, S.L.', 'c0f33b00-0000-4000-8000-0000000000b1'),
    (emp, 'CU0X33BB', a, 'Cliente de Prueba X33b Dos, S.L.', 'c0f33b00-0000-4000-8000-0000000000b2');
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values
    (emp, 'MD0X33BA', a, 'CU0X33BA'), (emp, 'MD0X33BB', a, 'CU0X33BB');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, forma_cobro) values
    (emp, 'c0f33b00-0000-4000-8000-0000000000b1', a, 101, 'gocardless'),
    (emp, 'c0f33b00-0000-4000-8000-0000000000b2', a, 102, 'gocardless');
  insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text,
                                       issue_date, party_id, base, tax, total) values
    ('c0f33b00-0000-4000-8000-0000000000c0', a, emp, 'emitida', 'factura', 'traida', 'X33B', 2026, 2700, '2026/1/2700', '2026-10-04',
     'c0f33b00-0000-4000-8000-0000000000b1', 50, 10.5, 60.5),
    ('c0f33b00-0000-4000-8000-0000000000c1', a, emp, 'emitida', 'factura', 'automatica', 'X33B', 2026, 2745, '2026/1/2745', '2026-11-04',
     'c0f33b00-0000-4000-8000-0000000000b1', 50, 10.5, 60.5),
    ('c0f33b00-0000-4000-8000-0000000000c2', a, emp, 'emitida', 'factura', 'automatica', 'X33B', 2026, 2746, '2026/1/2746', '2026-11-04',
     'c0f33b00-0000-4000-8000-0000000000b2', 60, 12.6, 72.6);
  -- El cobro de la Dos ya apuntado en Sumied, con su asiento (como lo deja el G05 al emitir).
  select id into v_gasto from public.company_account where company_id = emp and code like '6%' order by code limit 1;
  select id into v_caja from public.company_account where company_id = emp and code like '57%' order by code limit 1;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason)
  values ('c0f33b00-0000-4000-8000-0000000000e9', a, emp, v_y, 4, '2026-11-04', 'Cobro ya apuntado X33b', 'customer_invoice', 'propuesto', 'seguro', 'Prueba X33b');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept) values
    (a, emp, 'c0f33b00-0000-4000-8000-0000000000e9', 1, v_caja, 72.6, 0, 'X33b'), (a, emp, 'c0f33b00-0000-4000-8000-0000000000e9', 2, v_gasto, 0, 72.6, 'X33b');
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by_name, entry_id)
  values (a, emp, 'c0f33b00-0000-4000-8000-0000000000c2', '2026-11-04', 72.6, 'GoCardless', 'G05', 'prueba X33b', 'c0f33b00-0000-4000-8000-0000000000e9');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values
    (emp, 'PM0X33BA', a, 'MD0X33BA', 'paid_out', '2026-11-04', 60.5),
    (emp, 'PM0X33BB', a, 'MD0X33BB', 'paid_out', '2026-11-04', 72.6);
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v jsonb; r record; n int;
begin
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33b');
  if (v->>'preparados')::int <> 1 or (v->>'ya_estaban')::int <> 1 or (v->>'pendientes')::int <> 0 then
    raise exception 'PRUEBA X33b · 1: tenía que ser 1 preparado (la Uno) y 1 que ya estaba (la Dos, cobrada): %', v;
  end if;
  -- 1 · La Uno: su asiento de cobro y el cobro apuntado en la factura de noviembre, con ese asiento.
  select g.entry_id, g.factura_id, e.concept, e.status,
         (select string_agg(ca.code || ':' || l.debit || '/' || l.credit, ' ' order by l.position) from public.journal_line l
            join public.company_account ca on ca.id = l.company_account_id where l.entry_id = g.entry_id) as lineas
    into r from public.conta_gc_asiento g join public.journal_entry e on e.id = g.entry_id where g.company_id = emp and g.gc_id = 'PM0X33BA';
  if r.factura_id is distinct from 'c0f33b00-0000-4000-8000-0000000000c1'::uuid or r.concept <> '2026/1/2745-Cliente de Prueba X33b Uno, S.L.'
     or r.lineas <> '57200002:60.50/0.00 43000101:0.00/60.50' or r.status <> 'propuesto' then
    raise exception 'PRUEBA X33b · 1: el cobro de la Uno no es el esperado: % · % · % · %', r.factura_id, r.concept, r.lineas, r.status;
  end if;
  if not exists (select 1 from public.customer_invoice_payment p where p.invoice_id = 'c0f33b00-0000-4000-8000-0000000000c1' and p.amount = 60.5 and p.entry_id = r.entry_id) then
    raise exception 'PRUEBA X33b · 1: el cobro no quedó apuntado en la factura 2026/1/2745 con su asiento.';
  end if;
  if exists (select 1 from public.customer_invoice_payment p where p.invoice_id = 'c0f33b00-0000-4000-8000-0000000000c0') then
    raise exception 'PRUEBA X33b · 1: la factura de octubre no se cobra con el cobro de noviembre.';
  end if;
  raise notice 'PRUEBA X33b · 1: la Uno, un asiento de cobro (57200002 / 43000101) y su cobro apuntado en la 2026/1/2745.';
  -- 2 · La Dos: ya cobrada; ningún asiento nuevo, y la fila señala el que ya tiene.
  select g.entry_id, g.nota into r from public.conta_gc_asiento g where g.company_id = emp and g.gc_id = 'PM0X33BB';
  if r.entry_id is distinct from 'c0f33b00-0000-4000-8000-0000000000e9'::uuid or r.nota not like 'La factura 2026/1/2746 ya está cobrada en Sumied%' then
    raise exception 'PRUEBA X33b · 2: la Dos tenía que señalar su asiento de cobro y decirlo: % · %', r.entry_id, r.nota;
  end if;
  raise notice 'PRUEBA X33b · 2: la Dos, ya cobrada: ningún asiento nuevo (%).', r.nota;
  -- 3 · Otra vez: nada nuevo; cada factura con un solo cobro.
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33b');
  if (v->>'preparados')::int <> 0 or (v->>'ya_estaban')::int <> 2 then raise exception 'PRUEBA X33b · 3: la segunda vez, nada nuevo: %', v; end if;
  select max(c) into n from (select count(*) c from public.customer_invoice_payment p
                              where p.invoice_id in ('c0f33b00-0000-4000-8000-0000000000c1', 'c0f33b00-0000-4000-8000-0000000000c2') group by p.invoice_id) z;
  if n <> 1 then raise exception 'PRUEBA X33b · 3: una factura con dos cobros.'; end if;
  if (select count(*) from public.journal_entry e where e.company_id = emp and e.source_type in ('customer_payment', 'customer_invoice') and e.series = 4
        and e.status in ('propuesto', 'borrador', 'validado') and e.concept like '%X33b%') <> 2 then
    raise exception 'PRUEBA X33b · 3: tenía que haber dos asientos de cobro, uno por factura.';
  end if;
  if public.conta_gc_asientos_del_mes(emp, '2026-11-01')::text not like '%ya está cobrada en Sumied%' then
    raise exception 'PRUEBA X33b · 3: el mes tiene que enseñar la nota.';
  end if;
  raise notice 'PRUEBA X33b · 3: la segunda vez, nada nuevo; cada factura con un solo cobro y un solo asiento de cobro.';
end $$;

reset role;
\i supabase/vuelta-atras/20261125T1320_x33b_un_cobro_por_factura.down.sql
do $$ begin
  if to_regprocedure('public._conta_gc_factura_de_cobro(uuid,uuid,numeric,date)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'conta_gc_asiento' and column_name in ('nota', 'factura_id'))
     or strpos(pg_get_functiondef('public._conta_gc_asientos_plan(uuid,date)'::regprocedure), '_conta_gc_factura_de_cobro') > 0 then
    raise exception 'PRUEBA X33b · 4: la vuelta atrás tiene que dejar las funciones de antes y quitar lo nuevo.';
  end if;
  raise notice 'PRUEBA X33b · 4: vuelta atrás: las funciones de antes, sin la función ni las columnas nuevas.';
end $$;

rollback;
