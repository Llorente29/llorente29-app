-- supabase/vuelta-atras/20261129T0370_textos_sin_papel.down.sql
--
-- Vuelta atrás de la 0370: las 11 funciones vuelven a sus cuerpos de
-- producción del 21/10, tal cual (pg_get_functiondef), con la misma firma.
-- md5 del cuerpo al que vuelven:
--   _compras_camino_calcula        5cbeb3496b36696e1e002bf23cdd9e8f
--   _compras_factura_desde_papel   104ebec9514b827669fd918c5d1f89fd
--   compras_factura_desde_papel    4f4d38df93955ba3268052950c32b35d
--   compras_sin_iva                805d1ed89ae5c424a19b83ec17d311af
--   tg_goods_receipt_path_factura  5fa9ed53935109ea522d7dba29feaff1
--   conta_documentos_recibidos     7e33015af3eeb23e5ffc689007a26887
--   company_chart_import_apply     670b04da6349d90c69c06e43c90ac69a
--   company_chart_import_undo      d065d50eb0238f05dafdb0e40cc4f511
--   party_add_role                 eea26b75cf76cd59054f44ec19e369ee
--   party_misma_cuenta             981f998d47e5cccd9cdd6a21ea13bdee
--   _party_merge                   c88e5a6a71c428b3ab863804bf8906de

-- ── public._compras_camino_calcula ──
CREATE OR REPLACE FUNCTION public._compras_camino_calcula(p_recepcion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g goods_receipt; s supplier; sp supplier; d record; v_doc jsonb; v_tipo text; v_nombre text; v_nif text;
  v_unica uuid; v_es_factura boolean; v_path text; v_company uuid; v_sup uuid; v_how text;
  v_q text; v_qd jsonb; v_reason text; v_modo text; v_sugerida text;
  c_modo constant jsonb := '{"per_delivery": "con cada entrega", "delivery_note_then_invoice": "entrega con albarán y factura después", "monthly_settlement": "liquidación mensual"}';
begin
  select * into g from goods_receipt where id = p_recepcion;
  if g.id is null then raise exception 'Esa recepción no existe.' using errcode = 'P0002'; end if;
  if g.status = 'anulado' then
    return jsonb_build_object('path', 'anulada', 'supplier_id', g.supplier_id, 'reason', 'La recepción está anulada.');
  end if;
  select * into s from supplier where id = g.supplier_id;
  v_modo := s.invoicing_mode;
  v_unica := (select case when count(*) = 1 then min(c.id::text)::uuid end from company c where c.account_id = g.account_id and c.is_active);
  select a.parsed_result->'document' into v_doc from goods_receipt_ai_session a where a.id = g.ai_session_id;
  v_tipo := nullif(v_doc->>'doc_type', '');
  v_nombre := nullif(btrim(v_doc->>'bill_to_name'), '');
  v_nif := nullif(btrim(v_doc->>'bill_to_tax_id'), '');
  v_sup := g.supplier_id;

  if s.id is null then
    v_path := 'sin_decidir'; v_how := 'ficha'; v_q := 'sin_papel';
    v_reason := 'La recepción no tiene proveedor: no se sabe cómo factura.';
  elsif v_tipo is null then
    -- Sin papel leído: manda la ficha.
    v_how := 'ficha'; v_company := v_unica;
    if v_modo = 'monthly_settlement' then
      v_path := 'liquidacion'; v_reason := format('No hay papel leído; %s liquida cada mes.', s.name);
    elsif v_modo = 'delivery_note_then_invoice' then
      v_path := 'pendiente_factura'; v_reason := format('No hay papel leído; %s manda la factura después.', s.name);
    else
      v_path := 'pendiente_factura'; v_q := 'sin_papel';
      v_reason := case when v_modo = 'per_delivery'
        then format('No hay papel leído y %s factura con cada entrega: sube su factura.', s.name)
        else format('No hay papel leído y no se sabe cómo factura %s: queda pendiente de factura.', s.name) end;
    end if;
  else
    v_es_factura := v_tipo in ('factura', 'albaran_factura');
    select * into d from public._compras_destinatario(g.account_id, v_nombre, v_nif);
    v_how := d.how;
    if d.kind = 'empresa' then
      v_company := d.company_id;
      v_path := case when v_es_factura then 'factura' else 'pendiente_factura' end;
      v_reason := case when v_es_factura then 'Es una factura a nombre de tu empresa.' else 'Es un albarán a nombre de tu empresa: queda pendiente de factura.' end;
      v_sugerida := case when v_es_factura then 'per_delivery' else 'delivery_note_then_invoice' end;
      if v_modo is null then
        v_q := 'ficha_sin_forma';
      elsif v_modo = 'per_delivery' and not v_es_factura then
        v_q := 'papel_y_ficha';
      elsif v_modo = 'delivery_note_then_invoice' and v_es_factura then
        v_q := 'papel_y_ficha';
      elsif v_modo = 'monthly_settlement' then
        v_q := 'papel_y_ficha'; v_sugerida := null;
        v_reason := v_reason || format(' La ficha dice que %s liquida cada mes.', s.name);
      end if;
      if v_q is not null then
        v_qd := jsonb_build_object('ficha', v_modo, 'ficha_dice', c_modo->>v_modo, 'papel', v_tipo, 'sugerida', v_sugerida, 'sugerida_dice', c_modo->>v_sugerida);
      end if;
    elsif d.kind = 'proveedor' then
      select * into sp from supplier where id = d.supplier_id;
      if sp.invoicing_mode = 'monthly_settlement' then
        v_path := 'liquidacion'; v_sup := sp.id; v_company := v_unica;
        v_reason := case when sp.id = s.id then format('Va a nombre de %s, que liquida cada mes: entra en su liquidación.', sp.name)
                         else format('Lo trae %s a nombre de %s, que liquida cada mes: entra en su liquidación.', s.name, sp.name) end;
      elsif sp.invoicing_mode is null then
        v_path := 'sin_decidir'; v_q := 'a_nombre_de';
        v_reason := format('Va a nombre de %s, y su ficha no dice si liquida cada mes.', sp.name);
        v_qd := jsonb_build_object('nombre', v_nombre, 'nombre_norm', public.compras_nombre_norm(v_nombre), 'proveedor', sp.id, 'proveedor_nombre', sp.name);
      else
        v_path := 'a_nombre_de_otro'; v_q := 'a_nombre_de_otro'; v_sup := g.supplier_id;
        v_reason := format('Va a nombre de %s, no de tu empresa: así no se puede deducir el IVA.', sp.name);
      end if;
    elsif d.kind = 'otro' then
      v_path := 'a_nombre_de_otro'; v_q := 'a_nombre_de_otro';
      v_reason := format('Va a nombre de «%s», no de tu empresa: así no se puede deducir el IVA.', v_nombre);
    else
      v_path := 'sin_decidir'; v_q := 'a_nombre_de';
      v_reason := case when v_nombre is null then 'El papel no dice a nombre de quién va.'
                       else format('El papel va a nombre de «%s», y Folvy no sabe quién es.', v_nombre) end;
      v_qd := jsonb_build_object('nombre', v_nombre, 'nombre_norm', public.compras_nombre_norm(v_nombre),
        -- Candidatos para contestar: las empresas de la cuenta y los proveedores
        -- que liquidan. Primero el que empieza por la misma palabra: ordena, no decide.
        'candidatos', (select coalesce(jsonb_agg(x order by x->>'orden', x->>'nombre'), '[]'::jsonb) from (
          select jsonb_build_object('tipo', 'empresa', 'id', c.id, 'nombre', coalesce(c.legal_name, c.trade_name),
                   'orden', case when split_part(public.compras_nombre_norm(coalesce(c.legal_name, c.trade_name)), ' ', 1) = split_part(public.compras_nombre_norm(v_nombre), ' ', 1) then '0' else '1' end) x
            from company c where c.account_id = g.account_id and c.is_active
          union all
          select jsonb_build_object('tipo', 'proveedor', 'id', p.id, 'nombre', p.name,
                   'orden', case when split_part(public.compras_nombre_norm(p.name), ' ', 1) = split_part(public.compras_nombre_norm(v_nombre), ' ', 1) then '0' else '1' end)
            from supplier p where p.account_id = g.account_id and p.archived_at is null
             and (p.invoicing_mode = 'monthly_settlement' or p.id = g.supplier_id)) y));
    end if;
  end if;

  return jsonb_build_object('path', v_path, 'supplier_id', v_sup, 'company_id', v_company, 'doc_type', v_tipo,
    'bill_to_name', v_nombre, 'bill_to_tax_id', v_nif, 'bill_to_how', v_how,
    'question', v_q, 'question_detail', v_qd, 'reason', v_reason);
end $function$;

-- ── public._compras_factura_desde_papel ──
CREATE OR REPLACE FUNCTION public._compras_factura_desde_papel(p_cuenta uuid, p_sesion uuid, p_proveedor uuid, p_local uuid, p_empresa uuid, p_recepcion uuid DEFAULT NULL::uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_doc jsonb; v_lineas jsonb; v_num text; v_fecha date; v_id uuid; v_ok int; v_total int;
  v_base numeric; v_cuota numeric; v_url text;
begin
  select a.parsed_result->'document', coalesce(a.parsed_result->'lines', '[]'::jsonb) into v_doc, v_lineas
    from goods_receipt_ai_session a where a.id = p_sesion and a.account_id = p_cuenta;
  if v_doc is null then raise exception 'Ese papel no está leído en esta cuenta.' using errcode = 'P0002'; end if;
  if not exists (select 1 from supplier where id = p_proveedor and account_id = p_cuenta) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;

  v_num := nullif(btrim(v_doc->>'doc_number'), '');
  if v_num is null and p_recepcion is not null then
    select nullif(btrim(supplier_doc_number), '') into v_num from goods_receipt where id = p_recepcion;
  end if;
  begin v_fecha := (v_doc->>'doc_date')::date; exception when others then v_fecha := null; end;
  if v_fecha is null and p_recepcion is not null then select receipt_date into v_fecha from goods_receipt where id = p_recepcion; end if;
  v_fecha := coalesce(v_fecha, current_date);

  -- El mismo papel dos veces: mismo proveedor y mismo número, o la misma lectura.
  select si.id into v_id from supplier_invoice si
   where si.account_id = p_cuenta and si.status <> 'anulada'
     and (si.ai_session_id = p_sesion
          or (v_num is not null and si.supplier_id = p_proveedor
              and upper(regexp_replace(si.invoice_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(v_num, '[^A-Za-z0-9]', '', 'g'))))
   order by si.created_at limit 1;
  if v_id is not null then
    if p_recepcion is not null then
      insert into supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_id, p_recepcion) on conflict do nothing;
    end if;
    return jsonb_build_object('factura', v_id, 'creada', false, 'repetida', true,
      'motivo', format('Esta factura ya estaba (%s): se enlaza a ella, no se crea otra.', (select code from supplier_invoice where id = v_id)));
  end if;

  -- Importes: cada línea con su importe neto y su IVA.
  select count(*) filter (where jsonb_typeof(l->'line_amount') = 'number' and jsonb_typeof(l->'vat_pct') = 'number'), count(*)
    into v_ok, v_total from jsonb_array_elements(v_lineas) l;
  if v_total = 0 or v_ok < v_total then
    return jsonb_build_object('factura', null, 'creada', false, 'sin_importes', true,
      'motivo', case when v_total = 0 then 'El papel no trae líneas: sube la factura en Compras.'
                     else format('El papel trae %s línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.', v_total - v_ok) end);
  end if;

  select sum((l->>'line_amount')::numeric), sum(round((l->>'line_amount')::numeric * (l->>'vat_pct')::numeric / 100, 2))
    into v_base, v_cuota from jsonb_array_elements(v_lineas) l;
  if p_recepcion is not null then select raw_document_url into v_url from goods_receipt where id = p_recepcion; end if;

  insert into supplier_invoice (account_id, supplier_id, location_id, company_id, doc_kind, invoice_number, invoice_date, status,
                                source, ai_session_id, raw_document_url, tax_base_total, tax_total, grand_total, needs_review,
                                notes, created_by, created_by_name)
  values (p_cuenta, p_proveedor, p_local, p_empresa, 'invoice', v_num, v_fecha, 'en_revision',
          'ocr', p_sesion, v_url,
          coalesce((v_doc->>'tax_base_total')::numeric, v_base), coalesce((v_doc->>'tax_total')::numeric, v_cuota),
          coalesce((v_doc->>'grand_total')::numeric, v_base + v_cuota),
          -- Lo que dice la cabecera contra lo que suman las líneas: si no cuadra, se revisa.
          abs(coalesce((v_doc->>'tax_base_total')::numeric, v_base) - v_base) > 0.02,
          case when p_recepcion is not null then 'Creada al confirmar la recepción ' || (select code from goods_receipt where id = p_recepcion) || '.' end,
          auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor(), 'Folvy'))
  returning id into v_id;

  insert into supplier_invoice_line (supplier_invoice_id, raw_text, supplier_code, qty, unit_price, line_amount, vat_pct, position)
  select v_id, l->>'raw_text', nullif(l->>'supplier_code', ''),
         case when jsonb_typeof(l->'quantity') = 'number' then (l->>'quantity')::numeric end,
         case when jsonb_typeof(l->'unit_price_net') = 'number' then (l->>'unit_price_net')::numeric end,
         (l->>'line_amount')::numeric, (l->>'vat_pct')::numeric, (n - 1)::int
    from jsonb_array_elements(v_lineas) with ordinality as t(l, n);

  if p_recepcion is not null then
    insert into supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_id, p_recepcion) on conflict do nothing;
  end if;
  return jsonb_build_object('factura', v_id, 'creada', true, 'repetida', false,
    'motivo', format('Factura %s creada desde el papel: %s de base, %s de IVA.', coalesce(v_num, 'sin número'), public.compras_euros(v_base), public.compras_euros(v_cuota)));
