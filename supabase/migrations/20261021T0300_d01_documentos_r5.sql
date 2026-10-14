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
