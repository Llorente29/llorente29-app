-- ============================================================================
-- D01 · Tres CHECK que se AMPLÍAN (solo admiten más; nada de lo que vale hoy
-- deja de valer). Van aparte de la 0200 porque son «cambiar en caliente»:
--
-- cambia: public.supplier_contact · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.company_account_link · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
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
--   4. supplier_invoice: la REGLA ÚNICA de repetidas en la base (R1, punto 9),
--      como disparador: una factura NUEVA (o a la que se le cambia el número o
--      el proveedor) no entra si ya hay otra viva del mismo proveedor con la
--      misma clave de número, salvo que una persona haya dicho «No es
--      repetida». Las que YA estuvieran repetidas no se tocan ni se borran: se
--      listan con supplier_invoice_repetidas_que_hay() y se decide (staging
--      tiene dos a propósito, las del «¿Repetida?» del C01b; producción, 0,
--      medido el 13/10). No va como índice único porque el índice no se puede
--      crear donde ya hay repetidas sin borrarlas.
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

-- 4. La regla única de repetidas ---------------------------------------------------
create or replace function public.tg_supplier_invoice_no_repetida()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_otra public.supplier_invoice;
begin
  if new.status = 'anulada' or new.not_duplicate_confirmed_at is not null or new.supplier_id is null or new.number_key is null then return new; end if;
  -- En un cambio, solo si cambia lo que decide (el número, el proveedor o que deje de estar anulada).
  if tg_op = 'UPDATE' and new.number_key is not distinct from old.number_key and new.supplier_id is not distinct from old.supplier_id
     and not (old.status = 'anulada' and new.status <> 'anulada') then return new; end if;
  select * into v_otra from public.supplier_invoice i
   where i.account_id = new.account_id and i.supplier_id = new.supplier_id and i.number_key = new.number_key
     and i.id <> new.id and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   order by i.created_at limit 1;
  if v_otra.id is not null then
    raise exception 'Repetida: ya está la factura % de este proveedor (%). No entra dos veces; si no es la misma, márcala «No es repetida».',
      v_otra.invoice_number, coalesce(v_otra.code, v_otra.id::text) using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_invoice_no_repetida on public.supplier_invoice;
create trigger trg_supplier_invoice_no_repetida
  before insert or update of invoice_number, supplier_id, status, not_duplicate_confirmed_at on public.supplier_invoice
  for each row execute function public.tg_supplier_invoice_no_repetida();

-- Las que ya estaban repetidas: se listan para decidir, no se tocan.
create or replace function public.supplier_invoice_repetidas_que_hay(p_account uuid)
returns table (supplier_id uuid, number_key text, facturas integer, ids uuid[])
language sql stable security definer set search_path = public as $$
  select i.supplier_id, i.number_key, count(*)::int, array_agg(i.id order by i.created_at)
    from public.supplier_invoice i
   where i.account_id = p_account and (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role')
     and i.number_key is not null and i.supplier_id is not null and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   group by 1, 2 having count(*) > 1
$$;
revoke all on function public.supplier_invoice_repetidas_que_hay(uuid) from public, anon;
grant execute on function public.supplier_invoice_repetidas_que_hay(uuid) to authenticated, service_role;
