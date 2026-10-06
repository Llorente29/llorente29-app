-- supabase/seeds/conta/seed_c03_staging.sql
--
-- C03 · Clientes, plataformas y socios de marca, en staging-conta. SOLO
-- STAGING. Todo inventado (nombres, NIF con su dígito de control bien
-- calculado, cifras); nada copiado de producción. Se puede volver a lanzar:
-- ids fijos y «on conflict do nothing». Después de las migraciones del C03.
--
-- Cuenta A (Taberna de Prueba Norte), empresa «Taberna de Prueba Norte, S.L.»
-- (plan activado), dos locales (Norte Centro y Norte Mercado):
--   · Plataforma Norte: proveedor (comisiones, 410) y cliente (430) con papel
--     de plataforma en el canal Glovo, quincenal, 21 %. Cuatro liquidaciones
--     (una pendiente, dos cobradas al céntimo y una CON DIFERENCIA: faltan
--     212,30 € en el banco), como la maqueta N9.
--   · Marcas del Sur: socio de marca (cesión). Proveedor de mercancía (400) y
--     cliente (430); sus marcas Milanesa Cedida y Wok Cedido al 9 %. Julio,
--     agosto y septiembre liquidados POR LOCAL; octubre con albaranes,
--     aportaciones y ventas en los dos locales para «Preparar liquidación de
--     octubre» (sale 6.887 €: 4.090 en Norte Centro y 2.797 en Norte Mercado).
--   · Catering Eventos Norte: cliente normal, sin facturas (Facturación no
--     existe aún: la ficha lo dice).
--   · Distribuciones Antiguas: archivado, «histórico de 2024».

