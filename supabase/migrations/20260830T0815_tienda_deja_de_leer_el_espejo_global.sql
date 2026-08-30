-- 20260830T0815_tienda_deja_de_leer_el_espejo_global.sql
-- ============================================================================
-- PASO 1 de dos. APLICADA el 30/08/2026 a las 08:21 de Madrid, registrada como
-- version 20260830062119, nombre `tienda_deja_de_leer_el_espejo_global`.
-- Escrita el 29/08 y RENUMERADA al 30/08 antes de aplicarla:
-- estaba fechada el 01/09 y un nombre con fecha futura confunde a quien lee el
-- repo para saber que queda pendiente. (El registro real, sin embargo, nunca
-- corrio peligro: schema_migrations sella la hora UTC de aplicacion, no la del
-- nombre del fichero.)
-- No aplicada el 29 a propósito: sábado en servicio, y la tienda propia llevaba
-- 17 días sin una sola venta (22 ventas históricas, 600,39 €, cero líneas a 0 €).
-- El fallo es real pero no estaba costando dinero: no había razón para tocar
-- producción en servicio.
--
-- PROBLEMA
-- Seis funciones de la tienda propia deciden si un producto se puede vender
-- mirando `menu_item.is_available`, que es un espejo DERIVADO de
-- product_availability y vive en una tabla SIN local. Desde que el 86 es por
-- local (28/08), ese espejo se apaga en cuanto el producto se agota en UN solo
-- local. Medido el 29/08 en producción: los 52 agotados activos son todos por
-- local, 0 globales, y 125 fichas vivas (121 en marcas con tienda, 18 marcas)
-- estaban apagadas por un 86 de un solo local.
--
-- Lo que hacía, en concreto:
--   · _shop_reprice_line no encontraba el producto y devolvía unitPrice 0 /
--     valid false. adapt_folvy_shop_order llama a ESA MISMA función y, sin
--     mirar `valid`, insertaba la línea de venta a 0 €. El plato entra en
--     cocina y el cliente no lo paga. (Nunca llegó a pasar: cero líneas a 0 €.)
--   · shop_item_config devolvía NULL: el menú enseñaba el producto y al pinchar
--     no abría la ficha.
--   · "Repetir pedido" filtraba las líneas y podía decir «Ninguno de estos
--     platos está disponible ahora mismo».
--   · shop_hub_by_slug lo sacaba del carrusel de más vendidos, y los dos
--     elegidores de regalo (+ el recheque de place_shop_order) anulaban la promo.
--
-- LA REGLA, Y POR QUÉ ES ESTA
-- La tienda tiene DOS momentos con DOS reglas, y las dos son legítimas:
--   · navegar la carta -> el cliente AÚN NO ha elegido local
--     (ShopCartContext.tsx:8: «El local concreto se ELIGE en el checkout»,
--      y shop_brand_menu_by_slug ni siquiera recibe p_location_id).
--     Regla correcta: vendible si lo está en ALGÚN local activo de la marca.
--   · checkout / pedido -> el local YA está elegido
--     (place_shop_order:74 lee locationId del payload y sella la venta con él).
--     Regla correcta: vendible EN ESE LOCAL.
-- Esta migración es SOLO la primera. No toca la segunda: el pedido queda
-- exactamente igual de ciego al local que hoy, ni más ni menos.
--
-- POR QUÉ NO SE "ARREGLA EL ESPEJO"
-- Se probó en solo lectura contra producción: redefinir menu_item.is_available
-- como «agotado sólo si lo está en TODOS los locales activos» encendía 125
-- fichas y no apagaba ninguna. Seguro para la carta. Pero si el pedido siguiera
-- leyendo el espejo, aceptaría una línea de un producto agotado EN EL LOCAL QUE
-- LA VA A COCINAR: cambiaríamos regalar un plato por vender lo que no tenemos.
-- Una columna de una tabla sin local no puede ser la puerta de un pedido que sí
-- tiene local.
--
-- CÓMO SE REESCRIBEN LAS SEIS
-- NO se transcriben a mano. Se lee el cuerpo vivo con pg_get_functiondef, se
-- sustituye el literal exacto y se vuelve a crear. Cero riesgo de fidelidad
-- (el incidente de Glovo del 27/08 fue por copiar una regla a mano tres veces).
-- Verificado el 29/08 contra producción: las seis tienen EXACTAMENTE UNA
-- aparición de `mi.is_available is not false`. La guarda aborta si no es 1.
--
--   antes:  ... and mi.is_available is not false ...
--   después: ... and public.menu_item_vendible_en_alguna_parte(mi.id) ...
--
-- Como es CREATE OR REPLACE sobre el mismo OID, se conservan los GRANT.
--
-- DEUDA DECLARADA, CON FECHA (29/08)
-- shop_brand_menu_by_slug mantiene su cascada inline (0 apariciones del espejo:
-- ya era correcta, y de ella se copió literalmente el cuerpo del ayudante).
-- Quedan dos copias de la misma regla. Se retira la inline en el paso 2, que ya
-- toca esa zona. Se deja escrito aquí para que no se descubra como sorpresa.
--
-- CADUCIDAD: el ayudante sí mira available_until contra now(), así que un 86
-- vencido deja de bloquear en cuanto se consulta. El espejo no lo hacía. Esto
-- MEJORA el comportamiento, no lo empeora.
-- ============================================================================

begin;

