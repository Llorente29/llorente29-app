-- ============================================================================
-- El último plato también descuenta: el consumo de líneas se recalcula UNA vez,
-- al final de la transacción que las escribe
-- ----------------------------------------------------------------------------
-- 25/09/2026. Encargo «El extra del último plato no asienta al entrar el pedido».
-- PROPUESTA. SIN APLICAR. La aplica Julio, fuera de banda (ver el AVISO).
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
-- pedidos está corto, y lo leen el KDS, el panel de stock y los avisos.
--
-- Exposición HOY, pedidos vivos sin cerrar desde el 11/09, comparando lo que
-- pide el motor (solo lectura) contra lo asentado: TRES, y solo uno es esto.
--   U093  Last    awaiting_collection  24/09 21:31  Salsa Sweet Chilli 100 → 0
--   G034  HubRise delivery_failed      13/09 15:08  solo envase (anterior al 23/09)
--   G351  HubRise delivery_failed      14/09 22:11  solo envase (anterior al 23/09)
-- Exactamente lo que decía el parte.
--
-- ── EL ARREGLO: EL CAMINO 2 DEL ENCARGO ───────────────────────────────────
-- El disparador pasa a CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED.
-- Corre al COMMIT, cuando la ingesta ya ha metido todas las líneas, así que el
-- resultado deja de depender del orden de inserción. Y se quita el corte por
-- `line_type`: al commit ya no hace falta, porque lo que se recalcula es la
-- venta entera con todo dentro.
--
-- Postgres no tiene disparadores de restricción POR SENTENCIA: el evento se
-- encola por FILA. Para no recalcular la venta N veces al commit, cada pasada
-- deja una marca en la transacción (`set_config(..., true)`, local: muere con
-- ella) con la venta Y LA HUELLA DE SUS LÍNEAS. Si llega otro evento de la
-- misma venta y las líneas son las mismas, no se repite. Si alguien hubiera
-- escrito más líneas después de una pasada (un `SET CONSTRAINTS ... IMMEDIATE`
-- a mitad; medido: CERO funciones de public y cero ficheros del repositorio
-- lo usan), la huella cambia y se recalcula. Nunca se salta una pasada que
-- haga falta; como mucho sobra una, y esa la anula la guarda FV001.
--
-- Efecto colateral bueno: un pedido de 5 productos llamaba 5 veces a
-- generate_sale_consumption sobre la venta entera. Ahora, una.
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
--   · Los eventos: los mismos que hoy (INSERT, y UPDATE OF menu_item_id). No se
--     amplía nada.
--   · Ninguna edge function. Ningún fichero del front.
--
-- ── NO SE REPROCESA NADA HACIA ATRÁS ──────────────────────────────────────
-- Esto no toca ni una venta existente. U093 asentará su salsa cuando se cierre,
-- como hoy. G034 y G351 van al recuento del domingo 27/09 (regla del 18/09).
--
-- ── ENSAYADA EL 25/09 A LAS 10:34 (Madrid), REVERTIDA ─────────────────────
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
-- ============================================================================
-- AVISO: ESTO VA POR EL CAMINO DEL PEDIDO Y TIENE QUE ESPERAR A LA NOCHE.
-- `DROP TRIGGER` toma ACCESS EXCLUSIVE sobre `sale_line`, que se escribe en
-- cada pedido. Falla la condición 2 de la banda: NO se aplica en servicio.
-- DESPUÉS DE LAS 00:30 (reloj de la base, Europe/Madrid), no a las 23:50.
-- CLAUDE.md escribe la banda como 12:15–23:45; el método la lleva a las 00:30,
-- y los datos le dan la razón: el 24/09 entró un pedido a las 23:29 y el 23/09
-- a las 23:23. La duda va a favor de esperar. Con `lock_timeout` de 3 s: si
-- hay un pedido entrando, la migración falla sin dejar nada y se reintenta; no
-- deja cola detrás de ella.
-- ============================================================================
--
-- ── LO QUE ESTE FALLO HACE DURANTE EL SERVICIO (medido 25/09 ~10:45) ──────
-- El cierre repara el asiento, pero un pedido de Last tarda 125 min de mediana
-- en cerrarse. Mientras tanto, el stock en caché (`recipe_item_location_stock`)
-- no ha descontado el combo o el extra del último plato. Quién lee ese stock
-- durante la tarde, contado en pg_proc, cron.job y src/:
--   · Agotar productos (86): NO lo lee. `set_product_availability*` y
--     `_set_product_availability_core` no tocan el stock; agotar es a mano
--     (tablet o panel). No hay auto-86 por stock que llegue tarde.
--   · Avisos de falta de género: ninguno en servicio. De los 56 crons, ninguno
--     de día lee stock; el único que avisa desde la caché es el recuento
--     automático (`_generate_daily_count_core`, 04:00), con todo ya cerrado.
--   · Pantallas: Niveles de stock, Stock negativo, stock por artículo en
--     cocina, zonas de almacén, AvT y Pendientes (`pending_board`). Enseñan un
--     stock inflado por lo que falte hasta el cierre.
--   · Compra: `suggest_purchase_qty` resta lo que hay en caché. De 22 pedidos a
--     proveedor de Foodint en 30 días, 13 se crearon entre las 12:00 y las
--     22:00, o sea con este hueco abierto. Una sugerencia a media tarde puede
--     quedarse corta por lo que falte.
-- Conclusión: no hay automatismo que decida mal por esto; hay personas que
-- miran un número inflado. Éste es el motivo para aplicarlo esta noche y no
-- «cuando toque».

