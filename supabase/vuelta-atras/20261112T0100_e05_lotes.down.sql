-- supabase/vuelta-atras/20261112T0100_e05_lotes.down.sql
-- Deshace la 0100 (E05, los lotes de Catcher), en orden inverso. Las facturas
-- que hubiera dado de alta un lote se quedan (son facturas en revisión de la
-- cuenta), pero sin su lote ni su emisor: por eso no se deshace con lotes ya
-- subidos sin mirarlo antes (lo cuenta la tanda).

-- Freno: con algún lote subido, no se borra nada (se perderían sus pedidos y el
-- emisor de sus facturas). Para y lo dice.
do $$
declare n int; f int;
begin
  if to_regclass('public.supplier_batch') is null then return; end if;
  execute 'select count(*) from public.supplier_batch' into n;
  if n > 0 then
    select count(*) into f from public.supplier_invoice where source = 'lote';
    raise exception 'VUELTA ATRÁS 0100 PARADA: hay % lote(s) subido(s) con % factura(s). Deshacerla borraría sus pedidos y el emisor de esas facturas: no se toca nada. Hay que decidir antes qué se hace con ellos.', n, f
      using errcode = 'P0001';
  end if;
end $$;

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
