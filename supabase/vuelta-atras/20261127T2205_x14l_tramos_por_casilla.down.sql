-- supabase/vuelta-atras/20261127T2205_x14l_tramos_por_casilla.down.sql
-- X14l · Devuelve la regla de un tramo por factura y tipo, y quita la casilla, su disparador y el índice nuevo. Si ya hay una
-- factura con dos tramos al mismo tipo (lo traído de ERP10 los necesita), para: la regla de antes no cabe.
do $$ begin
  if exists (select 1 from public.supplier_invoice_tax group by supplier_invoice_id, vat_pct having count(*) > 1) then
    raise exception 'X14l: hay recibidas con dos tramos de IVA al mismo tipo (casillas de ERP10): con ellas no cabe la regla de antes. No se deshace.';
  end if;
end $$;
alter table public.supplier_invoice_tax add constraint supplier_invoice_tax_supplier_invoice_id_vat_pct_key unique (supplier_invoice_id, vat_pct);
drop index if exists public.supplier_invoice_tax_tipo_y_casilla;
drop trigger if exists tg_supplier_invoice_tax_casilla on public.supplier_invoice_tax;
drop function if exists public._supplier_invoice_tax_casilla();
alter table public.supplier_invoice_tax drop constraint if exists supplier_invoice_tax_casilla_valida;
alter table public.supplier_invoice_tax drop column if exists import_position;
