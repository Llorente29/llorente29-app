-- supabase/staging/sql/20261125_x33_qbo_a_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X33 (20261125T1205, 1206 y 1207). Todo en una transacción con ROLLBACK: staging no cambia.
-- Nombra los objetos que cambian: public.conta_erp10_por_salir, public.conta_erp10_cola y public.conta_erp10_atascados.
--
-- En la gestoría del núcleo (semilla K02), con su usuario, todo inventado (T11):
--   1. El freno, por sus caminos (regla 10): un asiento a mano y los de una factura recibida y una emitida (atados a
--      ellas como los ata Sumied), propuestos y VALIDADOS con journal_entry_validar; con el ajuste apagado salen los
--      tres en conta_erp10_por_salir; encendido (con conta_erp10_facturas_fuera_poner, que apunta quién y cuándo), sale
--      solo el asiento a mano, y el mes cuenta las dos frenadas. La cola y lo atascado llevan la misma condición.
--   2. Los asientos de GoCardless de noviembre: un cobro con su cliente, su 430 y su factura (se prepara: 57200002 /
--      43000101, «2026/1/0001-nombre»); uno retrocedido (su cobro se prepara; su devolución, a «Pendiente de revisar»
--      hasta saber su día); uno sin 430 y uno sin cliente (a «Pendiente de revisar», con su motivo); uno fallido (nada);
--      y la liquidación (se prepara: 57200000 / 57200002). Prepararlo otra vez no escribe nada (nada dos veces).
--   3. La vuelta atrás de las tres, al revés: la salida vuelve a sacar la recibida, y las tablas nuevas ya no están.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X33: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_erp10_por_salir(uuid,date)'::regprocedure), '_conta_erp10_factura_frenada') = 0 then
    raise exception 'PRUEBA X33 · 0: falta la 20261125T1206 (conta_erp10_por_salir sin el freno).';
  end if;
  if to_regprocedure('public.conta_gc_asientos_preparar(uuid,date,text)') is null then
    raise exception 'PRUEBA X33 · 0: falta la 20261125T1207 (conta_gc_asientos_preparar).';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── Los datos (inventados) ─────────────────────────────────────────────────────────────────────────────────────────
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v_y uuid;
  v_gasto uuid; v_caja uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-10' between starts_on and ends_on;
  if v_y is null then raise exception 'PRUEBA X33: la empresa del núcleo no tiene ejercicio 2026 (semilla K02).'; end if;
  select id into v_gasto from public.company_account where company_id = emp and code like '6%' order by code limit 1;
  select id into v_caja from public.company_account where company_id = emp and code like '57%' order by code limit 1;
  if v_gasto is null or v_caja is null then raise exception 'PRUEBA X33: la empresa del núcleo no tiene una 6 y una 57 en su plan.'; end if;
  insert into public.conta_erp10_salida_empresa (company_id, account_id, encendida, codigo_erp10, largo_subcuenta, desde)
  values (emp, a, true, '9', 8, '2026-11-01')
  on conflict (company_id) do update set encendida = true, desde = '2026-11-01';
  -- Un asiento a mano y el de una recibida, propuestos con sus líneas.
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason)
  values ('c0f33000-0000-4000-8000-0000000000e1', a, emp, v_y, 1, '2026-11-10', 'X33 a mano', 'manual', null, 'propuesto', 'seguro', 'Prueba X33'),
         ('c0f33000-0000-4000-8000-0000000000e2', a, emp, v_y, 1, '2026-11-10', 'X33 de una recibida', 'manual', null, 'propuesto', 'seguro', 'Prueba X33'),
         ('c0f33000-0000-4000-8000-0000000000e3', a, emp, v_y, 1, '2026-11-10', 'X33 de una emitida', 'manual', null, 'propuesto', 'seguro', 'Prueba X33');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept)
  values (a, emp, 'c0f33000-0000-4000-8000-0000000000e1', 1, v_gasto, 10, 0, 'X33'), (a, emp, 'c0f33000-0000-4000-8000-0000000000e1', 2, v_caja, 0, 10, 'X33'),
         (a, emp, 'c0f33000-0000-4000-8000-0000000000e2', 1, v_gasto, 20, 0, 'X33'), (a, emp, 'c0f33000-0000-4000-8000-0000000000e2', 2, v_caja, 0, 20, 'X33'),
         (a, emp, 'c0f33000-0000-4000-8000-0000000000e3', 1, v_gasto, 30, 0, 'X33'), (a, emp, 'c0f33000-0000-4000-8000-0000000000e3', 2, v_caja, 0, 30, 'X33');
  -- Atados a su factura (lo que mira el freno): la recibida por journal_entry_id y la emitida por entry_id.
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f33000-0000-4000-8000-0000000000a1', a, 'Proveedor de Prueba X33, S.L.', 'B00033033', 'ES', 'general');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, journal_entry_id)
  values ('c0f33000-0000-4000-8000-0000000000f1', a, emp, 'c0f33000-0000-4000-8000-0000000000a1', 'invoice', 'X33-1', date '2026-11-10',
          'en_revision', 'ocr', 20, 0, 20, false, 'prueba X33', 'c0f33000-0000-4000-8000-0000000000e2');

  -- GoCardless: tres clientes (uno con su 430 y su factura, uno sin 430, y un cobro sin cliente de Sumied).
  insert into public.party (id, account_id, name) values
    ('c0f33000-0000-4000-8000-0000000000b1', a, 'Cliente de Prueba X33 Uno, S.L.'),
    ('c0f33000-0000-4000-8000-0000000000b2', a, 'Cliente de Prueba X33 Dos, S.L.');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values
    (emp, 'CU00X33A', a, 'Cliente de Prueba X33 Uno, S.L.', 'c0f33000-0000-4000-8000-0000000000b1'),
    (emp, 'CU00X33B', a, 'Cliente de Prueba X33 Dos, S.L.', 'c0f33000-0000-4000-8000-0000000000b2'),
    (emp, 'CU00X33C', a, 'Cliente de Prueba X33 Tres', null);
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values
    (emp, 'MD00X33A', a, 'CU00X33A'), (emp, 'MD00X33B', a, 'CU00X33B'), (emp, 'MD00X33C', a, 'CU00X33C');
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, forma_cobro) values
    (emp, 'c0f33000-0000-4000-8000-0000000000b1', a, 101, 'gocardless'),
    (emp, 'c0f33000-0000-4000-8000-0000000000b2', a, null, 'gocardless');
  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text,
                                       issue_date, party_id, base, tax, total)
  values (a, emp, 'emitida', 'factura', 'traida', 'X33', 2026, 1, '2026/1/0001', '2026-11-01', 'c0f33000-0000-4000-8000-0000000000b1', 50, 10.5, 60.5);
  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text,
                                       issue_date, party_id, base, tax, total, entry_id)
  values (a, emp, 'emitida', 'factura', 'a_mano', 'X33', 2026, 2, '2026/1/0002', '2026-11-10', 'c0f33000-0000-4000-8000-0000000000b2', 25, 5, 30,
          'c0f33000-0000-4000-8000-0000000000e3');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe, payout_gc_id) values
    (emp, 'PM00X33A', a, 'MD00X33A', 'paid_out', '2026-11-04', 60.5, 'PO00X33A'),
    (emp, 'PM00X33B', a, 'MD00X33B', 'paid_out', '2026-11-04', 72.6, 'PO00X33A'),
    (emp, 'PM00X33C', a, 'MD00X33C', 'paid_out', '2026-11-04', 30.25, 'PO00X33A'),
    (emp, 'PM00X33D', a, 'MD00X33A', 'charged_back', '2026-11-04', 60.5, null),
    (emp, 'PM00X33E', a, 'MD00X33A', 'failed', '2026-11-04', 60.5, null);
  insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, referencia) values
    (emp, 'PO00X33A', a, 'paid', '2026-11-06', 158.95, 4.4, 'X33-LIQ-1');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · El freno ───────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v jsonb; t text;
