-- supabase/vuelta-atras/20261025T1212_v02_puerta.down.sql
--
-- Vuelta atrás de 20261025T1212_v02_puerta: todo como estaba el 25/10.
--   · Sin las funciones de la puerta ni sus ajustes.
--   · conta_direccion_entrada y conta_entrada_remitente, las de producción del
--     25/10 (medidas con pg_get_functiondef).
--   · Las restricciones de antes en las direcciones, las esperadas y los
--     remitentes. PARA si hay algo que solo cabe en lo nuevo (una dirección de
--     documentos, una fuente sin proveedor o con otra cadencia, un remitente
--     «tipo», una petición sin proveedor): eso ya es trabajo de alguien y no
--     se deshace a ciegas.
--   · conta_documentos_recibidos, la de producción del 25/10.
--   · Sin las columnas nuevas.
--   · Sin el almacén conta-entrada (vacío; con ficheros, PARA).

do $$ begin
  if exists (select 1 from public.company_inbound_address where kind = 'documentos')
     or exists (select 1 from public.supplier_expected_invoice where supplier_id is null or cadence <> 'mensual')
     or exists (select 1 from public.company_inbound_sender where decision <> 'no_facturas')
     or exists (select 1 from public.supplier_invoice_request where supplier_id is null)
     or exists (select 1 from public.document_inbox where file_bucket = 'conta-entrada')
     or exists (select 1 from storage.objects where bucket_id = 'conta-entrada') then
    raise exception 'VUELTA ATRÁS DE LA PUERTA: hay direcciones de documentos, fuentes nuevas, remitentes aprendidos, peticiones sin proveedor o ficheros en conta-entrada. No se deshace a ciegas.';
  end if;
end $$;

