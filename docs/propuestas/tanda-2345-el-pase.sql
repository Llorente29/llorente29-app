-- ═══════════════════════════════════════════════════════════════════════════
-- TANDA DE LAS 23:45 · EL PASE · 14/09/2026 · NO APLICAR ANTES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🔴 FUERA DE `supabase/migrations/` A PROPÓSITO. Si estuviera ahí, la fusión a
-- `main` la aplicaría por CI a la hora que fuese. Se aplica a mano a las 23:45
-- y ENTONCES el fichero se mueve con su versión registrada.
--
-- CUATRO PIEZAS, y las cuatro esperan a la banda por la misma razón:
--
--   1. `pase_activo` en `kitchen_time_config` — ADD COLUMN toma ACCESS
--      EXCLUSIVE sobre una tabla que leen dos disparadores del camino del
--      pedido (`tg_auto_print_on_accept` y `tg_auto_print_bag_on_ready`).
--      Condición 2 de la banda, igual que el CHECK del 13/09.
--   2. `pase_board` — función nueva.
--   3. La condición de `kds_board` — lo llama el tablero de cocina, vivo.
--   4. La línea del sello — `tg_sale_seal_kpi_hitos` es un disparador BEFORE
--      sobre `sale`. Es el camino del pedido en persona.
--
-- Con el interruptor apagado las cuatro son inertes: `pase_activo` nace en
-- false, `pase_board` no la llama nadie, la condición de `kds_board` no se
-- evalúa y la línea del sello sólo actúa al reabrir, que no se ha hecho nunca
-- (0 de 10.719).


-- ═══ 1 · EL INTERRUPTOR ════════════════════════════════════════════════════
alter table public.kitchen_time_config
  add column if not exists pase_activo boolean not null default false;

comment on column public.kitchen_time_config.pase_activo is
  'El Pase, por local. Apagado = todo exactamente como antes del 14/09: vuelve '
  '«Pedidos» y vuelve la estación expo al tablero. Se enciende desde Ajustes, '
  'sin desplegar. Orden de encendido: Alcalá primero (dos tablets con papeles '
  'separados), Carabanchel después (una sola tablet lo hace todo).';


