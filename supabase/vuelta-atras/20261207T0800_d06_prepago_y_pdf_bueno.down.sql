-- supabase/vuelta-atras/20261207T0800_d06_prepago_y_pdf_bueno.down.sql
--
-- Vuelta atrás de 20261207T0800_d06_prepago_y_pdf_bueno, en orden inverso:
--   · conta_factura_desde_lectura otra vez como en producción antes de la
--     0800 (la de la 0220), BYTE A BYTE: md5(pg_get_functiondef)
--     c7e7811e385ce489612d491213276602. Misma firma: create or replace. Las
--     que ya cambiaron la foto por su PDF lo conservan (es el suyo), y su
--     historial también.
--   · Los dos CHECK de payment_method sin 'prepaid'. PARA si alguna fila ya lo
--     usa (Riders, con la 0810): se deshace antes la 0810, que es lo que dice
--     vuelta-atras.txt.
-- La ejecuta la prueba de staging.
CREATE OR REPLACE FUNCTION public.conta_factura_desde_lectura(p_inbox uuid, p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_in public.document_inbox;
  v_s record;
  l jsonb; f jsonb;
  v_nif text; v_prov uuid; v_rep record; v_fac uuid; v_conf text; v_texto text;
begin
  select * into v_in from public.document_inbox where id = p_inbox for update;
  if v_in.id is null then raise exception 'Esa llegada no está.' using errcode = 'P0002'; end if;
  if not (coalesce(auth.role(), '') = 'service_role' or public.current_user_is_admin_or_manager_of(v_in.account_id)) then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  if v_in.supplier_invoice_id is not null then
    return jsonb_build_object('estado', 'factura', 'factura_id', v_in.supplier_invoice_id, 'texto', 'Ya tenía su factura.');
  end if;
  select s.id, s.validation, s.parsed_result into v_s from public.goods_receipt_ai_session s where s.id = p_session and s.account_id = v_in.account_id;
  if v_s.id is null then raise exception 'Esa lectura no es de esta cuenta.' using errcode = 'P0002'; end if;
  l := v_s.validation->'factura';
  if l is null then raise exception 'La lectura no se hizo con el modo factura.' using errcode = '22023'; end if;
  f := l->'factura';

  -- ¿Es una factura? Sin número, ni total, ni bases, no lo es.
  if f->>'numero' is null and f->>'total' is null and coalesce(jsonb_array_length(f->'tipos'), 0) = 0 then
    update public.document_inbox set status = 'no_es_factura', ai_session_id = p_session, reason = 'No he leído número, total ni bases: no parece una factura.', updated_at = now() where id = p_inbox;
    return jsonb_build_object('estado', 'no_es_factura', 'texto', 'No parece una factura: no trae número, total ni bases.');
  end if;

  -- El proveedor, por su NIF, en la cuenta.
  v_nif := f->'proveedor'->>'nif';
  select s.id into v_prov from public.supplier s
   where s.account_id = v_in.account_id and s.archived_at is null and v_nif is not null
     and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif
   order by s.created_at limit 1;

  -- ¿Repetida?
  select * into v_rep from public.supplier_invoice_repetida(v_in.account_id, v_prov, v_nif, f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'total', '')::numeric) limit 1;
  if v_rep.nivel = 'repetida' then
    update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
           reason = 'Ya está: el mismo proveedor y el mismo número (' || coalesce(v_rep.invoice_number, '') || '). No la apunto dos veces.', updated_at = now()
     where id = p_inbox;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'repetida', 'Repetida: ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || '. No la he apuntado dos veces.');
    return jsonb_build_object('estado', 'repetida', 'factura_id', v_rep.invoice_id, 'texto', 'Ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || ': no se apunta dos veces.');
  end if;

  v_conf := case when v_prov is null then 'duda' else l->>'confianza' end;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source, ai_session_id,
                                       raw_document_url, tax_base_total, tax_total, surcharge_total, grand_total, withholding_amount,
                                       needs_review, notes, created_by_name, arrival_channel, reading, reading_confidence, inbox_id)
  values (v_in.account_id, v_in.company_id, v_prov,
          case when f->>'clase' = 'rectificativa' or nullif(f->>'total', '')::numeric < 0 then 'credit_note' else 'invoice' end,
          f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'vencimiento', '')::date, 'en_revision', 'ocr', p_session,
          v_in.file_path, nullif(f->>'base', '')::numeric, nullif(f->>'cuota', '')::numeric, nullif(f->>'recargo', '')::numeric, nullif(f->>'total', '')::numeric,
          nullif(f->'retencion'->>'importe', '')::numeric,
          v_conf <> 'seguro',
          case when v_rep.nivel = 'posible' then '¿Repetida? El mismo proveedor, la misma fecha y el mismo total que la ' || coalesce(v_rep.invoice_number, 'sin número') || '.' end,
          'Folvy', v_in.channel, l, v_conf, p_inbox)
  returning id into v_fac;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
  select v_in.account_id, v_fac, (t->>'tipo')::numeric, (t->>'base')::numeric, (t->>'cuota')::numeric, nullif(t->>'recargoTipo', '')::numeric, coalesce(nullif(t->>'recargo', '')::numeric, 0)
    from jsonb_array_elements(coalesce(f->'tipos', '[]'::jsonb)) t;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select v_fac, coalesce(x->>'raw_text', '—'), nullif(x->>'quantity', '')::numeric, nullif(x->>'unit_price_net', '')::numeric,
         nullif(x->>'line_amount', '')::numeric, nullif(x->>'vat_pct', '')::numeric, o::int
    from jsonb_array_elements(coalesce(v_s.parsed_result->'lines', '[]'::jsonb)) with ordinality as e(x, o);

  update public.document_inbox set status = 'factura', ai_session_id = p_session, supplier_invoice_id = v_fac,
         reason = case when v_prov is null then 'No tengo a este proveedor: lo doy de alta con lo leído si me dices que sí.' end, updated_at = now()
   where id = p_inbox;
  v_texto := 'He leído la ' || coalesce(f->>'numero', 'factura') || coalesce(' de ' || (f->'proveedor'->>'nombre'), '') ||
             case v_conf when 'seguro' then ': todo cuadra.' when 'probable' then ': cuadra, pero hay algo que mirar.' else ': hay algo que aclarar.' end;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
  values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'leida', v_texto, jsonb_build_object('confianza', v_conf, 'porque', l->'porque'));
  if v_prov is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'proveedor_propuesto',
            'No tengo a ' || coalesce(f->'proveedor'->>'nombre', 'este proveedor') || coalesce(' (NIF ' || v_nif || ')', '') || ': lo doy de alta con lo leído si me dices que sí.');
  end if;
  return jsonb_build_object('estado', 'factura', 'factura_id', v_fac, 'confianza', v_conf, 'texto', v_texto, 'proveedor_nuevo', v_prov is null, 'posible_repetida', v_rep.nivel = 'posible');
end $function$;

do $$
begin
  if exists (select 1 from public.supplier where payment_method = 'prepaid')
     or exists (select 1 from public.supplier_invoice where payment_method = 'prepaid') then
    raise exception 'D06 0800 vuelta atrás: hay proveedores o recibidas con «prepaid»: deshaz antes la 0810 (o cámbiales la forma de pago).';
  end if;
end $$;
alter table public.supplier_invoice drop constraint if exists supplier_invoice_payment_method_check;
alter table public.supplier_invoice add constraint supplier_invoice_payment_method_check
  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash'));
alter table public.supplier drop constraint if exists supplier_payment_method_check;
alter table public.supplier add constraint supplier_payment_method_check
  check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash'));
