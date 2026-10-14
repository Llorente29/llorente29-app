-- supabase/staging/sql/20261021_d01_recepcion_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0310 (D01 R6): el fichero entero y su prueba
-- en UNA transacción que acaba en ROLLBACK.

begin;
-- ============================================================================
-- D01 · R6 (14/10) · Las facturas que ya entran por la recepción.
--
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261021_d01_recepcion_prueba.sql
-- cambia: public.conta_factura_para_revisar · prueba: supabase/staging/sql/20261021_d01_recepcion_prueba.sql
--
-- Medido en producción (Foodint, solo leyendo, 14/10): 43 recepciones vivas
-- cuyo papel la recepción leyó como «factura» o «albarán-factura» (las 73
-- lecturas son de esas 43 y sus relecturas). Desde el corte (01/10), las 5 ya
-- son factura recibida: Compras la hace con el mismo papel (0140). Las 38 de
-- antes del corte no lo son, a propósito (las llevó Diez), y no salían en
-- ninguna parte.
--
--   1. conta_documentos_recibidos (N22), la misma firma: además de las
--      facturas, las recepciones con papel de factura que no son factura:
--        · de antes del corte, «en Diez»: enlazadas con su asiento traído de
--          Diez cuando casan por proveedor, número (en el concepto) y total;
--          nunca se apuntan otra vez (la base ya no deja asentar antes del
--          corte, 0120 de C04);
--        · desde el corte sin factura: «por aclarar», con la pregunta de su
--          camino (regla 7: no se esconden).
--      Lo leído es el de la recepción: no se vuelve a leer.
--   2. conta_factura_para_revisar (N23), la misma firma: si la factura salió
--      de su recepción y no trae lectura propia, lo que leyó la recepción, para
--      comprobarlo en pantalla con la misma regla que el modo factura.
-- La regla de repetidas no cambia: una factura hecha desde la recepción es una
-- supplier_invoice como las demás, y el disparador (0230) y la lectura (0220)
-- la reconocen si luego llega por correo o subida.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0310_d01_recepcion.down.sql
-- (vuelve a las de la 0300 y la 0290).
-- ============================================================================

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
             where p.account_id = v_acc and p.supplier_id = i.supplier_id and p.id <> i.id and p.status <> 'anulada'
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
      'estado', case when f.asiento->>'estado' = 'validado' then 'apuntada'
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
      'porque', coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end),
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
end $$;
comment on function public.conta_documentos_recibidos(uuid, date, date) is
  'D01 · N22: las facturas recibidas de una empresa en un periodo (las cifras, del periodo; también las recepciones cuyo papel es una factura y no lo es todavía, o que son de antes del corte, enlazadas con Diez), con sus cinco cifras, el porqué de cada fila y lo que Folvy ha entendido; si el correo está encendido y si recibe la mercancía con Folvy. Solo para los de la cuenta.';
revoke all on function public.conta_documentos_recibidos(uuid, date, date) from public, anon;
grant execute on function public.conta_documentos_recibidos(uuid, date, date) to authenticated;

