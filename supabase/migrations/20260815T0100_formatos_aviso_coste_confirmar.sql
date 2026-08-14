-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0100
-- Formatos (Tramo D.1): aviso de coste fuera de rango antes de confirmar
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- goods_receipt_cost_warnings(cuenta, recepcion): para cada línea con coste,
-- compara €/unidad-base contra la MEDIANA histórica del propio artículo
-- (movimientos `recepcion` con unit_cost>0, mínimo 3 para opinar). Devuelve
-- solo las líneas que se desvían más de 1,8× en cualquier dirección
-- (constante con nombre: c_threshold). Excluye del histórico los
-- movimientos de la propia recepción que se está revisando (si se reabre
-- una ya confirmada, la mediana no puede incluirse a sí misma).
--
-- ack_goods_receipt_cost_warning: registra quién y cuándo aceptó seguir
-- pese al aviso (columnas nuevas goods_receipt.cost_warning_ack_by/_at).
--
-- BUG REAL ENCONTRADO Y CORREGIDO AL VALIDAR CONTRA EL CASO DEL ENCARGO
-- --------------------------------------------------------------------------
-- goods_receipt_line.unit_cost NO es €/unidad base -- es €/unidad RECIBIDA
-- (€ por caja, no por gramo): verificado en vivo, Pulled Pork ALB-00116,
-- unit_cost=72,27, qty_received=2, doc_amount=144,54 (72,27×2), qty_in_base
-- =12000 -- 72,27/6000=0,012045 €/g, el valor SANO. La primera versión de
-- esta función comparaba 72,27 directamente contra medianas en €/g y
-- marcaba TODO como outlier (ratios de miles). Fórmula correcta:
--   €/base = unit_cost × qty_received / qty_in_base
-- (el total de la línea entre las unidades base que trajo).
--
-- VALIDADO EN VIVO tras el fix, sobre ALB-00116 (el propio caso del
-- encargo): Gouda y Pulled Pork, ya corregidos el 14/08, dejan de marcarse
-- -- su €/base coincide con la mediana. Tomate Pera sí sale marcado (ratio
-- 6,0×, 2,45 €/kg vs mediana 0,41 €/kg) -- señal real, no ruido, queda para
-- que la oficina lo revise. La mediana calculada para Pulled Pork
-- (0,012045 €/g = 12,045 €/kg) reproduce el rango exacto que cita el
-- encargo (11,12-12,05 €/kg) -- el 16º movimiento sintético del encargo a
-- 24,09 €/kg (2,0× la mediana) habría saltado; no se puede reproducir tal
-- cual porque esa línea concreta ya fue corregida el 14/08 y queda excluida
-- de compararse consigo misma.
-- ----------------------------------------------------------------------------

alter table goods_receipt
  add column if not exists cost_warning_ack_by uuid,
  add column if not exists cost_warning_ack_at timestamptz;

create or replace function public.goods_receipt_cost_warnings(p_account_id uuid, p_receipt_id uuid)
returns table (
  line_id uuid,
  recipe_item_id uuid,
  product_name text,
  unit_cost_per_base numeric,
  median_cost_per_base numeric,
  ratio numeric
)
security definer
set search_path to 'public'
language plpgsql
as $$
declare
  c_threshold constant numeric := 1.8;
  c_min_recepciones constant int := 3;
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'No autorizado para esta cuenta.';
  end if;

  return query
  with linea as (
    select grl.id as line_id, grl.recipe_item_id, ri.name as product_name,
           (grl.unit_cost::numeric * grl.qty_received::numeric / grl.qty_in_base::numeric) as unit_cost_per_base
    from goods_receipt_line grl
    join goods_receipt gr on gr.id = grl.goods_receipt_id
    join recipe_item ri on ri.id = grl.recipe_item_id
    where gr.id = p_receipt_id and gr.account_id = p_account_id
      and grl.unit_cost is not null and grl.unit_cost > 0
      and grl.qty_in_base is not null and grl.qty_in_base > 0
  ),
  historico as (
    select sm.recipe_item_id,
           percentile_cont(0.5) within group (order by sm.unit_cost::numeric) as mediana,
           count(*) as n
    from stock_movement sm
    where sm.account_id = p_account_id and sm.source_type = 'goods_receipt_line'
      and sm.movement_type = 'recepcion' and sm.unit_cost > 0
      and sm.source_id not in (select l.line_id from linea l)
    group by sm.recipe_item_id
  )
  select l.line_id, l.recipe_item_id, l.product_name, round(l.unit_cost_per_base, 6),
         round(h.mediana::numeric, 6), round((l.unit_cost_per_base / h.mediana)::numeric, 3)
  from linea l
  join historico h on h.recipe_item_id = l.recipe_item_id
  where h.n >= c_min_recepciones
    and (l.unit_cost_per_base > h.mediana * c_threshold or l.unit_cost_per_base < h.mediana / c_threshold);
end;
$$;

create or replace function public.ack_goods_receipt_cost_warning(p_account_id uuid, p_receipt_id uuid)
returns void
security definer
set search_path to 'public'
language plpgsql
as $$
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'No autorizado para esta cuenta.';
  end if;
  update goods_receipt
    set cost_warning_ack_by = auth.uid(), cost_warning_ack_at = now()
    where id = p_receipt_id and account_id = p_account_id;
end;
$$;

do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc where proname = 'goods_receipt_cost_warnings';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 funcion goods_receipt_cost_warnings, hay %', v_count; end if;
  select count(*) into v_count from pg_proc where proname = 'ack_goods_receipt_cost_warning';
  if v_count <> 1 then raise exception 'guard: se esperaba 1 funcion ack_goods_receipt_cost_warning, hay %', v_count; end if;
end $$;
