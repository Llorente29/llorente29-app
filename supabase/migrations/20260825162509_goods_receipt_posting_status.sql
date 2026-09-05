-- Vista canonica de "que ha entrado de verdad" por albaran.
-- Los movimientos de recepcion se guardan POR LINEA
-- (source_type='goods_receipt_line', source_id = id de la LINEA), nunca con el
-- id del albaran. Contar con `source_id = goods_receipt.id` da cero SIEMPRE, y
-- ese cero se parece mucho a "no entro nada". Esta vista pone el join correcto
-- en un solo sitio.
--
-- security_invoker: la vista se lee con los permisos de QUIEN consulta, asi que
-- respeta las RLS de goods_receipt / stock_movement. Sin esto una vista sobre
-- tablas con RLS las saltaria.
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
  -- por que sigue pendiente: sin articulo asignado, o con articulo pero sin
  -- cantidad base calculable (formato sin resolver)
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

-- ── El vigia de oficina pasa a usarla ────────────────────────────────────
-- 'albaran_genero_sin_casar' se detectaba solo por needs_review, que es un
-- proxy: si el flag se queda mal, el genero sin entrar no lo ve nadie. Ahora
-- tambien mira si quedan lineas sin postear de verdad. Es un superconjunto:
-- nunca pierde un caso de los que ya detectaba.
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
    raise exception 'El vigia no usa la vista';
  end if;
end $$;