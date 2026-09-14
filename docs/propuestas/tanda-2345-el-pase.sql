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


-- ═══ 0 · LOS DOS RELOJES · VAN ANTES QUE NADA ══════════════════════════════
--
-- 🔴 `ADD COLUMN` TOMA ACCESS EXCLUSIVE, y una petición de ACCESS EXCLUSIVE no
-- se limita a esperar: SE PONE EN LA COLA Y BLOQUEA A TODO EL QUE LLEGUE
-- DETRÁS, aunque los de detrás sólo quieran leer. Si a las 23:45 hay algo
-- tocando `kitchen_time_config` --un cron, un informe, una sesión olvidada
-- abierta-- el ADD COLUMN espera, y detrás de él se apila el camino del pedido
-- entero: esa tabla la leen `tg_auto_print_on_accept` y
-- `tg_auto_print_bag_on_ready`.
--
-- Con esto, si no consigue el cerrojo en tres segundos la migración SE CAE
-- SOLA y no ha pasado nada. Un fallo limpio que se reintenta a las 00:15 es
-- infinitamente mejor que un minuto de cocina parada esperando.
set local lock_timeout = '3s';

-- Y un techo por SENTENCIA --no es un presupuesto para la tanda entera: cada
-- sentencia tiene sus 60 s, y los bloques `do $ensayo$` cuentan como una--.
-- Sesenta segundos sobran de largo para cuatro piezas y ocho ensayos. Si algo
-- tarda más, es que algo va mal y cortar es la respuesta correcta.
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
-- `pg_settings` da el número en la unidad base, sin normalizar y sin adornos,
-- así que no hay cadena que adivinar. Y el mensaje dice los DOS valores reales:
-- si algún día salta, el parte trae el diagnóstico puesto.
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
-- tres segundos, lo recoge su `exception` y sale como SIN ENSAYAR. Que es
-- exactamente lo que tiene que pasar: antes sin ensayar que peleándose con la
-- tablet por una fila en plena cocina.


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
           -- EL REPARTIDOR · los tres campos del §4 de la enmienda del 14/09.
           --
           -- 🔴 De los tres, sólo UNO es un dato que faltaba: el teléfono.
           -- `repartidor_nombre` ya viajaba (se llamaba `rider_nombre`) y
           -- `quien_lo_lleva` NO es un dato, es una FRASE derivada de canal +
           -- `service_type` + `carrier_code` --los tres ya van aquí en crudo--
           -- así que se arma en `quienLoLleva()` y no se escribe también aquí:
           -- la misma regla en dos sitios es una regla que un día dice dos
           -- cosas. Es el mismo motivo por el que los minutos no se calculan
           -- en esta función. Si Julio prefiere la frase en la base, se mueve
           -- entera, no se duplica.
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




-- ═══ ANTES DE TOCAR NADA · LA MITAD «ANTES» DE LA MEDICIÓN ═════════════════
--
-- 🔴 VA AQUÍ ARRIBA, ANTES DE LAS CUATRO PIEZAS, Y NO ES UN CAPRICHO DE ORDEN.
-- El ensayo E dice «`kds_board` devuelve lo mismo que antes». Para que eso
-- signifique algo, el «antes» tiene que tomarse con la función VIEJA todavía
-- puesta. Mi primer borrador medía las dos mitades en el mismo bloque, después
-- del `create or replace`: eso compara la función nueva consigo misma y sale
-- verde siempre. Un «no he roto nada» sin dos cifras tomadas con la misma vara
-- a los dos lados es una opinión (regla 33).
create temp table _pase_antes on commit drop as
select l.id as location_id, l.name as local,
       (select d.token from kds_device d
         where d.location_id = l.id and d.is_active order by d.label limit 1) as token,
       jsonb_array_length(coalesce(
         public.kds_board(l.id, (select d.token from kds_device d
                                  where d.location_id = l.id and d.is_active
                                  order by d.label limit 1)) -> 'tickets', '[]'::jsonb)) as tickets
  from locations l
 where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and exists (select 1 from kds_device d where d.location_id = l.id and d.is_active);


