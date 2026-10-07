-- supabase/seeds/conta/seed_c04_staging.sql
--
-- C04 · Libro diario, en staging-conta. SOLO STAGING. Todo inventado; nada
-- copiado de producción. Se puede volver a lanzar: ids fijos, «on conflict do
-- nothing», propuestas idempotentes por origen y los asientos a mano se buscan
-- por su concepto antes de crearlos. Después de las migraciones del C04 y de la
-- semilla del C03 (usa Plataforma Norte, Marcas del Sur y su liquidación).
--
-- Los asientos se hacen como los haría la pantalla: con las funciones de la
-- base (journal_entry_proponer, journal_entry_validar, journal_entry_anular,
-- conta_cerrar_mes) y la sesión del administrador de cada cuenta. Nada se
-- escribe en journal_entry «por debajo».
--
-- Cuenta A (Taberna de Prueba Norte, dos locales, empresa 3b34403a…):
--   1. Un día de ventas (05/10) en los dos locales, con una marca cedida que
--      queda fuera: Norte Centro «Para revisar» (Probable: base calculada,
--      regla 13) y Norte Mercado «Hecho por Folvy» (validado solo).
--   2. La liquidación de Plataforma Norte del 16–30/09 (cobrada el 05/10):
--      comisión con IVA 21 %, cobro y lo de Milanesa Cedida al socio
--      (NRV 16.ª). Para revisar, Seguro.
--   3. Dos facturas de proveedor: Hermanos Ruiz F-2026-0915 (validada) y el
--      alquiler de octubre de Locales del Norte con retención del 19 %
--      (modelo 115), para revisar.
--   4. La nómina de septiembre (validada): 640, 642, 476, 4751 (111) y 465.
--   5. Un préstamo común (cuota de octubre), repartido 60/40 por la regla.
--   6. Un asiento anulado (publicidad repetida) con su contraasiento.
-- Cuenta B (Cocina de Prueba Sur, Canarias, sin Cocina ni plataformas):
--   7. Enero a septiembre cerrados por la gestoría (mes bloqueado), la cuota
--      del préstamo de octubre validada y un borrador del 30/09 que no se
--      puede validar porque su mes está cerrado.

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea    constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  l1    constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  l2    constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  b     constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  eb    constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C04: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regclass('public.journal_entry') is null then raise exception 'Semilla C04: faltan las migraciones del C04.'; end if;
  if not exists (select 1 from public.channel_settlement where id = 'c0300000-0000-4000-8000-000000000103') then
    raise exception 'Semilla C04: falta la semilla del C03 (la liquidación SEED-C03-0916).';
  end if;

  -- La factura del alquiler, con su retención (19 %, modelo 115).
  insert into public.supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total,
                                       withholding_rate_id, withholding_amount, created_by_name)
  values ('c0400000-0000-4000-8000-000000000101', a, 'fec7e903-bd08-49ef-817b-cc24e83bc2fb', l2, 'A-2026-10', '2026-10-01', 'aprobada', 1530.00,
          (select id from public.withholding_rate where code = 'alquiler'), 285.00, 'semilla C04')
  on conflict (id) do nothing;
  -- La nómina de septiembre, como la manda la gestoría.
  insert into public.payroll_summary (id, account_id, company_id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions, net,
                                      employees_count, created_by_name)
  values ('c0400000-0000-4000-8000-000000000201', a, ea, '2026-09-01', l1, 4200.00, 1340.00, 268.80, 420.00, 0, 3511.20, 3, 'semilla C04')
  on conflict (id) do nothing;
  -- Lo común se reparte 60 % Norte Centro y 40 % Norte Mercado.
  if not exists (select 1 from public.allocation_rule where company_id = ea) then
    insert into public.allocation_rule (account_id, company_id, location_id, pct, valid_from)
    values (a, ea, l1, 60, '2026-01-01'), (a, ea, l2, 40, '2026-01-01');
  end if;
end $$;

-- ── Cuenta A, como su administrador ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  ea   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  l1   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  l2   constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  iva10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
  iva21 uuid := (select id from public.tax_rate where code = 'iva_general' and is_system and valid_to is null limit 1);
  r115 uuid := (select id from public.withholding_rate where code = 'alquiler');
  r111 uuid := (select id from public.withholding_rate where code = 'profesional');
  burger constant uuid := 'e0200000-0000-4000-8000-00000000a0b1';
  smash  constant uuid := 'e0200000-0000-4000-8000-00000000a0b3';
  pita   constant uuid := 'e0200000-0000-4000-8000-00000000a0b2';
  milanesa constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';
  r jsonb; v_id uuid;