end $function$;

-- ── public.compras_factura_desde_papel ──
CREATE OR REPLACE FUNCTION public.compras_factura_desde_papel(p_sesion uuid, p_proveedor uuid, p_local uuid, p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from goods_receipt_ai_session where id = p_sesion;
  if v_cuenta is null then raise exception 'Ese papel no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes registrar facturas en esta cuenta.' using errcode = '42501';
  end if;
  if p_empresa is not null and not exists (select 1 from company where id = p_empresa and account_id = v_cuenta) then
    raise exception 'Esa empresa no es de esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_factura_desde_papel(v_cuenta, p_sesion, p_proveedor, p_local, p_empresa, null, null);
end $function$;

-- ── public.compras_sin_iva ──
CREATE OR REPLACE FUNCTION public.compras_sin_iva(p_recepcion uuid, p_empresa uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p goods_receipt_path; g goods_receipt; v jsonb; v_factura uuid;
begin
  select * into p from goods_receipt_path where goods_receipt_id = p_recepcion for update;
  if p.id is null then raise exception 'Esa recepción no tiene camino.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(p.account_id) then raise exception 'No puedes decidir esto en esta cuenta.' using errcode = '42501'; end if;
  if p.path <> 'a_nombre_de_otro' then raise exception 'Solo se apunta sin IVA un papel que va a nombre de otro.' using errcode = '22023'; end if;
  if not exists (select 1 from company where id = p_empresa and account_id = p.account_id) then
    raise exception 'Esa empresa no es de esta cuenta.' using errcode = '42501';
  end if;
  select * into g from goods_receipt where id = p_recepcion;
  if g.ai_session_id is null then raise exception 'La recepción no tiene papel leído.' using errcode = '22023'; end if;
  -- Sin que el disparador de la 0140 intente crearla otra vez.
  perform set_config('folvy.compras_factura', 'si', true);
  v := public._compras_factura_desde_papel(g.account_id, g.ai_session_id, g.supplier_id, g.location_id, p_empresa, g.id, null);
  perform set_config('folvy.compras_factura', '', true);
  if coalesce((v->>'sin_importes')::boolean, false) or v->>'factura' is null then
    raise exception '%', v->>'motivo' using errcode = '22023';
  end if;
  v_factura := (v->>'factura')::uuid;
  update supplier_invoice set vat_non_deductible = true where id = v_factura;
  update goods_receipt_path set path = 'factura', company_id = p_empresa, supplier_invoice_id = v_factura, consumed_at = now(),
         question_closed = question, question_closed_note = 'Apuntada sin descontar el IVA.',
         question_closed_by_name = public.conta_nombre_actor(), question_closed_at = now(),
         reason = format('Va a nombre de «%s», no de tu empresa: se apunta sin descontar el IVA.', coalesce(bill_to_name, 'otro'))
   where id = p.id;
  return jsonb_build_object('factura', v_factura, 'repetida', coalesce((v->>'repetida')::boolean, false),
    'frase', format('Apuntada sin descontar el IVA: %s. Su IVA va como más gasto; no va a la 472 ni al libro de facturas recibidas como deducible.', v->>'motivo'));
end $function$;

-- ── public.tg_goods_receipt_path_factura ──
CREATE OR REPLACE FUNCTION public.tg_goods_receipt_path_factura()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g goods_receipt; v jsonb; v_corte date;
begin
  if current_setting('folvy.compras_factura', true) = 'si' then return null; end if;
  if new.path <> 'factura' or new.supplier_invoice_id is not null or new.consumed_at is not null then
    return null;
  end if;
  select * into g from goods_receipt where id = new.goods_receipt_id;
  if g.status <> 'confirmado' or g.ai_session_id is null then return null; end if;
  select max(fy.imported_until) into v_corte from fiscal_year fy where fy.company_id = new.company_id;
  perform set_config('folvy.compras_factura', 'si', true);
  if v_corte is not null and g.receipt_date <= v_corte then
    update goods_receipt_path set reason = reason || format(' Es anterior al corte (%s): la lleva el programa anterior.', to_char(v_corte, 'DD/MM/YYYY'))
     where id = new.id and reason not like '%anterior al corte%';
  else
    begin
      v := public._compras_factura_desde_papel(g.account_id, g.ai_session_id, g.supplier_id, g.location_id, new.company_id, g.id, null);
      if coalesce((v->>'sin_importes')::boolean, false) then
        update goods_receipt_path set question = 'factura_sin_importes', question_detail = jsonb_build_object('motivo', v->>'motivo')
         where id = new.id;
      else
        update goods_receipt_path set supplier_invoice_id = (v->>'factura')::uuid, consumed_at = now(),
               question = case when coalesce((v->>'repetida')::boolean, false) then 'factura_repetida' else question end,
               question_detail = case when coalesce((v->>'repetida')::boolean, false)
                                      then jsonb_build_object('motivo', v->>'motivo', 'factura', v->>'factura') else question_detail end
         where id = new.id;
      end if;
    exception when others then
      perform set_config('folvy.compras_factura', 'si', true);
      update goods_receipt_path set question = 'error', error = sqlerrm,
             question_detail = jsonb_build_object('motivo', 'Folvy no pudo crear la factura desde el papel.')
       where id = new.id;
    end;
  end if;
  perform set_config('folvy.compras_factura', '', true);
  return null;
end $function$;

-- ── public.conta_documentos_recibidos ──
CREATE OR REPLACE FUNCTION public.conta_documentos_recibidos(p_company uuid, p_desde date, p_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_acc uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_filas jsonb;
  v_esperadas jsonb;
  v_correo record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El periodo no es válido.' using errcode = '22023';
  end if;

  with facturas as (
    select i.*, s.name as proveedor_nombre,
           (select jsonb_build_object('id', e.id, 'estado', e.status, 'solo', coalesce(e.validated_by_name, '') like 'Folvy (apunta solo%')
              from public.journal_entry e
             where e.account_id = v_acc and e.company_id = p_company and e.source_type = 'supplier_invoice' and e.source_id = i.id
               and e.status in ('propuesto', 'borrador', 'validado')
             order by (e.status = 'validado') desc, e.created_at desc limit 1) as asiento,
           (select jsonb_build_object('fecha', gr.receipt_date, 'local', l.name)
              from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id
              left join public.locations l on l.id = gr.location_id
             where r.supplier_invoice_id = i.id order by gr.receipt_date desc limit 1) as recepcion,
           -- R5 · 6: cuántas facturas suyas había antes de esta (para decir «es la primera»).
           (select count(*) from public.supplier_invoice p
             where p.account_id = v_acc and p.supplier_id = i.supplier_id and p.id <> i.id and p.status not in ('anulada', 'descartada')
               and (coalesce(p.invoice_date, (p.created_at at time zone 'Europe/Madrid')::date), p.created_at) < (coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date), i.created_at)) as previas,
           -- R5 · 7: el fichero de la llegada (una foto o un PDF), para decir cómo llegó de verdad.
           (select d.mime_type from public.document_inbox d where d.id = i.inbox_id and d.account_id = v_acc) as llegada_tipo
      from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
       and i.status <> 'anulada'
       and coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date) between p_desde and p_hasta
  ), gasto0 as (
    -- Lo que Folvy ha entendido: la cuenta del asiento si lo hay; si no, la de la ficha.
    select f.id, f.supplier_id,
           coalesce(
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'del asiento')
                from public.journal_line l join public.company_account a on a.id = l.company_account_id
               where l.entry_id = (f.asiento->>'id')::uuid and a.code like '6%' and l.debit > 0 order by l.position limit 1),
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'de su ficha')
                from public.company_account_link k join public.company_account a on a.id = k.company_account_id
               where k.company_id = p_company and k.entity = 'supplier' and k.entity_id = f.supplier_id::text and k.role = 'gasto' limit 1)) as entendido
      from facturas f
  ), gasto as (
    -- R5 · 6: sin cuenta en el asiento ni en la ficha, lo aprendido de sus
    -- facturas anteriores (0250), como en N23, con su porqué. Si no hay nada
    -- que aprender, también se dice (la pantalla explica qué hacer).
    select g.id, g.entendido,
           case when g.entendido is null and g.supplier_id is not null then public.conta_gasto_aprendido(p_company, g.supplier_id) end as aprendido
      from gasto0 g
  ), filas_f as (
    select jsonb_build_object(
      'id', f.id, 'tipo', 'factura',
      -- S01 (0160): la descartada sale, con su estado y su porqué (regla 7: no se esconde).
      'estado', case when f.status = 'descartada' then 'descartada'
                     when f.asiento->>'estado' = 'validado' then 'apuntada'
                     when f.supplier_id is null or f.reading_confidence = 'duda' or f.status = 'con_discrepancias' then 'por_aclarar'
                     else 'para_mirar' end,
      'proveedor', jsonb_build_object('id', f.supplier_id, 'nombre', coalesce(f.proveedor_nombre, f.reading->'factura'->'proveedor'->>'nombre')),
      'numero', f.invoice_number, 'fecha', f.invoice_date, 'total', f.grand_total,
      -- R5 · 7: por dónde llegó DE VERDAD. Sin canal apuntado: leída del papel
      -- de su recepción (Cocina), leída en Compras, o escrita a mano.
      'canal', coalesce(f.arrival_channel, case when f.source = 'ocr' and f.recepcion is not null then 'cocina' when f.source = 'ocr' then 'compras' else 'a_mano' end),
      'llegada_tipo', f.llegada_tipo,
      'previas', f.previas,
      'confianza', f.reading_confidence,
      'porque', case when f.status = 'descartada'
                  then 'No es una factura: ' || coalesce(f.discard_reason, 'sin motivo') || ' (' || coalesce(f.discarded_by_name, 'una persona') || ', ' || to_char(f.discarded_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ').'
                  else coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end) end,
      'entendido', coalesce(g.entendido, case when g.aprendido->>'cuenta' is not null then jsonb_build_object(
                     'cuenta', g.aprendido->>'cuenta', 'nombre', g.aprendido->>'nombre', 'origen', g.aprendido->>'origen', 'sin_confirmar', true) end),
      'aprendido', case when g.aprendido is not null then jsonb_build_object('cuenta', g.aprendido->>'cuenta', 'facturas', coalesce((g.aprendido->>'facturas')::int, 0),
                     'confianza', g.aprendido->>'confianza', 'porque', g.aprendido->>'porque') end,
      'recepcion', f.recepcion, 'asiento', f.asiento,
      'llego', f.created_at) as fila
      from facturas f join gasto g on g.id = f.id
  ), recepciones as (
    -- R6 · Una recepción cuyo papel es «factura» o «albarán-factura» ES una
    -- factura recibida. Desde el corte, Compras ya la hace factura con el mismo
    -- papel (0140) y sale arriba, en filas_f. Aquí, las que NO son factura:
    --   · de antes del corte: las llevó el programa anterior. Se enlazan con su
    --     asiento traído de Diez (mismo proveedor, su número en el concepto y
    --     el mismo total), nunca se apuntan otra vez (la base no deja asentar
    --     antes del corte: 0120 de C04);
    --   · desde el corte, sin factura: la recepción no pudo hacerla (su
    --     pregunta lo dice): por aclarar, no se esconde (regla 7).
    -- Lo leído es el de la recepción: no se vuelve a leer con el modelo.
    select g.id, g.receipt_date, g.supplier_id, g.raw_document_url, g.created_at, s.name as proveedor_nombre,
           a.parsed_result->'document' as doc, p.question, p.reason as camino_porque,
           upper(regexp_replace(coalesce(nullif(a.parsed_result->'document'->>'doc_number', ''), g.supplier_doc_number, ''), '[^A-Za-z0-9]', '', 'g')) as clave,
           nullif(a.parsed_result->'document'->>'grand_total', '')::numeric as total,
           exists (select 1 from public.fiscal_year y
                    where y.company_id = p_company and y.account_id = v_acc and g.receipt_date between y.starts_on and y.ends_on
                      and y.imported_until is not null and g.receipt_date <= y.imported_until) as antes_del_corte,
           (select k.company_account_id from public.company_account_link k
             where k.company_id = p_company and k.account_id = v_acc and k.entity = 'supplier' and k.entity_id = g.supplier_id::text and k.role = 'principal' limit 1) as subcuenta
      from public.goods_receipt g
      join public.goods_receipt_ai_session a on a.id = g.ai_session_id and a.account_id = g.account_id
      left join public.goods_receipt_path p on p.goods_receipt_id = g.id and p.account_id = g.account_id
      left join public.supplier s on s.id = g.supplier_id and s.account_id = g.account_id
     where g.account_id = v_acc and g.status = 'confirmado'
       and a.parsed_result->'document'->>'doc_type' in ('factura', 'albaran_factura')
       and g.receipt_date between p_desde and p_hasta
       -- De esta empresa: la del camino; sin camino (las de antes de Compras), la
       -- del NIF a cuyo nombre va el papel, o la única de la cuenta si solo hay una.
       and coalesce(p.company_id,
             (select c.id from public.company c
               where c.account_id = v_acc and nullif(regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g'), '')
                     = regexp_replace(regexp_replace(upper(coalesce(a.parsed_result->'document'->>'bill_to_tax_id', '')), '[^A-Z0-9]', '', 'g'), '^ES(?=[A-Z0-9]{9}$)', '')
               limit 1),
             (select c.id from public.company c where c.account_id = v_acc and (select count(*) from public.company c2 where c2.account_id = v_acc) = 1)) = p_company
       and p.supplier_invoice_id is null
       and not exists (select 1 from public.supplier_invoice_receipt x join public.supplier_invoice si on si.id = x.supplier_invoice_id
                        where x.goods_receipt_id = g.id and si.status <> 'anulada')
  ), recepciones_diez as (
    select r.*,
           (select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date)
              from public.journal_entry e join public.journal_line l on l.entry_id = e.id
             where r.antes_del_corte and e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.external_program = 'diez' and e.status = 'validado'
               and l.company_account_id = r.subcuenta and l.credit > 0 and round(l.credit * 100) = round(r.total * 100)
               -- El número de Diez va en el concepto (medido: ninguna línea traída trae su justificante), o en el justificante si lo trae.
               and length(r.clave) >= 3
               and (position(r.clave in upper(regexp_replace(coalesce(e.concept, ''), '[^A-Za-z0-9]', '', 'g'))) > 0
                    or upper(regexp_replace(coalesce(l.external_voucher, l.document_ref, ''), '[^A-Za-z0-9]', '', 'g')) = r.clave)
             order by abs(e.entry_date - r.receipt_date) limit 1) as diez
      from recepciones r
  ), filas_r as (
    select jsonb_build_object(
      'id', r.id, 'tipo', 'recepcion',
      'estado', case when r.antes_del_corte then 'en_diez' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', r.supplier_id, 'nombre', coalesce(r.proveedor_nombre, r.doc->>'supplier_name')),
      'numero', nullif(r.doc->>'doc_number', ''), 'fecha', coalesce(nullif(r.doc->>'doc_date', '')::date, r.receipt_date), 'total', r.total,
      'canal', 'cocina', 'confianza', null,
      'porque', case
        when r.antes_del_corte and r.diez is not null then 'Es de antes del corte y ya está en Diez (asiento ' || (r.diez->>'serie') || '/' || (r.diez->>'numero') || ', mismo proveedor, número y total): no se vuelve a apuntar.'
        when r.antes_del_corte then 'Es de antes del corte: la llevó el programa anterior y no se vuelve a apuntar. No la encuentro en Diez por su número y su total: míralo allí.'
        when r.question = 'factura_sin_importes' then 'La recepción la leyó, pero el papel no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.'
        when r.question is not null then 'La recepción la leyó, pero no he podido hacer la factura: ' || coalesce(r.camino_porque, 'falta algo en la recepción') || '.'
        else 'La recepción la leyó y aún no es factura: ábrela en Compras.' end,
      'entendido', null, 'recepcion', jsonb_build_object('fecha', r.receipt_date, 'local', null),
      'asiento', case when r.diez is not null then jsonb_build_object('id', r.diez->>'id', 'estado', 'validado', 'solo', false, 'diez', true) end,
      'diez', r.diez, 'papel', r.raw_document_url,
      'llego', r.created_at) as fila
      from recepciones_diez r
  ), filas_l as (
    -- Lo que llegó y no es (todavía) una factura: por aclarar, con su motivo.
    select jsonb_build_object(
      'id', d.id, 'tipo', 'llegada',
      'estado', case when d.status = 'repetida' then 'repetida' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', null, 'nombre', null),
      'numero', null, 'fecha', (d.created_at at time zone 'Europe/Madrid')::date, 'total', null,
      'canal', d.channel, 'confianza', null,
      'porque', coalesce(d.reason, case d.status when 'falta_pdf' then 'Falta el PDF: el correo trae un enlace.' when 'leyendo' then 'Leyéndola.' when 'recibido' then 'Recibida, sin leer todavía.' else 'Hay algo que aclarar.' end),
      'entendido', null, 'recepcion', null, 'asiento', null, 'llego', d.created_at, 'archivo', d.file_name) as fila
      from public.document_inbox d
     where d.account_id = v_acc and (d.company_id = p_company or d.company_id is null)
       and d.supplier_invoice_id is null and d.status <> 'descartado'
       and (d.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  )
  select coalesce(jsonb_agg(fila order by (fila->>'llego') desc), '[]'::jsonb) into v_filas
    from (select fila from filas_f union all select fila from filas_l union all select fila from filas_r) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.periodo, x.supplier_name), '[]'::jsonb) into v_esperadas
    from public.conta_esperadas_no_llegadas(p_company, least(v_hoy, p_hasta + 1)) x;

  select a.local_part || '@' || a.domain as direccion, a.active into v_correo
    from public.company_inbound_address a where a.company_id = p_company and a.account_id = v_acc limit 1;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'correo', jsonb_build_object('activo', coalesce(v_correo.active, false), 'direccion', v_correo.direccion),
    'recibe_mercancia', public.conta_recibe_mercancia(p_company),
    'filas', v_filas,
    'esperadas', v_esperadas,
    'cifras', jsonb_build_object(
      -- R5 · 8: las del periodo elegido, no «esta semana».
      'llegadas', jsonb_array_length(v_filas),
      'llegadas_por_canal', (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (select f->>'canal' c, count(*) n from jsonb_array_elements(v_filas) f group by 1) y),
      'apuntadas_solas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada' and (f->'asiento'->>'solo')::boolean),
      'apuntadas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada'),
      'para_mirar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'para_mirar'),
      'por_aclarar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'por_aclarar'),
      'esperadas_no_llegadas', jsonb_array_length(v_esperadas)));
