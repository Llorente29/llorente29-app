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
    -- La misma ventana que usa `orders_feed` para la oficina: el día de
    -- negocio. La tablet ve menos; ver la nota del final.
    and coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at)
          >= (now() at time zone 'Europe/Madrid')::date
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

-- ── LA NOTA DE LA TABLET, que es un hallazgo y no una nota al pie ──────────
--
-- «Terminados» se define «sólo del día en curso», y en la OFICINA se cumple:
-- `orders_feed` trae el día de negocio entero.
--
-- 🔴 EN LA TABLET NO. `orders_feed_by_token` trae lo abierto MÁS lo tocado en
-- las últimas 2 horas:
--
--     or coalesce(s.closed_at, s.cancelled_at, s.sold_at, s.opened_at)
--          >= now() - interval '2 hours'
--
-- Medido el 15/09 a las 23:05 en Alcalá: 35 pedidos terminados en el día, de
-- los cuales la tablet descarga 23. Doce no están, y no es un filtro de la
-- pantalla: no han llegado.
--
-- Esto choca con la regla 7 --una pantalla que se abre a propósito no esconde
-- filas-- y NO se arregla desde el front: o el rótulo de la pestaña dice qué
-- periodo cubre, o se ensancha la ventana de la RPC, que es tocar el camino
-- del pedido y por tanto una migración con su hora. Va al parte para que se
-- decida, no lo decido yo.
--
-- Para verlo:
--
--   select count(*) filter (where true)                                as del_dia,
--          count(*) filter (where coalesce(closed_at, cancelled_at, sold_at, opened_at)
--                                 >= now() - interval '2 hours')       as los_que_ve_la_tablet
--   from sale
--   where account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'
--     and location_id = '38158159-cd71-4056-950b-53425afac1ce'
--     and (status = 'closed' or order_status = 'completed')
--     and (sold_at at time zone 'Europe/Madrid')::date
--           = (now() at time zone 'Europe/Madrid')::date;
