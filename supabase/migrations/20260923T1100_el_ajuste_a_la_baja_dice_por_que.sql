-- ============================================================================
-- El ajuste a la baja deja de ser un cajón
-- ----------------------------------------------------------------------------
-- 23/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- Punto 3 del encargo «Que los términos de la resta sean medibles».
-- APLICADA el 23/09/2026 a las 11:22 (Madrid), fuera de la ventana 12:15-00:30
-- que pide el encargo para tocar la pantalla: 0 pedidos en 30 minutos (el
-- ultimo de anoche a las 23:16) y 0 ajustes en curso.
--
-- Aplicada por `apply_migration`, asi que SI queda en
-- `supabase_migrations.schema_migrations` (version 20260923092237). Las cuatro
-- de la noche del 22 al 23 no estan: se aplicaron por SQL directo y el
-- historial de la base no las ve. Deuda apuntada, no arreglada aqui.
--
-- COMPROBADO SOBRE LA FUNCION VIVA, en transaccion revertida y suplantando a
-- un usuario real de la cuenta:
--   bajada count_correction SIN nota ... rechazada
--   bajada «Otro» ...................... rechazada
--   bajada «Merma» ..................... rechazada
--   bajada CON explicacion ............. pasa
--   SUBIDA «Otro» sin nota ............. pasa   (no se toca)
-- Una sola firma. Saldo de las servilletas intacto en 1.943.
--
-- ── LO QUE DICE EL ENCARGO, Y LO QUE DICEN LOS DATOS ──────────────────────
-- El encargo parte de «lo que se pierde se está borrando a mano»: 178 ajustes
-- por -24.249,07 EUR, 175 sin nota. Medido antes de escribir, en Alcalá, 30
-- días, separando por QUIÉN escribe el movimiento:
--
--   movement_type='ajuste'    movs      EUR      a la baja   EUR de la bajada
--   ├ source_type=inventory_count  936  +5.862,59      446       -6.119,08
--   ├ source_type=adjustment       192 -24.378,99  ***   8 ***  -31.003,84
--   └ source_type=goods_receipt_line 35 +9.366,22       18       -2.087,86
--
-- Los 24.249 EUR salen del bloque `adjustment` —esta pantalla— pero **no son
-- 178 bajadas: son OCHO**. El resto son subidas. Y al mirar las ocho, seis no
-- son pérdidas en absoluto:
--
--   11/09 00:10  Bolsas Ay Mamita        55.000 -> 200    -8.891,21   sin nota
--   11/09 00:11  Bolsas Birria Burrito   50.000 -> 200    -8.610,12   sin nota
--   11/09 00:11  Bolsas Korean           31.750 -> 100    -5.513,36   sin nota
--   11/09 00:12  Bolsas Dos Coyotes      22.500 ->   0    -3.835,80   sin nota
--   11/09 00:12  Bolsas Chivuo's         12.500 ->  40    -2.195,47   sin nota
--   05/09 14:07  Coca-Cola Original Lata  1.440 ->  60      -576,13   sin nota
--
-- Eso es stock FANTASMA corregido, no comida perdida. La Coca-Cola canta el
-- error ella sola: 1.440 = 60 x 24, una caja contada como unidades.
-- Las dos restantes SÍ llevan nota, y se explican solas («dos ventas del 01/09
-- no descontaron…»).
--
-- 🔴 LA CONCLUSIÓN CAMBIA EL TITULAR, y hay que decirlo: aquí no había 24.000
--    EUR de merma escondida. Había 29.622 EUR de correcciones de unidad sin
--    una línea de explicación. **Y eso es exactamente igual de grave para
--    medir**, porque desde la base las dos cosas son indistinguibles: un
--    -8.891,21 sin nota puede ser cualquiera de las dos. Lo que arregla esto
--    no es tapar una fuga: es que el residuo deje de estar explicado en falso.
--
-- ── LO QUE ESTA GUARDA **NO** VA A CAZAR, y también hay que decirlo ───────
-- El encargo pide bloquear `other` y redirigir `waste`/`expired` en las
-- bajadas. Medido a 90 días: **cero bajadas con `other`** (los 15 `other` son
-- todos al alza y suman 0,00 EUR) y **cero movimientos con `waste` o
-- `expired`** en toda la tabla. Esas dos reglas son PREVENTIVAS: hoy no
-- cambian ni una fila. La que muerde de verdad es la nota obligatoria en
-- `count_correction`, que habría cazado las seis.
--
-- ── DÓNDE VA LA GUARDA ────────────────────────────────────────────────────
-- En la RPC, no solo en la pantalla. `register_adjustment` es SECURITY
-- DEFINER y la llama el front, pero la pantalla no es la única puerta: el día
-- que alguien llame la RPC desde otro sitio, la regla tiene que seguir ahí.
-- La pantalla repite la misma regla (`src/modules/supply/lib/ajusteALaBaja`)
-- para no dejar pulsar, que es más amable que fallar al guardar.
--
-- Misma firma, mismo tipo de vuelta: CREATE OR REPLACE es correcto y NO crea
-- sobrecarga (regla 2, que solo muerde al añadir parámetros).
--
-- ── LO QUE NO SE TOCA ─────────────────────────────────────────────────────
-- · Los ajustes AL ALZA, enteros. No son la fuga y meterles fricción solo
--   conseguiría que se dejaran de hacer.
-- · Nada de lo ya escrito: ni los 8 movimientos, ni sus `stock_adjustment`.
-- · El camino de `apply_inventory_count` (936 movimientos): ése es aprobar un
--   recuento, no ajustar a mano, y tiene su propia puerta.
-- · `direct_receipt`: es el punto 4 del encargo, va aparte.
-- ============================================================================