-- ═══ 2 · `pase_board` ══════════════════════════════════════════════════════
--
-- Del corte de `kds_board`: el token resuelve dispositivo → local → CUENTA.
--
-- 🔴 ALCANCE POR CUENTA, no sólo por local. Hoy con un cliente no se nota; con
-- el cliente 2 es la diferencia entre un fallo y un incidente. El ensayo lo
-- prueba con un token de una cuenta pidiendo lo de otra.
--
-- 🔴 NO DEVUELVE LA LLAVE DE NADA, ni dato de cliente que la pantalla no
-- pinte. Sale el NOMBRE del cliente --se lee en «Entregado a Javier»-- y NO su
-- teléfono ni su dirección, que el Pase no enseña. Lo mismo que se corrigió por
-- la mañana en la ficha de Instagram con el `ig_user_id`.
--
-- 🔴 Y NO CALCULA MINUTOS. Devuelve los instantes en crudo y el front elige
-- cuál mirar, porque el reloj que toca depende de la SITUACIÓN y la situación
-- se decide en `lasTresZonas.ts`. Calcularlos aquí obligaría a decidir la
-- situación dos veces.
create or replace function public.pase_board(p_device_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_device  kds_device;
  v_cuenta  uuid;
  v_local   uuid;
  v_nombre  text;
  v_papel   text;
  v_activo  boolean;
  v_res     jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_board: token de dispositivo no válido';
  end if;
  v_cuenta := v_device.account_id;
  v_local  := v_device.location_id;

  select l.name into v_nombre from locations l where l.id = v_local;

  -- EL PAPEL, del `kind` de las estaciones del aparato. Cero campos nuevos.
  --   expo → pase · prep → cocina · sin estación → ambas
  -- Una tablet con las dos clases asignadas hace las dos cosas, que es lo
  -- razonable y no hace falta inventarle una cuarta palabra.
  select case
           when v_device.station_ids is null
             or coalesce(array_length(v_device.station_ids, 1), 0) = 0 then 'ambas'
           when bool_and(k.kind = 'expo') then 'pase'
           when bool_and(k.kind = 'prep') then 'cocina'
           else 'ambas'
         end
    into v_papel
    from kitchen_station k
   where k.id = any(coalesce(v_device.station_ids, '{}'::uuid[]))
     and k.account_id = v_cuenta;
  v_papel := coalesce(v_papel, 'ambas');

  select coalesce(k.pase_activo, false) into v_activo
    from kitchen_time_config k where k.location_id = v_local;
  v_activo := coalesce(v_activo, false);

  with vivos as (
    select s.*
      from sale s
     where s.location_id = v_local
       and s.account_id  = v_cuenta          -- 🔴 por CUENTA, no sólo por local
       and s.sold_at >= now() - interval '12 hours'
       and coalesce(s.status, '') <> 'cancelled'
       -- Lo que se torció no se pinta en ninguna zona, así que no viaja.
       and coalesce(s.order_status, '') not in ('rejected', 'cancelled', 'delivery_failed')
       -- Y lo cerrado sólo si la flota dice que llegó hace poco, que es lo
       -- único que entra en «Entregados». El front recorta a 20 min.
       and (coalesce(s.order_status, '') <> 'completed'
            or s.delivered_at >= now() - interval '40 minutes'
            or s.delivery_state in ('in_delivery', 'picked_up'))
  ),
  bolsa as (
    select pj.sale_id,
           (array_agg(pj.status order by pj.created_at desc))[1]     as estado,
           max(pj.created_at)                                        as cuando,
           count(*) filter (where pj.status = 'error')::int           as fallidos
      from print_job pj
     where pj.sale_id in (select id from vivos) and pj.doc_type = 'bag'
     group by pj.sale_id
  )
  select jsonb_agg(jsonb_build_object(
           'sale_id',   v.id,
           'codigo',    coalesce(v.pos_short_code, v.platform_order_code),
           'marca',     b.name,
           'marca_logo_url', b.logo_url,
           'cliente',   v.customer_name,   -- se lee en «Entregado a X». Ni tel ni dirección.
           'channel',   coalesce(c.name, v.external_channel_text),
           'order_status',  v.order_status,
           'service_type',  v.service_type,
           'has_courier',   v.has_courier,
           'carrier_code',  v.carrier_code,
           'delivery_state', v.delivery_state,
           'rider_nombre',     v.rider_name,
           'rider_transporte', v.rider_transport_type,
           -- Los instantes en crudo: el reloj lo elige el front.
           'entro_at',   coalesce(v.opened_at, v.sold_at, v.created_at),
           'ready_at',   v.ready_at,
           'handed_to_courier_at', v.handed_to_courier_at,
           'delivered_at',         v.delivered_at,
           'lineas', coalesce((
             select jsonb_agg(jsonb_build_object('nombre', sl.product_name,
                                                 'cantidad', sl.quantity)
                              order by sl.created_at)
               from sale_line sl
              where sl.sale_id = v.id and sl.parent_sale_line_id is null
                and coalesce(sl.line_type, '') <> 'modifier'), '[]'::jsonb),
           'bolsa', jsonb_build_object(
             'estado', case
                         when bo.sale_id is null then 'sin_pedir'
                         when bo.estado = 'done'  then 'hecha'
                         when bo.estado = 'error' then 'rota'
                         else 'esperando' end,
             'cuando',  to_char(bo.cuando at time zone 'Europe/Madrid', 'HH24:MI'),
             'intentos', coalesce(bo.fallidos, 0)),
           -- CÓMO AVANZÓ. Hoy sólo se puede distinguir «lo movió la flota» de
           -- «lo marcó una persona»: ver la nota de abajo.
           'avanzo_por', case
                           when v.delivery_state is not null then 'flota'
                           when v.ready_at is not null       then 'persona'
                           else null end,
           'avanzo_quien', null
         ) order by coalesce(v.opened_at, v.sold_at, v.created_at))
    into v_res
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel c on c.id = v.channel_id
    left join bolsa bo on bo.sale_id = v.id;

  return jsonb_build_object(
    'local',       v_nombre,
    'papel',       v_papel,
    'pase_activo', v_activo,
    'ahora',       now(),
    'tarjetas',    coalesce(v_res, '[]'::jsonb));
end;
$fn$;

revoke all on function public.pase_board(text) from public;
grant execute on function public.pase_board(text) to anon, authenticated, service_role;
-- anon y authenticated: igual que `kds_board` y `device_location_by_token`. La
-- tablet no tiene sesión; su frontera es el token, que resuelve la función.


-- ═══ 🔴 UNA COSA QUE LA MAQUETA PROMETÍA Y LA BASE NO PUEDE DAR ════════════
--
-- La maqueta enseñaba «Listo por Marta · 21:29». **No se puede.**
--
-- Medido: `sale` sólo tiene `created_by` y `created_by_name`, que son quién
-- CREÓ la venta --el webhook, casi siempre-- no quién pulsó «Listo».
-- `set_order_status` y `set_order_status_by_token` no escriben actor ninguno, y
-- el token de la tablet identifica al APARATO, no a la persona: en el pase de
-- Alcalá pulsan varias personas con el mismo token.
--
-- Así que `avanzo_quien` sale NULL y la tarjeta dirá «Listo», sin nombre. No se
-- inventa un «por Marta» que no sabemos, que es justo lo que llevamos todo el
-- día quitando de las pantallas.
--
-- Lo que sí se distingue hoy, y se manda:
--   · 'flota'   → lo movió el broker (hay `delivery_state`)
--   · 'persona' → hay sello y no hay flota: lo pulsó alguien, sin saber quién
--   · 'foto'    → el hueco de la visión artificial, que NO se construye ahora
--
-- Para que diga el nombre haría falta o una sesión por persona en la tablet o
-- una columna de actor en la venta. **Las dos son encargo aparte y ninguna
-- entra aquí.**


-- ═══ 3 · `kds_board` · la expo deja de ser la única salida ══════════════════
-- Ver `docs/propuestas/kds_board-sin-expo.sql` para el razonamiento entero.
-- Aquí va sólo el cambio: una condición más en el CTE `vivos`, colgada del
-- interruptor, que pregunta por el SELLO y no repite la lista de estados.
--
--   +     and (
--   +       s.ready_at is null
--   +       or not coalesce((select k2.pase_activo from kitchen_time_config k2
--   +                         where k2.location_id = v_location_id), false)
--   +     )


-- ═══ 4 · LA LÍNEA DEL SELLO ════════════════════════════════════════════════
-- En `tg_sale_seal_kpi_hitos`, después de sellar `ready_at`:
--
--   +   -- Al volver a cocina se borra el sello: `kds_board` pregunta por
--   +   -- `ready_at`, no por el estado, así que sin esto un pedido reabierto no
--   +   -- vuelve al tablero. El botón «Reabrir» existe y se pinta
--   +   -- (OrderCard.tsx:757). Nunca se ha pulsado --0 de 10.719-- y por eso
--   +   -- nadie lo ha notado.
--   +   -- Y es correcto por sí mismo: un pedido que vuelve a cocina no tiene
--   +   -- cumplido el hito de cocina, y el cronómetro no puede medir desde un
--   +   -- «listo» que ya no vale.
--   +   if new.order_status in ('new','received','accepted','in_preparation')
--   +      and old.order_status is distinct from new.order_status
--   +      and new.ready_at is not null then
--   +     new.ready_at := null;
--   +   end if;


-- ═══ EL ENSAYO ═════════════════════════════════════════════════════════════
--
-- Dentro de la migración, contra la población REAL y todo revertido:
--
--  A · 🔴 ALCANCE POR CUENTA. Con el token de una tablet de Foodint, ninguna
--      tarjeta de otra cuenta. Se comprueba contando ventas del mismo local en
--      otras cuentas y exigiendo que no salga ni una.
--  B · EL PAPEL. Token de «Pase» (Alcalá) → 'pase'. Token de «Cocina» → 'cocina'.
--      Token de camichi4 (sin estación) → 'ambas'. Los tres, medidos hoy.
--  C · EL INTERRUPTOR. `pase_activo` false en los tres locales al aplicar, y
--      `pase_board` lo devuelve false. Nada se enciende solo.
--  D · SIN LLAVES NI DATOS DE MÁS: el jsonb no contiene `customer_phone`,
--      `delivery_address`, `public_token` ni nada con forma de secreto.
--  E · `kds_board` CON EL INTERRUPTOR APAGADO devuelve los MISMOS tickets que
--      antes, para Alcalá y para Carabanchel. Mismos números a los dos lados.
--  F · Y ENCENDIDO: un pedido con sello y sin expo marcada ya no sale.
--  G · EL SELLO: reabrir borra `ready_at`; marcar listo lo vuelve a poner.
