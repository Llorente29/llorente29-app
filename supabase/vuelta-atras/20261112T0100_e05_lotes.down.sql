-- supabase/vuelta-atras/20261112T0100_e05_lotes.down.sql
-- Deshace la 0100 (E05, los lotes de Catcher), en orden inverso. Las facturas
-- que hubiera dado de alta un lote se quedan (son facturas en revisión de la
-- cuenta), pero sin su lote ni su emisor: por eso no se deshace con lotes ya
-- subidos sin mirarlo antes (lo cuenta la tanda).

drop function if exists public.conta_lote_registrar(uuid, jsonb, text);
drop table if exists public.supplier_batch_store;
drop table if exists public.supplier_batch_order;
drop index if exists public.supplier_invoice_lote_idx;
alter table public.supplier_invoice drop column if exists batch_id;
drop table if exists public.supplier_batch;
alter table public.supplier_invoice drop constraint if exists supplier_invoice_source_check;
alter table public.supplier_invoice add constraint supplier_invoice_source_check check (source in ('manual', 'ocr'));
alter table public.supplier_invoice drop column if exists issuer_address;
alter table public.supplier_invoice drop column if exists issuer_tax_id;
alter table public.supplier_invoice drop column if exists issuer_name;
