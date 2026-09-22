-- ============================================================================
-- El envase descuenta
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Decidido por Julio: «el envase descuenta, arreglalo».
-- PROPUESTA. NO APLICADA.
--
-- 🔴 NO SE PASA EN BANDA. Esto es EL motor de consumo. Se pasa con el servicio
--    parado, y NO se hace commit sin los cuatro caminos del §C3 en verde.
--
-- ── QUE ESTA ROTO, Y NO ES LO QUE PARECIA ─────────────────────────────────
-- El encargo sospechaba que «el consumo filtra por type = raw». No hay filtro.
-- `explode_recipe_to_raws` para en 'raw' / 'tool' / receta stockable. Un
-- 'packaging' no es ninguna de las tres, asi que cae en la rama compuesta,
-- busca sus `recipe_line` hijas, no tiene ninguna, y devuelve CERO filas.
-- El envase no esta excluido: es INVISIBLE, por construccion.
--
-- (Y por eso `is_stockable` no explicaba nada: la «Caja Milanesa Haus» lo tiene
--  a true y no se movia; las «Patatas Baston» a false y si. Decide el TYPE.)
--
-- ── EL TITULAR, Y NO ES EL DEL ENCARGO ────────────────────────────────────
-- El coste YA cobra el envase. `_kitchen_recompute_item_unguarded` suma TODAS
-- las lineas del escandallo a `computed_cost` —envase incluido— y guarda en
-- `packaging_cost` solo la rebanada, para informar. Medido el 22/09:
--
--   DSH-00010 Kebab de Pollo   computed 2,3636 = explosion 2,0882 + envase 0,2754
--   DSH-00015 Rollitos Feta    computed 1,6941 = explosion 1,4700 + envase 0,2241
--   DSH-00389 Patatas Harisa   computed 2,7122 = explosion 2,4654 + envase 0,2469
--
-- O sea: la cuenta de resultados esta BIEN y lo unico roto es el STOCK. Esto
-- no es un arreglo de coste, es un arreglo de inventario — y por eso NO hay
-- riesgo de duplicar coste: `computed_cost` no sale de esta funcion.
--
-- ── EL TERRENO, medido antes de tocar (escenario p8 del 10/09) ────────────
--   60 envases activos · 0 sin unidad base · 1 sin coste
--   31 aparecen en escandallos · 0 lineas de escandallo sin unidad
--   62 ya tienen fila en recipe_item_location_stock
--   recipe_item_location_stock NOT NULL: id, account_id, recipe_item_id,
--     location_id, qty_on_hand, updated_at  ->  `stock_value` NO es NOT NULL,
--     asi que el fallo exacto de la p8 (stock_value NOT NULL con avg NULL que
--     abortaba la transaccion entera) NO aplica aqui.
--
--   Queda UN envase sin coste. Se localiza en la guarda 2: sus movimientos
--   saldrian con unit_cost nulo. No aborta, pero mancha el dato.
--
-- ── LO QUE SE ESPERA QUE PASE ─────────────────────────────────────────────
--   · Cada venta empieza a mover tambien su envase.
--   · Los recuentos de cajas y bolsas empiezan a cuadrar (1.337,67 EUR de
--     envase consumido y nunca descontado en 30 dias; ~16.000 EUR al ano).
--   · La casilla 5 del cierre (1.710 lineas, 24.486,51 EUR en 10 dias) se vacia
--     hacia la casilla 6.
--   · NO se reprocesa nada (regla del 18/09): lo de antes se queda como esta,
--     y el stock de envase arranca descuadrado hasta el siguiente recuento.
--     Eso hay que decirselo a quien cuente.
-- ============================================================================

begin;

-- ── Guarda 1: el servicio esta parado ─────────────────────────────────────
do $$
declare v_p integer; v_hm text;
begin
  v_hm := to_char(now() at time zone 'Europe/Madrid','HH24:MI');
  select count(*) into v_p from public.sale
   where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and sold_at >= now() - interval '30 minutes';
  if v_p > 0 then
    raise exception 'ABORTA: % (Madrid) y % pedidos en los ultimos 30 min. Esto es el motor de consumo: con el servicio en marcha, no.', v_hm, v_p;
  end if;
end $$;

-- ── Guarda 2: la funcion es la que creo, y el terreno el que medi ─────────
do $$
declare v_sin_unidad integer; v_sin_coste integer;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='explode_recipe_to_raws'
       and pg_get_functiondef(p.oid) like '%v_item.type IN (''raw'', ''tool'')%')
  then raise exception 'ABORTA: explode_recipe_to_raws no tiene la forma que se midio el 22/09.'; end if;

  select count(*) into v_sin_unidad from public.recipe_item
   where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and type='packaging' and is_active and base_unit_id is null;
  if v_sin_unidad > 0 then
    raise exception 'ABORTA: % envase(s) sin unidad base. Sus movimientos no se podrian calcular.', v_sin_unidad;
  end if;

  select count(*) into v_sin_coste from public.recipe_item
   where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and type='packaging' and is_active
     and computed_cost is null and fixed_cost is null
     and exists (select 1 from public.recipe_line rl where rl.child_item_id = recipe_item.id
                   and rl.account_id = recipe_item.account_id);
  if v_sin_coste > 0 then
    raise exception 'ABORTA: % envase(s) EN ESCANDALLO y sin coste. Sus movimientos saldrian con unit_cost nulo. Ponerles coste primero.', v_sin_coste;
  end if;
