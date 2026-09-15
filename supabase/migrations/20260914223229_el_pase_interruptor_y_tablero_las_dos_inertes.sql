-- ═══════════════════════════════════════════════════════════════════════════
-- EL PASE · PIEZAS 1 Y 2 · las dos inertes
-- Aplicada el 15/09/2026 a las 00:30 de Madrid, FUERA de la banda.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🔴 ESTA TANDA ES LA MITAD DE LA ESCRITA. Van sólo las dos piezas que no
-- tocan el camino del pedido:
--
--   1. `pase_activo` — columna nueva, nace en false, no la lee nadie.
--   2. `pase_board`  — función nueva, no la llama nadie.
--
-- Y NO van la condición de `kds_board` ni la línea del sello, porque su ensayo
-- no se puede correr: el tablero de cocina de Alcalá tiene CERO tickets a esta
-- hora, así que el ensayo E compararía cero contra cero. Eso no es verde: es
-- SIN ENSAYAR, y no se aplica al camino del pedido una pieza cuya única prueba
-- fue una comparación vacía. Esperan a mañana con tickets delante.
--
-- Por lo mismo, aquí van los ensayos A, B, C, D y H. El E, el F y el G viajan
-- con las piezas que prueban.
--
-- La hora: el `ADD COLUMN` toma ACCESS EXCLUSIVE sobre `kitchen_time_config`,
-- que leen dos disparadores del camino del pedido. Alcalá cerró a las 14:34 y
-- Carabanchel despachó su última venta a las 23:27. Éste es el momento más
-- tranquilo del día para tomar ese cerrojo.

-- ═══ 0 · LOS DOS RELOJES · VAN ANTES QUE NADA ══════════════════════════════
--
-- 🔴 `ADD COLUMN` TOMA ACCESS EXCLUSIVE, y una petición de ACCESS EXCLUSIVE no
-- se limita a esperar: SE PONE EN LA COLA Y BLOQUEA A TODO EL QUE LLEGUE
-- DETRÁS, aunque los de detrás sólo quieran leer. Si hay algo tocando
-- `kitchen_time_config` --un cron, un informe, una sesión olvidada abierta--
-- el ADD COLUMN espera, y detrás de él se apila el camino del pedido entero:
-- esa tabla la leen `tg_auto_print_on_accept` y `tg_auto_print_bag_on_ready`.
--
-- Con esto, si no consigue el cerrojo en tres segundos la migración SE CAE
-- SOLA y no ha pasado nada. Un fallo limpio que se reintenta es infinitamente
-- mejor que un minuto de cocina parada esperando.
set local lock_timeout = '3s';

-- Y un techo por SENTENCIA --no es un presupuesto para la tanda entera: cada
-- sentencia tiene sus 60 s, y los bloques `do $ensayo$` cuentan como una--.
set local statement_timeout = '60s';

-- 🔴 Y UNA GUARDIA, PORQUE UN `set local` FUERA DE TRANSACCIÓN NO FALLA: suelta
-- un aviso y no hace nada. O sea que la protección podría no estar puesta y la
-- migración seguir adelante tan contenta --éxito silencioso de los de la regla
-- 8-- y, peor, sin transacción no hay vuelta atrás y los ensayos que plantan
-- DEJARÍAN LA PLANTA PUESTA. Esto lo convierte en un fallo ruidoso.
--
-- 🔴 Y SE COMPARA EN MILISEGUNDOS, NO EN CADENAS. Mi primera versión comparaba
-- `current_setting(...) <> '60s'` y se habría disparado LAS 100 VECES DE 100,
-- abortando la tanda entera sin que nada estuviera mal. Postgres NORMALIZA el
-- valor al guardarlo y pasa a minutos en cuanto es múltiplo de 60 s:
--
--     escribes '3s'  → devuelve '3s'      escribes '60s' → devuelve '1min'
--
--   y no depende del parámetro: `lock_timeout = '60s'` también devuelve
--   '1min', y `statement_timeout = '3s'` devuelve '3s'. Medido las cuatro
--   combinaciones. Yo comprobé la normalización de UNO de los dos y escribí la
--   conclusión para los dos.
--
-- Ensayada por sus dos lados antes de darla por buena, que es la única forma
-- que prueba algo (regla 36): con `lock_timeout` a 5 s salta y dice
-- «lock=5000 ms, statement=60000 ms»; con los dos bien, pasa.
do $guardia$
declare
  v_lock int := (select setting::int from pg_settings where name = 'lock_timeout');
  v_stmt int := (select setting::int from pg_settings where name = 'statement_timeout');
