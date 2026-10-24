-- supabase/vuelta-atras/20261121T0150_s01_recibidas_asiento_por_origen.down.sql
--
-- Vuelta atrás de 20261121T0150: banco_facturas_recibidas_pendientes como
-- estaba (20261021T0200, la vigente el 17/10), tal cual: journal_entry_id
-- vuelve a ser la columna de la factura.

create or replace function public.banco_facturas_recibidas_pendientes(p_company uuid, p_hasta date default null)
returns table (
  invoice_id uuid, supplier_id uuid, supplier_name text, supplier_tax_id text,
  invoice_number text, invoice_date date, due_date date,
  total numeric, pending numeric, read_iban text, journal_entry_id uuid, status text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return query
  select i.id, i.supplier_id, s.name, s.tax_id, i.invoice_number, i.invoice_date, i.due_date,
         i.grand_total, i.grand_total, i.read_iban, i.journal_entry_id, i.status
    from public.supplier_invoice i
    left join public.supplier s on s.id = i.supplier_id and s.account_id = v_acc
   where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
     and i.status in ('en_revision', 'aprobada', 'con_discrepancias') and i.paid_at is null
     and i.doc_kind = 'invoice'
     and (p_hasta is null or coalesce(i.due_date, i.invoice_date) <= p_hasta)
   order by coalesce(i.due_date, i.invoice_date), i.invoice_number;
end $$;
comment on function public.banco_facturas_recibidas_pendientes(uuid, date) is
  'D01 · Para B (Bancos): facturas recibidas de una empresa que no están pagadas, con su vencimiento e IBAN leído. Contrato estable: solo se añaden columnas al final.';