do $$
declare
  a        constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp      constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  l1       constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  l2       constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  glovo    constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  milanesa constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';
  banco    constant uuid := '3315cb3a-ad30-44ea-958b-253b1ae8811f';
  s_plat   constant uuid := 'c0300000-0000-4000-8000-000000000001';
  s_socio  constant uuid := 'c0300000-0000-4000-8000-000000000002';
  s_arch   constant uuid := 'c0300000-0000-4000-8000-000000000003';
  p_cli    constant uuid := 'c0300000-0000-4000-8000-000000000011';
  wok      constant uuid := 'c0300000-0000-4000-8000-000000000021';
  p_plat uuid; p_socio uuid; p_arch uuid; d int; v_code text; v_id uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C03: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regclass('public.party') is null then raise exception 'Semilla C03: faltan las migraciones del C03.'; end if;

  -- Los proveedores (su tercero lo crea el disparador del C03).
  insert into public.supplier (id, account_id, name, legal_name, tax_id, tax_id_type, country_code, entity_kind, tax_id_check_status, created_by_name)
  values (s_plat,  a, 'Plataforma Norte', 'Plataforma Norte Spain, S.L.', 'B91030015', 'nif_es', 'ES', 'company', 'valid', 'semilla C03'),
         (s_socio, a, 'Marcas del Sur',   'Marcas del Sur, S.L.',         'B91030023', 'nif_es', 'ES', 'company', 'valid', 'semilla C03'),
         (s_arch,  a, 'Distribuciones Antiguas', 'Distribuciones Antiguas, S.L.', 'B91030031', 'nif_es', 'ES', 'company', 'valid', 'semilla C03')
  on conflict (id) do nothing;
  update public.supplier set archived_at = '2024-12-31 12:00+01' where id = s_arch and archived_at is null;
  select party_id into p_plat from public.party_role where supplier_id = s_plat;
  select party_id into p_socio from public.party_role where supplier_id = s_socio;
  select party_id into p_arch from public.party_role where supplier_id = s_arch;
  update public.party set archived_note = 'histórico de 2024' where id = p_arch;

  -- Papeles.
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, commission_pct)
  values (a, p_plat, 'platform', glovo, 'fortnightly', 21) on conflict (party_id, role) do nothing;
  insert into public.party_role (account_id, party_id, role) values (a, p_plat, 'customer') on conflict (party_id, role) do nothing;
  insert into public.customer_fiscal (party_id, account_id, legal_name, tax_id_type, entity_kind, tax_id_check_status, tax_id_verified_at,
                                      fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, payment_method, collection_treasury_id)
  values (p_plat, a, 'Plataforma Norte Spain, S.L.', 'nif_es', 'company', 'valid', now(), 'Calle Inventada del Puerto, 12', '08005', 'Barcelona', 'Barcelona', 'transfer', banco)
  on conflict (party_id) do nothing;
  insert into public.party_role (account_id, party_id, role, contribution_kinds) values (a, p_socio, 'brand_partner', array['marketing', 'packaging'])
  on conflict (party_id, role) do nothing;
  insert into public.party_role (account_id, party_id, role) values (a, p_socio, 'customer') on conflict (party_id, role) do nothing;
  insert into public.customer_fiscal (party_id, account_id, legal_name, tax_id_type, entity_kind, tax_id_check_status, tax_id_verified_at, payment_method)
  values (p_socio, a, 'Marcas del Sur, S.L.', 'nif_es', 'company', 'valid', now(), 'transfer') on conflict (party_id) do nothing;

  insert into public.party (id, account_id, name, tax_id, source, created_by_name)
  values (p_cli, a, 'Catering Eventos Norte', 'B91030049', 'manual', 'semilla C03') on conflict (id) do nothing;
  insert into public.party_role (account_id, party_id, role) values (a, p_cli, 'customer') on conflict (party_id, role) do nothing;
  insert into public.customer_fiscal (party_id, account_id, legal_name, tax_id_type, entity_kind, tax_id_check_status, tax_id_verified_at,
                                      fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, payment_method, payment_terms_days, collection_treasury_id)
  values (p_cli, a, 'Catering Eventos Norte, S.L.', 'nif_es', 'company', 'valid', now(), 'Avenida Inventada, 4', '28005', 'Madrid', 'Madrid', 'transfer', 30, banco)
  on conflict (party_id) do nothing;

  -- Sus cuentas (si no las tienen ya): cliente → 4300; plataforma → 4100 como acreedor; socio → 4000 como proveedor.
  select length(code) into d from public.company_account where company_id = emp limit 1;
  for v_id, v_code in
    select x.party, x.hoja from (values (p_plat, '4300'), (p_socio, '4300'), (p_cli, '4300')) x(party, hoja)
     where not exists (select 1 from public.company_account_link l where l.company_id = emp and l.entity = 'customer' and l.entity_id = x.party::text and l.role = 'principal')
  loop
    perform 1;
    with c as (
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
      select a, emp, (select plan from public.company_account where company_id = emp limit 1),
             public.company_account_siguiente(emp, v_code, d), v_code,
             'Clientes · ' || (select name from public.party where id = v_id), 'own', 'manual', 'semilla C03'
      returning id)
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, emp, c.id, 'customer', v_id::text, 'principal', 'manual' from c;
  end loop;
  for v_id, v_code in
    select x.sup, x.hoja from (values (s_plat, '4100'), (s_socio, '4000')) x(sup, hoja)
     where not exists (select 1 from public.company_account_link l where l.company_id = emp and l.entity = 'supplier' and l.entity_id = x.sup::text and l.role = 'principal')
  loop
    with c as (
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
      select a, emp, (select plan from public.company_account where company_id = emp limit 1),
             public.company_account_siguiente(emp, v_code, d), v_code,
             case when v_code = '4100' then 'Acreedores · ' else 'Proveedores · ' end || (select name from public.supplier where id = v_id), 'own', 'manual', 'semilla C03'
      returning id)
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, emp, c.id, 'supplier', v_id::text, 'principal', 'manual' from c;
  end loop;

  -- Plataforma Norte: cuatro liquidaciones de Glovo (la maqueta N9).
  insert into public.channel_settlement (id, account_id, channel_id, location_id, party_id, settlement_ref, period_from, period_to, settlement_date,
                                         period_grain, orders_count, gross_sales, commission, net_payout, collected_on, collected_amount, source, import_key)
  values
    ('c0300000-0000-4000-8000-000000000101', a, glovo, l1, p_plat, 'SEED-C03-0816', '2026-08-16', '2026-08-31', '2026-09-05', 'quincena', 268,  8905.00, 1870.00, 7035.00, '2026-09-05', 6822.70, 'import_csv_glovo', 'seed-c03-101'),
    ('c0300000-0000-4000-8000-000000000102', a, glovo, l1, p_plat, 'SEED-C03-0901', '2026-09-01', '2026-09-15', '2026-09-20', 'quincena', 312, 10412.00, 2185.90, 8226.10, '2026-09-20', 8226.10, 'import_csv_glovo', 'seed-c03-102'),
    ('c0300000-0000-4000-8000-000000000103', a, glovo, l1, p_plat, 'SEED-C03-0916', '2026-09-16', '2026-09-30', '2026-10-05', 'quincena', 296,  9870.00, 2072.60, 7797.40, '2026-10-05', 7797.40, 'import_csv_glovo', 'seed-c03-103'),
    ('c0300000-0000-4000-8000-000000000104', a, glovo, l1, p_plat, 'SEED-C03-1001', '2026-10-01', '2026-10-15', '2026-10-20', 'quincena', 336, 11004.00, 2310.80, 8693.20, null, null, 'import_csv_glovo', 'seed-c03-104')
  on conflict (id) do nothing;

  -- Marcas del Sur: sus marcas y el acuerdo (9 % sobre las ventas sin IVA).
  insert into public.brand (id, account_id, name, slug, ownership_type, is_active)
  values (wok, a, 'Wok Cedido', 'wok-cedido', 'licensed', true) on conflict (id) do nothing;
  insert into public.brand_licensing_agreement (id, account_id, brand_id, owner_name, revenue_share_pct, reimburses_consumption, starts_on, party_id)
  values ('c0300000-0000-4000-8000-000000000031', a, milanesa, 'Marcas del Sur', 9, true, '2026-01-01', p_socio),
         ('c0300000-0000-4000-8000-000000000032', a, wok,      'Marcas del Sur', 9, true, '2026-01-01', p_socio)
  on conflict do nothing;

  -- Julio, agosto y septiembre, ya liquidados POR LOCAL (saldados).
  insert into public.licensed_settlement (id, account_id, location_id, party_id, period_from, period_to, period_grain, formula, status,
                                          purchases_amount, contributions_amount, brand_sales_base, commission_pct, commission_amount, amount,
                                          source, confirmed_at, confirmed_by_name, created_by_name, import_key)
  values
    ('c0300000-0000-4000-8000-000000000201', a, l1, p_socio, '2026-07-01', '2026-07-31', 'month', 'compras_aportaciones_comision', 'saldada', 2900.00, 600.00,  7400.00, 9, 666.00, 2966.00, 'folvy', '2026-08-01', 'semilla C03', 'semilla C03', 'seed-c03-201'),
    ('c0300000-0000-4000-8000-000000000202', a, l2, p_socio, '2026-07-01', '2026-07-31', 'month', 'compras_aportaciones_comision', 'saldada', 1700.00, 390.00,  6625.00, 9, 596.25, 1906.25, 'folvy', '2026-08-01', 'semilla C03', 'semilla C03', 'seed-c03-202'),
    ('c0300000-0000-4000-8000-000000000203', a, l1, p_socio, '2026-08-01', '2026-08-31', 'month', 'compras_aportaciones_comision', 'saldada', 3600.00, 650.00, 10000.00, 9, 900.00, 3850.00, 'folvy', '2026-09-01', 'semilla C03', 'semilla C03', 'seed-c03-203'),
    ('c0300000-0000-4000-8000-000000000204', a, l2, p_socio, '2026-08-01', '2026-08-31', 'month', 'compras_aportaciones_comision', 'saldada', 2000.00, 450.00,  7833.33, 9, 705.00, 2255.00, 'folvy', '2026-09-01', 'semilla C03', 'semilla C03', 'seed-c03-204'),
    ('c0300000-0000-4000-8000-000000000205', a, l1, p_socio, '2026-09-01', '2026-09-30', 'month', 'compras_aportaciones_comision', 'saldada', 3500.00, 700.00, 10200.00, 9, 918.00, 3718.00, 'folvy', '2026-10-01', 'semilla C03', 'semilla C03', 'seed-c03-205'),
    ('c0300000-0000-4000-8000-000000000206', a, l2, p_socio, '2026-09-01', '2026-09-30', 'month', 'compras_aportaciones_comision', 'saldada', 1900.00, 450.00,  8271.11, 9, 744.40, 2194.40, 'folvy', '2026-10-01', 'semilla C03', 'semilla C03', 'seed-c03-206')
  on conflict (id) do nothing;

  -- Octubre: albaranes confirmados a Marcas del Sur (3.800 en Norte Centro, 2.620 en Norte Mercado).
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, receipt_date, status, source, created_by_name)
  values ('c0300000-0000-4000-8000-000000000301', a, l1, s_socio, '2026-10-02', 'confirmado', 'manual', 'semilla C03'),
         ('c0300000-0000-4000-8000-000000000302', a, l1, s_socio, '2026-10-05', 'confirmado', 'manual', 'semilla C03'),
         ('c0300000-0000-4000-8000-000000000303', a, l2, s_socio, '2026-10-03', 'confirmado', 'manual', 'semilla C03')
  on conflict (id) do nothing;
  insert into public.goods_receipt_line (id, account_id, goods_receipt_id, product_name, qty_received, unit_cost, doc_qty, doc_amount, position)
  values ('c0300000-0000-4000-8000-000000000311', a, 'c0300000-0000-4000-8000-000000000301', 'Masa de milanesa (caja)', 40, 50.00, 40, 2000.00, 1),
         ('c0300000-0000-4000-8000-000000000312', a, 'c0300000-0000-4000-8000-000000000302', 'Salsa wok (garrafa)',     30, 60.00, 30, 1800.00, 1),
         ('c0300000-0000-4000-8000-000000000313', a, 'c0300000-0000-4000-8000-000000000303', 'Masa de milanesa (caja)', 30, 50.00, 30, 1500.00, 1),
         ('c0300000-0000-4000-8000-000000000314', a, 'c0300000-0000-4000-8000-000000000303', 'Envases wok (paquete)',   28, 40.00, 28, 1120.00, 2)
  on conflict (id) do nothing;

  -- Octubre: aportaciones del socio (700 en Norte Centro, 480 en Norte Mercado).
  insert into public.brand_partner_contribution (id, account_id, party_id, location_id, contributed_on, kind, amount, note, created_by_name)
  values ('c0300000-0000-4000-8000-000000000401', a, p_socio, l1, '2026-10-01', 'marketing', 500.00, 'Campaña de octubre', 'semilla C03'),
         ('c0300000-0000-4000-8000-000000000402', a, p_socio, l1, '2026-10-01', 'packaging', 200.00, null, 'semilla C03'),
         ('c0300000-0000-4000-8000-000000000403', a, p_socio, l2, '2026-10-01', 'marketing', 300.00, 'Campaña de octubre', 'semilla C03'),
         ('c0300000-0000-4000-8000-000000000404', a, p_socio, l2, '2026-10-02', 'packaging', 180.00, null, 'semilla C03')
  on conflict (id) do nothing;

  -- Octubre: ventas cerradas de sus marcas, sin IVA (11.000 en Norte Centro, 7.300 en Norte Mercado).
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status, external_channel_text)
  values ('c0300000-0000-4000-8000-000000000501', a, l1, milanesa, glovo, 'lastapp', '2026-10-02 13:30+02', 3850.00, 350.00, 3500.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000502', a, l1, milanesa, glovo, 'lastapp', '2026-10-04 21:10+02', 2750.00, 250.00, 2500.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000503', a, l1, wok,      glovo, 'lastapp', '2026-10-03 14:00+02', 3300.00, 300.00, 3000.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000504', a, l1, wok,      glovo, 'lastapp', '2026-10-05 20:45+02', 2200.00, 200.00, 2000.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000505', a, l2, milanesa, glovo, 'lastapp', '2026-10-02 13:15+02', 2530.00, 230.00, 2300.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000506', a, l2, milanesa, glovo, 'lastapp', '2026-10-05 21:30+02', 2200.00, 200.00, 2000.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000507', a, l2, wok,      glovo, 'lastapp', '2026-10-03 13:50+02', 1980.00, 180.00, 1800.00, 'closed', 'Glovo'),
         ('c0300000-0000-4000-8000-000000000508', a, l2, wok,      glovo, 'lastapp', '2026-10-04 20:20+02', 1320.00, 120.00, 1200.00, 'closed', 'Glovo')
  on conflict (id) do nothing;

  raise notice 'Semilla C03: plataforma, socio de marca (dos locales), cliente normal y archivado, en la cuenta A.';
end $$;
