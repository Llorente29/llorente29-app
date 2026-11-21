-- ============================================================================
-- K07 · Una factura, una sola ficha: las facturas de su e2e (tests/e2e/conta/k07),
-- en la gestoría de la cuenta del núcleo (semilla K02). SOLO STAGING. Todo
-- inventado (T11).
--
-- Por tamaño (t = 1 a 1456, t = 2 a 1366), con ids …d<t><n>:
--   · n = 1 y 2: leídas, por revisar, del Proveedor de Prueba Ficha Uno (t = 1)
--     o Dos (t = 2), a nombre de la gestoría (su NIF, de company.tax_id), al
--     21 %. La 1 se valida con Intro, se pasa a la 2 y se vuelve con ‹.
--   · n = 3: leída de un emisor que no existe (NIF inventado, con su dígito de
--     control), para el recorrido de Julio: «Darlo de alta», la cuenta de
--     gasto, Intro, y abrirla otra vez.
-- Sin documento: lo sube la prueba (no hay ficheros en una semilla).
-- Solo AÑADE, con ids fijos; se puede aplicar dos veces igual (W07).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-20 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K07 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K07: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1' and account_id = k_cuenta) then
    raise exception 'Semilla K07: faltan los proveedores de la semilla K04 (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;
  if exists (select 1 from public.supplier where account_id = k_cuenta and tax_id in ('B00000059', 'B00000067')) then
    raise exception 'Semilla K07: uno de sus NIF ya es de un proveedor de la cuenta: la factura no saldría como desconocida.';
  end if;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e70000-0000-4000-8000-000000000d' || x.t || x.n)::uuid, k_cuenta, k_emp2,
         case when x.n < 3 then ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid end,
         'K07-' || x.t || '-' || x.n, date '2026-10-06' + x.n, date '2026-11-05' + x.n, 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K07', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K07).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.n = 3 then 'Emisor Nuevo K07 de Prueba ' || x.t || ', S.L.'
                                                             when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end,
                                             'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', 'K07-' || x.t || '-' || x.n, 'fecha', (date '2026-10-06' + x.n)::text, 'vencimiento', (date '2026-11-05' + x.n)::text,
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 1, 'B00000000', 311.10), (1, 2, 'B00000000', 313.30), (1, 3, 'B00000059', 317.90),
                 (2, 1, 'A00000000', 321.50), (2, 2, 'A00000000', 323.70), (2, 3, 'B00000067', 327.10)) x(t, n, nif, base)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K07'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de prueba K07', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K07'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K07';
  if v_n <> 6 then raise exception 'Semilla K07: hay % facturas y tenían que ser 6.', v_n; end if;
  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K07' and vat_non_deductible;
  if v_n <> 0 then raise exception 'Semilla K07: % facturas con el IVA no deducible.', v_n; end if;
  raise notice 'Semilla K07 OK: 4 facturas leídas por revisar y 2 de un emisor que no existe, en la gestoría (%).', v_nif;
end $$;
