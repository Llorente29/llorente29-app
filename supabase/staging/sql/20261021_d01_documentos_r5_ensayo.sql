-- supabase/staging/sql/20261021_d01_documentos_r5_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0300 (D01 R5, N22): el fichero entero y su
-- prueba en UNA transacción que acaba en ROLLBACK.

begin;
-- ============================================================================
-- D01 · R5 (14/10) · N22 dice el porqué de cada fila, por dónde llegó de verdad
-- y las cifras del periodo elegido.
--
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261021_d01_documentos_r5_prueba.sql
--
-- La misma firma: se reemplaza en caliente (en producción aún no existe: va en
-- la misma tanda que la 0280, detrás). Lo que cambia, de lo que vio Julio en
-- las capturas:
--   6. Una fila sin cuenta de gasto decía solo «Sin cuenta de gasto todavía».
--      Ahora trae lo que hace falta para decir por qué y qué hacer: cuántas
--      facturas suyas había antes (previas) y lo aprendido de ellas (0250).
--      Si hay algo aprendido, es lo entendido, como en N23, marcado
--      «sin confirmar».
--   7. Por dónde llegó: sin canal apuntado ya no se inventa «subida». Leída
--      del papel de su recepción → 'cocina'; leída en Compras → 'compras';
--      escrita a mano → 'a_mano'. Y de una subida, si fue una foto o un PDF.
--   8. «Llegadas» contaba los últimos 7 días aunque se eligiera un mes: ahora
--      cuenta las del periodo pedido, como la lista.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0300_d01_documentos_r5.down.sql
-- (vuelve a la de la 0280).
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
    from (select fila from filas_f union all select fila from filas_l) x;

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
  'D01 · N22: las facturas recibidas de una empresa en un periodo (las cifras, del periodo), con sus cinco cifras, el porqué de cada fila y lo que Folvy ha entendido; si el correo está encendido y si recibe la mercancía con Folvy. Solo para los de la cuenta.';
revoke all on function public.conta_documentos_recibidos(uuid, date, date) from public, anon;
grant execute on function public.conta_documentos_recibidos(uuid, date, date) to authenticated;

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 R5 documentos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo que la pantalla no escribe (la llegada la mete el servidor; las fechas de
-- creación antiguas no las pone nadie a mano): como dueño.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_q uuid; v_i uuid; v_d uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Primera Prueba R5', 'Primera Prueba R5, S.L.', 'B00000071', true, 'Prueba D01 R5') returning id into v_p;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Aprendido Prueba R5', 'Aprendido Prueba R5, S.L.', 'B00000072', true, 'Prueba D01 R5') returning id into v_q;
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.q', v_q::text, true);

  -- 2 · La primera de su proveedor, escrita a mano en Compras, creada hace un mes.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, created_at)
  values (v_acc, v_p, v_e, 'PR5-1', '2026-12-02', 'en_revision', 'manual', 100, 'Prueba D01 R5', now() - interval '30 days');
  -- 4 · Leída en Compras sin canal apuntado (OCR de Supply, sin recepción).
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values (v_acc, v_p, v_e, 'PR5-2', '2026-12-03', 'en_revision', 'ocr', 50, 'Prueba D01 R5');
  -- 4 · Subida como foto: la llegada con su fichero, y su factura.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel)
  values (v_acc, v_q, v_e, 'PR5-4', '2026-12-05', 'en_revision', 'ocr', 30, 'Prueba D01 R5', 'subida') returning id into v_i;
  insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, mime_type, size_bytes, supplier_invoice_id)
  values (v_acc, v_e, 'subida', 'factura', v_acc::text || '/prueba-r5/foto.jpg', 'foto.jpg', 'image/jpeg', 1000, v_i) returning id into v_d;
  update public.supplier_invoice set inbox_id = v_d where id = v_i;
  perform set_config('prueba.i4', v_i::text, true);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_q   uuid := current_setting('prueba.q')::uuid;
  v_sub text; v_i uuid; r jsonb; f jsonb;