-- ═══ EL ENSAYO · A–H · EJECUTABLE, DENTRO DE LA MIGRACIÓN ══════════════════
--
-- Va al final del mismo fichero que aplica las cuatro piezas, así que corre
-- DENTRO de su transacción: si algo no cuadra, `raise exception` se lleva por
-- delante la migración entera y no queda nada a medias.
--
-- 🔴 LOS QUE PLANTAN ALGO LO DESHACEN SOLOS. Un `begin … exception` de plpgsql
-- abre un punto de retorno implícito: se planta, se mira, y un `raise` propio
-- devuelve la tabla a como estaba sin tocar el resto de la migración. Mismo
-- patrón que el ensayo de la llave de Meta de esta mañana.
--
-- 🔴 NO SE ESCRIBE NINGÚN TOKEN EN NINGÚN SITIO. Se leen de `kds_device` dentro
-- del bloque y no salen en ningún mensaje, ni siquiera en los de error.

do $ensayo$
declare
  CUENTA    constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint
  PLANTILLA constant uuid := '00000000-0000-0000-0000-000000000001';  -- catálogo del sistema
  ALCALA    constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_tok_pase text; v_tok_cocina text; v_tok_ambas text;
  v_b jsonb; v_papel text; v_n int; v_venta uuid; v_tel text;
  v_fallos text[] := '{}';
