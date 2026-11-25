-- supabase/staging/sql/20261125_x33c_varios_cobros_por_factura_prueba.sql
--
-- SOLO STAGING. Prueba del X33c (20261125T1810): una factura por cliente y mes, con todos sus cobros del mes. Todo en
-- una transacción con ROLLBACK. Nombra el objeto que cambia: public.conta_gc_asientos_preparar.
--
-- En la gestoría del núcleo (semilla K02), con su usuario, todo inventado (T11), noviembre de 2026:
--   1. Cliente Uno: su factura de noviembre (de Cegid, leída por Sumied: traída), de 181,50 €, atada a sus TRES cobros de
--      60,50 € (conta_gc_cobro_factura, ya sin el UNIQUE de la factura). Preparar: tres asientos de cobro, uno por cobro
--      (57200002 / 43000101), y los tres apuntados en la factura: cobrada entera cuando los tres llegan a su total.
--      Un cuarto cobro atado a la misma factura pasa de su total: «Pendiente de revisar», sin asiento ni cobro apuntado.
--   2. Cliente Dos: su factura atada a su cobro, que el G05 ya apuntó en ella («Domiciliación SEPA <cobro>») con su
--      asiento. Preparar: ningún asiento nuevo; la fila señala el que tiene.
--   3. Otra vez: nada nuevo.
--   4. La vuelta atrás (sin facturas con más de un cobro, como en producción): la función de antes y otra vez el UNIQUE.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X33c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if exists (select 1 from pg_constraint where conname = 'conta_gc_cobro_factura_invoice_id_key') then
    raise exception 'PRUEBA X33c · 0: falta la 20261125T1810 (conta_gc_cobro_factura sigue con una factura por cobro).';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v_y uuid;
  v_gasto uuid; v_caja uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-04' between starts_on and ends_on;
  if v_y is null then raise exception 'PRUEBA X33c: la empresa del núcleo no tiene ejercicio 2026 (semilla K02).'; end if;
  insert into public.party (id, account_id, name) values
    ('c0f33c00-0000-4000-8000-0000000000b1', a, 'Cliente de Prueba X33c Uno, S.L.'),
    ('c0f33c00-0000-4000-8000-0000000000b2', a, 'Cliente de Prueba X33c Dos, S.L.');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values
    (emp, 'CU0X33CA', a, 'Cliente de Prueba X33c Uno, S.L.', 'c0f33c00-0000-4000-8000-0000000000b1'),
    (emp, 'CU0X33CB', a, 'Cliente de Prueba X33c Dos, S.L.', 'c0f33c00-0000-4000-8000-0000000000b2');
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values
    (emp, 'MD0X33CA', a, 'CU0X33CA'), (emp, 'MD0X33CB', a, 'CU0X33CB');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, forma_cobro) values
    (emp, 'c0f33c00-0000-4000-8000-0000000000b1', a, 111, 'gocardless'),
    (emp, 'c0f33c00-0000-4000-8000-0000000000b2', a, 112, 'gocardless');
  insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text,
                                       issue_date, party_id, base, tax, total) values
    ('c0f33c00-0000-4000-8000-0000000000c1', a, emp, 'emitida', 'factura', 'traida', 'X33C', 2026, 2745, '2026/1/2745', '2026-11-26',
     'c0f33c00-0000-4000-8000-0000000000b1', 150, 31.5, 181.5),
    ('c0f33c00-0000-4000-8000-0000000000c2', a, emp, 'emitida', 'factura', 'traida', 'X33C', 2026, 2746, '2026/1/2746', '2026-11-26',
     'c0f33c00-0000-4000-8000-0000000000b2', 60, 12.6, 72.6);
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values
    (emp, 'PM0X33CA1', a, 'MD0X33CA', 'paid_out', '2026-11-03', 60.5),
    (emp, 'PM0X33CA2', a, 'MD0X33CA', 'paid_out', '2026-11-10', 60.5),
    (emp, 'PM0X33CA3', a, 'MD0X33CA', 'paid_out', '2026-11-17', 60.5),
    (emp, 'PM0X33CA4', a, 'MD0X33CA', 'paid_out', '2026-11-24', 60.5),
    (emp, 'PM0X33CB1', a, 'MD0X33CB', 'paid_out', '2026-11-04', 72.6);
  -- Q ata cada cobro a su factura: los cuatro de la Uno a la 2745 (una factura, varios cobros), el de la Dos a la 2746.
  insert into public.conta_gc_cobro_factura (company_id, account_id, gc_id, invoice_id) values
    (emp, a, 'PM0X33CA1', 'c0f33c00-0000-4000-8000-0000000000c1'), (emp, a, 'PM0X33CA2', 'c0f33c00-0000-4000-8000-0000000000c1'),
    (emp, a, 'PM0X33CA3', 'c0f33c00-0000-4000-8000-0000000000c1'), (emp, a, 'PM0X33CA4', 'c0f33c00-0000-4000-8000-0000000000c1'),
    (emp, a, 'PM0X33CB1', 'c0f33c00-0000-4000-8000-0000000000c2');
  -- El cobro de la Dos, ya apuntado por el G05 en su factura, con su asiento.
  select id into v_gasto from public.company_account where company_id = emp and code like '6%' order by code limit 1;
  select id into v_caja from public.company_account where company_id = emp and code like '57%' order by code limit 1;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason)
  values ('c0f33c00-0000-4000-8000-0000000000e9', a, emp, v_y, 4, '2026-11-04', 'Cobro del G05 X33c', 'customer_invoice', 'propuesto', 'seguro', 'Prueba X33c');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept) values
    (a, emp, 'c0f33c00-0000-4000-8000-0000000000e9', 1, v_caja, 72.6, 0, 'X33c'), (a, emp, 'c0f33c00-0000-4000-8000-0000000000e9', 2, v_gasto, 0, 72.6, 'X33c');
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, created_by_name, entry_id)
  values (a, emp, 'c0f33c00-0000-4000-8000-0000000000c2', '2026-11-04', 72.6, 'GoCardless', 'Domiciliación SEPA PM0X33CB1', 'prueba X33c',
          'c0f33c00-0000-4000-8000-0000000000e9');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v jsonb; r record; n int;
