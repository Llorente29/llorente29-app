-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0330
-- Ficha por producto (Tramo B): backfill posicional de supplier_code
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- Rellena supplier_code (y doc_qty/doc_amount cuando faltan) en líneas de
-- recepción históricas que no lo tenían, usando la sesión de OCR de su
-- propia recepción. NO toca qty_received, qty_in_base, unit_cost ni
-- purchase_format_id -- es documental puro.
--
-- LA TRAMPA MEDIDA ANTES DE ESCRIBIR UNA SOLA LÍNEA: de las 451 líneas sin
-- código con sesión, solo 5 tienen raw_text -- el join por texto que usó
-- Formatos (#79) NO sirve aquí. El camino es POSICIONAL: 62 de los 70
-- albaranes afectados tienen exactamente el mismo número de líneas que su
-- sesión de OCR -> 423 candidatas por posición 1:1 (número exacto,
-- verificado contra datos reales antes de tocar nada).
--
-- LA GUARDA -- Y UN AJUSTE SOBRE LO QUE PEDÍA EL ENCARGO: "cuadrar
-- doc_amount con line_amount" no se puede aplicar tal cual porque
-- doc_amount/doc_qty están NULL precisamente en las líneas que hay que
-- rellenar (es lo que este mismo backfill escribe). La guarda real compara
-- contra lo que YA hay de fiar en la línea: qty_received × unit_cost frente
-- a line_amount de la sesión (o qty_received frente a quantity si no hay
-- coste). Con esto: 405 de las 423 candidatas pasan la guarda (los 18
-- restantes no cuadran -- posición igual, contenido distinto, no se
-- adivina).
--
-- Los 8 albaranes con recuento de líneas distinto entre recepción y
-- sesión (sin backfill, se quedan como estaban):
--   ALB-00057 (6 sesión / 4 recepción) · ALB-00073 (14/12) · ALB-00080 (3/2)
--   ALB-00082 (3/2) · ALB-00085 (2/1) · ALB-00094 (3/2) · ALB-00101 (4/3)
--   ALB-00102 (3/2)
--
-- RESULTADO MEDIDO (antes -> después, mismos checksums salvo el código):
--   supplier_code presente:  248 -> 653 de 712  (35% -> 91,7%, objetivo >=90%)
--   suma(qty_received):      2985.208  -> 2985.208   (idéntica)
--   suma(unit_cost):         20619.327...  -> 20619.327...  (idéntica)
--   suma(qty_in_base):       4589769.94 -> 4589769.94  (idéntica)
--   stock_movement (source_type='goods_receipt_line', Llorente29): 658 -> 658
-- ----------------------------------------------------------------------------

do $$
declare
  v_account_id uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  create temp table _backfill_20260815 on commit drop as
  with sesion_count as (
    select gr.id as receipt_id, count(*) as n_sesion
    from goods_receipt gr
    join goods_receipt_ai_session s on s.id = gr.ai_session_id
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') as ln
    where gr.account_id = v_account_id
    group by gr.id
  ),
  receipt_count as (
    select grl.goods_receipt_id as receipt_id, count(*) as n_receipt
    from goods_receipt_line grl
    join goods_receipt gr on gr.id = grl.goods_receipt_id
    where gr.account_id = v_account_id
    group by grl.goods_receipt_id
  ),
  albaranes_ok as (
    select sc.receipt_id
    from sesion_count sc join receipt_count rc on rc.receipt_id = sc.receipt_id
    where sc.n_sesion = rc.n_receipt
  ),
  sesion_lineas as (
    select gr.id as receipt_id, (ln.ord - 1) as idx,
           nullif(ln.value->>'supplier_code','') as codigo,
           (ln.value->>'line_amount')::numeric as line_amount,
           (ln.value->>'quantity')::numeric as quantity
    from goods_receipt gr
    join goods_receipt_ai_session s on s.id = gr.ai_session_id
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') with ordinality as ln(value, ord)
    where gr.id in (select receipt_id from albaranes_ok)
  ),
  receipt_lineas as (
    select grl.id as line_id, grl.goods_receipt_id as receipt_id, grl.position,
           grl.qty_received, grl.unit_cost, grl.doc_qty, grl.doc_amount
    from goods_receipt_line grl
    where grl.goods_receipt_id in (select receipt_id from albaranes_ok)
      and (grl.supplier_code is null or grl.supplier_code = '')
  )
  select r.line_id, s.codigo,
         case when r.doc_amount is null then s.line_amount else null end as nuevo_doc_amount,
         case when r.doc_qty is null then s.quantity else null end as nuevo_doc_qty
  from receipt_lineas r
  join sesion_lineas s on s.receipt_id = r.receipt_id and s.idx = r.position
  where s.codigo is not null
    and (
      (r.unit_cost is not null and s.line_amount is not null and abs(r.qty_received * r.unit_cost - s.line_amount) < 0.02)
      or (r.qty_received is not null and s.quantity is not null and abs(r.qty_received - s.quantity) < 0.01)
    );

  update goods_receipt_line grl set
    supplier_code = b.codigo,
    doc_amount = coalesce(grl.doc_amount, b.nuevo_doc_amount),
    doc_qty = coalesce(grl.doc_qty, b.nuevo_doc_qty)
  from _backfill_20260815 b
  where grl.id = b.line_id;
end $$;
