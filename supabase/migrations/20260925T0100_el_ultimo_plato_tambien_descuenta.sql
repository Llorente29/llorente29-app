-- ============================================================================
-- El último plato también descuenta: el consumo de líneas se recalcula UNA vez,
-- al final de la transacción que las escribe
-- ----------------------------------------------------------------------------
-- 25/09/2026. Encargo «El extra del último plato no asienta al entrar el pedido».
-- APLICADA el 25/09/2026 a las 11:0x (Madrid) por Julio, fuera de banda: 0
-- pedidos en la hora anterior, el último el 24/09 a las 23:29. Registrada en
-- supabase_migrations como 20260925090015 el_ultimo_plato_tambien_descuenta.
--
-- EL SQL DE ABAJO ES EL DESPLEGADO, sacado de pg_get_functiondef el 25/09 a las
-- 11:06 (md5 01778790ef0ddc94492167b17eb336ad), no el que se propuso. Base y
-- repositorio cuentan lo mismo. La propuesta que se ensayó a las 10:34 era
-- distinta en dos cosas; van dichas en «LO APLICADO».
--
-- ── LA CAUSA, LEÍDA EN LO DESPLEGADO ──────────────────────────────────────
-- Lo vivo el 25/09 10:16 es lo mismo que el repositorio (md5 de
-- pg_get_functiondef = 04cc6b5e9ba12a117a100e9d5600c7e8):
--
--   CREATE TRIGGER trg_sale_line_consumption
--     AFTER INSERT OR UPDATE OF menu_item_id ON public.sale_line
--     FOR EACH ROW EXECUTE FUNCTION tg_sale_line_consumption()
--
-- y dentro: «if coalesce(new.line_type,'product') <> 'product' then return».
-- Los seis escritores de líneas (adapt_lastapp_order, adapt_hubrise_order,
-- adapt_folvy_shop_order, _adapt_folvy_pos_order, place_shop_order,
-- recasar_lastapp_en_frio) insertan en el orden producto → sus hijas →
-- siguiente producto. Cada inserción de producto recalcula la venta ENTERA,
-- pero en ese momento las hijas de ESE producto todavía no existen. Las
-- rescata la inserción del producto siguiente; las del último, nadie.
--
-- ── ES MÁS QUE UN EXTRA: TAMBIÉN EL COMBO ENTERO ──────────────────────────
-- El parte habla del extra. Leyendo `_sale_line_raw_consumption` sale el
-- hermano grande: una línea es combo SI Y SOLO SI ya existe algún hijo
-- `combo_item`. Cuando el combo es el último producto, al recalcular no tiene
-- hijos todavía: el motor lo trata como plato simple y no descuenta NADA de
-- lo que lleva dentro, hasta el cierre.
--
-- Medido en Foodint, ventas de Last de los últimos 7 días (25/09 10:2x):
--   634 ventas · 124 acaban en COMBO (19,6 %) · 18 acaban en plato con extra
-- Todas se tapan al cerrar (`close_sale` y `tg_sale_consumption_on_complete`
-- llaman a generate_sale_consumption con todas las líneas ya dentro). Mediana
-- de la venta al cierre: 125 minutos. Durante esa ventana el stock de esos
-- pedidos está corto (ver abajo quién lo lee: pantallas, nada automático).
--
-- Exposición HOY, pedidos vivos sin cerrar desde el 11/09, comparando lo que
-- pide el motor (solo lectura) contra lo asentado: TRES, y solo uno es esto.
--   U093  Last    awaiting_collection  24/09 21:31  Salsa Sweet Chilli 100 → 0
--   G034  HubRise delivery_failed      13/09 15:08  solo envase (anterior al 23/09)
--   G351  HubRise delivery_failed      14/09 22:11  solo envase (anterior al 23/09)
-- Exactamente lo que decía el parte.
--
-- ── LO APLICADO ───────────────────────────────────────────────────────────
-- El disparador pasa a CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED.
-- Corre al COMMIT, cuando la ingesta ya ha metido todas las líneas, así que el
-- resultado deja de depender del orden de inserción. En INSERT se quita el
-- corte por `line_type`. Un pedido de 5 productos llamaba 5 veces a
-- generate_sale_consumption sobre la venta entera; ahora, una.
--
-- Dos diferencias con la propuesta ensayada a las 10:34:
--   1. EVENTOS. Se aplicó `AFTER INSERT OR UPDATE` (cualquier columna) y el
--      filtro vive dentro: en UPDATE solo sigue si `menu_item_id` cambia de
--      valor. La razón que se dio, que un constraint trigger no admite
--      `UPDATE OF columna`, NO es cierta: el ensayo de las 10:34 creó
--      `after insert or update of menu_item_id ... deferrable initially
--      deferred` sin error. Lo aplicado es equivalente en efecto (y algo más
--      estricto: un UPDATE que escribe el mismo valor ya no recalcula). El
--      coste es que cualquier UPDATE de `sale_line` —el barrido de coste de las
--      04:50, por ejemplo— encola un evento por fila que sale en la primera
--      línea de la función.
--   2. MARCA. La propuesta marcaba venta + huella de sus líneas; lo aplicado
--      marca SOLO la venta, una vez por transacción. Diferencia medida en el
--      reensayo (C): si en la MISMA transacción se escriben líneas, se fuerza
--      el commit diferido con `SET CONSTRAINTS ... IMMEDIATE` y luego se
--      escriben más líneas de la misma venta, ese segundo lote NO recalcula
--      (U622 se quedó en 0 movimientos). Hoy no pasa: cero funciones de public
--      y cero ficheros del repositorio usan `SET CONSTRAINTS` (medido 25/09).
--      Si algún día alguien lo usa, ésta es la línea que hay que mirar.
--
-- ── LO QUE NO SE TOCA ─────────────────────────────────────────────────────
--   · generate_sale_consumption, _sale_line_raw_consumption, los adaptadores:
--     ni una línea. El corte del último recuento (regla 6) vive dentro de
--     generate_sale_consumption y sigue igual.
--   · Los disparadores de `sale` (Bloque 1 al entrar, Bloque 0 al anular,
--     cierre): intactos. Descontar al entrar y devolver al anular sigue siendo
--     el diseño.
--   · El NOMBRE del disparador: `recasar_lastapp_en_frio` lo busca por nombre
--     en su enclavamiento y se niega a correr si está armado. Con otro nombre
--     el enclavamiento dejaría de proteger. Se conserva, y el ensayo comprueba
--     que desarmar → escribir → rearmar en la misma transacción sigue sin
--     consumir (un evento solo se encola si el disparador está armado cuando
--     se escribe la fila).
--   · El alcance: INSERT de cualquier línea, y UPDATE solo cuando cambia
--     `menu_item_id`, como antes (ver «LO APLICADO», punto 1).
--   · Ninguna edge function. Ningún fichero del front.
--
-- ── NO SE REPROCESA NADA HACIA ATRÁS ──────────────────────────────────────
-- Esto no toca ni una venta existente. U093 asentará su salsa cuando se cierre,
-- como hoy. G034 y G351 van al recuento del domingo 27/09 (regla del 18/09).
--
-- ── ENSAYADA EL 25/09 A LAS 10:34 (Madrid), REVERTIDA — sobre la PROPUESTA ──
-- Script: docs/propuestas/ensayo_el_ultimo_plato_tambien_descuenta.sql. Hueco
-- medido: 0 pedidos en la última hora, el último el 24/09 a las 23:29.
-- Ingesta REAL: adapt_lastapp_order re-inserta las líneas en el orden del
-- pedido, como cuando Last lo reenvía. «Falta» = lo que pide el motor hoy
-- (solo lectura) menos lo asentado.
--
--                          U093 (extra al final)       U622 (combo al final)
--   antes                  28 movs · falta Sweet 100   11 movs · falta NADA
--   E1 disparador de hoy   28 movs · falta Sweet 100    0 movs · faltan los 11
--   E2 diferido, pre-commit 28 · falta Sweet 100        0 · faltan los 11
--   E2 diferido, al commit 29 movs · falta NADA        11 movs · falta NADA
--   E3 pasadas de generate 1 (4 líneas)                 1 (3 líneas)
--   E4 recasado en frío    —                           desarmado → cambiar un
--                                                      hijo → rearmar → commit:
--                                                      11 → 11, NO recalcula
--   E5 cierre encima       mismos ids de movimiento: t (FV001, no reescribe)
--
-- E1 en U622 es la pieza: re-adaptado con el disparador de hoy, un pedido de un
-- solo combo se queda a CERO — sin milanesa, sin patatas, sin la lata.
--
-- Después, comprobado: md5 de la función 04cc6b5e… (el de antes), disparador
-- inmediato y en 'O', U093 en 28 y U622 en 11 movimientos, 7 líneas.
--
-- Los CUATRO caminos de la regla 10: cerrar venta es E5. Recibir albarán,
-- apuntar merma y aprobar recuento no insertan en `sale_line` —medido en
-- pg_proc: las únicas funciones que lo hacen son los seis escritores de
-- arriba— así que no pasan por este disparador; no se ensayan porque no hay
-- nada suyo que cambie.
--
-- ── REENSAYADA CONTRA LO DESPLEGADO, 25/09 11:06, REVERTIDA ───────────────
-- Misma técnica que arriba (adapt_lastapp_order, bloque que acaba en RAISE),
-- ya con el disparador aplicado. 0 pedidos en la hora anterior.
--   A  ingesta real, al commit      U093 29 movs · falta NADA
--                                   U622 11 movs · falta NADA   <- el combo
--   B  UPDATE que no cambia menu_item_id (lo que hace el recosteo): 0 movs
--      tras borrar los de U622 a mano -> no recalcula, correcto
--   C  segundo lote en la misma transacción tras SET CONSTRAINTS IMMEDIATE:
--      no recalcula (ver «LO APLICADO», punto 2)
--   D  recasado en frío: desarmar -> cambiar menu_item_id -> rearmar -> commit:
--      29 movs, no recalcula -> el enclavamiento sigue protegiendo
--
-- ============================================================================
-- DÓNDE SE PODÍA APLICAR: `DROP TRIGGER` toma ACCESS EXCLUSIVE sobre
-- `sale_line`, que se escribe en cada pedido, así que falla la condición 2 de
-- la banda y solo cabe fuera de ella. La banda es 12:15–00:30 (Madrid):
-- 30 días medidos (26/08–24/09), el pedido más tardío a las 23:59, 6 de 30
-- días con alguno después de las 23:45 y 0 de 30 después de las 00:15. Se
-- aplicó a las 11:0x, antes de que abriera.
-- ============================================================================
--
-- ── QUIÉN LEE EL STOCK MIENTRAS EL PEDIDO NO CIERRA (apéndice, 25/09) ─────
-- No es el motivo del arreglo: una venta que no descuenta se arregla porque es
-- un fallo, no por sus consecuencias aguas abajo. Queda medido para no
-- repetirlo (pg_proc, cron.job y src/):
--   · Agotar productos (86): no lee el stock; es a mano.
--   · Avisos de falta en servicio: ninguno. El único aviso que sale del stock
--     es el recuento automático de las 04:00, con todo cerrado.
--   · Pantallas de stock, AvT y Pendientes: sí enseñan el número inflado.
--   · Compra (`suggest_purchase_qty`): lee el stock, pero no hay nada que
--     revisar. CORREGIDO: aquí se dijo «13 de 22 pedidos a proveedor entre las
--     12:00 y las 22:00», y la hora es la vara equivocada; la buena es cuántas
--     ventas había abiertas en ese instante, DEL MISMO LOCAL y DE LAST. Con
--     esa: 14 de 22 con cero abiertas, y el peor, 15 (20/09 14:51), unos 3
--     combos. Repetido desde Code y cuadra; con otras varas sale distinto
--     (todas las fuentes y el mismo local: 11 con cero y peor 17; sin filtrar
--     por local: 8 y 36), así que la definición va aquí escrita.