create or replace function public.conta_factura_para_revisar(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_i public.supplier_invoice;
  v_company uuid;
  v_apr jsonb;
begin
  select * into v_i from public.supplier_invoice where id = p_invoice;
  if v_i.id is null or not public.belongs_to_account(v_i.account_id) then
    raise exception 'Esa factura no está.' using errcode = 'P0002';
  end if;
  v_company := coalesce(v_i.company_id, (select id from public.company where account_id = v_i.account_id order by created_at limit 1));
  -- Lo aprendido de sus facturas anteriores (0250): de ahí sale el origen de
  -- verdad, «aprendido de Diez» o «aprendido de tus facturas» (la más reciente).
  if v_i.supplier_id is not null and v_company is not null then
    v_apr := public.conta_gasto_aprendido(v_company, v_i.supplier_id);
  end if;
  return jsonb_build_object(
    'id', v_i.id, 'account_id', v_i.account_id, 'company_id', v_company, 'estado', v_i.status,
    'numero', v_i.invoice_number, 'fecha', v_i.invoice_date, 'vence', v_i.due_date, 'clase', v_i.doc_kind,
    'base', v_i.tax_base_total, 'cuota', v_i.tax_total, 'recargo', v_i.surcharge_total, 'retencion', v_i.withholding_amount, 'total', v_i.grand_total,
    'canal', v_i.arrival_channel, 'confianza', v_i.reading_confidence, 'lectura', v_i.reading,
    -- R6 · Lo que leyó la recepción con su papel, si la factura salió de ella
    -- (Compras, 0140) y no trae lectura propia: la pantalla comprueba eso, sin
    -- volver a leerla con el modelo.
    'leido_en_recepcion', case when v_i.reading is null then (
        select jsonb_build_object('modelo', a.parsed_result, 'cuando', a.created_at, 'recepcion', gr.receipt_date)
          from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id and gr.account_id = v_i.account_id
          join public.goods_receipt_ai_session a on a.id = gr.ai_session_id and a.account_id = gr.account_id
         where r.supplier_invoice_id = v_i.id and a.parsed_result->'document'->>'doc_type' in ('factura', 'albaran_factura')
         order by gr.receipt_date desc limit 1) end,
    'no_repetida', v_i.not_duplicate_confirmed_at is not null,
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', t.vat_pct, 'base', t.base, 'cuota', t.vat_amount, 'recargo', t.surcharge_amount) order by t.vat_pct desc)
                         from public.supplier_invoice_tax t where t.supplier_invoice_id = v_i.id), '[]'::jsonb),
    'lineas', coalesce((select jsonb_agg(jsonb_build_object('texto', l.raw_text, 'cantidad', l.qty, 'importe', l.line_amount, 'iva', l.vat_pct) order by l.position nulls last, l.created_at)
                          from public.supplier_invoice_line l where l.supplier_invoice_id = v_i.id), '[]'::jsonb),
    'proveedor', (select jsonb_build_object(
        'id', s.id, 'nombre', s.name, 'razon', s.legal_name, 'nif', s.tax_id,
        'subcuenta', (select a.code from public.company_account_link k join public.company_account a on a.id = k.company_account_id
                       where k.company_id = v_company and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'principal' limit 1),
        -- «Sus facturas se apuntan en», con su origen dicho para una persona.
        -- Con cuenta en la ficha: si se puso aceptando lo aprendido y sigue
        -- siendo lo aprendido, el origen es el de la historia (Diez o tus
        -- facturas); si la eligió una persona, «elegida en su ficha». Sin
        -- cuenta en la ficha, lo aprendido tal cual.
        'gasto', coalesce(
          (select jsonb_build_object('cuenta', a.code, 'nombre', a.name,
                    'origen', case when k.source in ('ai_accepted', 'aprendido_diez') and v_apr->>'cuenta' = a.code then v_apr->>'origen'
                                   when k.source = 'manual' then 'elegida en su ficha' else 'de su ficha' end)
             from public.company_account_link k join public.company_account a on a.id = k.company_account_id
            where k.company_id = v_company and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'gasto' limit 1),
          case when v_apr->>'cuenta' is not null then jsonb_build_object('cuenta', v_apr->>'cuenta', 'nombre', v_apr->>'nombre', 'origen', v_apr->>'origen') end),
        'facturacion', (select jsonb_build_object('nombre', c.name, 'email', c.email) from public.supplier_contact c
                         where c.supplier_id = s.id and c.account_id = s.account_id and c.role = 'billing' and c.email is not null order by c.created_at limit 1))
      from public.supplier s where s.id = v_i.supplier_id and s.account_id = v_i.account_id),
    'propuesto', case when v_i.supplier_id is null then jsonb_build_object('nombre', v_i.reading->'factura'->'proveedor'->>'nombre', 'nif', v_i.reading->'factura'->'proveedor'->>'nif') end,
    'llegada', (select jsonb_build_object('canal', d.channel, 'archivo', d.file_name, 'ruta', d.file_path, 'tipo', d.mime_type, 'de', d.email_from, 'a', d.email_to, 'cuando', d.created_at)
                  from public.document_inbox d where d.id = v_i.inbox_id and d.account_id = v_i.account_id),
    'papel', v_i.raw_document_url,
    'recepcion', (select jsonb_build_object('fecha', gr.receipt_date, 'local', l.name)
                    from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id
                    left join public.locations l on l.id = gr.location_id
                   where r.supplier_invoice_id = v_i.id order by gr.receipt_date desc limit 1),
    'asiento', (select jsonb_build_object('id', e.id, 'estado', e.status, 'numero', e.number)
                  from public.journal_entry e
                 where e.account_id = v_i.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_i.id and e.status in ('propuesto', 'borrador', 'validado')
                 order by (e.status = 'validado') desc, e.created_at desc limit 1));
