-- supabase/migrations/20261206T0500_d03_recibida_pdf_sin_recepcion.sql
-- cambia: public._compras_factura_desde_papel · prueba: supabase/staging/sql/20261206_d03_recibida_pdf_prueba.sql
--
-- D03 · LA RECIBIDA QUE SE SUBE SIN RECEPCIÓN NACE CON SU DOCUMENTO (Julio, 23/10).
--
-- _compras_factura_desde_papel (0140) hace la factura recibida desde una
-- lectura de ocr-albaran y le pone como documento el de su RECEPCIÓN
-- (goods_receipt.raw_document_url). Cuando no hay recepción —«Subir una
-- factura» en Compras, que llama a compras_factura_desde_papel con
-- p_recepcion nulo— la factura nacía SIN documento, aunque el fichero estaba
-- subido en receipt-uploads y apuntado en su lectura
-- (goods_receipt_ai_session.input_files). Medido en producción el 23/10, solo
-- lectura, todas las cuentas: 2 recibidas así, las dos de Foodint y las dos
-- PDF (FAC-00098 S11/0177416578, 19/10; FAC-00101 COHELDI P26 4.980, 21/10).
-- No es cosa de PDF o foto: es que no hay recepción. Las 8 que sí tienen
-- documento entraron por una recepción (7) o por la pantalla vieja de
-- facturas, que lo guardaba ella (1, FAC-00001).
--
-- El cambio, uno solo: si no hay recepción o la suya no tiene documento, el
-- primero de los ficheros de su lectura, de la misma cuenta (regla 9) y del
-- bucket receipt-uploads, que es lo mismo que la recepción guarda en
-- raw_document_url (220 de 220 recepciones leídas: 209 de Foodint y 11 de la
-- plantilla; medido el 23/10). Con
-- recepción y documento, igual que antes. El cuerpo de partida es el de
-- PRODUCCIÓN (pg_get_functiondef, md5 e0d04afddb7e98ab9cb1b46deccb91e0; cuerpo
-- 5a1926e590b6a7cfa09e2b50efaaac8f, la 0370 byte a byte). Misma firma: create
-- or replace, sin sobrecarga (regla 2). Los permisos se quedan como están.
--
-- Con el D02 (0470): si el documento es una foto, conta-recibida-pdf la
-- convierte a PDF; si ya es un PDF, no hay nada que convertir, y cuando su
-- asiento se valide, la pasada del minuto lo enlaza al asiento y despierta su
-- envío a Diez si esperaba por el documento. Hasta hoy, una recibida subida
-- sin recepción se habría ido a Diez con «falta el documento».
--
-- No toca filas (las dos de Foodint las arregla la 0510, aparte, con su
-- «autorizo»). No toca el camino del pedido ni coste ni stock: la factura
-- nace con líneas sin artículo, como antes.
-- Vuelta atrás: supabase/vuelta-atras/20261206T0500_d03_recibida_pdf_sin_recepcion.down.sql
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
  if v_doc is null then raise exception 'Ese documento no está leído en esta cuenta.' using errcode = 'P0002'; end if;
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
      'motivo', case when v_total = 0 then 'El documento no trae líneas: sube la factura en Compras.'
                     else format('El documento trae %s línea(s) sin importe o sin IVA: sube la factura en Compras o complétala.', v_total - v_ok) end);
  end if;

  select sum((l->>'line_amount')::numeric), sum(round((l->>'line_amount')::numeric * (l->>'vat_pct')::numeric / 100, 2))
    into v_base, v_cuota from jsonb_array_elements(v_lineas) l;
  if p_recepcion is not null then select raw_document_url into v_url from goods_receipt where id = p_recepcion; end if;
  -- 0500: sin recepción, o con una recepción sin documento, el fichero que se
  -- leyó: el primero de su lectura, de esta misma cuenta (lo que la recepción
  -- guarda en goods_receipt.raw_document_url). «Subir una factura» no lo
  -- guardaba: FAC-00098 y FAC-00101 de Foodint (19 y 21/10) nacieron sin él.
  if v_url is null then
    select nullif(btrim(case when jsonb_typeof(a.input_files -> 0) = 'string' then a.input_files ->> 0
                             else a.input_files -> 0 ->> 'path' end), '')
      into v_url
      from goods_receipt_ai_session a
     where a.id = p_sesion and a.account_id = p_cuenta
       and jsonb_typeof(a.input_files) = 'array'
       and coalesce(a.input_files -> 0 ->> 'bucket', 'receipt-uploads') = 'receipt-uploads';
  end if;

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
    'motivo', format('Factura %s creada desde el documento: %s de base, %s de IVA.', coalesce(v_num, 'sin número'), public.compras_euros(v_base), public.compras_euros(v_cuota)));
end $function$;
