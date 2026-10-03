-- Guarda de 20261002T0100_c01_ficha_proveedor_estructura.down.sql: si algo de
-- lo que la vuelta atrás quita tiene datos, para sin tocar nada y dice qué.
-- Va aparte para poder probarla sola en staging. SOLO LEE.

do $$
declare
  d text := '';
  n int;
begin
  -- Columnas nuevas de supplier con algo escrito (las de valor por defecto, distintas de él).
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'legal_name') then
    execute $q$
      select count(*) from public.supplier where
        legal_name is not null or tax_id_type is not null or entity_kind is not null or tax_id_verified_at is not null
        or tax_id_check_status is not null or tax_id_checked_at is not null or fiscal_street is not null
        or fiscal_postal_code is not null or fiscal_city is not null or fiscal_province is not null or vat_regime is not null
        or usual_vat_rates <> '{}' or irpf_withholding_pct is not null or expense_category_id is not null
        or default_location_id is not null or payment_method is not null or payment_terms_days is not null
        or payment_fixed_days <> '{}' or iban is not null or iban_verified_at is not null or bank_name is not null
        or ledger_account_code is not null or website is not null or tags <> '{}' or bic is not null
        or sepa_mandate_ref is not null or sepa_mandate_date is not null or country_code <> 'ES' or currency <> 'EUR'
        or early_payment_discount_pct is not null $q$ into n;
    if n > 0 then d := d || format(' %s proveedores con datos en columnas nuevas;', n); end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name = 'paid_at') then
    execute $q$ select count(*) from public.supplier_invoice where due_date is not null or paid_at is not null
                 or paid_method is not null or due_date_set_at is not null $q$ into n;
    if n > 0 then d := d || format(' %s facturas con vencimiento o pago;', n); end if;
  end if;
  if to_regclass('public.supplier_contact') is not null then
    execute 'select count(*) from public.supplier_contact' into n;
    if n > 0 then d := d || format(' %s contactos;', n); end if;
  end if;
  if to_regclass('public.supplier_proposal') is not null then
    execute 'select count(*) from public.supplier_proposal' into n;
    if n > 0 then d := d || format(' %s propuestas;', n); end if;
  end if;
  if to_regclass('public.supplier_invoice_payment_log') is not null then
    execute 'select count(*) from public.supplier_invoice_payment_log' into n;
    if n > 0 then d := d || format(' %s apuntes de pago;', n); end if;
  end if;
  select count(*) into n from public.compliance_document where doc_family = 'bank_ownership_certificate';
  if n > 0 then d := d || format(' %s certificados de titularidad bancaria;', n); end if;
  if d <> '' then
    raise exception 'VUELTA ATRÁS T0100 (C01): hay datos que se perderían:%. No se toca nada.', d;
  end if;
end $$;