begin
  -- 1 · Ventas del 05/10, Norte Centro: para revisar (Probable, base calculada).
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 1, 'fecha', '2026-10-05', 'concepto', 'Ventas del día · Norte Centro', 'source_type', 'sales_day',
      'confianza', 'probable', 'porque', '212 tickets de tus marcas; la base sale calculada al 10 % porque los pedidos no la traen.',
      'razones', jsonb_build_array(
        jsonb_build_object('decision', 'Un asiento por día y local', 'porque', 'resumen de 212 facturas simplificadas del día', 'cita', 'RIVA art. 63.4'),
        jsonb_build_object('decision', 'IVA al 10 % en tus ventas', 'porque', 'comida a domicilio = servicio de restauración', 'cita', 'Ley 37/1992 art. 91.Uno.2.2º'),
        jsonb_build_object('decision', 'Milanesa Cedida no va a tus ventas', 'porque', 'sus 38 pedidos (412,30 €) son del socio: entran en su liquidación', 'cita', 'PGC NRV 16.ª'),
        jsonb_build_object('decision', 'Base calculada', 'porque', 'los pedidos de tus marcas llegan sin base ni cuota: la calculo y por eso es Probable'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000001', 'debe', 3214.60, 'local_id', l1, 'concepto', 'cobro por Glovo'),
      jsonb_build_object('cuenta', '70000000', 'haber', 1800.00, 'local_id', l1, 'marca_id', burger),
      jsonb_build_object('cuenta', '70000000', 'haber', 1122.36, 'local_id', l1, 'marca_id', smash),
      jsonb_build_object('cuenta', '47700010', 'haber', 292.24, 'local_id', l1,
        'iva', jsonb_build_object('tipo_id', iva10, 'base', 2922.36, 'libro', 'issued', 'facturas', 212))),
    jsonb_build_object('location_id', l1, 'sales_day', '2026-10-05', 'tickets_count', 212, 'total', 3214.60,
      'detail_hash', 'semilla-c04-norte-centro', 'base_calculated', true), 'Folvy');

  -- 1 · Ventas del 05/10, Norte Mercado: validado por Folvy.
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 1, 'fecha', '2026-10-05', 'concepto', 'Ventas del día · Norte Mercado', 'source_type', 'sales_day',
      'confianza', 'seguro', 'porque', 'los 96 tickets cuadran con lo cobrado por la plataforma, al céntimo.',
      'razones', jsonb_build_array(jsonb_build_object('decision', 'Un asiento por día y local', 'porque', 'resumen de 96 facturas simplificadas', 'cita', 'RIVA art. 63.4'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000001', 'debe', 1100.00, 'local_id', l2),
      jsonb_build_object('cuenta', '70000000', 'haber', 1000.00, 'local_id', l2, 'marca_id', pita),
      jsonb_build_object('cuenta', '47700010', 'haber', 100.00, 'local_id', l2,
        'iva', jsonb_build_object('tipo_id', iva10, 'base', 1000.00, 'libro', 'issued', 'facturas', 96))),
    jsonb_build_object('location_id', l2, 'sales_day', '2026-10-05', 'tickets_count', 96, 'total', 1100.00, 'detail_hash', 'semilla-c04-norte-mercado'), 'Folvy');
  if exists (select 1 from public.journal_entry where id = (r->>'id')::uuid and status = 'propuesto') then
    perform public.journal_entry_validar((r->>'id')::uuid, 'Folvy (validación automática de ventas)');
  end if;

  -- 2 · Liquidación de Plataforma Norte, 16–30/09: para revisar, Seguro.
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 3, 'fecha', '2026-10-05', 'concepto', 'Liquidación Plataforma Norte · 16–30 sep', 'source_type', 'channel_settlement',
      'source_id', 'c0300000-0000-4000-8000-000000000103', 'documento', 'SEED-C03-0916', 'confianza', 'seguro',
      'porque', 'cuadra con el PDF: 9.870 € vendidos, 2.072,60 € de comisión con IVA y 7.797,40 € cobrados.',
      'razones', jsonb_build_array(
        jsonb_build_object('decision', 'Separé las ventas por marca', 'porque', 'de los 9.870 €, 7.535,52 € son de tus marcas y 2.334,48 € de Milanesa Cedida'),
        jsonb_build_object('decision', 'Milanesa Cedida va al socio, no a tus ventas', 'porque', 'lo cobrado de una marca cedida es suyo: entra en su liquidación de octubre', 'cita', 'PGC NRV 16.ª'),
        jsonb_build_object('decision', 'Comisión con IVA 21 % deducible', 'porque', 'la plataforma te factura la comisión como servicio', 'cita', 'Ley 37/1992 art. 90'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62300000', 'debe', 1712.89, 'local_id', l1, 'concepto', 'comisión 21 % sobre ventas'),
      jsonb_build_object('cuenta', '47200021', 'debe', 359.71, 'local_id', l1,
        'iva', jsonb_build_object('tipo_id', iva21, 'base', 1712.89, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '57200001', 'debe', 7797.40, 'local_id', l1, 'concepto', 'cobro del 05/10'),
      jsonb_build_object('cuenta', '43000001', 'haber', 7535.52, 'local_id', l1, 'concepto', 'ventas de tus marcas, ya en los resúmenes del día'),
      jsonb_build_object('cuenta', '40000005', 'haber', 2334.48, 'local_id', l1, 'marca_id', milanesa, 'concepto', 'ventas de Milanesa Cedida: del socio'))
    , null, 'Folvy');

  -- 3 · Factura F-2026-0915 de Hermanos Ruiz: validada.
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 2, 'fecha', '2026-09-24', 'concepto', 'Factura Hermanos Ruiz · F-2026-0915', 'source_type', 'supplier_invoice',
      'source_id', '95cf35ac-3035-4204-9872-70a589dde870', 'documento', 'F-2026-0915', 'confianza', 'seguro',
      'porque', 'mercancía al 10 %, a su cuenta de siempre.',
      'razones', jsonb_build_array(jsonb_build_object('decision', 'Compras de mercaderías', 'porque', 'su tipo de gasto es materia prima'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 1166.50, 'local_id', l1),
      jsonb_build_object('cuenta', '47200010', 'debe', 116.65, 'local_id', l1,
        'iva', jsonb_build_object('tipo_id', iva10, 'base', 1166.50, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '40000002', 'haber', 1283.15, 'local_id', l1)), null, 'Folvy');
  if exists (select 1 from public.journal_entry where id = (r->>'id')::uuid and status = 'propuesto') then
    perform public.journal_entry_validar((r->>'id')::uuid, 'Ana Prueba');
  end if;

  -- 3 · Alquiler de octubre de Norte Mercado, con retención: para revisar.
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 2, 'fecha', '2026-10-01', 'concepto', 'Alquiler Norte Mercado · octubre', 'source_type', 'supplier_invoice',
      'source_id', 'c0400000-0000-4000-8000-000000000101', 'documento', 'A-2026-10', 'confianza', 'seguro',
      'porque', 'alquiler con IVA 21 % y retención del 19 % que ingresas tú en el 115.',
      'razones', jsonb_build_array(
        jsonb_build_object('decision', 'Retención del 19 %', 'porque', 'alquiler de un local de negocio', 'cita', 'RD 439/2007 art. 100'),
        jsonb_build_object('decision', 'IVA 21 % deducible', 'porque', 'arrendamiento de local afecto a la actividad', 'cita', 'Ley 37/1992 art. 90'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62100000', 'debe', 1500.00, 'local_id', l2),
      jsonb_build_object('cuenta', '47200021', 'debe', 315.00, 'local_id', l2,
        'iva', jsonb_build_object('tipo_id', iva21, 'base', 1500.00, 'libro', 'received', 'deducible', 'yes')),
      jsonb_build_object('cuenta', '47510000', 'haber', 285.00, 'local_id', l2,
        'retencion', jsonb_build_object('tipo_id', r115, 'base', 1500.00, 'modelo', '115')),
      jsonb_build_object('cuenta', '41000001', 'haber', 1530.00, 'local_id', l2)), null, 'Folvy');

  -- 4 · Nómina de septiembre: validada.
  r := public.journal_entry_proponer(ea,
    jsonb_build_object('series', 9, 'fecha', '2026-09-30', 'concepto', 'Nóminas de septiembre · Norte Centro', 'source_type', 'payroll',
      'source_id', 'c0400000-0000-4000-8000-000000000201', 'confianza', 'seguro', 'porque', 'el resumen de la gestoría cuadra: bruto = SS del trabajador + IRPF + líquido.',
      'razones', jsonb_build_array(jsonb_build_object('decision', 'IRPF al 111', 'porque', 'retenciones del trabajo', 'cita', 'RD 439/2007 art. 108'))),
    jsonb_build_array(
      jsonb_build_object('cuenta', '64000000', 'debe', 4200.00, 'local_id', l1),
      jsonb_build_object('cuenta', '64200000', 'debe', 1340.00, 'local_id', l1),
      jsonb_build_object('cuenta', '47600000', 'haber', 1608.80, 'local_id', l1),
      jsonb_build_object('cuenta', '47510000', 'haber', 420.00, 'local_id', l1,
        'retencion', jsonb_build_object('tipo_id', r111, 'base', 4200.00, 'modelo', '111')),
      jsonb_build_object('cuenta', '46500000', 'haber', 3511.20, 'local_id', l1)), null, 'Folvy');
  if exists (select 1 from public.journal_entry where id = (r->>'id')::uuid and status = 'propuesto') then
    perform public.journal_entry_validar((r->>'id')::uuid, 'Ana Prueba');
  end if;

  -- 5 · Préstamo común: a mano y validado.
  if not exists (select 1 from public.journal_entry where company_id = ea and concept = 'Cuota del préstamo · octubre') then
    r := public.journal_entry_proponer(ea,
      jsonb_build_object('series', 4, 'fecha', '2026-10-06', 'concepto', 'Cuota del préstamo · octubre', 'source_type', 'manual',
        'confianza', 'seguro', 'porque', 'hecho a mano por Ana Prueba.'),
      jsonb_build_array(
        jsonb_build_object('cuenta', '52000000', 'debe', 812.40, 'comun', true, 'concepto', 'capital'),
        jsonb_build_object('cuenta', '66230000', 'debe', 187.60, 'comun', true, 'concepto', 'intereses'),
        jsonb_build_object('cuenta', '57200001', 'haber', 1000.00, 'comun', true)), null, 'Ana Prueba');
    perform public.journal_entry_validar((r->>'id')::uuid, 'Ana Prueba');
  end if;

  -- 6 · Un asiento repetido, anulado con su contraasiento.
  if not exists (select 1 from public.journal_entry where company_id = ea and concept = 'Publicidad en la plataforma · octubre') then
    r := public.journal_entry_proponer(ea,
      jsonb_build_object('series', 4, 'fecha', '2026-10-03', 'concepto', 'Publicidad en la plataforma · octubre', 'source_type', 'manual',
        'confianza', 'seguro', 'porque', 'hecho a mano por Ana Prueba.'),
      jsonb_build_array(
        jsonb_build_object('cuenta', '62700000', 'debe', 200.00, 'local_id', l1),
        jsonb_build_object('cuenta', '57200001', 'haber', 200.00, 'local_id', l1)), null, 'Ana Prueba');
    v_id := (r->>'id')::uuid;
    perform public.journal_entry_validar(v_id, 'Ana Prueba');
    perform public.journal_entry_anular(v_id, 'Estaba repetido: la misma publicidad va dentro de la liquidación de la plataforma', '2026-10-03', 'Ana Prueba');
  end if;
end $$;
reset role;

-- ── Cuenta B, como su administrador ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  eb  constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  lb  constant uuid := 'c01b0000-0000-4000-8000-0000000000b2';
  m date; r jsonb;
begin
  -- 7 · Enero a septiembre cerrados (en orden, como obliga conta_cerrar_mes).
  for m in select generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month')::date loop
    if not public.conta_mes_cerrado(eb, m) then perform public.conta_cerrar_mes(eb, m); end if;
  end loop;
  if not exists (select 1 from public.journal_entry where company_id = eb and concept = 'Cuota del préstamo · octubre') then
    r := public.journal_entry_proponer(eb,
      jsonb_build_object('series', 4, 'fecha', '2026-10-06', 'concepto', 'Cuota del préstamo · octubre', 'source_type', 'manual',
        'confianza', 'seguro', 'porque', 'hecho a mano por la administradora de B.'),
      jsonb_build_array(
        jsonb_build_object('cuenta', '52000000', 'debe', 450.00, 'local_id', lb),
        jsonb_build_object('cuenta', '66230000', 'debe', 50.00, 'local_id', lb),
        jsonb_build_object('cuenta', '57200000', 'haber', 500.00, 'local_id', lb)), null, null);
    perform public.journal_entry_validar((r->>'id')::uuid, null);
  end if;
end $$;

-- El borrador del 30/09 (mes cerrado): por la RLS, como haría «Nuevo asiento».
insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
select 'c0400000-0000-4000-8000-0000000000b9', 'c01b0000-0000-4000-8000-00000000000b', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', y.id, 4,
       '2026-09-30', 'Honorarios de la gestoría · septiembre', 'manual', 'borrador', 'Gestoría de prueba'
  from public.fiscal_year y where y.company_id = '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6' and '2026-09-30' between y.starts_on and y.ends_on
on conflict (id) do nothing;
insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
select 'c01b0000-0000-4000-8000-00000000000b', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', 'c0400000-0000-4000-8000-0000000000b9', x.pos, c.id, x.d, x.h,
       'c01b0000-0000-4000-8000-0000000000b2'
  from (values (1, '62300000', 300.00, 0), (2, '41000000', 0, 300.00)) x(pos, code, d, h)
  join public.company_account c on c.company_id = '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6' and c.code = x.code
 where not exists (select 1 from public.journal_line l where l.entry_id = 'c0400000-0000-4000-8000-0000000000b9');
reset role;

-- Lo que ha quedado, para el parte (regla 5: el resultado, no la afirmación).
select e.account_id = 'c01a0000-0000-4000-8000-00000000000a' as cuenta_a, e.series, e.number, e.entry_date, e.status, e.concept,
       (select sum(debit) from public.journal_line l where l.entry_id = e.id) as importe
  from public.journal_entry e
 where e.company_id in ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6')
 order by 1 desc, e.entry_date, e.series, e.number nulls last;