end $$;

-- ── EL CAMBIO: una condicion, una palabra ─────────────────────────────────
-- Misma firma, mismo tipo de vuelta: CREATE OR REPLACE es correcto. NO se
-- anade ningun parametro — eso seria DROP + CREATE (regla 2).
create or replace function public.explode_recipe_to_raws(p_item_id uuid, p_multiplier numeric)
 returns table(raw_item_id uuid, qty_base numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
DECLARE
  v_item  recipe_item%ROWTYPE;
  v_line  recipe_line%ROWTYPE;
  v_qb    numeric;
  v_yield numeric := NULL;
BEGIN
  IF p_item_id IS NULL OR p_multiplier IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Condicion de parada: hoja del arbol de consumo.
  --
  -- 22/09/2026: entra 'packaging'. NO estaba excluido por un filtro: un
  -- packaging no es raw ni tool ni receta stockable, asi que caia a la rama
  -- compuesta, no tenia lineas hijas y devolvia cero filas. Era invisible por
  -- construccion, y por eso 55 articulos de envase llevaban 30 dias con CERO
  -- movimientos de venta mientras los raw acumulaban 35.921.
  -- El coste ya lo cobraba (`computed_cost` suma todas las lineas); lo que no
  -- se movia era el STOCK. Decidido por Julio el 22/09.
  IF v_item.type IN ('raw', 'tool', 'packaging')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Rendimiento del batch. Solo preparaciones o quien lo declare.
  IF v_item.type = 'recipe' OR v_item.batch_yield IS NOT NULL THEN
    v_yield := public._batch_yield_in_base(p_item_id);
  END IF;
  IF v_yield IS NULL OR v_yield <= 0 THEN
    v_yield := 1;
  END IF;

  -- Nodo compuesto (recipe no-stockable o dish): recurrir por cada linea.
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      CONTINUE;
    END IF;
    RETURN QUERY
      SELECT * FROM public.explode_recipe_to_raws(
                      v_line.child_item_id,
                      (p_multiplier / v_yield) * v_qb);
  END LOOP;
  RETURN;
END;
$function$;

-- ── C1 · Un plato conocido pasa a ver su envase ───────────────────────────
select ri.folvy_code, ri.name, ri.type, round(e.qty_base::numeric,3) as cantidad
  from public.explode_recipe_to_raws(
         (select id from public.recipe_item
           where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and folvy_code='DSH-00010'), 1) e
  join public.recipe_item ri on ri.id=e.raw_item_id and ri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
 order by ri.type, ri.folvy_code;
-- ANTES: 9 filas, todas 'raw'.
-- DESPUES: esas 9 + las 4 de envase del Kebab de Pollo (RAW-00043 pergamino,
--          RAW-00258 aluminio, RAW-00163 servilletas, RAW-00144 bolsa 0,5).

-- ── C2 · El coste del plato por la explosion pasa a ser el `computed_cost` ─
select ri.folvy_code,
       round(ri.computed_cost::numeric,4) as computed_guardado,
       round((select coalesce(sum(e.qty_base*coalesce(r2.computed_cost,r2.fixed_cost,0)),0)
                from public.explode_recipe_to_raws(ri.id,1) e
                join public.recipe_item r2 on r2.id=e.raw_item_id and r2.account_id=ri.account_id)::numeric,4) as por_la_explosion
  from public.recipe_item ri
 where ri.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and ri.folvy_code in ('DSH-00010','DSH-00015','DSH-00389');
-- ANTES: 2,3636 vs 2,0882 · 1,6941 vs 1,4700 · 2,7122 vs 2,4654
-- DESPUES: los dos numeros IGUALES en las tres. Si no cuadran, el envase se
-- esta contando dos veces o a medias en algun sitio y NO se hace commit.

-- ── C3 · 🔴 ENSAYO POR LOS CUATRO CAMINOS (regla 10) ──────────────────────
-- Esto mueve stock. NO basta con que los numeros salgan: hay que ver quien
-- ESCRIBE, y que no aborte. Los cuatro, aqui dentro, antes del commit:
--
--   1. CERRAR UNA VENTA   public.close_sale(:sale_id)
--      Una venta abierta de un plato CON envase. Mirar que no aborte y que
--      aparezcan movimientos de los articulos 'packaging'. ESTE es el que
--      importa: es el camino que la p8 del 10/09 rompio para todo el servicio.
--   2. RECIBIR UN ALBARAN public.confirm_goods_receipt(:receipt_id)
--      Un albaran en borrador con una linea de envase.
--   3. APUNTAR UNA MERMA  public.register_waste(...) sobre un envase.
--   4. APROBAR UN RECUENTO public.apply_inventory_count(:count_id, ...)
--      Un recuento sin aprobar que incluya envase.
--
-- Los ids NO van escritos: cambian cada dia y un ensayo contra una fila
-- inventada no mide nada. Se rellenan con la base delante esa noche.
-- Si alguno no se puede ensayar, ESO es el hallazgo: se dice en el parte y NO
-- se hace commit.

rollback;
-- commit;
