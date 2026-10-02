-- ============================================================================
-- C00 · Empresas de prueba en staging-conta. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Las tablas generales son de cada EMPRESA, y staging no tiene ninguna (el alta
-- conversada llega en la tarea 6). Sin empresa no hay pantalla que probar ni
-- que fotografiar. Una por cuenta, INVENTADAS, con CIF de control correcto
-- (validados con validarNifEs):
--
--   A · Taberna de Prueba Norte, S.L. · B28000016 · Madrid (península)
--       presenta 303, 390, 111, 115 y 202 · un banco y una serie de facturas
--   B · Cocina de Prueba Sur, S.L.    · B35000017 · Las Palmas (Canarias)
--       presenta 111 · sin bancos ni series (así se ve el «vacío»)
--
-- B en Canarias a propósito: «Los que usas» tiene que subir el IGIC y bajar el
-- IVA. Ni una fila de producción ni de Folvy Interno. Idempotente.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  emp_a uuid; emp_b uuid;
begin
  select id into emp_a from public.company where account_id = a_cuenta and tax_id = 'B28000016';
  if emp_a is null then
    insert into public.company (account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
      fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
      setup_step, setup_completed_at, created_by)
    values (a_cuenta, 'Taberna de Prueba Norte, S.L.', 'Taberna de Prueba Norte', 'B28000016', 'nif_es', 'company',
      'Calle', 'de la Prueba', '12', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), a_user)
    returning id into emp_a;
    insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms)
    values (emp_a, a_cuenta, 'peninsula_baleares', 'quarterly', 'pymes', 8, array['303', '390', '111', '115', '202']);
    -- IBAN de ejemplo de la documentación bancaria (válido por su control, no es de nadie).
    insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, created_by)
    values (a_cuenta, emp_a, 'bank', 'Cuenta principal', 'ES9121000418450200051332', '572', true, a_user);
    insert into public.invoice_series (account_id, company_id, code, name, doc_type, digits, is_default, created_by)
    values (a_cuenta, emp_a, 'F', 'Facturas', 'invoice', 6, true, a_user);
  end if;

  select id into emp_b from public.company where account_id = b_cuenta and tax_id = 'B35000017';
  if emp_b is null then
    insert into public.company (account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
      fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
      setup_step, setup_completed_at)
    values (b_cuenta, 'Cocina de Prueba Sur, S.L.', 'Cocina de Prueba Sur', 'B35000017', 'nif_es', 'company',
      'Calle', 'del Ensayo', '3', '35001', 'Las Palmas de Gran Canaria', 'Las Palmas', 'ES', 'hecho', now())
    returning id into emp_b;
    insert into public.company_tax_profile (company_id, account_id, tax_territory, vat_period, chart_kind, account_digits, tax_forms)
    values (emp_b, b_cuenta, 'canarias', 'quarterly', 'pymes', 8, array['111']);
  end if;

  raise notice 'EMPRESAS DE PRUEBA: A % · B % · empresas en total: %', emp_a, emp_b, (select count(*) from public.company);
end $$;