-- ── El único hogar de la regla de navegación ────────────────────────────────
-- Copiada LITERALMENTE de la cascada que shop_brand_menu_by_slug ya tenía en su
-- cuerpo vivo (líneas 56-80 el 29/08/2026). No se reinventa: se le pone nombre.
--
-- Se lee así: un agotado CON local sólo bloquea si NO queda ningún local activo
-- de la marca donde el producto siga disponible. Un agotado SIN local (global)
-- bloquea siempre.
create or replace function public.menu_item_vendible_en_alguna_parte(p_menu_item_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1
      from menu_item mi
      join product_availability pa
        on pa.account_id = mi.account_id
       and pa.is_available = false
       and (pa.available_until is null or pa.available_until > now())
       and ( (mi.external_id    is not null and pa.external_id    = mi.external_id)
          or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) )
     where mi.id = p_menu_item_id
       and ( pa.location_id is null
          or not exists (
               select 1
                 from brand_location_availability bla
                where bla.brand_id = mi.brand_id
                  and bla.is_active = true
                  and not exists (
                        select 1
                          from product_availability pa2
                         where pa2.account_id = mi.account_id
                           and pa2.is_available = false
                           and (pa2.available_until is null or pa2.available_until > now())
                           and (pa2.location_id = bla.location_id or pa2.location_id is null)
                           and ( (mi.external_id    is not null and pa2.external_id    = mi.external_id)
                              or (mi.recipe_item_id is not null and pa2.recipe_item_id = mi.recipe_item_id) )
                      )
             ) )
  );
$function$;

comment on function public.menu_item_vendible_en_alguna_parte(uuid) is
  'Regla de NAVEGACION de la tienda propia (el cliente aun no ha elegido local): '
  'un producto es vendible si lo esta en ALGUN local activo de su marca. NO vale '
  'para el pedido, que si conoce el local y necesita la regla POR LOCAL (paso 2). '
  'Unico hogar de esta regla; copiada de shop_brand_menu_by_slug el 29/08/2026.';

-- ── Las seis puertas de la tienda dejan de mirar el espejo ──────────────────
do $mig$
declare
  v_objetivos text[] := array[
    'public._shop_reprice_line(uuid, jsonb)',
    'public.shop_item_config(text, uuid)',
    'public.shop_hub_by_slug(text)',
    'public._shop_account_free_gift(uuid)',
    'public._shop_brand_free_gift(uuid, uuid)',
    'public.place_shop_order(text, jsonb, boolean)'
  ];
  v_obj   text;
  v_def   text;
  v_n     int;
  v_vieja text := 'mi.is_available is not false';
  v_nueva text := 'public.menu_item_vendible_en_alguna_parte(mi.id)';
begin
  foreach v_obj in array v_objetivos loop
    v_def := pg_get_functiondef(v_obj::regprocedure);

    v_n := (length(v_def) - length(replace(v_def, v_vieja, ''))) / length(v_vieja);
    if v_n <> 1 then
      raise exception 'ABORTA: % tiene % aparicion(es) de "%", se esperaba exactamente 1. '
                      'La funcion ha cambiado desde el 29/08: revisar a mano antes de seguir.',
                      v_obj, v_n, v_vieja;
    end if;

    execute replace(v_def, v_vieja, v_nueva);
    raise notice 'reescrita: %', v_obj;
  end loop;
end
$mig$;

-- ── GUARDA FINAL: no dar nada por hecho ─────────────────────────────────────
do $ver$
declare
  v_objetivos text[] := array[
    'public._shop_reprice_line(uuid, jsonb)',
    'public.shop_item_config(text, uuid)',
    'public.shop_hub_by_slug(text)',
    'public._shop_account_free_gift(uuid)',
    'public._shop_brand_free_gift(uuid, uuid)',
    'public.place_shop_order(text, jsonb, boolean)'
  ];
  v_obj text;
  v_def text;
begin
  if to_regprocedure('public.menu_item_vendible_en_alguna_parte(uuid)') is null then
    raise exception 'El ayudante no quedo creado con la firma esperada';
  end if;

  foreach v_obj in array v_objetivos loop
    v_def := pg_get_functiondef(v_obj::regprocedure);
    if position('mi.is_available is not false' in v_def) > 0 then
      raise exception 'VERIFICACION: % sigue leyendo el espejo global', v_obj;
    end if;
    if position('menu_item_vendible_en_alguna_parte(mi.id)' in v_def) = 0 then
      raise exception 'VERIFICACION: % no quedo con la puerta nueva', v_obj;
    end if;
  end loop;

  raise notice 'VERIFICACION OK: las 6 puertas de la tienda usan la regla nueva';
end
$ver$;

commit;

-- ── Comprobaciones DESPUES de aplicar (pegar el resultado, no el resumen) ────
--
-- 1) Ninguna funcion de la tienda lee ya el espejo:
-- select p.proname
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('_shop_reprice_line','shop_item_config','shop_hub_by_slug',
--                      '_shop_account_free_gift','_shop_brand_free_gift','place_shop_order')
--    and pg_get_functiondef(p.oid) like '%mi.is_available is not false%';
--    -- esperado: CERO filas.
--
-- 2) Las 125 fichas que mentian ya son vendibles para la tienda:
-- select count(*) from menu_item mi
--  where mi.archived_at is null and mi.is_active is not false
--    and mi.mirror_of_item_id is null
--    and mi.is_available = false
--    and public.menu_item_vendible_en_alguna_parte(mi.id) = true;
--    -- esperado el 29/08: 125. Si sale menos, es que alguien reactivo a mano.
--
-- 3) Un producto agotado en TODOS los locales sigue bloqueado (la regla no se
--    ha vuelto permisiva de mas):
-- select count(*) from menu_item mi
--  where mi.archived_at is null
--    and public.menu_item_vendible_en_alguna_parte(mi.id) = false;
--    -- esperado: los agotados globales + los agotados en todos los locales.
