-- docs/medidas/pedidos-tres-pestanas.sql
--
-- EL §5.4 DEL ENCARGO, EN UNA CONSULTA · 15/09/2026
--
-- «Una consulta demuestra que la suma de los tres contadores más Incidencias
-- es igual al total de pedidos abiertos del local.»
--
-- Esta es esa consulta, y es LA MISMA REGLA que `src/modules/orders/lib/
-- lasFases.ts` --mismo orden, mismas condiciones-- escrita en SQL para poder
-- comprobarla desde fuera de la aplicación. Si un día las dos dejan de decir lo
-- mismo, es que alguien cambió una y no la otra, y esta consulta lo canta.
--
-- 🔴 LO QUE CAMBIÓ RESPECTO AL ENCARGO, y por qué:
--
--  1. El ORDEN de las cuatro condiciones está fijado: la incidencia se
--     pregunta la primera. Sin fijarlo, un pedido cancelado Y cerrado cumple
--     dos fases y se cuenta dos veces. Medido sobre 1.709 ventas de 14 días:
--     SIETE pedidos están en ese cruce, y la suma del §5.4 fallaba por siete.
--
--  2. «Terminado» mira `status`, no `closed_at`. `closed_at` NO viaja en el
--     payload de `orders_feed` --la RPC lo lee en el `where` y no lo proyecta--
--     así que la pantalla no puede mirarlo. Sustituirlo por `status='closed'`
--     no mueve ni un pedido: de las 1.709, ocho discrepan y las ocho están
--     canceladas, o sea resueltas antes como incidencia.
--
--  3. La venta con `status='cancelled'` es incidencia aunque su
--     `order_status` diga `completed`. Son 5 en 14 días. Por la letra del
--     encargo irían a «Terminados», que le diría a quien mira que salieron
--     bien.
--
-- 🔴 Y LLEVA `account_id` (regla 9): la cuenta plantilla tiene locales con los
-- mismos nombres que producción.

-- El arranque del día de negocio, con el huso de la CUENTA (`accounts.timezone`,
-- con respaldo 'Europe/Madrid'), exactamente como lo calcula la RPC.
with dia as (
  select (date_trunc('day', (now() at time zone tz) - interval '4 hours')
            + interval '4 hours') at time zone tz as v_day_start
  from (select coalesce(a.timezone, 'Europe/Madrid') as tz
        from accounts a where a.id = '51ad1792-6629-4ef7-833a-b57b09a86710') t
), v as (
  select s.*,
    (s.order_status in ('cancelled','delivery_failed','rejected')
      or s.status = 'cancelled'
      or (s.status = 'open'
          and coalesce(s.opened_at, s.sold_at) < now() - interval '6 hours')) as f_inc,
    (s.status = 'closed' or s.order_status = 'completed')                     as f_term
  from sale s
  where s.account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and s.location_id = '38158159-cd71-4056-950b-53425afac1ce'
    -- 🔴 LA VENTANA DE LA OFICINA, COPIADA DE `orders_feed` Y NO APROXIMADA.
    -- El día de negocio arranca a las 04:00 del huso de la CUENTA, no a la
    -- medianoche: `c_business_day_cutoff_hours constant int := 4`, verificado
    -- contra `pg_proc` el 16/09. A las 00:05 del 16/09 el día de negocio sigue
    -- siendo el del 15, y cortar por medianoche se dejaba fuera el servicio
    -- entero de la noche.
    and coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= (select v_day_start from dia)
    and coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) <  (select v_day_start from dia) + interval '1 day'
), f as (
  select case when f_inc                 then 'incidencia'
              when f_term                then 'terminado'
              when ready_at is not null  then 'esperando'
              else                            'en_curso'
         end as fase,
         f_inc, f_term
  from v
)
select
  count(*) filter (where fase = 'en_curso')   as "En curso",
  count(*) filter (where fase = 'esperando')  as "Esperando repartidor",
  count(*) filter (where fase = 'terminado')  as "Terminados",
  count(*) filter (where fase = 'incidencia') as "Incidencias",
  count(*)                                    as "Total del día",
  -- 🔴 LA COMPROBACIÓN DE VERDAD. Que los cuatro sumen el total no prueba que
  -- sean excluyentes: dos errores que se compensan también suman (regla 33).
  -- Esto cuenta cuántos pedidos cumplen DOS condiciones a la vez y cuántos no
  -- cumplen ninguna. Los dos tienen que ser cero... salvo el cruce conocido,
  -- que sale aparte en la última columna.
  count(*) filter (where fase is null)        as "Sin fase (tiene que ser 0)",
  count(*) filter (where f_inc and f_term)    as "En el cruce (los resuelve el orden)"
