-- 20260825T2100_vista_goods_receipt_posting_status.sql
-- APLICADA en producción el 25-08-2026.
--
-- POR QUÉ EXISTE ESTA VISTA
-- Los movimientos de recepción se guardan POR LÍNEA:
--     source_type = 'goods_receipt_line'
--     source_id   = id de la LÍNEA          ← nunca el id del albarán
-- Contar con `sm.source_id = goods_receipt.id` devuelve cero SIEMPRE, y ese
-- cero se parece muchísimo a "no entró nada al almacén". Hoy nos costó una
-- discusión sobre ALB-00124/125: la query decía 0 movimientos y en realidad
-- tenían las 21 y las 9 líneas dentro.
-- Esta vista deja el join correcto escrito en un solo sitio.

-- security_invoker: la vista se lee con los permisos de QUIEN consulta, así que
-- respeta las RLS de goods_receipt / stock_movement. Sin esto, una vista sobre
-- tablas con RLS se las saltaría.
create or replace view public.goods_receipt_posting_status
with (security_invoker = on) as
select
  gr.id                as goods_receipt_id,
  gr.account_id,
  gr.location_id,
  gr.code,
  gr.status,
  gr.needs_review,
  gr.receipt_date,
  gr.received_at,
  gr.via_assistant,
  count(l.id) filter (where not coalesce(l.not_goods, false))                       as lines_total,
  count(l.id) filter (where not coalesce(l.not_goods, false) and sm.id is not null) as lines_posted,
  count(l.id) filter (where not coalesce(l.not_goods, false) and sm.id is null)     as lines_pending,
  count(l.id) filter (where coalesce(l.not_goods, false))                           as lines_not_goods,
  -- por qué sigue pendiente: sin artículo asignado, o con artículo pero sin
  -- cantidad base calculable (formato de compra sin resolver)
  count(l.id) filter (where not coalesce(l.not_goods, false) and sm.id is null
                        and l.recipe_item_id is null)                               as pending_sin_articulo,
  count(l.id) filter (where not coalesce(l.not_goods, false) and sm.id is null
                        and l.recipe_item_id is not null)                           as pending_sin_cantidad
from public.goods_receipt gr
left join public.goods_receipt_line l
  on l.goods_receipt_id = gr.id
left join lateral (
  select sm.id
    from public.stock_movement sm
   where sm.source_type   = 'goods_receipt_line'
     and sm.source_id     = l.id
     and sm.movement_type = 'recepcion'
   limit 1
) sm on true
group by gr.id, gr.account_id, gr.location_id, gr.code, gr.status,
         gr.needs_review, gr.receipt_date, gr.received_at, gr.via_assistant;

comment on view public.goods_receipt_posting_status is
  'Lineas / posteadas / pendientes por albaran, con el join correcto (movimiento por LINEA). Fuente unica para "¿entro este albaran al almacen?".';

grant select on public.goods_receipt_posting_status to authenticated;

-- ── El vigía de oficina pasa a usarla ────────────────────────────────────
-- 'albaran_genero_sin_casar' se detectaba solo por needs_review, que es un
-- proxy: si el flag se queda mal, el género sin entrar no lo ve nadie. Ahora
-- además mira si quedan líneas sin postear DE VERDAD. Es un superconjunto: no
-- pierde ningún caso de los que ya detectaba.
--
-- Matiz del destino del botón: la pantalla filtra 'confirmado_revision' por
-- needs_review. Un albarán confirmado con líneas pendientes y needs_review en
-- false aparecería en el vigía pero no en ese filtro. Hoy no existe ninguno
-- (las funciones de posteo mantienen el flag), y el vigía es el sitio correcto
-- para que se vea si algún día aparece.
CREATE OR REPLACE FUNCTION public.pending_raw_entities(p_account_id uuid)
 RETURNS TABLE(pending_kind text, entity_id uuid, location_id uuid, entity_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  select 'recepcion_esperando_oficina', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'recibido'

  union all
  select 'albaran_genero_sin_casar', v.goods_receipt_id, v.location_id, v.received_at
  from public.goods_receipt_posting_status v
  where v.account_id = p_account_id
    and v.status = 'confirmado'
    and (coalesce(v.needs_review, false) or v.lines_pending > 0)

  union all
  select 'pedido_vencido', po.id, po.location_id, po.expected_date::timestamptz
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'enviado' and po.expected_date < current_date

  union all
  select 'albaran_borrador_atascado', gr.id, gr.location_id, gr.created_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'borrador' and gr.created_at < now() - interval '2 days'

  union all
  select 'pedido_borrador_atascado', po.id, po.location_id, po.created_at
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'borrador' and po.created_at < now() - interval '7 days'

  union all
  select 'recuento_abierto', ic.id, ic.location_id, ic.created_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is null and ic.status <> 'anulado'

  union all
  select 'recuento_sin_aprobar', ic.id, ic.location_id, ic.closed_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is not null and ic.approved_at is null and ic.status <> 'anulado'

  union all
  select 'linea_sin_coste', sm.id, sm.location_id, sm.created_at
  from stock_movement sm
  where sm.account_id = p_account_id and sm.source_type = 'goods_receipt_line' and sm.unit_cost is null

  union all
  select 'albaran_sin_pedido', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id
    and gr.purchase_order_id is null
    and gr.status in ('recibido', 'confirmado')
    and exists (select 1 from public._goods_receipt_order_candidates(gr.id));
end;
$function$;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (select 1 from information_schema.views
                 where table_schema='public' and table_name='goods_receipt_posting_status') then
    raise exception 'Falta la vista goods_receipt_posting_status';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='pending_raw_entities'
                   and pg_get_functiondef(p.oid) like '%goods_receipt_posting_status%') then
    raise exception 'El vigía no usa la vista';
  end if;
end $$;

-- VERIFICADO tras aplicar:
--   ALB-00124  recibido   21 líneas · 21 posteadas · 0 pendientes
--   ALB-00125  recibido    9 líneas ·  9 posteadas · 0 pendientes
--   ALB-00106  anulado     9 líneas ·  0 posteadas · 9 pendientes (9 sin artículo)
--   ALB-00091  anulado    26 líneas ·  0 posteadas · 26 pendientes (26 sin artículo)
--   ALB-00092  anulado     7 líneas ·  0 posteadas · 7 pendientes (7 sin artículo)
--
--   security_invoker = on.
--   Vigía: 0 albaranes confirmados con género sin entrar (nada oculto hoy).
--   Con líneas pendientes en toda la base: 10 → 8 anulados (los conocidos) y
--   2 borradores sin recibir todavía. Nada vivo escondiendo mercancía.