begin
  select token into v_tok_pase   from kds_device
   where account_id = CUENTA and label = 'Pase'   and location_id = ALCALA;
  select token into v_tok_cocina from kds_device
   where account_id = CUENTA and label = 'Cocina' and location_id = ALCALA;
  select token into v_tok_ambas  from kds_device
   where account_id = CUENTA and label = 'Tablet camichi4';

  if v_tok_pase is null or v_tok_cocina is null or v_tok_ambas is null then
    raise exception 'ENSAYO: faltan aparatos. Medido hoy: Alcalá tiene «Pase» '
                    '(1 estación expo) y «Cocina» (1 prep), y Carabanchel '
                    '«Tablet camichi4» (0 estaciones). Si esto falla es que el '
                    'mapa de tablets ha cambiado, y entonces el ensayo B ya no '
                    'dice lo que cree decir.';
  end if;

  -- ── A · ALCANCE POR CUENTA ──────────────────────────────────────────────
  --
  -- 🔴 MEDIDO ANTES DE ESCRIBIR ESTO: hoy NINGÚN local tiene ventas de más de
  -- una cuenta (cero locales con `count(distinct account_id) > 1` en 90 días).
  -- O sea que un ensayo que sólo CONTASE tarjetas ajenas daría verde sin haber
  -- probado nada, porque no hay nada que pueda escaparse todavía. Eso es una
  -- prueba espejo y la regla 31 no la admite.
  --
  -- Así que se PLANTA: se le cambia la cuenta a una venta viva de Alcalá y se
  -- exige que desaparezca. Si `pase_board` filtrara sólo por local --que es lo
  -- que hacía mi primer borrador-- seguiría saliendo y el ensayo se cae.
  v_b := public.pase_board(v_tok_pase);
  select count(*) into v_n
    from jsonb_array_elements(v_b -> 'tarjetas') t
   where not exists (select 1 from sale s
                      where s.id = (t ->> 'sale_id')::uuid and s.account_id = CUENTA);
  if v_n > 0 then v_fallos := v_fallos || format('A1: %s tarjetas de otra cuenta', v_n); end if;

  select (t ->> 'sale_id')::uuid into v_venta from jsonb_array_elements(v_b -> 'tarjetas') t limit 1;
  if v_venta is null then
    -- No es un fallo: puede no haber pedido vivo. Pero se DICE, en vez de dar
    -- por ensayado lo que no se ha ensayado (regla 32).
    raise notice 'ENSAYO A2 · SIN ENSAYAR: no había ninguna tarjeta viva que plantar.';
  else
    begin
      update sale set account_id = PLANTILLA where id = v_venta;
      if exists (select 1 from jsonb_array_elements(public.pase_board(v_tok_pase) -> 'tarjetas') t
                  where (t ->> 'sale_id')::uuid = v_venta) then
        v_fallos := v_fallos || 'A2: una venta de OTRA cuenta sigue saliendo en el tablero';
      end if;
      raise exception 'DESHACER_A2';
    exception when others then
      if sqlerrm <> 'DESHACER_A2' then v_fallos := v_fallos || ('A2 sin ensayar: ' || sqlerrm); end if;
    end;
  end if;

  -- ── B · EL PAPEL, de `kitchen_station.kind`. Cero campos nuevos. ─────────
  v_papel := public.pase_board(v_tok_pase)   ->> 'papel';
  if v_papel <> 'pase'   then v_fallos := v_fallos || ('B: «Pase» da ' || v_papel); end if;
  v_papel := public.pase_board(v_tok_cocina) ->> 'papel';
  if v_papel <> 'cocina' then v_fallos := v_fallos || ('B: «Cocina» da ' || v_papel); end if;
  v_papel := public.pase_board(v_tok_ambas)  ->> 'papel';
  if v_papel <> 'ambas'  then v_fallos := v_fallos || ('B: camichi4 da ' || v_papel); end if;

  -- ── C · EL INTERRUPTOR NACE APAGADO, y el tablero lo dice ───────────────
  select count(*) into v_n from kitchen_time_config where coalesce(pase_activo, false);
  if v_n > 0 then v_fallos := v_fallos || format('C: %s locales nacen ENCENDIDOS', v_n); end if;
  if (public.pase_board(v_tok_pase) ->> 'pase_activo') <> 'false' then
    v_fallos := v_fallos || 'C: el tablero dice que está encendido';
  end if;

  -- ── D · SIN LLAVES NI DATOS DE MÁS ──────────────────────────────────────
  --
  -- 🔴 LA RAYA SE HA ESTRECHADO, porque ahora SÍ sale un teléfono: el del
  -- repartidor, que es de casa. No basta con mirar el nombre del campo. Se
  -- compara el VALOR del teléfono del cliente contra el texto entero del
  -- jsonb, así que si se colara bajo otra etiqueta, el ensayo se cae igual.
  v_b := public.pase_board(v_tok_pase);
  for v_venta, v_tel in
    select s.id, s.customer_phone from sale s
     where s.id in (select (t ->> 'sale_id')::uuid from jsonb_array_elements(v_b -> 'tarjetas') t)
       and nullif(trim(s.customer_phone), '') is not null
  loop
    if v_b::text like '%' || v_tel || '%' then
      v_fallos := v_fallos || 'D: el teléfono del CLIENTE viaja en el tablero';
      exit;
    end if;
  end loop;
  if v_b::text ~ 'delivery_address|public_token|customer_phone|"token"' then
    v_fallos := v_fallos || 'D: el jsonb trae dirección, token o teléfono de cliente';
  end if;

  -- ── H · EL REPARTIDOR, contra la población real ─────────────────────────
  --
  -- Medido hoy, 14 días: 231 repartos propios con flota, los 231 con nombre Y
  -- teléfono, cero excepciones; y 0 de 1.424 de plataforma con cualquiera de
  -- los dos. Aquí se exige lo mismo sobre lo que salga vivo.
  select count(*) into v_n from jsonb_array_elements(v_b -> 'tarjetas') t
   where coalesce((t ->> 'has_courier')::boolean, false)
     and (nullif(trim(t ->> 'repartidor_nombre'), '') is null
          or nullif(trim(t ->> 'repartidor_telefono'), '') is null);
  if v_n > 0 then v_fallos := v_fallos || format('H: %s con flota y sin nombre o sin teléfono', v_n); end if;

  select count(*) into v_n from jsonb_array_elements(v_b -> 'tarjetas') t
   where coalesce(t ->> 'service_type', '') like '%platform%'
     and (nullif(trim(t ->> 'repartidor_nombre'), '') is not null
          or nullif(trim(t ->> 'repartidor_telefono'), '') is not null);
  if v_n > 0 then v_fallos := v_fallos || format('H: %s de plataforma con repartidor inventado', v_n); end if;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYO A-D/H: %', array_to_string(v_fallos, ' · ');
  end if;
  raise notice 'ENSAYO A-D/H: en verde.';
end
$ensayo$;


