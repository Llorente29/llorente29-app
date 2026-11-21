-- ============================================================================
-- K10 · La «Cuenta de pago» en la ficha del proveedor: lo que necesita su e2e
-- (tests/e2e/conta/k10), en la gestoría de la cuenta del núcleo (semilla K02).
-- SOLO STAGING. Todo inventado (T11).
--   · la 43000002 (la que la prueba pone como cuenta de pago), si no está, y una
--     21600000 de inmovilizado (para el aviso de la contrapartida);
--   · por tamaño (t = 1 a 1456, t = 2 a 1366), un proveedor de prueba con su
--     subcuenta (40000082, 40000083: la prueba lo busca por ella) y una factura
--     leída, por revisar, a nombre de la gestoría, al 21 %;
--   · la plataforma del K06 con su 43000091 como cuenta de pago en su ficha: lo
--     que la tanda 1650 le pone en producción (la e2e del K06 ve «De su ficha»).
-- Va DELANTE de la migración 1650 en el manifiesto de staging: no la necesita
-- (la 43 es de las que el disparador ya dejaba). Solo AÑADE, con ids fijos; se
-- puede aplicar dos veces igual (W07).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  k_k06     constant uuid := 'c0e60000-0000-4000-8000-0000000000a0';
  cuando    constant timestamptz := '2026-11-21 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K10 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K10: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.company_account where company_id = k_emp2 and code = '43000091') then
    raise exception 'Semilla K10: falta la plataforma del K06 (seed_k06_cuenta_de_pago_staging.sql). Aplícala antes.';
  end if;

  -- 1 · Las cuentas.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values
    (k_cuenta, k_emp2, 'pymes', '43000002', '4300', 'Clientes · Plataforma de Prueba K10', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '21600000', '216', 'Mobiliario de prueba K10', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '40000082', '4000', 'Proveedor de Prueba K10 Uno', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '40000083', '4000', 'Proveedor de Prueba K10 Dos', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;

  -- 2 · Los dos proveedores, con su subcuenta, y su factura por revisar.
  insert into public.supplier (id, account_id, name, legal_name, created_by_name, created_at)
  select ('c0ea0000-0000-4000-8000-0000000000b' || t)::uuid, k_cuenta, x.nombre, x.nombre, 'Semilla K10', cuando
    from (values (1, 'Proveedor de Prueba K10 Uno, S.L.'), (2, 'Proveedor de Prueba K10 Dos, S.L.')) x(t, nombre)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', x.de, 'principal', 'manual'
    from (values ('40000082', 'c0ea0000-0000-4000-8000-0000000000b1'), ('40000083', 'c0ea0000-0000-4000-8000-0000000000b2')) x(codigo, de)
    join public.company_account a on a.company_id = k_emp2 and a.code = x.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0ea0000-0000-4000-8000-000000000d' || x.t || '1')::uuid, k_cuenta, k_emp2, ('c0ea0000-0000-4000-8000-0000000000b' || x.t)::uuid,
         x.numero, date '2026-10-14', date '2026-11-13', 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K10', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K10).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', x.nombre),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', x.numero, 'fecha', '2026-10-14', 'vencimiento', '2026-11-13',
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 'K10-1-0001', 361.20, 'Proveedor de Prueba K10 Uno, S.L.'), (2, 'K10-2-0001', 363.40, 'Proveedor de Prueba K10 Dos, S.L.')) x(t, numero, base, nombre)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de prueba K10', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  -- 3 · La plataforma del K06, con su 430 en la ficha (lo que hace la tanda en producción).
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', k_k06::text, 'pago', 'manual'
    from public.company_account a where a.company_id = k_emp2 and a.code = '43000091'
  on conflict (company_id, entity, entity_id, role) do nothing;

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K10';
  if v_n <> 2 then raise exception 'Semilla K10: hay % facturas y tenían que ser 2.', v_n; end if;
  raise notice 'Semilla K10 OK: la 43000002 y la 21600000, dos proveedores de prueba (40000082, 40000083) con su factura por revisar, y la 43000091 en la ficha de la plataforma del K06.';
end $$;
