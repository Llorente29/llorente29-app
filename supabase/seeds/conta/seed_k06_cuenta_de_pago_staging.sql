-- ============================================================================
-- K06 · La cuenta del pago de la recibida en el núcleo: lo que necesita su e2e
-- (tests/e2e/conta/k06) en la gestoría de la cuenta del núcleo (semillas K02 y
-- K04). SOLO STAGING. Todo inventado (T11): NIF con ceros, nombres «de Prueba».
--
-- Solo AÑADE, con ids y fechas fijos: se puede aplicar dos veces igual (W07),
-- y va de verdad desde la rama (W05):
--
--   · la 55100001 del socio (para que salga con F4 entre las cuentas de pago);
--   · una plataforma de prueba: su canal, su contacto con los dos papeles
--     (proveedor y plataforma), su proveedor con su 40000073 y su cliente con
--     su 43000091 (la que descuenta la liquidación);
--   · por cada tamaño de la e2e (1 = 1456, 2 = 1366), una liquidación de la
--     plataforma y una factura de comisión leída, por revisar, ligada a ella
--     (channel_settlement_invoice): la que se paga con la 430.
-- ============================================================================
do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  k_canal   constant uuid := 'c0e60000-0000-4000-8000-0000000000c0';
  k_party   constant uuid := 'c0e60000-0000-4000-8000-0000000000d0';
  k_prov    constant uuid := 'c0e60000-0000-4000-8000-0000000000a0';
  cuando    constant timestamptz := '2026-11-20 08:00:00+00';
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K06 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.company_account where company_id = k_emp2 and code = '62800000') then
    raise exception 'Semilla K06: faltan las cuentas de la ficha recibida del núcleo (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;
  -- 1 · Las cuentas: la del socio, la del proveedor y la del cliente de la plataforma.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values
    (k_cuenta, k_emp2, 'pymes', '55100001', '551', 'Socio de Prueba', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '40000073', '4000', 'Plataforma de Prueba K06', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '43000091', '4300', 'Plataforma de Prueba K06', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;
  -- 2 · La plataforma: su canal, su contacto (proveedor y plataforma), su proveedor y sus dos subcuentas.
  insert into public.sales_channel (id, account_id, name, slug, channel_type, created_at)
  values (k_canal, k_cuenta, 'Plataforma de Prueba K06', 'plataforma-de-prueba-k06', 'delivery', cuando)
  on conflict (id) do nothing;
  insert into public.party (id, account_id, name, tax_id, source, created_at, updated_at)
  values (k_party, k_cuenta, 'Plataforma de Prueba K06, S.L.', 'B00000745', 'manual', cuando, cuando)
  on conflict (id) do nothing;
  insert into public.supplier (id, account_id, name, legal_name, tax_id, created_by_name, created_at)
  values (k_prov, k_cuenta, 'Plataforma de Prueba K06, S.L.', 'Plataforma de Prueba K06, S.L.', 'B00000745', 'Semilla K06', cuando)
  on conflict (id) do nothing;
  insert into public.party_role (account_id, party_id, role, supplier_id)
  select k_cuenta, k_party, 'supplier', k_prov where not exists (select 1 from public.party_role where party_id = k_party and role = 'supplier');
  insert into public.party_role (account_id, party_id, role, channel_id)
  select k_cuenta, k_party, 'platform', k_canal where not exists (select 1 from public.party_role where party_id = k_party and role = 'platform');
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, x.entidad, x.de, 'principal', 'manual'
    from (values ('40000073', 'supplier', k_prov::text), ('43000091', 'customer', k_party::text)) x(codigo, entidad, de)
    join public.company_account a on a.company_id = k_emp2 and a.code = x.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;
  -- 3 · Por cada tamaño, su liquidación y su factura de comisión leída, por revisar, ligada a ella.
  insert into public.channel_settlement (id, account_id, channel_id, party_id, settlement_ref, period_from, period_to, settlement_date, currency,
                                         commission, net_payout, source, import_key, needs_review, created_by_name, created_at, updated_at)
  select ('c0e60000-0000-4000-8000-0000000000e' || t)::uuid, k_cuenta, k_canal, k_party, 'LIQ-K06-' || t,
         date '2026-10-01', date '2026-10-07', date '2026-10-10', 'EUR', 50 + t, 900, 'manual', 'semilla-k06-' || t, false, 'Semilla K06', cuando, cuando
    from generate_series(1, 2) t
  on conflict (id) do nothing;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e60000-0000-4000-8000-0000000000b' || t)::uuid, k_cuenta, k_emp2, k_prov, 'K06P-' || t || '-1', date '2026-10-08', date '2026-10-10',
         'en_revision', 'ocr', round((50 + t) * 1.21, 2), 50 + t, round((50 + t) * 0.21, 2), true, 'Semilla K06', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K06).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', 'Plataforma de Prueba K06, S.L.', 'nif', 'B00000745'),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', null),
             'numero', 'K06P-' || t || '-1', 'fecha', '2026-10-08', 'vencimiento', '2026-10-10',
             'base', 50 + t, 'cuota', round((50 + t) * 0.21, 2), 'total', round((50 + t) * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from generate_series(1, 2) t
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Comisión de la plataforma, del 01/10 al 07/10', 1, null, i.tax_base_total, 21, 1, '62800000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);
  insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id, matched_by, matched_by_name, created_at)
  select k_cuenta, ('c0e60000-0000-4000-8000-0000000000e' || t)::uuid, ('c0e60000-0000-4000-8000-0000000000b' || t)::uuid, 'sumied', 'Semilla K06', cuando
    from generate_series(1, 2) t
  on conflict (supplier_invoice_id) do nothing;

  select count(*) into v_n from public.channel_settlement_invoice k join public.supplier_invoice i on i.id = k.supplier_invoice_id
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06';
  if v_n <> 2 then raise exception 'Semilla K06: hay % facturas de plataforma ligadas y tenían que ser 2.', v_n; end if;
  raise notice 'Semilla K06 OK: la 55100001, la plataforma con su 40000073 y su 43000091, y % facturas de comisión ligadas a su liquidación.', v_n;
end $$;
