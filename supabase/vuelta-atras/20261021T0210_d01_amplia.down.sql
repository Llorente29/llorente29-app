-- Vuelta atrás de 20261021T0210 (D01): los tres CHECK como estaban.
-- PARA si alguna fila ya usa lo nuevo: quitarlo rompería el CHECK y, peor,
-- obligaría a cambiar datos de una persona. Entonces no se toca nada.
do $$
begin
  if exists (select 1 from public.supplier_contact where role = 'billing') then
    raise exception 'Vuelta atrás D01 0210: hay % contacto(s) de facturación; no se quita nada.', (select count(*) from public.supplier_contact where role = 'billing');
  end if;
  if exists (select 1 from public.company_account_link where source = 'aprendido_diez') then
    raise exception 'Vuelta atrás D01 0210: hay enlaces aprendidos de Diez; no se quita nada.';
  end if;
  if exists (select 1 from public.journal_entry_document where kind = 'factura_recibida') then
    raise exception 'Vuelta atrás D01 0210: hay documentos de facturas recibidas; no se quita nada.';
  end if;
end $$;
drop function if exists public.supplier_invoice_repetidas_que_hay(uuid);
drop trigger if exists trg_supplier_invoice_no_repetida on public.supplier_invoice;
drop function if exists public.tg_supplier_invoice_no_repetida();
alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check check (kind = 'resumen_ventas');
alter table public.company_account_link drop constraint if exists company_account_link_source_check;
alter table public.company_account_link add constraint company_account_link_source_check
  check (source = any (array['serie', 'manual', 'ai_accepted', 'migrated']));
alter table public.supplier_contact drop constraint if exists supplier_contact_role_check;
alter table public.supplier_contact add constraint supplier_contact_role_check
  check (role = any (array['orders', 'sales', 'admin', 'delivery', 'other']));