begin
  perform public.journal_entry_validar('c0f33000-0000-4000-8000-0000000000e1', 'prueba X33');
  perform public.journal_entry_validar('c0f33000-0000-4000-8000-0000000000e2', 'prueba X33');
  perform public.journal_entry_validar('c0f33000-0000-4000-8000-0000000000e3', 'prueba X33');
  t := public.conta_erp10_por_salir(emp, '2026-11-01')::text;
  if strpos(t, 'c0f33000-0000-4000-8000-0000000000e1') = 0 or strpos(t, 'c0f33000-0000-4000-8000-0000000000e2') = 0
     or strpos(t, 'c0f33000-0000-4000-8000-0000000000e3') = 0 then
    raise exception 'PRUEBA X33 · 1a: con el ajuste apagado tienen que salir los tres (el asiento a mano, la recibida y la emitida).';
  end if;
  raise notice 'PRUEBA X33 · 1a: apagado, salen el asiento a mano, la recibida y la emitida.';
  v := public.conta_erp10_facturas_fuera_poner(emp, true, 'Persona de Prueba X33');
  if not (v->>'encendido')::boolean or v->>'cambiado_por_nombre' is distinct from 'Persona de Prueba X33' or v->>'cambiado_en' is null then
    raise exception 'PRUEBA X33 · 1b: encenderlo tiene que apuntar quién y cuándo: %', v;
  end if;
  t := public.conta_erp10_por_salir(emp, '2026-11-01')::text;
  if strpos(t, 'c0f33000-0000-4000-8000-0000000000e1') = 0 then raise exception 'PRUEBA X33 · 1b: el asiento a mano tiene que seguir saliendo.'; end if;
  if strpos(t, 'c0f33000-0000-4000-8000-0000000000e2') > 0 or strpos(t, 'c0f33000-0000-4000-8000-0000000000e3') > 0 then
    raise exception 'PRUEBA X33 · 1b: ni la recibida ni la emitida pueden salir con el ajuste encendido.';
  end if;
  v := public.conta_erp10_facturas_fuera_del_mes(emp, '2026-11-01');
  if (v->>'recibidas')::int <> 1 or (v->>'emitidas')::int <> 1 then raise exception 'PRUEBA X33 · 1c: el mes tiene que contar 1 recibida y 1 emitida frenadas: %', v; end if;
  if not public._conta_erp10_factura_frenada(emp, 'c0f33000-0000-4000-8000-0000000000e2')
     or public._conta_erp10_factura_frenada(emp, 'c0f33000-0000-4000-8000-0000000000e1') then
    raise exception 'PRUEBA X33 · 1d: la condición de la cola y de lo atascado no distingue la recibida del asiento a mano.';
  end if;
  raise notice 'PRUEBA X33 · 1: encendido (con quién y cuándo), sale el asiento a mano y no las facturas; el mes cuenta 1 recibida y 1 emitida frenadas.';
  v := public.conta_erp10_facturas_fuera_poner(emp, false, 'Persona de Prueba X33');
  if strpos(public.conta_erp10_por_salir(emp, '2026-11-01')::text, 'c0f33000-0000-4000-8000-0000000000e2') = 0 then
    raise exception 'PRUEBA X33 · 1e: apagado otra vez, la recibida vuelve a salir.';
  end if;
  perform public.conta_erp10_facturas_fuera_poner(emp, true, 'Persona de Prueba X33');