-- ═══ 🔴 QUÉ SALE DE LA TRANSACCIÓN · MEDIDO EL 14/09 ANTES DE APLICAR ══════
--
-- F y G mueven el ESTADO de una venta por el camino real, y ese camino dispara
-- cosas que podrían salirse de la base. Si algo sale, el `rollback` no lo trae
-- de vuelta: un ticket de bolsa impreso en Alcalá, o un «listo» dicho a Glovo,
-- no se deshacen. Así que se comprobó, no se supuso.
--
-- 1 · NO EXISTE NINGUNA VÍA SÍNCRONA DE SALIR. Hay DIEZ extensiones instaladas
--     --pg_cron, pg_net, pg_stat_statements, pg_trgm, pgcrypto, plpgsql,
--     postgis, supabase_vault, unaccent y uuid-ossp-- y de las diez, la única
--     que sale afuera es `pg_net` 0.20.0. Ni `http`, ni `dblink`, ni
--     `pg_background`. (Mi parte de las 19:45 decía «sólo está instalada
--     pg_net», que es otra cosa y es falsa: están las diez.) Y CERO
--     funciones en toda la base --de cualquier esquema-- llaman a un
--     `http_post(` o `http_get(` que no sea `net.`. Todo lo que sale, sale
--     encolado.
--
--     (Mi primera regex daba las dos de `pg_net` como síncronas: `[^a-z_]`
--     admitía el punto de `net.`, así que `net.http_post(` casaba. El mismo
--     fallo de regex de por la mañana con el conteo de llamadas. Excluido el
--     punto, la cifra de verdad es 0.)
--
-- 2 · UN `pg_net` ENCOLADO Y REVERTIDO NO SALE. Ensayado con testigo a los dos
--     lados, mismo mecanismo y misma forma de URL:
--
--       revertido (dentro de un punto de retorno) → 0 en la cola, 0 respuestas
--       testigo   (sin revertir)                  → salió: respuesta id 145336
--
--     La ausencia sólo significa algo porque el testigo sí dejó fila. Sin él,
--     un cero no distingue «no salió» de «no se encoló nunca».
--
-- 3 · LAS DOS QUE SALEN EN ESTE CAMINO, y salen las dos por `pg_net`:
--       · `trg_sale_push_status` — su condición es exactamente
--         `old.order_status is distinct from new.order_status`, o sea que F y G
--         LA DISPARAN. Revertida, no sale.
--       · `tg_auto_print_bag_on_ready` — mira `awaiting_collection` y encola en
--         `print_job`. Es un `insert` normal: otra sesión no puede leer una fila
--         sin confirmar, así que el agente de impresión no la ve.
--       · `tg_auto_dispatch` usa `pg_net` pero no menciona ninguno de los
--         estados de este camino: no se dispara aquí.
--
-- ⚠️ LO QUE SÍ SE SALE, Y NO ES UN DATO: EL CERROJO DE FILA. Mientras la
--    migración corre, la venta plantada queda bloqueada. Si la tablet intenta
--    tocar ESA venta en ese momento, espera a que terminemos. Son segundos y no
--    deja rastro, pero es el único efecto que un `rollback` no borra, y por eso
--    F y G plantan sobre UNA venta, la primera del tablero, y no sobre varias.
--
-- ⚠️ Y ESTO NO AUTORIZA A ENSAYAR EN SERVICIO. La banda acaba a las 23:45
--    justo porque a esa hora puede quedar gente cocinando. Que el ensayo sea
--    reversible no lo hace invisible.

-- ═══ ENSAYO E · F · G · el tablero de cocina y el sello ════════════════════
--
-- 🔴 `kds_board` TOMA DOS ARGUMENTOS: `(p_location_id uuid, p_device_token text)`.
-- Mi primer borrador lo llamaba con uno y se habría caído con un 42883 a las
-- 23:45, con la banda encima. Comprobado contra `pg_proc` antes de escribirlo,
-- que es lo que había que haber hecho la primera vez.
do $ensayo_efg$
declare
  ALCALA constant uuid := '38158159-cd71-4056-950b-53425afac1ce';
  v_tok_cocina text; v_venta uuid; v_n int; v_antes int; v_local text;
  v_fallos text[] := '{}';