end $$;
comment on function public.conta_factura_para_revisar(uuid) is
  'D01 · N23: todo lo de una factura recibida para revisarla (lo leído, o lo que leyó su recepción, su proveedor con «Sus facturas se apuntan en» y su contacto de Facturación, su llegada y fichero, su recepción y su asiento). Solo para los de la cuenta.';
revoke all on function public.conta_factura_para_revisar(uuid) from public, anon;
grant execute on function public.conta_factura_para_revisar(uuid) to authenticated;

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 R6 recepción: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo que escribe el servidor: como dueño.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_s uuid; v_run uuid; v_ca uuid; r jsonb; v_i uuid;
  -- Una recepción con su lectura y su camino (el que deja Compras), como en producción.
  v_r uuid;
begin
  if exists (select 1 from public.fiscal_year where company_id = c and code = '2024') then
    raise exception 'PRUEBA D01 R6 recepción · 0: la empresa A ya tiene un 2024: la prueba necesita traerlo ella.';
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Recepción Prueba R6', 'Recepción Prueba R6, S.L.', 'B00000081', true, 'Prueba D01 R6') returning id into v_s;
  perform set_config('prueba.s', v_s::text, true);

  -- El 2024, traído de Diez (antes del corte), con un asiento de factura recibida.
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values (v_acc, c, 'diez', 'historico', '2024-01-01', '2024-12-31') returning id into v_run;
  perform public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  perform public.conta_diez_subcuentas(c, v_run, '[{"code":"40000977","nombre":"RECEPCION PRUEBA R6"}]');
  select id into v_ca from public.company_account where company_id = c and code = '40000977';
  perform public.company_account_link_set(c, 'supplier', v_s::text, 'principal', v_ca, 'Prueba D01 R6', 'manual');
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(jsonb_build_object(
    'ejercicio', '2024', 'serie', 2, 'numero', 9001, 'fecha', '2024-12-12', 'concepto', 'Fra. RCP-24/77 Recepción Prueba R6',
    'tipoAsiento', 2, 'huella', 'h-r6', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '62100000', 'debe', 12100, 'haber', 0),
      jsonb_build_object('posicion', 2, 'cuenta', '40000977', 'debe', 0, 'haber', 12100)))));
  if (r->>'traidos')::int <> 1 then raise exception 'PRUEBA D01 R6 recepción · 0: no se trajo el asiento de Diez: %', r; end if;

  -- R1 · 2024, «factura», casa con el asiento de Diez por número y total.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-24/77","doc_date":"2024-12-10","grand_total":121,"supplier_name":"Recepción Prueba R6"},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, supplier_doc_number, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-10', 'confirmado', v_acc::text || '/prueba-r6/r1.jpg', v_i, 'RCP-24/77', 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6. Es anterior al corte (31/12/2024): la lleva el programa anterior.');
  perform set_config('prueba.r1', v_r::text, true);
  -- R2 · 2024, «albarán-factura», no está en Diez.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"albaran_factura","doc_number":"RCP-24/78","doc_date":"2024-12-11","grand_total":50,"supplier_name":"Recepción Prueba R6"},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-11', 'confirmado', v_acc::text || '/prueba-r6/r2.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'factura', v_s, c, 'albaran_factura', 'Prueba D01 R6.');
  perform set_config('prueba.r2', v_r::text, true);
  -- R3 · 2024, albarán suelto: no es factura.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"albaran","doc_number":"ALB-24/1","grand_total":20},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2024-12-12', 'confirmado', v_acc::text || '/prueba-r6/r3.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason)
  values (v_acc, v_r, 'pendiente_factura', v_s, c, 'albaran', 'Prueba D01 R6.');
  perform set_config('prueba.r3', v_r::text, true);

  -- R4 · Desde el corte (2026 es de Folvy), «factura» sin importes por línea: Compras no pudo hacerla.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-26/79","doc_date":"2026-12-10","grand_total":30},"lines":[],"confidence":0.9}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2026-12-10', 'confirmado', v_acc::text || '/prueba-r6/r4.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason, question)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6: sin importes por línea.', 'factura_sin_importes');
  perform set_config('prueba.r4', v_r::text, true);

  -- R5 · Desde el corte, «factura» que Compras sí hizo factura con su papel (0140), enlazada.
  insert into public.goods_receipt_ai_session (account_id, kind, parsed_result, ai_model, status)
  values (v_acc, 'photo', '{"document":{"doc_type":"factura","doc_number":"RCP-26/80","doc_date":"2026-12-11","grand_total":40,"supplier_name":"Recepción Prueba R6","supplier_tax_id":"B00000081"},"lines":[{"raw_text":"Género","line_amount":36.36,"vat_pct":10}],"confidence":0.95}', 'prueba', 'pending_review')
  returning id into v_i;
  insert into public.goods_receipt (account_id, location_id, supplier_id, receipt_date, status, raw_document_url, ai_session_id, created_by_name)
  values (v_acc, v_loc, v_s, '2026-12-11', 'confirmado', v_acc::text || '/prueba-r6/r5.jpg', v_i, 'Prueba D01 R6') returning id into v_r;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, raw_document_url, created_by_name)
  values (v_acc, v_s, c, 'RCP-26/80', '2026-12-11', 'en_revision', 'ocr', 40, v_acc::text || '/prueba-r6/r5.jpg', 'Prueba D01 R6') returning id into v_i;
  insert into public.supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id) values (v_i, v_r);
  insert into public.goods_receipt_path (account_id, goods_receipt_id, path, supplier_id, company_id, doc_type, reason, supplier_invoice_id)
  values (v_acc, v_r, 'factura', v_s, c, 'factura', 'Prueba D01 R6.', v_i);
  perform set_config('prueba.i5', v_i::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_s   uuid := current_setting('prueba.s')::uuid;
  r jsonb; f jsonb; v_n int;
begin
  -- 1 y 2 · Antes del corte.
  r := public.conta_documentos_recibidos(c, '2024-12-01', '2024-12-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r1');
  if f is null or f->>'tipo' <> 'recepcion' or f->>'estado' <> 'en_diez' or (f->'diez'->>'numero')::int <> 9001
     or not coalesce((f->'asiento'->>'diez')::boolean, false) or f->>'porque' not like '%ya está en Diez (asiento 2/9001%' or f->>'canal' <> 'cocina' then
    raise exception 'PRUEBA D01 R6 recepción · 1: la factura de antes del corte no sale enlazada con Diez: %', f;
  end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r2');
  if f is null or f->>'estado' <> 'en_diez' or f->'diez' <> 'null'::jsonb or f->>'porque' not like '%No la encuentro en Diez%' then
    raise exception 'PRUEBA D01 R6 recepción · 1: el albarán-factura de antes del corte que no casa: %', f;
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 1: antes del corte, «en Diez»: la que casa, con su asiento 2/9001; la que no, lo dice.';
  if exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r3')) then
    raise exception 'PRUEBA D01 R6 recepción · 2: el albarán suelto sale como factura.';
  end if;
  if (r->'cifras'->>'para_mirar')::int <> 0 or (r->'cifras'->>'por_aclarar')::int <> 0 then
    raise exception 'PRUEBA D01 R6 recepción · 1: lo de antes del corte cuenta como pendiente: %', r->'cifras';
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 2: el albarán suelto no sale; lo de Diez no cuenta como pendiente.';

  -- 3 y 4 · Desde el corte.
  r := public.conta_documentos_recibidos(c, '2026-12-01', '2026-12-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.r4');
  if f is null or f->>'tipo' <> 'recepcion' or f->>'estado' <> 'por_aclarar' or f->>'porque' not like '%no trae importes por línea%' then
    raise exception 'PRUEBA D01 R6 recepción · 3: la que la recepción no pudo hacer factura: %', f;
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 3: desde el corte, sin factura: por aclarar, «%».', f->>'porque';
  select count(*) into v_n from jsonb_array_elements(r->'filas') x where x->>'numero' = 'RCP-26/80';
  if v_n <> 1 or not exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.i5') and x->>'tipo' = 'factura' and x->>'canal' = 'cocina') then
    raise exception 'PRUEBA D01 R6 recepción · 4: la hecha factura desde su recepción sale % veces (tiene que ser 1, como factura, «de su recepción»).', v_n;
  end if;
  f := public.conta_factura_para_revisar(current_setting('prueba.i5')::uuid);
  if f->'leido_en_recepcion'->'modelo'->'document'->>'doc_number' <> 'RCP-26/80' or jsonb_array_length(f->'leido_en_recepcion'->'modelo'->'lines') <> 1 then
    raise exception 'PRUEBA D01 R6 recepción · 4: N23 no trae lo que leyó la recepción: %', f->'leido_en_recepcion';
  end if;
  raise notice 'PRUEBA D01 R6 recepción · 4: la hecha factura sale una vez, «de su recepción», y N23 trae lo que leyó la recepción.';

  -- 5 · Repetidas: la misma, llegando luego por correo o subida.
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_s, 'B00000081', 'RCP 26-80', '2026-12-14', 40) x where x.nivel = 'repetida';
  if v_n <> 1 then raise exception 'PRUEBA D01 R6 recepción · 5: la regla no reconoce como repetida la que ya entró por la recepción.'; end if;
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel)
    values (v_acc, v_s, c, 'RCP-26/80', '2026-12-14', 'en_revision', 'ocr', 40, 'Prueba D01 R6', 'correo');
    raise exception 'PRUEBA D01 R6 recepción · 5: el disparador ha dejado meter dos veces la misma factura.';
  exception when others then
    if sqlerrm like 'PRUEBA%' then raise; end if;
    -- Que la pare LA REGLA, no otra cosa (un permiso, una columna).
    if sqlerrm not like 'Repetida:%' then raise exception 'PRUEBA D01 R6 recepción · 5: no la ha parado la regla de repetidas, sino: %', sqlerrm; end if;
  end;
  raise notice 'PRUEBA D01 R6 recepción · 5: la misma que llega luego por correo es «repetida» y no entra dos veces.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_documentos_recibidos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2024-12-01', '2024-12-31');
    raise exception 'PRUEBA D01 R6 recepción · 6: B ha leído los documentos de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform public.conta_factura_para_revisar(current_setting('prueba.i5')::uuid);
    raise exception 'PRUEBA D01 R6 recepción · 6: B ha leído la factura de A.';
  exception when sqlstate 'P0002' then null; end;
  raise notice 'PRUEBA D01 R6 recepción · 6: B ni las ve.';
end $$;
reset role;


rollback;