end $$;

-- ── 2 · Los asientos de GoCardless de noviembre ────────────────────────────────────────────────────────────────────
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v jsonb; n int; r record;
begin
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33');
  -- Preparados: el cobro con su 430 y su factura, el cobro que después se retrocedió (se cobró: su asiento va) y el
  -- ingreso. Pendientes: el cobro sin 430, el cobro sin cliente y la devolución (sin su día). El fallido, nada.
  if (v->>'preparados')::int <> 3 or (v->>'pendientes')::int <> 3 or (v->>'ya_estaban')::int <> 0 then
    raise exception 'PRUEBA X33 · 2a: tenían que ser 3 preparados y 3 pendientes: %', v;
  end if;
  -- El cobro: 57200002 al debe y la 430 del cliente al haber, por el importe, con su concepto.
  select e.status, e.entry_date, e.concept,
         string_agg(ca.code || ':' || l.debit || '/' || l.credit, ' ' order by l.position) as lineas
    into r
    from public.conta_gc_asiento g join public.journal_entry e on e.id = g.entry_id
    join public.journal_line l on l.entry_id = e.id join public.company_account ca on ca.id = l.company_account_id
   where g.company_id = emp and g.clase = 'cobro' and g.gc_id = 'PM00X33A'
   group by e.status, e.entry_date, e.concept;
  if r.status is distinct from 'propuesto' or r.entry_date <> date '2026-11-04' or r.concept <> '2026/1/0001-Cliente de Prueba X33 Uno, S.L.'
     or r.lineas <> '57200002:60.50/0.00 43000101:0.00/60.50' then
    raise exception 'PRUEBA X33 · 2b: el asiento del cobro no es el del libro mayor de QBO: % · % · % · %', r.status, r.entry_date, r.concept, r.lineas;
  end if;
  select string_agg(ca.code || ':' || l.debit || '/' || l.credit, ' ' order by l.position) into r
    from public.conta_gc_asiento g join public.journal_line l on l.entry_id = g.entry_id join public.company_account ca on ca.id = l.company_account_id
   where g.company_id = emp and g.clase = 'ingreso' and g.gc_id = 'PO00X33A';
  if r.string_agg <> '57200000:158.95/0.00 57200002:0.00/158.95' then raise exception 'PRUEBA X33 · 2c: el ingreso no es 57200000 / 57200002: %', r.string_agg; end if;
  -- Lo que no tiene con qué: a «Pendiente de revisar», con su motivo.
  for r in select clase, gc_id, pendiente from public.conta_gc_asiento where company_id = emp and cardinality(pendiente) > 0 order by gc_id, clase loop
    raise notice 'PRUEBA X33 · 2d: pendiente % %: %', r.clase, r.gc_id, array_to_string(r.pendiente, ' · ');
  end loop;
  if not exists (select 1 from public.conta_gc_asiento where company_id = emp and gc_id = 'PM00X33B' and 'El cliente no tiene su 430' = any(pendiente))
     or not exists (select 1 from public.conta_gc_asiento where company_id = emp and gc_id = 'PM00X33C' and 'El cobro no está atado a ningún cliente de Sumied' = any(pendiente))
     or not exists (select 1 from public.conta_gc_asiento where company_id = emp and gc_id = 'PM00X33D' and clase = 'devolucion' and 'Falta el día de la devolución' = any(pendiente))
     or exists (select 1 from public.conta_gc_asiento where company_id = emp and gc_id = 'PM00X33E') then
    raise exception 'PRUEBA X33 · 2d: los pendientes no son los esperados (sin 430, sin cliente, la devolución; y el fallido, fuera).';
  end if;
  -- Nada dos veces.
  v := public.conta_gc_asientos_preparar(emp, '2026-11-01', 'Persona de Prueba X33');
  select count(*) into n from public.journal_entry e
   where e.company_id = emp and e.source_type = 'customer_payment' and e.status in ('propuesto', 'borrador', 'validado');
  if (v->>'preparados')::int <> 0 or (v->>'ya_estaban')::int <> 3 or n <> 3 then
    raise exception 'PRUEBA X33 · 2e: prepararlo otra vez no puede escribir otro asiento: % (asientos de GoCardless: %)', v, n;
  end if;
  v := public.conta_gc_asientos_del_mes(emp, '2026-11-01');
  if jsonb_array_length(v->'filas') <> 6 or (v->>'por_preparar')::int <> 0 then raise exception 'PRUEBA X33 · 2f: el mes tiene que enseñar las 6 filas: %', v; end if;
  raise notice 'PRUEBA X33 · 2: 3 preparados (dos cobros 57200002 / 43000101 y el ingreso), 3 en «Pendiente de revisar», y la segunda vez ninguno nuevo.';
