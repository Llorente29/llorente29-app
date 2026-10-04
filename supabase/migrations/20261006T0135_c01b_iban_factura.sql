-- supabase/migrations/20261006T0135_c01b_iban_factura.sql
--
-- C01b, respuesta 2, punto 1 · IBAN DISTINTO EN UNA FACTURA = aviso y freno.
-- Defensa contra el fraude del «cambio de cuenta» (Pennylane lo hace).
--
-- SOLO AÑADE: columnas nuevas (nulas), una función nueva, un disparador nuevo.
-- No cambia ni borra nada que exista.
--
--   supplier_invoice.read_iban         El IBAN que trae la factura, tal y como
--                                      lo leyó la lectura (sin espacios, en
--                                      mayúsculas). Hoy ninguna lectura lo
--                                      rellena: llega con la de facturas (C02).
--   supplier_invoice.iban_decision_*   Lo que decidió una persona:
--                                      'es_el_nuevo' o 'no_es_suyo', quién y cuándo.
--   supplier.iban_previous             El IBAN de antes del último cambio.
--   supplier.iban_changed_*            Quién cambió el IBAN desde una factura y
--                                      cuándo. El certificado del banco vale
--                                      solo si es posterior (núcleo).
--
--   supplier_invoice_iban_decide()     La decisión. SECURITY INVOKER: pasa por la
--                                      RLS. «Es el nuevo» escribe la ficha, así
--                                      que exige administrador o encargado
--                                      (política supplier_update).
--   supplier_invoice_iban_guard        Disparador BEFORE UPDATE: rechaza pasar
--                                      a «pagada» una factura con IBAN distinto
--                                      y sin decidir, venga de donde venga
--                                      (la ficha, Compras o un update directo).
--
-- La regla es la del núcleo (src/modules/conta/lib/ibanFactura.ts, probada):
-- frena solo si la factura trae IBAN, la ficha tiene IBAN, son distintos y
-- nadie ha decidido. Hoy read_iban es NULL en todas las facturas, así que el
-- disparador no frena nada hasta que una lectura lo rellene.
--
-- Camino del pedido, medido en producción (solo lectura) el 04/10 a las 14:06:
--   · pg_trigger en supplier_invoice: 1, trg_set_supplier_invoice_code (el código).
--   · cron.job que nombre supplier_invoice: 0.
--   · pg_proc que nombran supplier_invoice: 9, todas de compras
--     (next_supplier_invoice_code, run_invoice_match, invoice_required_role,
--     current_user_can_approve_invoice, refresh_supplier_proposals,
--     mark/unmark_supplier_invoice_paid, set_supplier_invoice_due_date,
--     apply_invoice_costs). Ninguna pasa a 'pagada' salvo mark_supplier_invoice_paid.
--   · supplier_invoice: 1 fila en toda la base (Foodint).
-- El disparador nuevo solo actúa al pasar a 'pagada'.

-- ── 1. Columnas ─────────────────────────────────────────────────────────
alter table public.supplier_invoice
  add column read_iban               text,
  add column iban_decision           text,
  add column iban_decision_at        timestamptz,
  add column iban_decision_by        uuid,
  add column iban_decision_by_name   text,
  add constraint supplier_invoice_read_iban_format_check
    check (read_iban is null or read_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  add constraint supplier_invoice_iban_decision_check
    check (iban_decision is null or iban_decision in ('es_el_nuevo', 'no_es_suyo'));

comment on column public.supplier_invoice.read_iban is
  'C01b · IBAN que trae la factura, leído (sin espacios, mayúsculas). Si no es el de la ficha, frena el pago hasta que una persona decida.';
comment on column public.supplier_invoice.iban_decision is
  'C01b · Decisión sobre un IBAN distinto: es_el_nuevo (pasa a la ficha) o no_es_suyo (se paga al de la ficha).';

alter table public.supplier
  add column iban_previous          text,
  add column iban_changed_at        timestamptz,
  add column iban_changed_by        uuid,
  add column iban_changed_by_name   text;

comment on column public.supplier.iban_changed_at is
  'C01b · Cuándo se cambió el IBAN desde una factura («Es el nuevo IBAN»). El certificado del banco anterior deja de valer.';

-- ── 2. La decisión ──────────────────────────────────────────────────────
create function public.supplier_invoice_iban_decide(p_invoice_id uuid, p_decision text, p_quien_nombre text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv public.supplier_invoice%rowtype;
begin
  if p_decision is null or p_decision not in ('es_el_nuevo', 'no_es_suyo') then
    raise exception 'Esa decisión no existe.' using errcode = '22023';
  end if;
  select * into v_inv from public.supplier_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Esa factura no existe o no es de tu cuenta.' using errcode = 'P0002'; end if;
  if v_inv.read_iban is null then raise exception 'Esa factura no trae IBAN.' using errcode = '22023'; end if;
  if v_inv.supplier_id is null then raise exception 'Esa factura no tiene proveedor.' using errcode = '22023'; end if;

  if p_decision = 'es_el_nuevo' then
    update public.supplier
       set iban_previous = iban,
           iban = v_inv.read_iban,
           iban_verified_at = now(),
           iban_changed_at = now(),
           iban_changed_by = auth.uid(),
           iban_changed_by_name = p_quien_nombre,
           updated_at = now()
     where id = v_inv.supplier_id;
    if not found then
      raise exception 'Solo un administrador o encargado puede cambiar el IBAN de la ficha.' using errcode = '42501';
    end if;
  end if;

  update public.supplier_invoice
     set iban_decision = p_decision, iban_decision_at = now(),
         iban_decision_by = auth.uid(), iban_decision_by_name = p_quien_nombre
   where id = p_invoice_id;
end $$;
comment on function public.supplier_invoice_iban_decide(uuid, text, text) is
  'C01b · Una persona decide sobre el IBAN distinto de una factura: es_el_nuevo (a la ficha, con quién y cuándo) o no_es_suyo.';

revoke all on function public.supplier_invoice_iban_decide(uuid, text, text) from public, anon;
grant execute on function public.supplier_invoice_iban_decide(uuid, text, text) to authenticated;

-- ── 3. El freno ─────────────────────────────────────────────────────────
create function public.supplier_invoice_iban_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ficha text;
begin
  if new.status = 'pagada' and old.status is distinct from 'pagada'
     and new.read_iban is not null and new.iban_decision is null then
    select upper(regexp_replace(s.iban, '\s', '', 'g')) into v_ficha
      from public.supplier s where s.id = new.supplier_id;
    if v_ficha is not null and v_ficha <> upper(regexp_replace(new.read_iban, '\s', '', 'g')) then
      raise exception 'IBAN distinto al de la ficha: decide si es el nuevo IBAN o no es suyo antes de marcarla como pagada.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
comment on function public.supplier_invoice_iban_guard() is
  'C01b · Rechaza pagar una factura con IBAN distinto al de la ficha y sin decidir. Misma regla que src/modules/conta/lib/ibanFactura.ts.';

create trigger supplier_invoice_iban_guard
  before update of status on public.supplier_invoice
  for each row execute function public.supplier_invoice_iban_guard();
