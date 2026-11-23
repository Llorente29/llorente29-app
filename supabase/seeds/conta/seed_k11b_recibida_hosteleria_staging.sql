-- supabase/seeds/conta/seed_k11b_recibida_hosteleria_staging.sql
--
-- ============================================================================
-- K11b · Una empresa de HOSTELERÍA en la cuenta del núcleo, para la e2e de la recibida como ERP10
-- (tests/e2e/conta/k11b/recibida.spec.ts). SOLO STAGING.
-- ----------------------------------------------------------------------------
-- La marca y la plataforma de cada contrapartida salen solo en una empresa de hostelería (encargo K11b, 2.2), y la
-- cuenta del núcleo (semilla K02) tiene una general y una gestoría. Con todo inventado (T11):
--   · «Restaurante de Ejemplo Núcleo, S.L.» (sector hostelería), con su ejercicio 2026 abierto, el 303 del 3T
--     presentado (lo de «un trimestre presentado no deja guardar») y la analítica por local y por marca encendida;
--   · tres locales, dos marcas y dos plataformas de la cuenta, de prueba;
--   · un proveedor con su subcuenta (40000101), tres subcuentas de gasto, la de la caja (57000000) y la del banco
--     (57200001, sin tesorería: el pago con ella se apunta al momento, sin esperar el cargo);
--   · por cada tamaño de la e2e (t = 1, 1366 × 768; t = 2, 1920 × 1080), dos facturas por revisar del 16/10:
--     la de las tres contrapartidas (base 300,00, IVA 21 %) y la del IVA deducible al 50 % (base 100,00).
-- Solo añade, con ids fijos: aplicarla dos veces deja lo mismo (W07); va de verdad desde la rama (W05).
-- Guarda: aborta si al otro lado hay cuentas de producción, o si falta la cuenta del núcleo (semilla K02).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp     constant uuid := 'c0f60000-0000-4000-8000-0000000000e3';
  k_prov    constant uuid := 'c0f60000-0000-4000-8000-0000000000a1';
  cuando    constant timestamptz := '2026-11-23 00:00:00+00';
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K11b ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.accounts where id = k_cuenta) then
    raise exception 'Semilla K11b: falta la cuenta del núcleo (semilla K02).';
  end if;

  -- 1 · La empresa de hostelería, su perfil fiscal, su ejercicio, el 303 del 3T presentado y su analítica.
  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at, sector, is_hospitality, created_at, updated_at)
  values (k_emp, k_cuenta, 'Restaurante de Ejemplo Núcleo, S.L.', 'Restaurante Núcleo', 'B00000046', 'nif_es', 'company', 'hecho', cuando, 'hosteleria', true, cuando + interval '2 minutes', cuando + interval '2 minutes')
  on conflict (id) do nothing;
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
  select k_emp, k_cuenta, 'pymes', 8, array['303', '347', '390']
   where not exists (select 1 from public.company_tax_profile t where t.company_id = k_emp);
  insert into public.fiscal_year (id, account_id, company_id, code, starts_on, ends_on, status, closed_at, created_at)
  values ('c0f60000-0000-4000-8000-0000000000f0', k_cuenta, k_emp, '2026', '2026-01-01', '2026-12-31', 'open', null, cuando)
  on conflict (id) do nothing;
  insert into public.tax_return (id, account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount,
                                 filed_at, filed_via, aeat_csv, filed_by_name, created_at, updated_at)
  select 'c0f60000-0000-4000-8000-0000000000e1', k_cuenta, k_emp, '303', 2026, 'quarterly', '3T', date '2026-10-20', 'filed', 'zero', 0,
         timestamptz '2026-10-15 10:00:00+02', 'outside', 'K11BSEMILLA000000', 'Semilla K11b', cuando, cuando
   where not exists (select 1 from public.tax_return r where r.company_id = k_emp and r.form_code = '303' and r.fiscal_year = 2026 and r.period = '3T');
  insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre, nombre_plural, posicion, updated_at)
  select k_cuenta, k_emp, x.eje, true, x.nombre, x.plural, x.pos, cuando
    from (values ('local', 'Local', 'Locales', 1), ('marca', 'Marca', 'Marcas', 2)) x(eje, nombre, plural, pos)
   where not exists (select 1 from public.conta_eje_analitico e where e.company_id = k_emp and e.eje = x.eje);

  -- 2 · Tres locales, dos marcas y dos plataformas de la cuenta, de prueba.
  insert into public.locations (id, account_id, name, active, created_at, updated_at)
  values ('c0f60000-0000-4000-8000-0000000000c1', k_cuenta, 'Local de Prueba K11b Uno', true, cuando, cuando),
         ('c0f60000-0000-4000-8000-0000000000c2', k_cuenta, 'Local de Prueba K11b Dos', true, cuando, cuando),
         ('c0f60000-0000-4000-8000-0000000000c3', k_cuenta, 'Local de Prueba K11b Tres', true, cuando, cuando)
  on conflict (id) do nothing;
  insert into public.brand (id, account_id, name, slug, ownership_type, is_active, created_at, updated_at)
  values ('c0f60000-0000-4000-8000-0000000000b1', k_cuenta, 'Marca de Prueba K11b Uno', 'marca-de-prueba-k11b-uno', 'own', true, cuando, cuando),
         ('c0f60000-0000-4000-8000-0000000000b2', k_cuenta, 'Marca de Prueba K11b Dos', 'marca-de-prueba-k11b-dos', 'own', true, cuando, cuando)
  on conflict (id) do nothing;
  insert into public.sales_channel (id, account_id, name, slug, channel_type, created_at)
  values ('c0f60000-0000-4000-8000-0000000000d1', k_cuenta, 'Plataforma de Prueba K11b Uno', 'plataforma-de-prueba-k11b-uno', 'delivery', cuando),
         ('c0f60000-0000-4000-8000-0000000000d2', k_cuenta, 'Plataforma de Prueba K11b Dos', 'plataforma-de-prueba-k11b-dos', 'delivery', cuando)
  on conflict (id) do nothing;

  -- 3 · Las subcuentas: la del proveedor, tres de gasto, la caja y el banco (sin tesorería).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values (k_cuenta, k_emp, 'pymes', '40000101', '4000', 'Proveedor de Prueba K11b', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp, 'pymes', '60000001', '600', 'Compras de prueba K11b', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp, 'pymes', '62800001', '628', 'Suministros de prueba K11b', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp, 'pymes', '62900001', '629', 'Otros servicios de prueba K11b', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp, 'pymes', '57000000', '570', 'Caja de prueba K11b', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp, 'pymes', '57200001', '572', 'Banco de prueba K11b', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;

  -- 4 · El proveedor, con su subcuenta, y sus facturas por revisar (dos por cada tamaño de la e2e).
  insert into public.supplier (id, account_id, name, legal_name, tax_id, country_code, vat_regime, created_by_name, created_at)
  values (k_prov, k_cuenta, 'Proveedor de Prueba K11b, S.L.', 'Proveedor de Prueba K11b, S.L.', 'B00011215', 'ES', 'general', 'Semilla K11b', cuando)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp, a.id, 'supplier', k_prov, 'principal', 'manual'
    from public.company_account a where a.company_id = k_emp and a.code = '40000101'
  on conflict (company_id, entity, entity_id, role) do nothing;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0f60000-0000-4000-8000-000000000f' || x.t || x.n)::uuid, k_cuenta, k_emp, k_prov,
         x.numero, date '2026-10-16', date '2026-11-15', 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K11b', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K11b).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', 'Proveedor de Prueba K11b, S.L.', 'nif', 'B00011215'),
             'destinatario', jsonb_build_object('nombre', 'Restaurante de Ejemplo Núcleo, S.L.', 'nif', 'B00000046'),
             'numero', x.numero, 'fecha', '2026-10-16', 'vencimiento', '2026-11-15',
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 1, 'K11B-1-TRES', 300.00), (1, 2, 'K11B-1-MITAD', 100.00),
                 (2, 1, 'K11B-2-TRES', 300.00), (2, 2, 'K11B-2-MITAD', 100.00)) x(t, n, numero, base)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp and i.created_by_name = 'Semilla K11b'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Servicio de prueba K11b', 1, null, i.tax_base_total, 21, 1, '62800001'
    from public.supplier_invoice i
   where i.company_id = k_emp and i.created_by_name = 'Semilla K11b'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp and created_by_name = 'Semilla K11b';
  if v_n <> 4 then raise exception 'Semilla K11b: hay % facturas y tenían que ser 4.', v_n; end if;
  if (select count(*) from public.locations where account_id = k_cuenta and name like 'Local de Prueba K11b %') <> 3 then
    raise exception 'Semilla K11b: los tres locales no están.';
  end if;
  raise notice 'Semilla K11b OK: «Restaurante de Ejemplo Núcleo, S.L.» (hostelería) con el 303 del 3T presentado, tres locales, dos marcas, dos plataformas, el proveedor 40000101 y cuatro facturas por revisar.';
end $$;
