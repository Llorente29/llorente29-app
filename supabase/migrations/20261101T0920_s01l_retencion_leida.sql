-- supabase/migrations/20261101T0920_s01l_retencion_leida.sql
-- cambia: public.conta_factura_desde_lectura · prueba: supabase/staging/sql/20261101_s01l_retencion_prueba.sql
--
-- S01l · Una factura con retención que entraba leída fallaba siempre (Julio,
-- 01/11, «LLORENTE29-FOOD-S.L.pdf»): conta_factura_desde_lectura rellenaba
-- withholding_amount desde la lectura pero no withholding_rate_id, y el CHECK
-- supplier_invoice_retencion_completa exige los dos. En producción no hay ni
-- una factura con retención que haya entrado leída.
--
-- Ahora el tipo sale de la lectura (su porcentaje) o, si no lo dice, de base ×
-- tipo = importe, contra withholding_rate (los del sistema y los de la cuenta,
-- vigentes en la fecha de la factura; nunca «Intereses y dividendos», que no va
-- en una factura recibida). Si encaja uno, va con su tipo. Si no encaja ninguno,
-- o encajan dos, la factura se crea igual, SIN retención, en revisión y con el
-- aviso «La factura trae una retención de X €: elige su tipo.» (la ficha la
-- propone para elegirlo). Nunca un error de la base en pantalla (regla 8).
--
-- Lo demás, igual que el cuerpo de producción del 01/11 (md5 del cuerpo
-- 1b5583c344a3765f55d136d555449a7f). Misma firma: create or replace (regla 2).

