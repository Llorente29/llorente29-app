-- ============================================================================
-- K04b · El emisor que no se reconoce (respuesta K05 · 0, 19/11): lo que
-- necesita su e2e (tests/e2e/conta/k04b) en la gestoría de la cuenta del
-- núcleo (semilla K02). SOLO STAGING. Todo inventado (T11): NIF con ceros,
-- nombres «de Prueba».
--
-- Cuatro facturas leídas SIN proveedor (supplier_id null), a nombre de la
-- gestoría (el NIF del destinatario es el suyo, como la semilla K04b de las
-- recibidas: así su IVA se deduce). Por cada tamaño de la e2e (1 = 1456,
-- 2 = 1366):
--   · n = 1: la de «Darlo de alta», con un NIF que no es de ningún proveedor
--     (B00000018 y B00000026);
--   · n = 2: la de «Es uno que ya tengo», con otro NIF que tampoco es de nadie
--     (B00000034 y B00000042): se elige a mano el proveedor de la semilla K04.
--   · n = 3: una de su proveedor de la semilla K04, para la e2e del cambio de
--     empresa (respuesta K05 · 0b): se escribe en ella, se cambia de empresa,
--     se vuelve y se valida.
-- Y en la OTRA empresa de la cuenta (Empresa de Ejemplo Núcleo, …e2), una por
-- tamaño (…0e<tamaño>1, K04E-<tamaño>-1), la que se abre en la empresa 2.
-- Ids …0d<tamaño><n>, números K04C-<tamaño>-<n>, con sus fechas e importes
-- propios (no salen como repetidas de ninguna otra).
--
-- Solo AÑADE, con ids y fechas fijos: se puede aplicar dos veces igual (W07),
-- y va de verdad desde la rama (W05).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp1    constant uuid := 'c0e20000-0000-4000-8000-0000000000e2';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-19 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K04b (emisor) ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K04b (emisor): la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.company_account where company_id = k_emp2 and code = '60000000') then
    raise exception 'Semilla K04b (emisor): faltan las cuentas de la semilla K04 (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;
  if exists (select 1 from public.supplier where account_id = k_cuenta and tax_id in ('B00000018', 'B00000026', 'B00000034', 'B00000042')) then
    raise exception 'Semilla K04b (emisor): uno de sus NIF ya es de un proveedor de la cuenta: la factura no saldría como desconocida.';
  end if;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e40000-0000-4000-8000-000000000d' || x.t || x.n)::uuid, k_cuenta, k_emp2,
         case when x.n = 3 then ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid end,
         'K04C-' || x.t || '-' || x.n, date '2026-10-03' + (x.n * 4), date '2026-11-02' + (x.n * 4), 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K04b emisor', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K04b, emisor desconocido).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.n = 1 then 'Emisor Nuevo de Prueba ' || x.t || ', S.L.' when x.n = 2 then 'Emisor con Otro Nombre de Prueba ' || x.t || ', S.L.'
                                                             when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end,
                                             'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', 'K04C-' || x.t || '-' || x.n, 'fecha', (date '2026-10-03' + (x.n * 4))::text, 'vencimiento', (date '2026-11-02' + (x.n * 4))::text,
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 1, 'B00000018', 211.10), (1, 2, 'B00000034', 223.30), (1, 3, 'B00000000', 233.90),
                 (2, 1, 'B00000026', 241.50), (2, 2, 'B00000042', 257.70), (2, 3, 'A00000000', 263.10)) x(t, n, nif, base)
  on conflict (id) do nothing;
  -- La de la otra empresa: de su proveedor, a nombre de esa empresa.
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e40000-0000-4000-8000-000000000e' || x.t || '1')::uuid, k_cuenta, k_emp1, ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid,
         'K04E-' || x.t || '-1', date '2026-10-20', date '2026-11-19', 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K04b emisor', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K04b, la otra empresa).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end, 'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Empresa de Ejemplo Núcleo, S.L.', 'nif', (select tax_id from public.company where id = k_emp1)),
             'numero', 'K04E-' || x.t || '-1', 'fecha', '2026-10-20', 'vencimiento', '2026-11-19',
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 'B00000000', 271.30), (2, 'A00000000', 283.50)) x(t, nif, base)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id in (k_emp1, k_emp2) and i.created_by_name = 'Semilla K04b emisor'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de oficina de prueba', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id in (k_emp1, k_emp2) and i.created_by_name = 'Semilla K04b emisor'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K04b emisor' and supplier_id is null;
  if v_n <> 4 then raise exception 'Semilla K04b (emisor): hay % facturas sin proveedor y tenían que ser 4.', v_n; end if;
  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K04b emisor' and vat_non_deductible;
  if v_n <> 0 then raise exception 'Semilla K04b (emisor): % facturas con el IVA no deducible.', v_n; end if;
  select count(*) into v_n from public.supplier_invoice where company_id in (k_emp1, k_emp2) and created_by_name = 'Semilla K04b emisor';
  if v_n <> 8 then raise exception 'Semilla K04b (emisor): hay % facturas de la semilla y tenían que ser 8.', v_n; end if;
  raise notice 'Semilla K04b (emisor) OK: 4 facturas leídas sin proveedor y 2 con él en la gestoría (%), y 2 en la otra empresa.', v_nif;
end $$;