begin
  select token into v_tok_cocina from kds_device where label = 'Cocina' and location_id = ALCALA;

  -- ── E · APAGADO, LOS MISMOS TICKETS QUE ANTES ───────────────────────────
  -- Las dos mitades, con la misma vara: `_pase_antes` se llenó arriba con la
  -- función vieja; esto vuelve a contar con la nueva, local por local.
  for v_local, v_antes, v_n in
    select a.local, a.tickets,
           jsonb_array_length(coalesce(public.kds_board(a.location_id, a.token) -> 'tickets', '[]'::jsonb))
      from _pase_antes a
  loop
    if v_n is distinct from v_antes then
      v_fallos := v_fallos || format('E: %s tenía %s tickets y ahora %s, con el Pase APAGADO',
                                     v_local, v_antes, v_n);
    else
      raise notice 'ENSAYO E · %: % tickets antes y % después.', v_local, v_antes, v_n;
    end if;
  end loop;

  -- ── F y G · SE ENSAYAN POR EL CAMINO, NO POR LA FÓRMULA ─────────────────
  --
  -- Regla 10: la pregunta no es «¿sale el número?» sino «¿quién escribe esto y
  -- qué le pasa a esa escritura?». Así que no se planta `ready_at` a mano: se
  -- mueve el ESTADO, que es lo que hace la tablet, y se mira qué sella el
  -- disparador. `sale` es el camino del pedido en persona, y por eso todo esto
  -- va dentro de un punto de retorno y la tanda entera espera a las 23:45.
  select (t ->> 'sale_id')::uuid into v_venta
    from jsonb_array_elements(public.kds_board(ALCALA, v_tok_cocina) -> 'tickets') t
   limit 1;

  if v_venta is null then
    raise notice 'ENSAYO F y G · SIN ENSAYAR: el tablero de cocina de Alcalá está '
                 'vacío ahora mismo. Hay que volver a pasarlos con el local en '
                 'servicio: medido hoy a las 19:00, Alcalá tenía 0 tickets y '
                 'Carabanchel 1, así que esto puede pasar de verdad.';
  else
    begin
      -- El camino de verdad: marcar listo desde la tablet.
      update sale set order_status = 'awaiting_collection' where id = v_venta;
      if (select ready_at from sale where id = v_venta) is null then
        v_fallos := v_fallos || 'G: marcar listo NO sella `ready_at`';
      end if;

      -- F, apagado: sellado y todo, sigue en cocina porque el Pase no está.
      if not exists (select 1 from jsonb_array_elements(public.kds_board(ALCALA, v_tok_cocina) -> 'tickets') t
                      where (t ->> 'sale_id')::uuid = v_venta) then
        v_fallos := v_fallos || 'F: con el Pase APAGADO un pedido sellado ya desaparece de cocina';
      end if;

      -- F, encendido: la expo deja de ser la única salida.
      update kitchen_time_config set pase_activo = true where location_id = ALCALA;
      if exists (select 1 from jsonb_array_elements(public.kds_board(ALCALA, v_tok_cocina) -> 'tickets') t
                  where (t ->> 'sale_id')::uuid = v_venta) then
        v_fallos := v_fallos || 'F: con el Pase ENCENDIDO un pedido sellado sigue en cocina';
      end if;
      update kitchen_time_config set pase_activo = false where location_id = ALCALA;

      -- G, la vuelta: reabrir borra el sello y el pedido regresa al tablero.
      update sale set order_status = 'in_preparation' where id = v_venta;
      if (select ready_at from sale where id = v_venta) is not null then
        v_fallos := v_fallos || 'G: reabrir NO borra el sello, y el pedido no vuelve a cocina';
      end if;

      raise exception 'DESHACER_FG';
    exception when others then
      if sqlerrm <> 'DESHACER_FG' then v_fallos := v_fallos || ('F/G sin ensayar: ' || sqlerrm); end if;
    end;
  end if;

  if array_length(v_fallos, 1) > 0 then
    raise exception 'ENSAYO E-G: %', array_to_string(v_fallos, ' · ');
  end if;
  raise notice 'ENSAYO E-G: en verde.';
end
$ensayo_efg$;


-- ═══ LO QUE ESTE ENSAYO NO PRUEBA, DICHO ═══════════════════════════════════
--
--  · A2, F y G sólo corren si a las 23:45 hay pedidos vivos. Si no los hay,
--    avisan por `notice` con las palabras SIN ENSAYAR, y eso se pega en el
--    parte tal cual: no se da por bueno lo que no se ha probado.
--  · E compara CUÁNTOS tickets, no cuáles. Con el interruptor apagado la
--    condición nueva ni se evalúa, así que el número basta; el día que se
--    encienda de verdad hay que comparar identificadores.
--  · Nada de esto prueba que la tablet pinte bien. Eso son la maqueta y las 33
--    pruebas de `lasTresZonas`, que no tocan la base.
