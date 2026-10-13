-- ============================================================================
-- D01 · Tres CHECK que se AMPLÍAN (solo admiten más; nada de lo que vale hoy
-- deja de valer). Van aparte de la 0200 porque son «cambiar en caliente»:
--
-- cambia: public.supplier_contact · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.company_account_link · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
--
--   1. supplier_contact.role + 'billing' («Facturación»): a quién se le pide la
--      factura que no llega (R1, punto 5).
--   2. company_account_link.source + 'aprendido_diez': «Sus facturas se apuntan
--      en» rellenado desde el histórico de Diez al confirmar (R1, punto 2).
--   3. journal_entry_document.kind + 'factura_recibida': el PDF de la factura
--      recibida, enlazado a su asiento en conta-documentos (R1, punto 4). La
--      prueba comprueba que 'resumen_ventas' sigue valiendo igual, y la del
--      R15 (20261021_conta_documentos_prueba.sql) vuelve a pasar después.
--
-- Cada CHECK se quita y se vuelve a poner en la MISMA transacción, con los
-- valores de antes y uno más. Las tres tablas son pequeñas.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0210_d01_amplia.down.sql
-- ============================================================================

alter table public.supplier_contact drop constraint if exists supplier_contact_role_check;
alter table public.supplier_contact add constraint supplier_contact_role_check
  check (role = any (array['orders', 'sales', 'admin', 'delivery', 'other', 'billing']));

alter table public.company_account_link drop constraint if exists company_account_link_source_check;
alter table public.company_account_link add constraint company_account_link_source_check
  check (source = any (array['serie', 'manual', 'ai_accepted', 'migrated', 'aprendido_diez']));

alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas', 'factura_recibida']));
