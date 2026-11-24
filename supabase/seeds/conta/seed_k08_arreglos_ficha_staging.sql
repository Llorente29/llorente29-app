-- ============================================================================
-- K08 · Cinco arreglos de la ficha: las facturas de su e2e (tests/e2e/conta/k08),
-- en la gestoría de la cuenta del núcleo (semilla K02). SOLO STAGING. Todo
-- inventado (T11).
--
-- Una por tamaño (t = 1 a 1456, t = 2 a 1366), con ids …d<t>1: leída de un
-- emisor que no existe (NIF inventado, con su dígito de control), a nombre de
-- la gestoría, al 21 %, a la 60000000. Se da de alta en la prueba y, antes de
-- validar, su asiento dice qué subcuenta le tocará («Será la 4000000N»).
-- Sin documento: lo sube la prueba. Solo AÑADE, con ids fijos; se puede
-- aplicar dos veces igual (W07).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-21 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K08 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K08: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.company_account where company_id = k_emp2 and code = '60000000') then
    raise exception 'Semilla K08: faltan las cuentas de la semilla K04 (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;
  if exists (select 1 from public.supplier where account_id = k_cuenta and tax_id in ('B00000075', 'B00000083')) then
    raise exception 'Semilla K08: uno de sus NIF ya es de un proveedor de la cuenta: la factura no saldría como desconocida.';
  end if;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e80000-0000-4000-8000-000000000d' || x.t || '1')::uuid, k_cuenta, k_emp2, null,
         'K08-' || x.t || '-1', date '2026-10-09', date '2026-11-08', 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K08', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K08).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', 'Emisor Nuevo K08 de Prueba ' || x.t || ', S.L.', 'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', 'K08-' || x.t || '-1', 'fecha', '2026-10-09', 'vencimiento', '2026-11-08',
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 'B00000075', 331.10), (2, 'B00000083', 337.30)) x(t, nif, base)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K08'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de prueba K08', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K08'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K08' and supplier_id is null;
  if v_n <> 2 then raise exception 'Semilla K08: hay % facturas sin proveedor y tenían que ser 2.', v_n; end if;
  raise notice 'Semilla K08 OK: 2 facturas leídas de un emisor que no existe, en la gestoría (%).', v_nif;
end $$;
