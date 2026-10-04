-- ============================================================================
-- VUELTA ATRÁS de 20261002T0100_c01_ficha_proveedor_estructura.sql
-- ----------------------------------------------------------------------------
-- Respuesta 7 del C00. Deja supplier, supplier_invoice y compliance_document
-- como estaban en producción (leído el 04/10/2026 en solo lectura: ninguna de
-- las columnas nuevas existía y la restricción de doc_family tenía nueve
-- familias). Quita también lo que solo el C01 usa: sus tres tablas
-- (supplier_contact, supplier_proposal, supplier_invoice_payment_log) y sus
-- funciones, que leen las columnas que aquí se quitan.
--
-- expense_category se QUEDA: la usa el C00 (tablas generales). Las
-- restricciones de las columnas nuevas se van con ellas.
--
-- Va la ÚLTIMA si hay que volver atrás de la tanda (después de las de la 0140
-- y la 0110 del C00). El C00 queda aplicado, pero con el interruptor `conta`
-- apagado nadie llama a sus funciones.
--
-- No borra datos en silencio: si alguna de las columnas o tablas que quita
-- tiene algo, para antes de tocar nada y dice qué.
-- ============================================================================

-- La guarda: si algo de lo que se quita tiene datos, para antes de tocar nada.
\ir 20261002T0100_c01_ficha_proveedor_estructura.down.guarda.sql

-- Funciones del C01 (leen las columnas que se quitan).
drop function if exists public.mark_supplier_invoice_paid(uuid, date, text);
drop function if exists public.unmark_supplier_invoice_paid(uuid);
drop function if exists public.set_supplier_invoice_due_date(uuid, date);
drop function if exists public.refresh_supplier_proposals(uuid);
drop function if exists public._actor_name(uuid);

-- Tablas del C01 (vacías: lo comprueba la guarda).
drop table if exists public.supplier_invoice_payment_log;
drop table if exists public.supplier_proposal;
drop table if exists public.supplier_contact;
drop function if exists public.supplier_contact_misma_cuenta();

-- supplier_invoice, como estaba.
alter table public.supplier_invoice
  drop column if exists due_date,
  drop column if exists due_date_set_by,
  drop column if exists due_date_set_name,
  drop column if exists due_date_set_at,
  drop column if exists paid_at,
  drop column if exists paid_method,
  drop column if exists paid_by,
  drop column if exists paid_by_name;

-- supplier, como estaba.
alter table public.supplier
  drop column if exists legal_name,
  drop column if exists tax_id_type,
  drop column if exists country_code,
  drop column if exists entity_kind,
  drop column if exists tax_id_verified_at,
  drop column if exists tax_id_check_status,
  drop column if exists tax_id_checked_at,
  drop column if exists fiscal_street,
  drop column if exists fiscal_postal_code,
  drop column if exists fiscal_city,
  drop column if exists fiscal_province,
  drop column if exists vat_regime,
  drop column if exists usual_vat_rates,
  drop column if exists irpf_withholding_pct,
  drop column if exists expense_category_id,
  drop column if exists default_location_id,
  drop column if exists payment_method,
  drop column if exists payment_terms_days,
  drop column if exists payment_fixed_days,
  drop column if exists iban,
  drop column if exists iban_verified_at,
  drop column if exists bank_name,
  drop column if exists ledger_account_code,
  drop column if exists website,
  drop column if exists tags,
  drop column if exists bic,
  drop column if exists sepa_mandate_ref,
  drop column if exists sepa_mandate_date,
  drop column if exists currency,
  drop column if exists early_payment_discount_pct;

-- compliance_document: las nueve familias de antes.
alter table public.compliance_document drop constraint compliance_document_doc_family_check;
alter table public.compliance_document add constraint compliance_document_doc_family_check
  check (doc_family = any (array['food_spec','chemical_spec','chemical_sds','pest_contract','pest_spec',
    'water_analysis','oil_manager','supplier_approval','other']));
