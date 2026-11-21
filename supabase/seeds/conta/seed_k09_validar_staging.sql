-- ============================================================================
-- K09 · Nunca se valida una recibida incompleta ni repetida: las facturas de su
-- e2e (tests/e2e/conta/k09), en la gestoría de la cuenta del núcleo (semilla
-- K02). SOLO STAGING. Todo inventado (T11).
--
-- Por tamaño (t = 1 a 1456, t = 2 a 1366), con ids …d<t><n>, leídas, por
-- revisar, del Proveedor de Prueba Ficha Uno (t = 1) o Dos (t = 2), a nombre de
-- la gestoría, al 21 %:
--   · n = 1: la de «sin cuenta de gasto» (se vacía en la prueba);
--   · n = 2: «K09-<t>-000123», que la prueba valida;
--   · n = 3: «k09 <t> 123», la misma escrita de otra forma y con otro total
--     (las reglas de siempre no la ven: mismo total, mismo número con
--     separadores); la pantalla dice que ya está la 2 y la abre.
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
    raise exception 'Semilla K09 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K09: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1' and account_id = k_cuenta) then
    raise exception 'Semilla K09: faltan los proveedores de la semilla K04 (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e90000-0000-4000-8000-000000000d' || x.t || x.n)::uuid, k_cuenta, k_emp2, ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid,
         x.numero, date '2026-10-12' + x.n, date '2026-11-11' + x.n, 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K09', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K09).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end,
                                             'nif', case when x.t = 1 then 'B00000000' else 'A00000000' end),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', x.numero, 'fecha', (date '2026-10-12' + x.n)::text, 'vencimiento', (date '2026-11-11' + x.n)::text,
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 1, 'K09-1-SIN', 341.10), (1, 2, 'K09-1-000123', 343.30), (1, 3, 'k09 1 123', 347.90),
                 (2, 1, 'K09-2-SIN', 351.50), (2, 2, 'K09-2-000123', 353.70), (2, 3, 'k09 2 123', 357.10)) x(t, n, numero, base)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K09'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de prueba K09', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K09'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K09';
  if v_n <> 6 then raise exception 'Semilla K09: hay % facturas y tenían que ser 6.', v_n; end if;
  raise notice 'Semilla K09 OK: 6 facturas leídas por revisar en la gestoría (%), dos de ellas con el mismo número escrito de otra forma.', v_nif;
end $$;