end $$;

reset role;

-- ── 3 · La vuelta atrás, al revés ─────────────────────────────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261125T1207_x33_asientos_de_gocardless.down.sql
\i supabase/vuelta-atras/20261125T1206_x33_freno_en_la_salida.down.sql
\i supabase/vuelta-atras/20261125T1205_x33_facturas_las_emite_cegid.down.sql
do $$ begin
  if to_regclass('public.conta_gc_asiento') is not null or to_regclass('public.conta_erp10_facturas_fuera') is not null then
    raise exception 'PRUEBA X33 · 3: la vuelta atrás tiene que quitar las dos tablas.';
  end if;
  if strpos(pg_get_functiondef('public.conta_erp10_por_salir(uuid,date)'::regprocedure), '_conta_erp10_factura_frenada') > 0
     or strpos(pg_get_functiondef('public.conta_erp10_cola(integer)'::regprocedure), '_conta_erp10_factura_frenada') > 0
     or strpos(pg_get_functiondef('public.conta_erp10_atascados(uuid)'::regprocedure), '_conta_erp10_factura_frenada') > 0 then
    raise exception 'PRUEBA X33 · 3: la vuelta atrás tiene que dejar las tres funciones de la salida sin el freno.';
  end if;
  if strpos(public.conta_erp10_por_salir('c0e20000-0000-4000-8000-0000000000e2', '2026-11-01')::text, 'c0f33000-0000-4000-8000-0000000000e2') = 0 then
    raise exception 'PRUEBA X33 · 3: sin el freno, la recibida vuelve a salir.';
  end if;
  raise notice 'PRUEBA X33 · 3: vuelta atrás: las funciones de antes, la recibida vuelve a salir y las tablas nuevas no están.';
end $$;

rollback;