from f;

-- ── DECIDIDO EL 15/09: EL RÓTULO DICE EL PERIODO. NO SE TOCA LA RPC ───────
--
-- En la TABLET la pestaña se llama «Terminados · últimas 2 h», porque eso es lo
-- que `orders_feed_by_token` trae:
--
--     or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at)
--          >= now() - interval '2 hours'
--
-- Medido el 15/09 a las 23:05 en Alcalá: 35 terminados en el día, 23 los que la
-- tablet descarga. No se ensancha la ventana: esa pestaña en el pase no es un
-- informe, sirve para encontrar el pedido por el que pregunta un repartidor que
-- acaba de llegar, y dos horas cubren eso de sobra. El día entero ya existe en
-- la oficina, que es donde se mira un día.
--
-- Y la regla 7 queda CUMPLIDA, no esquivada: lo que prohíbe es la pantalla que
-- parece completa sin serlo. Una que declara su alcance en el rótulo no esconde
-- filas.
--
-- Por tanto el §5.4 se comprueba SOBRE LO QUE CADA PANTALLA DECLARA CUBRIR:
-- arriba, el día de negocio (oficina); abajo, las dos horas (tablet).

with v as (
  select s.*,
    (s.order_status in ('cancelled','delivery_failed','rejected')
      or s.status = 'cancelled'
      or (s.status = 'open'
          and coalesce(s.opened_at, s.sold_at) < now() - interval '6 hours')) as f_inc,
    (s.status = 'closed' or s.order_status = 'completed')                     as f_term
  from sale s
  where s.account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and s.location_id = '38158159-cd71-4056-950b-53425afac1ce'
    -- La ventana de la TABLET, literal: lo abierto SIEMPRE, más lo tocado en
    -- las últimas 2 horas.
    and (s.status = 'open'
         or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at)
              >= now() - interval '2 hours')
), f as (
  select case when f_inc                 then 'incidencia'
              when f_term                then 'terminado'
              when ready_at is not null  then 'esperando'
              else                            'en_curso'
         end as fase, f_inc, f_term
  from v
)
select 'TABLET · últimas 2 h'                     as pantalla,
       count(*) filter (where fase = 'en_curso')   as "En curso",
       count(*) filter (where fase = 'esperando')  as "Esperando repartidor",
       count(*) filter (where fase = 'terminado')  as "Terminados · últimas 2 h",
       count(*) filter (where fase = 'incidencia') as "Incidencias",
       count(*)                                    as "Total que trae la RPC",
       count(*) filter (where f_inc and f_term)    as "En el cruce"
from f;

-- ── EL CABO SUELTO DEL §1b, CONTESTADO ────────────────────────────────────
--
-- «Si `closed_at` no viaja, ¿con qué campo se recorta *sólo del día en curso*?
-- Un pedido que entró anoche y se cerró hoy, ¿cae fuera?»
--
-- 🔴 NO CAE, y el motivo es que EL RECORTE NO LO HACE EL FRONT. `laFase` no
-- mira fechas: clasifica lo que le llega. Quien recorta es la RPC, y ahí
-- `closed_at` SÍ está disponible --se lee en el `where` aunque no se proyecte--.
-- El `where` de `orders_feed`, literal:
--
--        coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) >= v_day_start
--    and coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at) <  v_day_start + interval '1 day'
--
-- O sea: se recorta por el cierre, y sólo a falta de él por la cancelación, la
-- venta o la apertura. El pedido que entró anoche y cerró hoy tiene `closed_at`
-- de hoy y entra en el día de hoy. Es el orden correcto y ya estaba escrito así.
--
-- ✅ COMPROBADO EL 16/09, y la consulta de arriba ya lo lleva:
--
--     c_business_day_cutoff_hours constant int := 4;
--     v_day_start := (date_trunc('day', (now() at time zone v_tz) - v_cutoff)
--                       + v_cutoff) at time zone v_tz;
--
-- El día de negocio va de las 04:00 a las 04:00, con el huso de la CUENTA
-- (`accounts.timezone`, respaldo 'Europe/Madrid'). Importaba: a las 00:05 del
-- 16/09 el día de negocio seguía siendo el del 15, y mi corte por medianoche
-- daba 0 en curso y 0 terminados donde la pantalla enseña 58 pedidos.
--
-- Y de paso, una sospecha que resultó infundada y por eso se mira en vez de
-- contarse: el `at time zone v_tz` de la línea 27 SÍ está. Sin él, un 04:00 de
-- Madrid se habría guardado como 04:00 UTC --las 06:00 de Madrid-- y el día de
-- negocio habría empezado dos horas tarde todo el verano. Está bien escrito.