CREATE OR REPLACE FUNCTION public.tg_sale_line_consumption()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale_id uuid; v_sale record; v_n integer; v_state text; v_msg text; v_marca text;
begin
  v_sale_id := new.sale_id;
  if v_sale_id is null then return new; end if;

  -- En UPDATE se mantiene el alcance de antes: solo cuando cambia menu_item_id.
  -- En INSERT entra cualquier line_type (ese es el arreglo).
  if tg_op = 'UPDATE' and new.menu_item_id is not distinct from old.menu_item_id then
    return new;
  end if;

  -- Una sola vez por venta y por transaccion.
  v_marca := 'folvy.consumo_' || replace(v_sale_id::text, '-', '');
  if coalesce(current_setting(v_marca, true), '') = '1' then
    return new;
  end if;

  select id, status, order_status, is_active into v_sale
    from public.sale where id = v_sale_id;
  if not found then return new; end if;

  -- No consumir ventas canceladas ni inactivas.
  if coalesce(v_sale.status,'') = 'cancelled'
     or coalesce(v_sale.order_status,'') in ('cancelled','rejected')
     or not coalesce(v_sale.is_active, true) then
    return new;
  end if;

  perform set_config(v_marca, '1', true);

  v_n := public.generate_sale_consumption(v_sale_id);
  perform public._resolver_fallo_de_consumo(v_sale_id, v_n);
  return new;

exception when others then
  -- No tumbamos la ingesta, pero el fallo deja FILA y ALERTA.
  v_state := sqlstate;
  v_msg   := sqlerrm;
  begin
    perform public._registrar_fallo_de_consumo(v_sale_id, v_state, v_msg);
  exception when others then
    raise warning 'tg_sale_line_consumption: no se pudo apuntar el fallo de la venta % : %',
      v_sale_id, sqlerrm;
  end;
  raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, v_msg;
  return new;
end;
$function$;

drop trigger if exists trg_sale_line_consumption on public.sale_line;

create constraint trigger trg_sale_line_consumption
  after insert or update on public.sale_line
  deferrable initially deferred
  for each row
  execute function public.tg_sale_line_consumption();