end $function$;

-- ── public.company_chart_import_apply ──
CREATE OR REPLACE FUNCTION public.company_chart_import_apply(p_import uuid, p_plan jsonb, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_quien uuid := auth.uid(); v_nombre text;
  v_plan text; v_d int; v_territorio text; v_sistema text; v_programa text;
  r record; x jsonb; v_code text; v_id uuid; v_suf int;
  n_serie int := 0; n_propias int := 0; n_genericas int := 0; n_fichas int := 0; n_enl int := 0; n_sub int := 0;
  avisos text[] := '{}'; fichas jsonb := '{}'::jsonb; creadas uuid[] := '{}';
begin
  select * into imp from public.company_chart_import where id = p_import for update;
  if imp.id is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(imp.company_id);
  v_nombre := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if imp.status <> 'revision' then raise exception 'Esta importación ya está %.', case imp.status when 'traida' then 'traída' else 'deshecha' end using errcode = '23514'; end if;
  if exists (select 1 from public.company_account where company_id = imp.company_id) then
    raise exception 'El plan contable de esta empresa ya está activado.' using errcode = '23505';
  end if;
  select case p.chart_kind when 'normal' then 'general' else 'pymes' end, p.account_digits, p.tax_territory into v_plan, v_d, v_territorio
    from public.company_tax_profile p where p.company_id = imp.company_id;
  if v_plan is distinct from imp.plan or v_d is distinct from imp.digits then
    raise exception 'La empresa usa ahora el plan % con % dígitos y el fichero se leyó para % con %: vuelve a leerlo.', v_plan, v_d, imp.plan, imp.digits using errcode = '22023';
  end if;
  v_sistema := case v_territorio when 'canarias' then 'igic' else 'iva' end;
  v_programa := case imp.program when 'diez' then 'Cegid Diez' when 'sage50' then 'Sage 50' when 'contasol' then 'Contasol' when 'holded' then 'Holded' else 'otro programa' end;
  if jsonb_typeof(p_plan -> 'cuentas') <> 'array' then raise exception 'Falta la lista de cuentas.' using errcode = '22023'; end if;

  -- 4a · Validar las cuentas propias: su longitud, su hoja (del plan de la empresa) y que no sean de serie.
  for x in select * from jsonb_array_elements(p_plan -> 'cuentas') loop
    v_code := x ->> 'code';
    if v_code !~ ('^[0-9]{' || v_d || '}$') then raise exception '«%» no tiene % dígitos.', v_code, v_d using errcode = '22023'; end if;
    if not exists (select 1 from public.pgc_account a where a.plan = v_plan and a.code = x ->> 'hoja' and a.is_leaf and a.valid_to is null) then
      raise exception '% dice colgar de %, que no es una cuenta sin hijas del plan de %.', v_code, x ->> 'hoja', v_plan using errcode = '22023';
    end if;
    if v_code not like (x ->> 'hoja') || '%' or v_code = rpad(x ->> 'hoja', v_d, '0') then
      raise exception '% no es una subcuenta propia de %.', v_code, x ->> 'hoja' using errcode = '22023';
    end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception '% no tiene nombre.', v_code using errcode = '22023'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_plan -> 'cuentas')) <> (select count(distinct e ->> 'code') from jsonb_array_elements(p_plan -> 'cuentas') e) then
    raise exception 'Hay un código repetido en las cuentas.' using errcode = '22023';
  end if;

  -- 4b · Las hojas de serie, rellenadas, como en la activación normal (D2). El
  --      nombre del fichero, si lo traía, va a name_source; el que se enseña es el oficial (§4.3).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, is_common, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, rpad(a.code, v_d, '0'), a.code, a.name, a.plain_name, 'template', a.code in ('4000', '4100', '4300'), 'serie', v_quien, v_nombre,
         (select s ->> 'nombre_origen' from jsonb_array_elements(coalesce(p_plan -> 'nombres_serie', '[]'::jsonb)) s where s ->> 'code' = rpad(a.code, v_d, '0') limit 1),
         null
    from public.pgc_account a where a.plan = v_plan and a.is_leaf and a.valid_to is null;
  get diagnostics n_serie = row_count;

  -- 4c · Las propias del fichero, con su código exacto (§4.2).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, j ->> 'code', j ->> 'hoja', trim(j ->> 'nombre'), 'own', 'migrated', v_quien, v_nombre, nullif(trim(j ->> 'nombre_origen'), ''), imp.id
    from jsonb_array_elements(p_plan -> 'cuentas') j;
  get diagnostics n_propias = row_count;

  -- 4c bis · Las GENÉRICAS del programa (respuesta 2 del C02c): la 16000000 de Diez bajo la 160,
  --          que tiene hijas. Con su número, kind own, source migrated. La regla (madre, relleno,
  --          choque con una hoja) la vuelve a mirar el disparador company_account_madre al insertar.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) loop
    v_code := x ->> 'code';
    if v_code !~ ('^[0-9]{' || v_d || '}$') then raise exception '«%» no tiene % dígitos.', v_code, v_d using errcode = '22023'; end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception '% no tiene nombre.', v_code using errcode = '22023'; end if;
    if exists (select 1 from jsonb_array_elements(p_plan -> 'cuentas') c where c ->> 'code' = v_code) then
      raise exception '% viene a la vez como cuenta propia y como genérica.', v_code using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb))) <> (select count(distinct e ->> 'code') from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) e) then
    raise exception 'Hay un código repetido en las genéricas.' using errcode = '22023';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name, name_source, import_id)
  select v_cuenta, imp.company_id, v_plan, j ->> 'code', j ->> 'madre', trim(j ->> 'nombre'), 'own', 'migrated', v_quien, v_nombre, nullif(trim(j ->> 'nombre_origen'), ''), imp.id
    from jsonb_array_elements(coalesce(p_plan -> 'genericas', '[]'::jsonb)) j;
  get diagnostics n_genericas = row_count;

  -- 4d · Las fichas de proveedor nuevas («Traída de … · por completar»): solo para cuentas propias de 40x/41x del fichero.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'crear', '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_array_elements(p_plan -> 'cuentas') c where c ->> 'code' = x ->> 'code' and (c ->> 'hoja' like '40%' or c ->> 'hoja' like '41%')) then
      raise exception 'La ficha nueva de % no corresponde a una cuenta de proveedor o acreedor del fichero.', x ->> 'code' using errcode = '22023';
    end if;
    if coalesce(trim(x ->> 'nombre'), '') = '' then raise exception 'La ficha nueva de % no tiene nombre.', x ->> 'code' using errcode = '22023'; end if;
    insert into public.supplier (account_id, name, legal_name, tax_id, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, created_by, created_by_name, import_id)
    values (v_cuenta, trim(x ->> 'nombre'), trim(x ->> 'nombre'), nullif(trim(x ->> 'nif'), ''), nullif(trim(x ->> 'direccion'), ''), nullif(trim(x ->> 'cp'), ''),
            nullif(trim(x ->> 'poblacion'), ''), nullif(trim(x ->> 'provincia'), ''), v_quien, v_nombre, imp.id)
    returning id into v_id;
    fichas := fichas || jsonb_build_object(x ->> 'code', v_id);
    creadas := creadas || v_id;
    n_fichas := n_fichas + 1;
  end loop;

  -- 4e · Los enlaces a proveedores y bancos (los comprueba además el disparador de la 0160:
  --      misma cuenta, un tercero por subcuenta, pago solo a 57x/43x).
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'enlaces', '[]'::jsonb)) loop
    select id into v_id from public.company_account where company_id = imp.company_id and code = x ->> 'code' and import_id = imp.id;
    if v_id is null then raise exception 'El enlace apunta a %, que no es una cuenta traída del fichero.', x ->> 'code' using errcode = '22023'; end if;
    if x ->> 'role' not in ('principal', 'pago') then raise exception 'Papel no válido en %.', x ->> 'code' using errcode = '22023'; end if;
    if x ->> 'entity' = 'supplier' then
      if x ->> 'crea_code' is not null then
        if not fichas ? (x ->> 'crea_code') then raise exception '% se enlaza con la ficha que iba a crear %, y no se crea.', x ->> 'code', x ->> 'crea_code' using errcode = '22023'; end if;
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
        values (v_cuenta, imp.company_id, v_id, 'supplier', fichas ->> (x ->> 'crea_code'), x ->> 'role', 'migrated', v_quien);
      else
        if not exists (select 1 from public.supplier s where s.id::text = x ->> 'entity_id' and s.account_id = v_cuenta) then
          raise exception 'El proveedor de % no es de esta cuenta.', x ->> 'code' using errcode = '22023';
        end if;
        insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
        values (v_cuenta, imp.company_id, v_id, 'supplier', x ->> 'entity_id', x ->> 'role', 'migrated', v_quien);
      end if;
    elsif x ->> 'entity' = 'bank_account' then
      if x ->> 'role' <> 'principal' or not exists (select 1 from public.treasury_account t where t.id::text = x ->> 'entity_id' and t.company_id = imp.company_id and t.kind = 'bank') then
        raise exception 'El banco de % no es de esta empresa.', x ->> 'code' using errcode = '22023';
      end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
      values (v_cuenta, imp.company_id, v_id, 'bank_account', x ->> 'entity_id', 'principal', 'migrated', v_quien);
    else
      raise exception 'Entidad no válida en %.', x ->> 'code' using errcode = '22023';
    end if;
    n_enl := n_enl + 1;
  end loop;

  -- 4f · IVA por tipo (§4.7, decisión de Julio): como en la activación normal. Si el código ya
  --      lo trae el fichero (otro programa con subcuentas de IVA por tipo), se respeta y se enlaza a él.
  for r in
    select case when t.rate = trunc(t.rate) then t.rate::int else round(t.rate * 10)::int end suf, array_agg(t.id::text order by t.code) ids,
           replace(rtrim(to_char(min(t.rate), 'FM990.99'), '.'), '.', ',') tipo
      from public.tax_rate t
     where t.tax_system = v_sistema and t.treatment = 'taxed' and (t.valid_to is null or t.valid_to >= current_date)
       and (t.is_system or (t.account_id = v_cuenta and (t.company_id is null or t.company_id = imp.company_id)))
     group by 1 order by 1 desc
  loop
    for v_code, v_suf in select * from (values ('472', 1), ('477', 2)) x(h, o) loop
      if r.suf = 0 then
        select id into v_id from public.company_account where company_id = imp.company_id and code = rpad(v_code, v_d, '0');
      else
        select id into v_id from public.company_account where company_id = imp.company_id and code = v_code || lpad(r.suf::text, v_d - 3, '0');
        if v_id is null then
          insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
          values (v_cuenta, imp.company_id, v_plan, v_code || lpad(r.suf::text, v_d - 3, '0'), v_code,
                  case v_code when '472' then 'IVA soportado ' else 'IVA repercutido ' end || r.tipo || ' %', 'own', 'serie', v_quien, v_nombre)
          returning id into v_id;
          n_sub := n_sub + 1;
        else
          avisos := avisos || (v_code || lpad(r.suf::text, v_d - 3, '0') || ' venía en el fichero: el IVA del ' || r.tipo || ' % se enlaza a ella.');
        end if;
      end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
      select v_cuenta, imp.company_id, v_id, 'tax_rate', i, case v_suf when 1 then 'soportado' else 'repercutido' end, 'serie', v_quien from unnest(r.ids) i;
      n_enl := n_enl + cardinality(r.ids);
    end loop;
  end loop;

  -- 4g · Retenciones: las del modelo elegido a la 4751 del fichero; las demás, a su hoja.
  for x in select * from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) loop
    if x ->> 'modelo' not in ('111', '115') then raise exception 'Modelo no válido en %.', x ->> 'code' using errcode = '22023'; end if;
    if (select count(*) from jsonb_array_elements(p_plan -> 'retenciones') y where y ->> 'modelo' = x ->> 'modelo') > 1 then
      raise exception 'Dos cuentas van al modelo %: elige una.', x ->> 'modelo' using errcode = '22023';
    end if;
    if not exists (select 1 from public.company_account where company_id = imp.company_id and code = x ->> 'code' and import_id = imp.id and template_code = '4751') then
      raise exception '% no es una cuenta de retenciones (4751) traída del fichero.', x ->> 'code' using errcode = '22023';
    end if;
  end loop;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, imp.company_id,
         coalesce((select a.id from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) y
                     join public.company_account a on a.company_id = imp.company_id and a.code = y ->> 'code'
                    where y ->> 'modelo' = w.filed_in limit 1), h.id),
         'withholding_rate', w.id::text, 'principal', case when exists (select 1 from jsonb_array_elements(coalesce(p_plan -> 'retenciones', '[]'::jsonb)) y where y ->> 'modelo' = w.filed_in) then 'migrated' else 'serie' end, v_quien
    from public.withholding_rate w
    join public.company_account h on h.company_id = imp.company_id and h.kind = 'template' and h.template_code = coalesce(w.pgc_hint, '4751')
   where (w.valid_to is null or w.valid_to >= current_date)
     and (w.is_system or (w.account_id = v_cuenta and (w.company_id is null or w.company_id = imp.company_id)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;

  -- 4h · Tipos de gasto: a su hoja, como en la activación normal.
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
  select v_cuenta, imp.company_id, a.id, 'expense_category', g.id::text, 'principal', 'serie', v_quien
    from public.expense_category g
    join public.company_account a on a.company_id = imp.company_id and a.kind = 'template' and a.template_code = g.pgc_account_hint
   where g.is_active and (g.is_system or (g.account_id = v_cuenta and (g.company_id is null or g.company_id = imp.company_id)));
  get diagnostics v_suf = row_count; n_enl := n_enl + v_suf;

  -- 4i · Bancos de Folvy que no venían en el fichero: su subcuenta, la siguiente libre (§4.9).
  for r in select t.id, t.name from public.treasury_account t
            where t.company_id = imp.company_id and t.kind = 'bank' and t.is_active
              and not exists (select 1 from public.company_account_link l where l.company_id = imp.company_id and l.entity = 'bank_account' and l.entity_id = t.id::text)
            order by t.name, t.id loop
    v_code := public.company_account_siguiente(imp.company_id, '572', v_d);
    if v_code is null then avisos := avisos || ('Numeración agotada en 572: ' || r.name || ' se queda sin subcuenta.'); continue; end if;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by, created_by_name)
    values (v_cuenta, imp.company_id, v_plan, v_code, '572', 'Bancos · ' || r.name, 'own', 'serie', v_quien, v_nombre) returning id into v_id;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (v_cuenta, imp.company_id, v_id, 'bank_account', r.id::text, 'principal', 'serie', v_quien);
    n_sub := n_sub + 1; n_enl := n_enl + 1;
  end loop;
  -- Los proveedores de Folvy que no venían en el fichero NO se numeran aquí: reciben la
  -- propuesta de la IA como hoy (0180), con el siguiente número libre dentro de lo traído.

  update public.company_chart_import
     set status = 'traida', applied_at = now(), applied_by = v_quien, applied_by_name = v_nombre,
         result = jsonb_build_object('serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub,
                                     'fichas_creadas', to_jsonb(creadas), 'avisos', to_jsonb(avisos))
   where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, despues, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importado',
          format('Plan traído de %s · %s cuentas%s · %s enlaces%s', v_programa, n_propias + n_genericas,
                 case when n_genericas > 0 then format(' · %s %s', n_genericas, case when n_genericas = 1 then 'genérica' else 'genéricas' end) else '' end,
                 (select count(distinct l.company_account_id) from public.company_account_link l join public.company_account a on a.id = l.company_account_id
                   where a.import_id = imp.id and l.source = 'migrated'),
                 case when n_fichas > 0 then format(' · %s fichas nuevas', n_fichas) else '' end),
          jsonb_build_object('importacion', imp.id, 'programa', imp.program, 'plan', v_plan, 'digitos', v_d, 'serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas,
                             'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos)),
          'migrated', v_quien, v_nombre);
  return jsonb_build_object('importacion', imp.id, 'serie', n_serie, 'cuentas', n_propias + n_genericas, 'genericas', n_genericas, 'fichas', n_fichas, 'enlaces', n_enl, 'subcuentas', n_sub, 'avisos', to_jsonb(avisos));
end $function$;

-- ── public.company_chart_import_undo ──
CREATE OR REPLACE FUNCTION public.company_chart_import_undo(p_import uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  imp public.company_chart_import%rowtype;
  v_cuenta uuid; v_nombre text; fk record; n bigint; usadas text[] := '{}'; v_fichas uuid[]; n_cuentas int; n_borradas int;
  v_terceros uuid[] := '{}';
begin
  select * into imp from public.company_chart_import where id = p_import for update;
  if imp.id is null then raise exception 'Esa importación no existe.' using errcode = 'P0002'; end if;
  v_cuenta := public.conta_ia_cuenta(imp.company_id);
  v_nombre := coalesce(p_quien_nombre, public.conta_nombre_actor());
  if imp.status <> 'traida' then raise exception 'Solo se deshace un plan traído.' using errcode = '23514'; end if;
  -- Con asientos no se deshace (respuesta 1.3). Hasta el C04 no hay asientos: la guarda es la de la longitud.
  if public.company_account_length_locked(imp.company_id) then
    raise exception 'Ya hay asientos en este plan: deshacer la importación borraría su historia. No se puede.' using errcode = '23514';
  end if;
  select coalesce(array_agg(s.id), '{}') into v_fichas from public.supplier s where s.import_id = imp.id;
  if cardinality(v_fichas) > 0 then
    for fk in
      select c.conrelid::regclass::text tabla, a.attname columna
        from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.supplier'::regclass and cardinality(c.conkey) = 1
         and c.conrelid::regclass::text not in ('supplier_contact', 'supplier_alias', 'supplier_learning', 'supplier_learning_log', 'supplier_proposal', 'party_role')
    loop
      execute format('select count(*) from %s where %I = any($1)', fk.tabla, fk.columna) into n using v_fichas;
      if n > 0 then usadas := usadas || format('%s en %s', n, fk.tabla); end if;
    end loop;
    -- C03: el papel de proveedor (party_role) es parte de la ficha y se va con
    -- ella. Lo que sí es un uso: que su tercero tenga ya OTRO papel (cliente,
    -- plataforma, socio de marca), porque alguien se lo dio a mano.
    select coalesce(array_agg(distinct r.party_id), '{}') into v_terceros from public.party_role r where r.supplier_id = any(v_fichas);
    select count(distinct r.party_id) into n from public.party_role r where r.party_id = any(v_terceros) and r.role <> 'supplier';
    if n > 0 then usadas := usadas || format('%s con otro papel en Clientes y proveedores', n); end if;
    if cardinality(usadas) > 0 then
      raise exception 'Alguna ficha creada al traer el plan ya se ha usado (%): deshacer la borraría. Quita antes ese uso o deja el plan como está.', array_to_string(usadas, ', ') using errcode = '23514';
    end if;
  end if;

  select count(*) into n_cuentas from public.company_account where import_id = imp.id;
  delete from public.company_account_link where company_id = imp.company_id;
  delete from public.company_account where company_id = imp.company_id;
  get diagnostics n_borradas = row_count;
  -- Las propuestas de la IA contestadas sobre este plan vuelven a poder salir.
  delete from public.ai_suggestion where company_id = imp.company_id and kind = 'plan';
  delete from public.supplier where id = any(v_fichas);
  -- C03: sus terceros, que se han quedado sin ningún papel, se van también.
  delete from public.party p where p.id = any(v_terceros) and not exists (select 1 from public.party_role r where r.party_id = p.id);
  update public.company_chart_import set status = 'deshecha', undone_at = now(), undone_by = auth.uid(), undone_by_name = v_nombre where id = imp.id;
  insert into public.company_account_log (account_id, company_id, que, detalle, antes, source, done_by, done_by_name)
  values (v_cuenta, imp.company_id, 'importacion_deshecha',
          format('Deshecho el plan traído: se quitan sus %s cuentas y %s fichas nuevas; el plan vuelve a estar sin activar.', n_cuentas, cardinality(v_fichas)),
          jsonb_build_object('importacion', imp.id, 'cuentas_borradas', n_borradas, 'fichas_borradas', cardinality(v_fichas)),
          'migrated', auth.uid(), v_nombre);
  return jsonb_build_object('cuentas', n_borradas, 'fichas', cardinality(v_fichas));
end $function$;

-- ── public.party_add_role ──
CREATE OR REPLACE FUNCTION public.party_add_role(p_party uuid, p_role text, p_config jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cuenta uuid := public.party_cuenta(p_party); v_canal uuid; n int := 0;
begin
  if p_role not in ('customer', 'platform', 'brand_partner') then
    raise exception 'Ese papel no se añade desde aquí (el de proveedor llega con su ficha de Cocina).' using errcode = '22023';
  end if;
  if p_role = 'platform' then
    v_canal := nullif(p_config->>'channelId', '')::uuid;
    insert into party_role (account_id, party_id, role, channel_id, settlement_every, commission_pct, created_by)
    values (v_cuenta, p_party, 'platform', v_canal, nullif(p_config->>'settlementEvery', ''), nullif(p_config->>'commissionPct', '')::numeric, auth.uid())
    on conflict (party_id, role) do update set channel_id = excluded.channel_id, settlement_every = excluded.settlement_every,
                                                commission_pct = excluded.commission_pct;
    if v_canal is not null then
      update channel_settlement set party_id = p_party
       where account_id = v_cuenta and channel_id = v_canal and party_id is distinct from p_party;
      get diagnostics n = row_count;
    end if;
  elsif p_role = 'brand_partner' then
    insert into party_role (account_id, party_id, role, contribution_kinds, created_by)
    values (v_cuenta, p_party, 'brand_partner',
            coalesce((select array_agg(x) from jsonb_array_elements_text(p_config->'contributionKinds') x), array['marketing', 'packaging']), auth.uid())
    on conflict (party_id, role) do update set contribution_kinds = excluded.contribution_kinds;
  else
    insert into party_role (account_id, party_id, role, created_by) values (v_cuenta, p_party, 'customer', auth.uid())
    on conflict (party_id, role) do nothing;
    insert into customer_fiscal (party_id, account_id) values (p_party, v_cuenta) on conflict (party_id) do nothing;
  end if;
  return jsonb_build_object('party_id', p_party, 'role', p_role, 'liquidaciones_enlazadas', n);
end $function$;

-- ── public.party_misma_cuenta ──
CREATE OR REPLACE FUNCTION public.party_misma_cuenta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from party p where p.id = new.party_id and p.account_id = new.account_id) then
    raise exception 'El papel y su tercero tienen que ser de la misma cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'party_role' then
    if new.supplier_id is not null and not exists (select 1 from supplier s where s.id = new.supplier_id and s.account_id = new.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '23514';
    end if;
    if new.channel_id is not null and not exists (select 1 from sales_channel c where c.id = new.channel_id and c.account_id = new.account_id) then
      raise exception 'Ese canal de venta no es de esta cuenta.' using errcode = '23514';
    end if;
  end if;
  return new;
end $function$;

-- ── public._party_merge ──
CREATE OR REPLACE FUNCTION public._party_merge(p_queda uuid, p_se_va uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cuenta uuid; v_a party; v_b party;
  v_mov jsonb := '{}'::jsonb; v_quedan jsonb := '[]'::jsonb; v_ids uuid[];
  v_validados int; v_n int := 0; v_resumen text; v_nif_movido boolean := false; v_merge uuid; v_prov uuid[]; r record;
begin
  if p_queda = p_se_va then raise exception 'Es la misma ficha.' using errcode = '22023'; end if;
  select * into v_a from party where id = p_queda for update;
  if v_a.id is null then raise exception 'Ese tercero no existe.' using errcode = 'P0002'; end if;
  v_cuenta := v_a.account_id;
  select * into v_b from party where id = p_se_va for update;
  if v_b.id is null or v_b.account_id <> v_cuenta then raise exception 'Las dos fichas tienen que ser de la misma cuenta.' using errcode = '42501'; end if;
  if exists (select 1 from party_merge m where m.undone_at is null and m.gone_party_id = p_queda) then
    raise exception '% ya se fusionó en otra ficha: fusiona con esa.', v_a.name using errcode = '22023';
  end if;

  select (select count(*) from journal_entry where party_id = p_se_va and status in ('validado', 'anulado'))
       + (select count(*) from journal_line l join journal_entry e on e.id = l.entry_id where l.party_id = p_se_va and e.status in ('validado', 'anulado'))
    into v_validados;
  if v_validados > 0 then
    raise exception '% sale en % asiento(s) o apunte(s) validados: lo validado no cambia de tercero. Anúlalos y rehazlos con %, y vuelve a fusionar.', v_b.name, v_validados, v_a.name
      using errcode = '23514';
  end if;

  select coalesce(array_agg(x.id), '{}') into v_ids from party_role x
   where x.party_id = p_se_va and not exists (select 1 from party_role y where y.party_id = p_queda and y.role = x.role);
  for r in select role from party_role where party_id = p_se_va and not (id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'papel', 'papel', r.role);
  end loop;
  update party_role set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('party_role', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(l.id), '{}') into v_ids from company_account_link l
   where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text
     and not exists (select 1 from company_account_link x where x.company_id = l.company_id and x.entity = 'customer' and x.entity_id = p_queda::text and x.role = l.role);
  for r in select l.role, a.code from company_account_link l join company_account a on a.id = l.company_account_id
            where l.account_id = v_cuenta and l.entity = 'customer' and l.entity_id = p_se_va::text and not (l.id = any(v_ids)) loop
    v_quedan := v_quedan || jsonb_build_object('que', 'cuenta', 'papel', r.role, 'codigo', r.code);
  end loop;
  update company_account_link set entity_id = p_queda::text where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('company_account_link', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  if exists (select 1 from customer_fiscal where party_id = p_se_va) then
    if not exists (select 1 from customer_fiscal where party_id = p_queda) then
      update customer_fiscal set party_id = p_queda where party_id = p_se_va;
      v_mov := v_mov || jsonb_build_object('customer_fiscal', true); v_n := v_n + 1;
    else
      v_quedan := v_quedan || jsonb_build_object('que', 'datos_fiscales');
    end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_ids from channel_settlement where party_id = p_se_va and account_id = v_cuenta;
  update channel_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('channel_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from licensed_settlement where party_id = p_se_va and account_id = v_cuenta;
  update licensed_settlement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('licensed_settlement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_licensing_agreement where party_id = p_se_va and account_id = v_cuenta;
  update brand_licensing_agreement set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_licensing_agreement', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from brand_partner_contribution where party_id = p_se_va and account_id = v_cuenta;
  update brand_partner_contribution set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('brand_partner_contribution', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  select coalesce(array_agg(id), '{}') into v_ids from journal_entry where party_id = p_se_va and account_id = v_cuenta;
  update journal_entry set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_entry', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);
  select coalesce(array_agg(id), '{}') into v_ids from journal_line where party_id = p_se_va and account_id = v_cuenta;
  update journal_line set party_id = p_queda where id = any(v_ids);
  v_mov := v_mov || jsonb_build_object('journal_line', to_jsonb(v_ids)); v_n := v_n + cardinality(v_ids);

  if v_a.tax_id is null and v_b.tax_id is not null then
    update party set tax_id = null where id = p_se_va;
    update party set tax_id = v_b.tax_id where id = p_queda;
    v_nif_movido := true;
  end if;

  select coalesce(array_agg(s.id), '{}') into v_prov from party_role pr join supplier s on s.id = pr.supplier_id
   where pr.party_id = p_se_va and s.archived_at is null;
  update supplier set archived_at = now() where id = any(v_prov);
  update party set archived_at = coalesce(archived_at, now()), archived_note = format('Fusionado con %s', v_a.name) where id = p_se_va;

  v_resumen := format('%s fusionado en %s: %s %s movido%s%s%s.', v_b.name, v_a.name, v_n, case when v_n = 1 then 'dato' else 'datos' end,
    case when v_n = 1 then '' else 's' end,
    case when v_nif_movido then format(', con su NIF %s', v_b.tax_id) else '' end,
    case when jsonb_array_length(v_quedan) > 0 then format('; se queda en %s (archivada) lo que %s ya tenía: %s', v_b.name, v_a.name,
      (select string_agg(case x->>'que' when 'papel' then 'su papel de ' || case x->>'papel' when 'supplier' then 'proveedor' when 'customer' then 'cliente' when 'platform' then 'plataforma' when 'brand_partner' then 'socio de marca' else x->>'papel' end when 'cuenta' then 'la cuenta ' || (x->>'codigo') else 'sus datos fiscales' end, ', ')
         from jsonb_array_elements(v_quedan) x)) else '' end);

  insert into party_merge (account_id, kept_party_id, gone_party_id, moved, kept_on_gone, summary, done_by, done_by_name)
  values (v_cuenta, p_queda, p_se_va,
          v_mov || jsonb_build_object('nif', v_nif_movido, 'antes', jsonb_build_object('archived_at', v_b.archived_at, 'archived_note', v_b.archived_note, 'tax_id', v_b.tax_id),
                                      'proveedores_archivados', to_jsonb(v_prov)),
          v_quedan, v_resumen, auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning id into v_merge;
  return jsonb_build_object('fusion', v_merge, 'resumen', v_resumen, 'movidos', v_n, 'se_quedan', v_quedan);
end $function$;

