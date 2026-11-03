-- supabase/vuelta-atras/20261102T2011_s01q_no_duplicar.down.sql
--
-- Vuelta atrás de la 2011: fuera las reglas 1 a 4 (sus disparadores, el índice
-- único y sus funciones). No toca ningún dato.
drop trigger if exists trg_customer_invoice_payment_tope on public.customer_invoice_payment;
drop trigger if exists trg_supplier_invoice_payment_tope on public.supplier_invoice_payment;
drop index if exists public.ux_customer_invoice_entry;
drop trigger if exists trg_customer_invoice_un_asiento on public.customer_invoice;
drop trigger if exists trg_journal_entry_no_antes_del_corte on public.journal_entry;
drop trigger if exists trg_journal_entry_factura_una_vez on public.journal_entry;
drop function if exists public.tg_invoice_payment_tope();
drop function if exists public._conta_s01q_como_se_pago(text, boolean);
drop function if exists public.tg_customer_invoice_un_asiento();
drop function if exists public.tg_journal_entry_no_antes_del_corte();
drop function if exists public.tg_journal_entry_factura_una_vez();
drop function if exists public._conta_factura_en_otro_asiento(uuid, uuid);
drop function if exists public._conta_s01q_euros(numeric);