begin
  if v_lock <> 3000 or v_stmt <> 60000 then
    raise exception 'GUARDIA: los relojes no han prendido (lock=% ms, statement=% ms). '
                    'Si un `set local` no prende es que esto NO corre dentro de una '
                    'transacción — y sin transacción no hay relojes, no hay vuelta '
                    'atrás y los ensayos que plantan dejarían la planta puesta. '
                    'NO SEGUIR.', v_lock, v_stmt;
  end if;
end
$guardia$;

-- 🔴 EL `lock_timeout` SE QUEDA PUESTO PARA TODA LA TRANSACCIÓN, y es a
-- propósito. Los ensayos que plantan toman cerrojo de fila sobre una venta
-- viva; si la tablet la tiene cogida en ese instante, el ensayo se cae a los
-- tres segundos, lo recoge su `exception` y sale como SIN ENSAYAR.


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
-- prueba plantando una venta de otra cuenta y exigiendo que desaparezca.
--
-- 🔴 NO DEVUELVE LA LLAVE DE NADA, ni dato de cliente que la pantalla no
-- pinte. Sale el NOMBRE del cliente --se lee en «Entregado a Javier»-- y NO su
-- teléfono ni su dirección, que el Pase no enseña.
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
       --
       -- 🔴 OJO CON LO QUE ESTA RAYA DEJA FUERA, y es a propósito: una venta
       -- `completed` con `delivery_state = 'delivered'` pero SIN `delivered_at`
       -- no viaja, porque `null >= now() - interval` es null y null no pasa.
       -- Medido: hay 43 así --41 con `delivered` y 2 con `finish`-- y LAS 43
       -- no tienen ni entrega, ni sello, ni handoff.
       --
       -- 🔴 Y NO SON UN GOTEO: son la semana en que se encendió el sello.
       -- Todas están entre el 06/07 y el 24/07, todas en Alcalá y todas de
       -- reparto nuestro con repartidor puesto. El sello no existía --0 de 101,
       -- 0 de 80, 0 de 95, 0 de 121--, aparece la semana del 20/07 con 32 de
       -- 111, y esa misma semana concentra 39 de los 43. Desde el 27/07, CERO,
       -- siete semanas seguidas. Está extinto. Mandarlas hoy sería pintar
       -- «Entregado» sin ninguna hora de un pedido de julio.
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
           -- EL REPARTIDOR · los tres campos del §4 de la enmienda del 14/09.
           --
           -- 🔴 De los tres, sólo UNO era un dato que faltaba: el teléfono.
           -- `repartidor_nombre` ya viajaba y `quien_lo_lleva` NO es un dato,
           -- es una FRASE derivada de canal + `service_type` + `carrier_code`
           -- --los tres ya van aquí en crudo-- así que se arma en
           -- `quienLoLleva()` y no se escribe también aquí: la misma regla en
           -- dos sitios es una regla que un día dice dos cosas.
           --
           -- 🔴 Y es el teléfono del REPARTIDOR, que es de casa. Medido en 14
           -- días: 231 repartos propios con flota, los 231 con nombre Y
           -- teléfono; 0 con flota y sin nombre; 0 con nombre y sin flota. De
           -- 1.424 pedidos de plataforma, CERO traen repartidor.
           'repartidor_nombre',     v.rider_name,
           'repartidor_telefono',   v.rider_phone,
           'repartidor_transporte', v.rider_transport_type,
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
