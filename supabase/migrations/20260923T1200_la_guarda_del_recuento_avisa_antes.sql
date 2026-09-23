-- ============================================================================
-- La guarda del recuento: avisar de lo que va a dejar huérfano
-- ----------------------------------------------------------------------------
-- 23/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Punto 5 del encargo «Que los términos de la resta sean medibles».
--
-- ✅ APLICADA el 23/09/2026 a las 11:28 (Madrid), fuera de la ventana
--    12:15-00:30. Registrada como `20260923092816`.
--    Es INERTE al aplicarla: una función nueva que no llama nadie todavía.
--    Solo LEE. No toca el motor de consumo, no escribe y no bloquea nada.
--
-- ── POR QUÉ ───────────────────────────────────────────────────────────────
-- `generate_sale_consumption` compara la hora de la venta contra el corte del
-- recuento aprobado. Si la venta es anterior, NO escribe su consumo y anota el
-- descarte en `sale_consumption_skip`. Para el stock es correcto —el recuento
-- ya vio lo que faltaba— pero ese consumo teórico no se escribe NUNCA, y es
-- justo el término que se quiere medir.
--
-- Esto no bloquea: avisa. A veces se aprueba igualmente y está bien. Lo que no
-- puede pasar es que se descarte en silencio (regla 8).
--
-- ── MEDIDO, atribuyendo cada nota al recuento cuyo corte coincide ─────────
-- Alcalá, 13-21/09 (el 12/09 se excluye: son 4.482 notas de un recompute
-- masivo, no del goteo normal):
--   INV-00226   11 ventas · 12 artículos · 245,00 EUR
--   INV-00227    7 ventas ·  5 artículos · 144,50 EUR
--   INV-00243    7 ventas · 20 artículos · 194,47 EUR
--   INV-00240    4 ventas ·  9 artículos ·  72,02 EUR
--   INV-00232    2 ventas ·  6 artículos ·  29,83 EUR
-- Pequeño y sistemático, como dice el encargo. No es una hemorragia.
--
-- ── UN HALLAZGO QUE EL ENCARGO NO ANTICIPA ───────────────────────────────
-- El corte NO es uno por recuento: es uno por ARTÍCULO, sellado en el minuto
-- en que se contó esa línea. El 13/09 los cortes son 22:44, 22:45, 22:46,
-- 22:50, 22:51, 22:54, 22:58, 23:01, 23:15, 23:44, 23:45… uno por línea.
-- Y hay ventas descartadas de más de un día antes del corte (una del 19/09
-- 22:10 descartada por un corte del 20/09 23:49), así que la ventana de 72 h
-- se queda justa pero cubre todo lo medido. Si algún día no cubriera, el
-- parámetro `p_horas` está ahí.
--
-- ── ENSAYO ────────────────────────────────────────────────────────────────
-- Con 72 h sobre los recuentos de hoy da 0, y es correcto: a las 11:28 no hay
-- ninguna venta sin consumo. Una prueba cuya población no puede fallar es un
-- espejo (regla 31), así que se abrió la ventana a 400 días con filas reales:
--   INV-00226  1.374 ventas · 28.778,35 EUR · 29 artículos
--   INV-00243  1.400 ventas · 29.284,01 EUR · 44 artículos
--   INV-00253  1.301 ventas · 27.516,79 EUR · 21 artículos
-- Los artículos distintos por recuento (29 / 44 / 21) enseñan que el filtro
-- por artículo discrimina y no está devolviendo «todo».
-- ============================================================================

create or replace function public.ventas_pendientes_al_aprobar(
  p_count_id uuid,
  p_horas    integer default 72
)
returns table (
  ventas              integer,
  euros               numeric,
  articulos_afectados integer,
  detalle             jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_acc uuid; v_loc uuid; v_items uuid[]; v_cand uuid[]; v_afect uuid[]; v_toca uuid[];
begin
  select ic.account_id, ic.location_id into v_acc, v_loc
    from public.inventory_count ic where ic.id = p_count_id;
  if v_acc is null then
    raise exception 'ventas_pendientes_al_aprobar: el recuento % no existe', p_count_id;
  end if;
  if not public.belongs_to_account(v_acc) then
    raise exception 'ventas_pendientes_al_aprobar: sin acceso a la cuenta %', v_acc;
  end if;

  -- Los articulos que este recuento va a cortar. Las apartadas no cortan.
  select coalesce(array_agg(distinct icl.recipe_item_id), '{}'::uuid[]) into v_items
    from public.inventory_count_line icl
   where icl.inventory_count_id = p_count_id and icl.account_id = v_acc
     and icl.excluded_at is null;

  if array_length(v_items, 1) is null then
    ventas := 0; euros := 0; articulos_afectados := 0; detalle := '[]'::jsonb;
    return next; return;
  end if;

  -- CANDIDATAS: ventas vivas del local sin consumo escrito todavia.
  -- Se saca a un ARRAY antes de preguntar al motor, por lo mismo que el vigia
  -- de ventas cerradas: como CTE, Postgres la incorpora y el lateral acaba
  -- colgando de `sale` entera (20.917 ms medidos el 12/09).
  select coalesce(array_agg(q.id), '{}'::uuid[]) into v_cand from (
    select s.id from public.sale s
      left join public._ventas_con_consumo() t on t.sale_id = s.id
     where s.account_id = v_acc and s.location_id = v_loc
       and s.created_at >= now() - make_interval(hours => greatest(coalesce(p_horas,72),1))
       and coalesce(s.status,'') <> 'cancelled'
       and coalesce(s.order_status,'') not in ('cancelled','rejected')
       and coalesce(s.is_active, true)
       and t.sale_id is null) q;

  if array_length(v_cand, 1) is null then
    ventas := 0; euros := 0; articulos_afectados := 0; detalle := '[]'::jsonb;
    return next; return;
  end if;

  -- LA VARA ES LA DEL MOTOR (regla 39), no una copia del escandallo: solo
  -- cuentan las ventas que de verdad tocarian un articulo de este recuento.
  select coalesce(array_agg(distinct sl.sale_id), '{}'::uuid[]),
         coalesce(array_agg(distinct r.raw_item_id), '{}'::uuid[])
    into v_afect, v_toca
  from public.sale_line sl
  cross join lateral public._sale_line_raw_consumption(sl.id) r
  where sl.sale_id = any(v_cand)
    and coalesce(sl.line_type,'product') = 'product'
    and sl.ignored_at is null
    and r.raw_item_id = any(v_items)
    and coalesce(r.qty_base,0) <> 0;

  select count(*)::integer, coalesce(round(sum(s.total),2),0) into ventas, euros
    from public.sale s where s.id = any(v_afect);
  articulos_afectados := coalesce(array_length(v_toca,1), 0);

  -- El detalle a un clic, como pide el encargo. Tope de 30: la pantalla no es
  -- un informe, y pasados 30 el numero ya ha dicho lo que hacia falta.
  select coalesce(jsonb_agg(d.x order by d.orden), '[]'::jsonb) into detalle from (
    select s.created_at as orden, jsonb_build_object(
             'pedido', coalesce(s.pos_short_code, s.platform_order_code, left(s.id::text,8)),
             'cuando', to_char(s.created_at at time zone 'Europe/Madrid','DD/MM HH24:MI'),
             'euros',  round(s.total,2)) as x
      from public.sale s where s.id = any(v_afect)
      order by s.created_at limit 30) d;

  return next;
end;
$function$;

revoke all on function public.ventas_pendientes_al_aprobar(uuid, integer) from public, anon;
grant execute on function public.ventas_pendientes_al_aprobar(uuid, integer) to authenticated, service_role;