select public._respaldar_funcion('public.conta_factura_desde_lectura(uuid,uuid)', '20261101T0920_s01l_retencion_leida');

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
  v_doc text; v_total numeric; v_estado text; v_validada boolean;
  v_forma text; v_iban text;
  -- S01l · La retención leída.
  v_ret_imp numeric; v_ret_pct numeric; v_ret_base numeric; v_ret_fecha date; v_ret_ids uuid[]; v_ret_id uuid; v_ret_aviso text;
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
    -- D06 · El PDF bueno de una que entró con foto (o sin documento): el mismo proveedor, el mismo
    -- número y el mismo total. Ocupa el sitio de la foto, que queda en su historial como documento
    -- anterior, y no se crea otra factura. No con su asiento validado: su documento va con el asiento.
    select i.raw_document_url, i.grand_total, i.status,
           exists (select 1 from public.journal_entry e where e.account_id = i.account_id and e.source_type = 'supplier_invoice'
                     and e.source_id = i.id and e.status = 'validado')
      into v_doc, v_total, v_estado, v_validada
      from public.supplier_invoice i where i.id = v_rep.invoice_id and i.account_id = v_in.account_id for update;
    if v_in.file_path is not null and (v_in.mime_type = 'application/pdf' or v_in.file_path ~* '\.pdf$')
       and (v_doc is null or v_doc ~* '\.(jpe?g|png|webp|heic|heif)$')
       and v_total is not null and round(v_total, 2) = round(nullif(f->>'total', '')::numeric, 2)
       and v_estado not in ('anulada', 'descartada') and not v_validada then
      update public.supplier_invoice
         set raw_document_url = v_in.file_path, no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
       where id = v_rep.invoice_id;
      -- El D02: el PDF hecho de la foto ya no vale; la pasada del minuto mira el nuevo (un PDF no se convierte).
      delete from public.conta_recibida_pdf r where r.invoice_id = v_rep.invoice_id;
      insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
      values (v_in.account_id, v_rep.invoice_id, 'Folvy', 'papel',
              jsonb_build_array(jsonb_build_object('campo', 'documento', 'antes', v_doc, 'ahora', v_in.file_path,
                                                   'nombre', regexp_replace(v_in.file_path, '^.*/', ''), 'motivo', 'pdf_sustituye_foto')));
      update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
             reason = 'Es el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ', que había entrado ' ||
                      case when v_doc is null then 'sin documento' else 'con una foto' end || ': lo pongo en su lugar' ||
                      case when v_doc is null then '.' else ' y la foto queda en su historial.' end, updated_at = now()
       where id = p_inbox;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
      values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'corregida',
              'Ha llegado el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ': sustituye ' ||
              case when v_doc is null then 'a la falta de documento' else 'a la foto, que queda como documento anterior' end || '. No es otra factura.',
              jsonb_build_object('pdf_sustituye_foto', true, 'antes', v_doc, 'ahora', v_in.file_path));
      return jsonb_build_object('estado', 'pdf_sustituye_foto', 'factura_id', v_rep.invoice_id,
        'texto', 'Es el PDF de la ' || coalesce(v_rep.invoice_number, 'factura') || ': ' ||
                 case when v_doc is null then 'ya tiene su documento' else 'sustituye a la foto, que queda en su historial' end || '. No se crea otra factura.');
    end if;
    update public.document_inbox set status = 'repetida', ai_session_id = p_session, duplicate_of_invoice_id = v_rep.invoice_id,
           reason = 'Ya está: el mismo proveedor y el mismo número (' || coalesce(v_rep.invoice_number, '') || '). No la apunto dos veces.', updated_at = now()
     where id = p_inbox;
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_rep.invoice_id, 'folvy', 'repetida', 'Repetida: ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || '. No la he apuntado dos veces.');
    return jsonb_build_object('estado', 'repetida', 'factura_id', v_rep.invoice_id, 'texto', 'Ya estaba la ' || coalesce(v_rep.invoice_number, 'factura') || ': no se apunta dos veces.');
  end if;

  v_conf := case when v_prov is null then 'duda' else l->>'confianza' end;
  -- PC01 · E2b · La forma de pago y el IBAN que trae el papel. El IBAN solo se guarda si es para
  -- pagarle por transferencia (o no lo dice), pasa el control y no es de una cuenta nuestra: en una
  -- domiciliada, o con tarjeta o al contado, el IBAN que sale suele ser el NUESTRO, el del cargo.
  v_forma := case when f->>'forma' in ('transfer', 'direct_debit', 'card', 'cash') then f->>'forma' end;
  v_iban := public._pc01e2_iban(f->>'iban');
  if v_iban is not null and (coalesce(v_forma, 'transfer') <> 'transfer' or not public._pc01e2b_iban_valido(v_iban)
     or exists (select 1 from public.treasury_account t where t.account_id = v_in.account_id and public._pc01e2_iban(t.iban) = v_iban)) then
    v_iban := null;
  end if;

  -- S01l · La retención: con su tipo (el leído, o el que da base × tipo = importe), o ninguna y en revisión.
  v_ret_imp := abs(nullif(f->'retencion'->>'importe', '')::numeric);
  if coalesce(v_ret_imp, 0) = 0 then
    v_ret_imp := null;
  else
    v_ret_pct := abs(nullif(f->'retencion'->>'tipo', '')::numeric);
    v_ret_base := abs(nullif(f->>'base', '')::numeric);
    v_ret_fecha := coalesce(nullif(f->>'fecha', '')::date, current_date);
    select array_agg(r.id order by r.sort_order, r.code) into v_ret_ids
      from public.withholding_rate r
     where (r.is_system or r.account_id = v_in.account_id) and r.code <> 'capital' and r.rate > 0
       and (r.valid_from is null or r.valid_from <= v_ret_fecha) and (r.valid_to is null or r.valid_to >= v_ret_fecha)
       and case when v_ret_pct is not null
                then abs(r.rate - v_ret_pct) < 0.005 and (v_ret_base is null or abs(round(v_ret_base * r.rate / 100, 2) - v_ret_imp) <= 0.01)
                else v_ret_base is not null and abs(round(v_ret_base * r.rate / 100, 2) - v_ret_imp) <= 0.01 end;
    if coalesce(cardinality(v_ret_ids), 0) = 1 then
      v_ret_id := v_ret_ids[1];
    else
      v_ret_aviso := format('La factura trae una retención de %s: elige su tipo.', public.conta_euros_exactos(v_ret_imp));
      v_ret_imp := null;
    end if;
  end if;

  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, due_date, status, source, ai_session_id,
                                       raw_document_url, tax_base_total, tax_total, surcharge_total, grand_total, withholding_amount, withholding_rate_id,
                                       needs_review, notes, created_by_name, arrival_channel, reading, reading_confidence, inbox_id,
                                       read_iban, payment_method)
  values (v_in.account_id, v_in.company_id, v_prov,
          case when f->>'clase' = 'rectificativa' or nullif(f->>'total', '')::numeric < 0 then 'credit_note' else 'invoice' end,
          f->>'numero', nullif(f->>'fecha', '')::date, nullif(f->>'vencimiento', '')::date, 'en_revision', 'ocr', p_session,
          v_in.file_path, nullif(f->>'base', '')::numeric, nullif(f->>'cuota', '')::numeric, nullif(f->>'recargo', '')::numeric, nullif(f->>'total', '')::numeric,
          v_ret_imp, v_ret_id,
          v_conf <> 'seguro' or v_ret_aviso is not null,
          nullif(concat_ws(' ',
            case when v_rep.nivel = 'posible' then '¿Repetida? El mismo proveedor, la misma fecha y el mismo total que la ' || coalesce(v_rep.invoice_number, 'sin número') || '.' end,
            v_ret_aviso), ''),
          'Folvy', v_in.channel, l, v_conf, p_inbox,
          v_iban, v_forma)
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
             case v_conf when 'seguro' then ': todo cuadra.' when 'probable' then ': cuadra, pero hay algo que mirar.' else ': hay algo que aclarar.' end ||
             coalesce(' ' || v_ret_aviso, '');
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
  values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'leida', v_texto, jsonb_build_object('confianza', v_conf, 'porque', l->'porque'));
  if v_prov is null then
    insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text)
    values (v_in.account_id, v_in.company_id, p_inbox, v_fac, 'folvy', 'proveedor_propuesto',
            'No tengo a ' || coalesce(f->'proveedor'->>'nombre', 'este proveedor') || coalesce(' (NIF ' || v_nif || ')', '') || ': lo doy de alta con lo leído si me dices que sí.');
  end if;
  return jsonb_build_object('estado', 'factura', 'factura_id', v_fac, 'confianza', v_conf, 'texto', v_texto, 'proveedor_nuevo', v_prov is null, 'posible_repetida', v_rep.nivel = 'posible',
                            'retencion_sin_tipo', v_ret_aviso is not null);
end $function$;