begin
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33c');
  if (v->>'preparados')::int <> 3 or (v->>'ya_estaban')::int <> 1 or (v->>'pendientes')::int <> 1 then
    raise exception 'PRUEBA X33c · 1: tenían que ser 3 preparados (los tres cobros de la Uno), 1 que ya estaba (la Dos) y 1 pendiente (el cuarto): %', v;
  end if;
  -- 1 · Tres asientos, uno por cobro, cada uno 57200002 / 43000101 por 60,50, y los tres apuntados en la factura.
  select count(distinct g.entry_id), count(*) filter (where (select string_agg(ca.code || ':' || l.debit || '/' || l.credit, ' ' order by l.position)
           from public.journal_line l join public.company_account ca on ca.id = l.company_account_id where l.entry_id = g.entry_id)
           = '57200002:60.50/0.00 43000101:0.00/60.50')
    into r from public.conta_gc_asiento g where g.company_id = emp and g.gc_id in ('PM0X33CA1', 'PM0X33CA2', 'PM0X33CA3');
  if r.count <> 3 then raise exception 'PRUEBA X33c · 1: tenía que haber tres asientos distintos, uno por cobro: %', r; end if;
  select count(*), sum(p.amount), count(distinct p.entry_id) into r from public.customer_invoice_payment p where p.invoice_id = 'c0f33c00-0000-4000-8000-0000000000c1';
  if r.count <> 3 or r.sum <> 181.5 or r.count <> 3 then raise exception 'PRUEBA X33c · 1: la 2745 tenía que quedar cobrada entera con sus tres cobros: %', r; end if;
  raise notice 'PRUEBA X33c · 1: la Uno, tres asientos de cobro (uno por cobro) y la 2745 cobrada entera con sus tres cobros (181,50 €).';
  select g.entry_id, g.pendiente into r from public.conta_gc_asiento g where g.company_id = emp and g.gc_id = 'PM0X33CA4';
  if r.entry_id is not null or array_to_string(r.pendiente, ' ') not like '%pasa de su total%' then
    raise exception 'PRUEBA X33c · 1: el cuarto cobro tenía que quedar en «Pendiente de revisar»: % · %', r.entry_id, r.pendiente;
  end if;
  raise notice 'PRUEBA X33c · 1: el cuarto, «Pendiente de revisar» (%).', array_to_string(r.pendiente, ' · ');
  -- 2 · La Dos: ya apuntado por el G05; ningún asiento nuevo.
  select g.entry_id, g.nota into r from public.conta_gc_asiento g where g.company_id = emp and g.gc_id = 'PM0X33CB1';
  if r.entry_id is distinct from 'c0f33c00-0000-4000-8000-0000000000e9'::uuid or r.nota not like 'El cobro ya está apuntado en la factura 2026/1/2746%' then
    raise exception 'PRUEBA X33c · 2: la Dos tenía que señalar el asiento del G05: % · %', r.entry_id, r.nota;
  end if;
  if (select count(*) from public.customer_invoice_payment p where p.invoice_id = 'c0f33c00-0000-4000-8000-0000000000c2') <> 1 then
    raise exception 'PRUEBA X33c · 2: la 2746 tenía que seguir con un solo cobro.';
  end if;
  raise notice 'PRUEBA X33c · 2: la Dos, ya apuntado por el G05: ningún asiento nuevo (%).', r.nota;
  -- 3 · Otra vez: nada nuevo.
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33c');
  if (v->>'preparados')::int <> 0 or (v->>'ya_estaban')::int <> 4 or (v->>'pendientes')::int <> 1 then
    raise exception 'PRUEBA X33c · 3: la segunda vez, nada nuevo: %', v;
  end if;
  select count(*) into n from public.customer_invoice_payment p where p.invoice_id = 'c0f33c00-0000-4000-8000-0000000000c1';
  if n <> 3 then raise exception 'PRUEBA X33c · 3: la 2745 tenía que seguir con tres cobros, no %.', n; end if;
  raise notice 'PRUEBA X33c · 3: la segunda vez, nada nuevo; la 2745 sigue con sus tres cobros y la 2746 con el suyo.';
end $$;

reset role;
-- 4 · La vuelta atrás, como en producción: sin facturas con más de un cobro.
delete from public.conta_gc_cobro_factura where company_id = 'c0e20000-0000-4000-8000-0000000000e2' and gc_id like 'PM0X33C%';
\i supabase/vuelta-atras/20261125T1810_x33c_varios_cobros_por_factura.down.sql
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'conta_gc_cobro_factura_invoice_id_key')
     or strpos(pg_get_functiondef('public.conta_gc_asientos_preparar(uuid,date,text)'::regprocedure), 'Domiciliación SEPA') > 0 then
    raise exception 'PRUEBA X33c · 4: la vuelta atrás tiene que dejar la función de antes y el UNIQUE de la factura.';
  end if;
  raise notice 'PRUEBA X33c · 4: vuelta atrás: la función de antes y otra vez una factura por cobro.';
end $$;

rollback;
