-- supabase/seeds/conta/seed_c05_staging.sql
--
-- C05 · Libros y balances, en staging-conta. SOLO STAGING. Todo inventado; nada
-- copiado de producción. Se puede volver a lanzar: ids fijos, «si no está».
-- Después de las migraciones del C05 y de la semilla del C04.
--
-- Cuenta A (Taberna de Prueba Norte, empresa 3b34403a…):
--   1. El ejercicio 2025, TRAÍDO de otro programa y cerrado allí: la columna
--      del año anterior sale «traído» y no se recalcula su cierre.
--   2. Un bien de inversión (un horno, 6.200 € de base al 21 %).
--   3. El rango de tiques del resumen de ventas del 04/10 (Norte Centro), con
--      «Completar» como lo haría la pantalla: el libro lo enseña «F4 ·
--      resumen · art. 63.4 · T1-000101–T1-000105 · 5 tiques».
--   4. Una rectificativa de Hermanos Ruiz (abono de 50 € + IVA 10 % sobre la
--      F-2026-0915), propuesta y validada con las funciones del libro: R1 en
--      recibidas, base y cuota en negativo.
--   5. Un cambio de mapeo propio: «Transportes» (624) a Aprovisionamientos,
--      con su motivo, en el historial.
-- Cuenta B (Cocina de Prueba Sur, sin locales en Contabilidad): nada nuevo; el
-- e2e mira que su PyG no ofrece «Por local».

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  y25 constant uuid := 'c0500000-0000-4000-8000-000000002025';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C05: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regclass('public.vat_book_entry') is null then raise exception 'Semilla C05: faltan las migraciones del C05.'; end if;
  if not exists (select 1 from public.supplier_invoice where id = '95cf35ac-3035-4204-9872-70a589dde870') then
    raise exception 'Semilla C05: falta la factura F-2026-0915 de la semilla del C04.';
  end if;

  -- 1 · 2025, traído y cerrado.
  insert into public.fiscal_year (id, account_id, company_id, code, starts_on, ends_on, status, closed_at, origin, origin_program, imported_until)
  values (y25, a, ea, '2025', '2025-01-01', '2025-12-31', 'closed', '2026-03-31', 'migrated', 'Otro programa', '2025-12-31')
  on conflict (id) do nothing;
  update public.fiscal_year set previous_year_id = y25
   where company_id = ea and code = '2026' and previous_year_id is null;

  -- 3 · El rango de tiques del resumen del 04/10 (lo que manda el TPV).
  update public.sales_day_summary set first_invoice = 'T1-000101', last_invoice = 'T1-000105'
   where company_id = ea and sales_day = '2026-10-04' and first_invoice is null;

  -- 4 · La rectificativa (el documento; el asiento, abajo como el administrador).
  insert into public.supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status, grand_total, doc_kind, corrects_invoice_id, created_by_name)
  values ('c0500000-0000-4000-8000-000000000101', a, 'c01a0000-0000-4000-8000-0000000000a3', 'c01a0000-0000-4000-8000-0000000000a2',
          'AB-2026-031', '2026-10-02', 'aprobada', -55.00, 'credit_note', '95cf35ac-3035-4204-9872-70a589dde870', 'semilla C05')
  on conflict (id) do nothing;
end $$;

-- ── Cuenta A, como su administrador ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  l1 constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  iva10 uuid := (select id from public.tax_rate where code = 'iva_reducido' and is_system and valid_to is null limit 1);
  r jsonb; v_id uuid; v_modelo text;
begin
  -- 2 · El horno.
  if not exists (select 1 from public.investment_good where company_id = ea and description = 'Horno mixto de 10 bandejas (semilla C05)') then
    insert into public.investment_good (account_id, company_id, description, kind, acquired_on, start_use_on, acquisition_value, tax_base, vat_rate, vat_amount, deductible_pct, created_by_name)
    values (a, ea, 'Horno mixto de 10 bandejas (semilla C05)', 'mueble', '2026-03-02', '2026-03-10', 7502.00, 6200.00, 21, 1302.00, 100, 'Ana Prueba');
  end if;

  -- 3 · «Completar» el rango en su anotación del libro registro.
  update public.vat_book_entry v set number = 'T1-000101', number_to = 'T1-000105', updated_at = now(), updated_by_name = 'Ana Prueba'
    from public.sales_day_summary d
   where d.company_id = ea and d.sales_day = '2026-10-04' and v.entry_id = d.entry_id and v.number is null;

  -- 4 · El asiento de la rectificativa: proveedor al Debe, compras y su IVA al Haber.
  if not exists (select 1 from public.journal_entry where company_id = ea and source_type = 'supplier_invoice' and source_id = 'c0500000-0000-4000-8000-000000000101') then
    r := public.journal_entry_proponer(ea,
      jsonb_build_object('series', 2, 'fecha', '2026-10-02', 'concepto', 'Abono Hermanos Ruiz · AB-2026-031', 'source_type', 'supplier_invoice',
        'source_id', 'c0500000-0000-4000-8000-000000000101', 'documento', 'AB-2026-031', 'confianza', 'seguro',
        'porque', 'rectificativa de la F-2026-0915: mercancía devuelta, al 10 %.', 'razones', '[]'::jsonb),
      jsonb_build_array(
        jsonb_build_object('cuenta', '40000002', 'debe', 55.00, 'local_id', l1),
        jsonb_build_object('cuenta', '60000000', 'haber', 50.00, 'local_id', l1),
        jsonb_build_object('cuenta', '47200010', 'haber', 5.00, 'local_id', l1,
          'iva', jsonb_build_object('tipo_id', iva10, 'base', 50.00, 'libro', 'received', 'deducible', 'yes'))), null, 'Folvy');
    perform public.journal_entry_validar((r->>'id')::uuid, 'Ana Prueba');
  end if;

  -- 5 · Un cambio de mapeo propio, con su motivo.
  select case when (select plan from public.company_account where company_id = ea limit 1) = 'general' then 'abreviado' else 'pymes' end into v_modelo;
  if not exists (select 1 from public.annual_accounts_mapping where company_id = ea and account_prefix = '624' and statement = 'pyg') then
    perform public.conta_mapeo_cambiar(ea, v_modelo, 'pyg', '624', '4', null, 'El transporte que pagamos es el de la mercancía comprada (semilla C05).');
  end if;
end $$;