-- Facturas recibidas, la de producción del 25/10 (md5 del cuerpo 15e5295e4d6b2538e9b557f3eda153d3).
create or replace function public.conta_documentos_recibidos(p_company uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
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
        when r.question = 'factura_sin_importes' then 'La recepción la leyó, pero no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.'
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
end $$;

drop function if exists public.conta_puerta_subida(uuid, text, text, text, integer, text, text);
drop function if exists public.conta_puerta_pedir(uuid, date, text, text, text, text);
drop function if exists public.conta_entrada_tipo(uuid, text, text);
drop function if exists public.conta_puerta_dime_que_es(uuid, text, boolean, text);
drop function if exists public.conta_puerta(uuid, int);
drop function if exists public.conta_puerta_ajustes_poner(uuid, boolean, smallint, text);
drop function if exists public.conta_puerta_fuente_guardar(uuid, jsonb, text);
drop function if exists public.conta_puerta_fuentes_proponer(uuid);
drop function if exists public.conta_puerta_fuentes(uuid);
drop function if exists public._conta_puerta_llegadas(public.supplier_expected_invoice);
drop function if exists public._conta_puerta_cuenta(uuid);
drop table if exists public.conta_puerta_ajustes;

create or replace function public.conta_entrada_remitente(p_company uuid, p_from text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object('decision', s.decision, 'motivo', s.reason)
    from public.company_inbound_sender s
   where s.company_id = p_company
     and s.sender_sha256 = encode(sha256(convert_to(lower(btrim(coalesce(substring(p_from from '<([^>]+)>'), p_from, ''))), 'UTF8')), 'hex')
$function$;
alter table public.company_inbound_sender drop constraint if exists company_inbound_sender_decision_check;
alter table public.company_inbound_sender add constraint company_inbound_sender_decision_check check (decision = 'no_facturas'::text);
alter table public.company_inbound_sender drop column if exists doc_kind;

drop index if exists public.supplier_invoice_request_fuente_mes_uq;
alter table public.supplier_invoice_request alter column supplier_id set not null;

drop index if exists public.supplier_expected_invoice_clave_uq;
alter table public.supplier_expected_invoice drop column if exists updated_by_name;
alter table public.supplier_expected_invoice drop column if exists location_id;
alter table public.supplier_expected_invoice drop column if exists updated_at;
alter table public.supplier_expected_invoice drop column if exists covered_by_recurring_id;
alter table public.supplier_expected_invoice drop column if exists match;
alter table public.supplier_expected_invoice drop column if exists source_key;
alter table public.supplier_expected_invoice drop column if exists group_label;
alter table public.supplier_expected_invoice drop column if exists gap_days;
alter table public.supplier_expected_invoice drop column if exists weekday;
alter table public.supplier_expected_invoice drop column if exists margin_days;
alter table public.supplier_expected_invoice drop column if exists kind;
alter table public.supplier_expected_invoice drop constraint if exists supplier_expected_invoice_cadence_check;
alter table public.supplier_expected_invoice add constraint supplier_expected_invoice_cadence_check check (cadence = 'mensual'::text);
alter table public.supplier_expected_invoice alter column supplier_id set not null;

alter table public.document_inbox drop constraint if exists document_inbox_file_bucket_check;
alter table public.document_inbox add constraint document_inbox_file_bucket_check check (file_bucket = 'receipt-uploads'::text);
drop policy if exists conta_entrada_select on storage.objects;
drop policy if exists conta_entrada_insert on storage.objects;
drop policy if exists conta_entrada_delete on storage.objects;
-- El almacén conta-entrada, vacío (la guarda de arriba para si tiene ficheros),
-- se borra con storage.allow_delete_query solo en esta transacción: sin eso,
-- el disparador storage.protect_delete lo impide (staging y producción lo
-- tienen). Antes se tragaba el error y el almacén se quedaba: el ensayo de la
-- tanda (run 40216083774, 25/10) lo cazó, «el almacén» no volvía a «no». Si
-- aun así no se borra, PARA: callarlo dejaría producción distinta (como S01).
do $$ begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.buckets where id = 'conta-entrada';
  perform set_config('storage.allow_delete_query', 'false', true);
  if exists (select 1 from storage.buckets where id = 'conta-entrada') then
    raise exception 'VUELTA ATRÁS DE LA PUERTA: el almacén conta-entrada, vacío, no se ha borrado.';
  end if;
end $$;
alter table public.document_inbox drop column if exists expected_id;
alter table public.document_inbox drop column if exists doc_kind_by;
alter table public.document_inbox drop column if exists doc_kind;

create or replace function public.conta_direccion_entrada(p_company uuid, p_tipo text, p_quien_nombre text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_c public.company;
  v_base text; v_lp text; v_i int := 1;
  v_x public.company_inbound_address;
begin
  if p_tipo not in ('facturas', 'liquidaciones') then raise exception 'Una dirección es de facturas o de liquidaciones.' using errcode = '22023'; end if;
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_x from public.company_inbound_address where company_id = p_company and kind = p_tipo;
  if v_x.id is not null then return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', true); end if;
  if not public.current_user_is_admin_or_manager_of(v_c.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta crea las direcciones de entrada.' using errcode = '42501';
  end if;
  v_base := regexp_replace(lower(translate(coalesce(nullif(v_c.trade_name, ''), v_c.legal_name, 'empresa'),
                                           'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc')), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := left(regexp_replace(v_base, '-(s-?l-?u?|s-?a|s-?c-?p|s-?l-?l)$', ''), 30);
  if length(v_base) < 2 then v_base := 'empresa'; end if;
  v_lp := p_tipo || '-' || v_base;
  while exists (select 1 from public.company_inbound_address where lower(local_part) = v_lp and domain = 'entrada.folvy.app') loop
    v_i := v_i + 1; v_lp := p_tipo || '-' || v_base || '-' || v_i;
  end loop;
  insert into public.company_inbound_address (account_id, company_id, kind, local_part, created_by, created_by_name)
  values (v_c.account_id, v_c.id, p_tipo, v_lp, auth.uid(), p_quien_nombre) returning * into v_x;
  return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', false);
end $function$;
alter table public.company_inbound_address drop constraint if exists company_inbound_address_local_part_check;
alter table public.company_inbound_address add constraint company_inbound_address_local_part_check
  check (local_part ~ (('^'::text || kind) || '-[a-z0-9][a-z0-9-]{1,40}$'::text));
alter table public.company_inbound_address drop constraint if exists company_inbound_address_kind_check;
alter table public.company_inbound_address add constraint company_inbound_address_kind_check
  check (kind = any (array['facturas'::text, 'liquidaciones'::text]));
