-- supabase/migrations/20261121T0150_s01_recibidas_asiento_por_origen.sql
-- cambia: banco_facturas_recibidas_pendientes · prueba: supabase/staging/sql/20261121_s01_recibidas_asiento_prueba.sql
--
-- S01 · El enlace factura-asiento es uno solo: journal_entry.source_type +
-- source_id, con su índice único para los asientos vivos (ux_journal_entry_origen).
-- Inventario del paso 1, §11 (paso 1 de 2): el front y esta función dejan de
-- leer supplier_invoice.journal_entry_id, que nadie escribe (0 de 7 en
-- producción, 17/10). La columna se quita en otra tanda (destruir, «autorizo»).
--
-- CAMBIAR EN CALIENTE: la MISMA firma (p_company uuid, p_hasta date) y el MISMO
-- contrato —las mismas columnas, con el mismo nombre, tipo y orden («solo se
-- añaden columnas al final»)— y el MISMO cuerpo que la vigente (20261021T0200,
-- md5 de pg_get_functiondef f6e2f68f6d1fcec1618f255e57929812 en producción y en
-- staging el 17/10), con un cambio y nada más:
--   · journal_entry_id ya no es la columna de la factura (siempre nula): es el
--     asiento vivo (propuesto, borrador o validado) de esa factura en esa
--     empresa, el que dice el índice único. Sin asiento vivo, nula, como antes.
-- Ninguna pantalla la llama hoy (la lee B por contrato).
--
-- Vuelta atrás: supabase/vuelta-atras/20261121T0150_s01_recibidas_asiento_por_origen.down.sql
-- (la de antes, tal cual).

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
         i.grand_total, i.grand_total, i.read_iban,
         (select e.id from public.journal_entry e
           where e.company_id = p_company and e.account_id = v_acc
             and e.source_type = 'supplier_invoice' and e.source_id = i.id
             and e.status in ('propuesto', 'borrador', 'validado')
           limit 1),
         i.status
    from public.supplier_invoice i
    left join public.supplier s on s.id = i.supplier_id and s.account_id = v_acc
   where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
     and i.status in ('en_revision', 'aprobada', 'con_discrepancias') and i.paid_at is null
     and i.doc_kind = 'invoice'
     and (p_hasta is null or coalesce(i.due_date, i.invoice_date) <= p_hasta)
   order by coalesce(i.due_date, i.invoice_date), i.invoice_number;
end $$;
comment on function public.banco_facturas_recibidas_pendientes(uuid, date) is
  'D01 · Para B (Bancos): facturas recibidas de una empresa que no están pagadas, con su vencimiento e IBAN leído. Contrato estable: solo se añaden columnas al final. S01 (0150): journal_entry_id es el asiento vivo de la factura (source_type + source_id).';