begin
  -- 3 · Una factura anterior de «Aprendido», validada a 62100000 (noviembre: fuera del periodo).
  v_sub := public.company_account_add(v_e, '4000', 'Aprendido Prueba R5', null, 'supplier', v_q::text, 'Prueba D01 R5')->>'code';
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_q, v_e, 'PR5-0', '2026-11-20', 'aprobada', 'manual', 110, 100, 10, 'Prueba D01 R5') returning id into v_i;
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-11-20', 'concepto', 'Factura Aprendido Prueba R5 · PR5-0', 'source_type', 'supplier_invoice', 'source_id', v_i,
                       'confianza', 'seguro', 'porque', 'Prueba D01 R5', 'documento', 'PR5-0'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62100000', 'debe', 100, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0'),
      jsonb_build_object('cuenta', '47200010', 'debe', 10, 'haber', 0, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0',
                         'iva', jsonb_build_object('tipo_id', '5bbab66f-a022-44a6-b146-ac577a2988d3', 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', v_sub, 'debe', 0, 'haber', 110, 'local_id', v_loc, 'comun', false, 'documento', 'PR5-0')),
    null, 'Prueba D01 R5');
  perform public.journal_entry_validar((r->>'id')::uuid, 'Prueba D01 R5');
  -- Y una de diciembre, sin nada en la ficha.
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, arrival_channel, reading_confidence, reading)
  values (v_acc, v_q, v_e, 'PR5-3', '2026-12-04', 'en_revision', 'ocr', 121, 'Prueba D01 R5', 'correo', 'seguro', '{"porque":["Todo cuadra y trae lo que pide la norma."]}');

  r := public.conta_documentos_recibidos(v_e, '2026-12-01', '2026-12-31');
  -- 1
  if jsonb_array_length(r->'filas') <> 4 then raise exception 'PRUEBA D01 R5 documentos · 1: % filas, no 4 (diciembre tenía algo ya): %', jsonb_array_length(r->'filas'), r->'filas'; end if;
  if (r->'cifras'->>'llegadas')::int <> 4 then
    raise exception 'PRUEBA D01 R5 documentos · 1: «llegadas» dice %, no 4: la del mes pasado se ha quedado fuera (seguía contando los últimos 7 días).', r->'cifras'->>'llegadas';
  end if;
  if (r->'cifras'->'llegadas_por_canal'->>'a_mano')::int <> 1 or (r->'cifras'->'llegadas_por_canal'->>'compras')::int <> 1
     or (r->'cifras'->'llegadas_por_canal'->>'correo')::int <> 1 or (r->'cifras'->'llegadas_por_canal'->>'subida')::int <> 1 then
    raise exception 'PRUEBA D01 R5 documentos · 1: por dónde: %', r->'cifras'->'llegadas_por_canal';
  end if;
  raise notice 'PRUEBA D01 R5 documentos · 1: llegadas 4, las del periodo (también la creada hace 30 días): %.', r->'cifras'->'llegadas_por_canal';
  -- 2
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1';
  if (f->>'previas')::int <> 0 or f->'entendido' <> 'null'::jsonb or (f->'aprendido'->>'facturas')::int <> 0 or f->'aprendido'->>'porque' is null then
    raise exception 'PRUEBA D01 R5 documentos · 2: la primera de su proveedor: %', f;
  end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-2';
  if (f->>'previas')::int <> 1 then raise exception 'PRUEBA D01 R5 documentos · 2: la segunda del mismo proveedor no cuenta la primera: %', f; end if;
  raise notice 'PRUEBA D01 R5 documentos · 2: la primera de su proveedor: previas 0 y «%»; la segunda, previas 1.', (select x->'aprendido'->>'porque' from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1');
  -- 3
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-3';
  if (f->>'previas')::int <> 1 or f->'entendido'->>'cuenta' <> '62100000' or not coalesce((f->'entendido'->>'sin_confirmar')::boolean, false)
     or f->'entendido'->>'origen' <> 'aprendido de tus facturas' or (f->'aprendido'->>'facturas')::int <> 1 then
    raise exception 'PRUEBA D01 R5 documentos · 3: lo aprendido: %', f;
  end if;
  raise notice 'PRUEBA D01 R5 documentos · 3: sin ficha, lo entendido es lo aprendido: % · % (%, sin confirmar).', f->'entendido'->>'nombre', f->'entendido'->>'cuenta', f->'entendido'->>'origen';
  -- 4
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-1';
  if f->>'canal' <> 'a_mano' then raise exception 'PRUEBA D01 R5 documentos · 4: la escrita a mano: %', f->>'canal'; end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-2';
  if f->>'canal' <> 'compras' then raise exception 'PRUEBA D01 R5 documentos · 4: la leída en Compras sale como %', f->>'canal'; end if;
  select x into f from jsonb_array_elements(r->'filas') x where x->>'numero' = 'PR5-4';
  if f->>'canal' <> 'subida' or f->>'llegada_tipo' <> 'image/jpeg' then raise exception 'PRUEBA D01 R5 documentos · 4: la foto subida: % %', f->>'canal', f->>'llegada_tipo'; end if;
  raise notice 'PRUEBA D01 R5 documentos · 4: a mano, leída en Compras y foto subida, cada una por su nombre.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_documentos_recibidos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-12-01', '2026-12-31');
    raise exception 'PRUEBA D01 R5 documentos · 5: B ha leído los documentos de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 R5 documentos · 5: B ni los ve.';
end $$;
reset role;


rollback;
