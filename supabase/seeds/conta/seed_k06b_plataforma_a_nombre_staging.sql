-- ============================================================================
-- K06b · La factura de comisión de la e2e de la cuenta del pago, a nombre de la
-- gestoría. SOLO STAGING. Todo inventado (T11).
--
-- La e2e a mano 44715124011 no pudo validar la K06P-<t>-1 de la semilla K06:
-- su lectura no traía el NIF del destinatario, y la base no valida sin saber a
-- nombre de quién va («No he podido leer a nombre de quién va esta factura»).
-- La K06 ya está de verdad en staging y una semilla solo añade, así que van
-- aparte, como hizo el K04b:
--
--   · la cuenta de gasto de la plataforma en su ficha (62800000, «gasto»);
--   · por cada tamaño (1 = 1456, 2 = 1366), la K06P-<t>-2: leída, por revisar,
--     con el destinatario y el NIF de la gestoría, ligada a la misma liquidación.
--
-- Solo AÑADE, con ids y fechas fijos: se puede aplicar dos veces igual (W07),
-- y va de verdad desde la rama (W05).
-- ============================================================================
do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  k_prov    constant uuid := 'c0e60000-0000-4000-8000-0000000000a0';
  cuando    constant timestamptz := '2026-11-20 12:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K06b ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K06b: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.supplier where id = k_prov and account_id = k_cuenta) then
    raise exception 'Semilla K06b: falta la plataforma de prueba (seed_k06_cuenta_de_pago_staging.sql). Aplícala antes.';
  end if;
  -- 1 · La cuenta de gasto de la plataforma, en su ficha.
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', k_prov::text, 'gasto', 'manual'
    from public.company_account a where a.company_id = k_emp2 and a.code = '62800000'
  on conflict (company_id, entity, entity_id, role) do nothing;
  -- 2 · Por cada tamaño, la K06P-<t>-2, a nombre de la gestoría, ligada a su liquidación.
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e60000-0000-4000-8000-0000000001b' || t)::uuid, k_cuenta, k_emp2, k_prov, 'K06P-' || t || '-2', date '2026-10-09', date '2026-10-10',
         'en_revision', 'ocr', round((40 + t) * 1.21, 2), 40 + t, round((40 + t) * 0.21, 2), true, 'Semilla K06b', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K06b).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', 'Plataforma de Prueba K06, S.L.', 'nif', 'B00000745'),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', 'K06P-' || t || '-2', 'fecha', '2026-10-09', 'vencimiento', '2026-10-10',
             'base', 40 + t, 'cuota', round((40 + t) * 0.21, 2), 'total', round((40 + t) * 1.21, 2), 'desgloseDe', 'papel')),
         cuando, cuando
    from generate_series(1, 2) t
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06b'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Comisión de la plataforma, del 01/10 al 07/10', 1, null, i.tax_base_total, 21, 1, '62800000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06b'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);
  insert into public.channel_settlement_invoice (account_id, settlement_id, supplier_invoice_id, matched_by, matched_by_name, created_at)
  select k_cuenta, ('c0e60000-0000-4000-8000-0000000000e' || t)::uuid, ('c0e60000-0000-4000-8000-0000000001b' || t)::uuid, 'sumied', 'Semilla K06b', cuando
    from generate_series(1, 2) t
  on conflict (supplier_invoice_id) do nothing;

  select count(*) into v_n from public.channel_settlement_invoice k join public.supplier_invoice i on i.id = k.supplier_invoice_id
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K06b' and i.reading -> 'factura' -> 'destinatario' ->> 'nif' = v_nif;
  if v_n <> 2 then raise exception 'Semilla K06b: hay % facturas de plataforma a nombre de la gestoría y ligadas, y tenían que ser 2.', v_n; end if;
  raise notice 'Semilla K06b OK: la 62800000 en la ficha de la plataforma y % facturas de comisión a nombre de la gestoría, ligadas a su liquidación.', v_n;
end $$;