begin;

-- ── Guarda: la función tiene la forma que se midió ────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='register_adjustment'
       and pg_get_functiondef(p.oid) like '%v_delta    := p_counted_base - v_previous;%')
  then raise exception 'ABORTA: register_adjustment no tiene la forma medida el 23/09.'; end if;
end $$;

CREATE OR REPLACE FUNCTION public.register_adjustment(
  p_account_id uuid, p_location_id uuid, p_recipe_item_id uuid,
  p_reason_code text, p_counted_base numeric,
  p_use_unit_label text DEFAULT NULL::text, p_use_unit_factor numeric DEFAULT NULL::numeric,
  p_use_qty numeric DEFAULT NULL::numeric, p_photo_url text DEFAULT NULL::text,
  p_lot_code text DEFAULT NULL::text, p_expiry_date date DEFAULT NULL::date,
  p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid,
  p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(adjustment_id uuid, delta_base numeric, cost_eur numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item_account uuid;
  v_previous     numeric;
  v_unit_cost    numeric;
  v_delta        numeric;
  v_cost_eur     numeric;
  v_adj_id       uuid;
begin
  -- Guard: el usuario debe pertenecer a la cuenta.
  if not belongs_to_account(p_account_id) then
    raise exception 'register_adjustment: sin acceso a la cuenta %', p_account_id;
  end if;
  -- El conteo real no puede ser negativo (sí puede ser 0 = "no queda nada").
  if p_counted_base is null or p_counted_base < 0 then
    raise exception 'register_adjustment: el conteo debe ser >= 0';
  end if;
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'register_adjustment: el motivo es obligatorio';
  end if;
  -- El artículo debe existir y pertenecer a la cuenta.
  select account_id into v_item_account
    from public.recipe_item where id = p_recipe_item_id;
  if v_item_account is null then
    raise exception 'register_adjustment: el artículo % no existe', p_recipe_item_id;
  end if;
  if v_item_account <> p_account_id then
    raise exception 'register_adjustment: el artículo no pertenece a la cuenta';
  end if;

  -- Saldo actual y WAC del instante (0/NULL si el artículo aún no tiene fila/coste).
  select coalesce(qty_on_hand, 0), coalesce(avg_unit_cost, 0)
    into v_previous, v_unit_cost
    from public.recipe_item_location_stock
    where recipe_item_id = p_recipe_item_id
      and location_id = p_location_id
      and account_id = p_account_id;
  v_previous  := coalesce(v_previous, 0);
  v_unit_cost := coalesce(v_unit_cost, 0);

  v_delta    := p_counted_base - v_previous;     -- movimiento con signo
  v_cost_eur := v_delta * v_unit_cost;

  -- ── 23/09/2026 · BAJAR STOCK EXIGE DECIR POR QUÉ ────────────────────────
  -- Solo a la BAJA. Al alza no se toca nada: no es la fuga, y la fricción
  -- solo conseguiría que se dejaran de hacer.
  if v_delta < 0 then
    if p_reason_code in ('waste', 'expired') then
      raise exception
        'register_adjustment: «%» es una merma y va por register_waste, no por aquí. '
        'Si sale por merma tiene que contar como merma, o el almacén dice que la '
        'merma es cero mientras se tira comida.', p_reason_code
        using errcode = 'check_violation';
    end if;

    if p_reason_code = 'other' then
      raise exception
        'register_adjustment: para bajar stock hace falta un motivo de verdad. '
        '«Otro» no dice nada y el mes que viene nadie sabra que paso.'
        using errcode = 'check_violation';
    end if;

    -- La que muerde. Las seis correcciones de unidad del 05 y el 11/09
    -- (29.622 EUR) habrian caido aqui: ninguna llevaba nota, y sin nota no se
    -- distingue «he perdido 8.891 EUR de bolsas» de «nunca hubo 55.000 bolsas».
    if p_reason_code = 'count_correction'
       and length(btrim(coalesce(p_notes, ''))) < 10 then
      raise exception
        'register_adjustment: una correccion de conteo a la baja necesita nota '
        '(minimo 10 caracteres). Sin ella no se distingue de una perdida.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Sin cambio real: no escribimos ruido en el ledger.
  if v_delta = 0 then
    insert into public.stock_adjustment (
      account_id, location_id, recipe_item_id, reason_code,
      counted_base, previous_base, delta_base,
      use_unit_label, use_unit_factor, use_qty,
      unit_cost, cost_eur, photo_url, lot_code, expiry_date, notes,
      occurred_at, created_by, created_by_name
    ) values (
      p_account_id, p_location_id, p_recipe_item_id, p_reason_code,
      p_counted_base, v_previous, 0,
      p_use_unit_label, p_use_unit_factor, p_use_qty,
      v_unit_cost, 0, p_photo_url, p_lot_code, p_expiry_date, p_notes,
      now(), p_user_id, p_user_name
    ) returning id into v_adj_id;
    return query select v_adj_id, 0::numeric, 0::numeric;
    return;
  end if;

  -- 1) Evento de ajuste (cabecera con causa, conteo, diferencia, unidad amigable…).
  insert into public.stock_adjustment (
    account_id, location_id, recipe_item_id, reason_code,
    counted_base, previous_base, delta_base,
    use_unit_label, use_unit_factor, use_qty,
    unit_cost, cost_eur, photo_url, lot_code, expiry_date, notes,
    occurred_at, created_by, created_by_name
  ) values (
    p_account_id, p_location_id, p_recipe_item_id, p_reason_code,
    p_counted_base, v_previous, v_delta,
    p_use_unit_label, p_use_unit_factor, p_use_qty,
    v_unit_cost, v_cost_eur, p_photo_url, p_lot_code, p_expiry_date, p_notes,
    now(), p_user_id, p_user_name
  ) returning id into v_adj_id;

  -- 2) Movimiento al ledger: tipo 'ajuste', qty = diferencia (puede ser + o −).
  insert into public.stock_movement (
    account_id, location_id, recipe_item_id, movement_type, qty_base,
    unit_cost, cost_provisional, source_type, source_id, occurred_at,
    lot_code, expiry_date, created_by, created_by_name, notes
  ) values (
    p_account_id, p_location_id, p_recipe_item_id, 'ajuste', v_delta,
    v_unit_cost, false, 'adjustment', v_adj_id, now(),
    p_lot_code, p_expiry_date, p_user_id, p_user_name,
    coalesce('Ajuste: ' || p_reason_code, 'Ajuste')
  );

  -- 3) Recalcular el saldo del artículo en el local (core: somos SECURITY DEFINER).
  perform public.recompute_location_stock_core(p_recipe_item_id, p_location_id);

  return query select v_adj_id, v_delta, v_cost_eur;
end;
$function$;

commit;