begin;

set local lock_timeout = '3s';

-- ── 1. La función ─────────────────────────────────────────────────────────
-- Misma firma (sin argumentos, devuelve trigger): CREATE OR REPLACE no crea
-- sobrecarga (regla 2 no aplica).
create or replace function public.tg_sale_line_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_sale_id uuid; v_sale record; v_n integer; v_state text; v_msg text;
  v_huella  text; v_marca text; v_hechas text;
begin
  -- DIFERIDO (25/09/2026): esto corre al COMMIT de la transacción que escribe
  -- las líneas, no al escribir cada una. A esas alturas la ingesta ya ha metido
  -- el pedido entero —productos, extras e hijos de combo— y el recálculo ve lo
  -- mismo que verá el cierre. Antes corría fila a fila y las hijas del ÚLTIMO
  -- producto no llegaban nunca: G246 (Mayo Smokey) y U093 (Sweet Chili).
  v_sale_id := new.sale_id;
  if v_sale_id is null then return null; end if;
  select id, status, order_status, is_active into v_sale
    from public.sale where id = v_sale_id;
  if not found then return null; end if;
  -- No consumir ventas canceladas ni inactivas.
  if coalesce(v_sale.status,'') = 'cancelled'
     or coalesce(v_sale.order_status,'') in ('cancelled','rejected')
     or not coalesce(v_sale.is_active, true) then
    return null;
  end if;

  -- UNA pasada por venta y por forma de sus líneas. Sin esto, un pedido de 20
  -- líneas recalcularía 20 veces al commit (el evento es por fila). Ya NO se
  -- corta por line_type: una hija también dispara, y la marca las agrupa.
  select md5(coalesce(string_agg(
           sl.id::text || '|' || coalesce(sl.line_type,'') || '|'
           || coalesce(sl.parent_sale_line_id::text,'') || '|'
           || coalesce(sl.menu_item_id::text,'') || '|'
           || coalesce(sl.modifier_option_id::text,'') || '|'
           || coalesce(sl.quantity::text,'') || '|'
           || coalesce(sl.ignored_at::text,''),
           ',' order by sl.id), ''))
    into v_huella
    from public.sale_line sl where sl.sale_id = v_sale_id;
  v_marca  := v_sale_id::text || ':' || v_huella;
  v_hechas := coalesce(current_setting('folvy.consumo_lineas_hecho', true), '');
  if strpos(v_hechas, v_marca) > 0 then
    return null;
  end if;

  v_n := public.generate_sale_consumption(v_sale_id);
  perform set_config('folvy.consumo_lineas_hecho', v_hechas || ' ' || v_marca, true);
  -- Salió bien: si esta venta arrastraba un fallo, se cierra con contenido.
  perform public._resolver_fallo_de_consumo(v_sale_id, v_n);
  return null;
exception when others then
  -- No tumbamos la ingesta —y ahora menos: un error aquí sería un COMMIT
  -- fallido y el pedido entero se perdería— pero el fallo deja FILA y ALERTA.
  v_state := sqlstate;
  v_msg   := sqlerrm;
  begin
    perform public._registrar_fallo_de_consumo(v_sale_id, v_state, v_msg);
  exception when others then
    raise warning 'tg_sale_line_consumption: no se pudo apuntar el fallo de la venta % : %',
      v_sale_id, sqlerrm;
  end;
  -- Marcada también: el fallo ya está apuntado y lo reintenta el cron
  -- (cron_recompute_missing_sale_consumption lee los fallos sin resolver).
  -- Repetirlo por cada línea del mismo pedido solo repetiría el error.
  if v_marca is not null then
    perform set_config('folvy.consumo_lineas_hecho',
                       coalesce(v_hechas,'') || ' ' || v_marca, true);
  end if;
  raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, v_msg;
  return null;
end;
$fn$;

-- ── 2. El disparador: mismo nombre, mismos eventos, diferido ──────────────
drop trigger if exists trg_sale_line_consumption on public.sale_line;
create constraint trigger trg_sale_line_consumption
  after insert or update of menu_item_id on public.sale_line
  deferrable initially deferred
  for each row execute function public.tg_sale_line_consumption();

-- ── 3. Comprobación antes del commit ──────────────────────────────────────
do $$
declare v_t record; v_defs integer;
begin
  select t.tgenabled, t.tgdeferrable, t.tginitdeferred, t.tgconstraint
    into v_t
    from pg_trigger t
   where t.tgrelid = 'public.sale_line'::regclass
     and t.tgname  = 'trg_sale_line_consumption';
  if not found then
    raise exception 'falta el trigger trg_sale_line_consumption';
  end if;
  if v_t.tgenabled <> 'O' or not v_t.tgdeferrable or not v_t.tginitdeferred
     or v_t.tgconstraint = 0 then
    raise exception 'trg_sale_line_consumption no ha quedado diferido y armado: % % % %',
      v_t.tgenabled, v_t.tgdeferrable, v_t.tginitdeferred, v_t.tgconstraint;
  end if;
  select count(*) into v_defs from pg_proc
   where proname = 'tg_sale_line_consumption'
     and pronamespace = 'public'::regnamespace;
  if v_defs <> 1 then
    raise exception 'tg_sale_line_consumption tiene % definiciones', v_defs;
  end if;
end $$;

commit;
