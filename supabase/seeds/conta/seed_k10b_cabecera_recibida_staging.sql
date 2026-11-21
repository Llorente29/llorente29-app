-- ============================================================================
-- K10b · La cabecera de la recibida: lo que necesita su e2e (tests/e2e/conta/k10b),
-- en la gestoría de la cuenta del núcleo (semilla K02). SOLO STAGING. Todo
-- inventado (T11).
--   · dos marcas de prueba de la cuenta (la casilla «Marca» sale si hay marcas);
--   · el 303 del 3T de 2026 de la gestoría, presentado (fuera de Sumied): una
--     factura de septiembre propone el 4T. Las semillas de la gestoría son todas
--     del 4T (medido el 21/11): no las toca;
--   · por tamaño (t = 1 a 1456, t = 2 a 1366), un proveedor de prueba de España
--     con su subcuenta (40000084, 40000085) y dos facturas leídas, por revisar, a
--     nombre de la gestoría: la n = 1, del 16/10, al 21 %; la n = 2, del 15/09, al
--     21 % (propone el 4T); y la n = 3, del 17/10, SIN IVA, como llega una
--     intracomunitaria de servicios (se le cambia el tipo, el concepto, las
--     observaciones y la marca). Con IVA español la autoliquidación no se propone
--     («o la factura o su ficha están mal»): e2e 44953178165.
-- Va DELANTE de la migración 2150 en el manifiesto de staging: no la necesita.
-- Solo AÑADE, con ids fijos; se puede aplicar dos veces igual (W07).
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
    raise exception 'Semilla K10b ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K10b: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;

  -- 1 · Las marcas.
  insert into public.brand (id, account_id, name, slug, ownership_type, is_active, created_at, updated_at)
  values ('c0eb0000-0000-4000-8000-0000000000c1', k_cuenta, 'Marca de Prueba K10b Uno', 'marca-de-prueba-k10b-uno', 'own', true, cuando, cuando),
         ('c0eb0000-0000-4000-8000-0000000000c2', k_cuenta, 'Marca de Prueba K10b Dos', 'marca-de-prueba-k10b-dos', 'own', true, cuando, cuando)
  on conflict (id) do nothing;

  -- 2 · El 303 del 3T, presentado.
  insert into public.tax_return (id, account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount,
                                 filed_at, filed_via, aeat_csv, filed_by_name, created_at, updated_at)
  select 'c0eb0000-0000-4000-8000-0000000000e1', k_cuenta, k_emp2, '303', 2026, 'quarterly', '3T', date '2026-10-20', 'filed', 'zero', 0,
         timestamptz '2026-10-15 10:00:00+02', 'outside', 'K10BSEMILLA000000', 'Semilla K10b', cuando, cuando
   where not exists (select 1 from public.tax_return r where r.company_id = k_emp2 and r.form_code = '303' and r.fiscal_year = 2026 and r.period = '3T');

  -- 3 · Los dos proveedores, con su subcuenta, y sus facturas por revisar.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values (k_cuenta, k_emp2, 'pymes', '40000084', '4000', 'Proveedor de Prueba K10b Uno', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp2, 'pymes', '40000085', '4000', 'Proveedor de Prueba K10b Dos', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;
  insert into public.supplier (id, account_id, name, legal_name, country_code, vat_regime, created_by_name, created_at)
  select ('c0eb0000-0000-4000-8000-0000000000b' || t)::uuid, k_cuenta, x.nombre, x.nombre, 'ES', 'general', 'Semilla K10b', cuando
    from (values (1, 'Proveedor de Prueba K10b Uno, S.L.'), (2, 'Proveedor de Prueba K10b Dos, S.L.')) x(t, nombre)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', x.de, 'principal', 'manual'
    from (values ('40000084', 'c0eb0000-0000-4000-8000-0000000000b1'), ('40000085', 'c0eb0000-0000-4000-8000-0000000000b2')) x(codigo, de)
    join public.company_account a on a.company_id = k_emp2 and a.code = x.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0eb0000-0000-4000-8000-000000000d' || x.t || x.n)::uuid, k_cuenta, k_emp2, ('c0eb0000-0000-4000-8000-0000000000b' || x.t)::uuid,
         x.numero, x.fecha, x.fecha + 30, 'en_revision', 'ocr',
         round(x.base * (1 + x.pct / 100.0), 2), x.base, round(x.base * x.pct / 100.0, 2), true, 'Semilla K10b', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K10b).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', x.nombre),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', x.numero, 'fecha', x.fecha::text, 'vencimiento', (x.fecha + 30)::text,
             'base', x.base, 'cuota', round(x.base * x.pct / 100.0, 2), 'total', round(x.base * (1 + x.pct / 100.0), 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 1, 'K10B-1-0001', date '2026-10-16', 371.20, 21, 'Proveedor de Prueba K10b Uno, S.L.'),
                 (1, 2, 'K10B-1-0002', date '2026-09-15', 372.40, 21, 'Proveedor de Prueba K10b Uno, S.L.'),
                 (1, 3, 'K10B-1-0003', date '2026-10-17', 375.20, 0, 'Proveedor de Prueba K10b Uno, S.L.'),
                 (2, 1, 'K10B-2-0001', date '2026-10-16', 373.60, 21, 'Proveedor de Prueba K10b Dos, S.L.'),
                 (2, 2, 'K10B-2-0002', date '2026-09-15', 374.80, 21, 'Proveedor de Prueba K10b Dos, S.L.'),
                 (2, 3, 'K10B-2-0003', date '2026-10-17', 376.40, 0, 'Proveedor de Prueba K10b Dos, S.L.')) x(t, n, numero, fecha, base, pct, nombre)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, case when i.tax_total = 0 then 0 else 21 end, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10b'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Servicio de prueba K10b', 1, null, i.tax_base_total, case when i.tax_total = 0 then 0 else 21 end, 1, '62800000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10b'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K10b';
  if v_n <> 6 then raise exception 'Semilla K10b: hay % facturas y tenían que ser 6.', v_n; end if;
  if not exists (select 1 from public.tax_return r where r.company_id = k_emp2 and r.form_code = '303' and r.fiscal_year = 2026 and r.period = '3T'
                   and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')) then
    raise exception 'Semilla K10b: el 303 del 3T de la gestoría no está presentado.';
  end if;
  raise notice 'Semilla K10b OK: dos marcas, el 303 del 3T presentado, y dos proveedores de prueba (40000084, 40000085) con su factura del 16/10, la del 15/09 y la del 17/10 sin IVA.';
end $$;
