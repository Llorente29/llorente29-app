-- ============================================================================
-- `closed_at` ES LA HORA DE ENTREGA CUANDO LA HAY · 16/09/2026
-- APLICADA en producción el 16/09 (ver la versión del nombre del fichero).
--
-- El URGENTE §3.1 pide que al cerrar por la entrega, `closed_at` sea la hora de
-- entrega. Hoy `close_sale` pone `coalesce(closed_at, now())`, y eso vale
-- mientras el aviso llega en el momento --dentro de una transacción `now()` es
-- el mismo instante que el `delivered_at` que sella `tg_sale_seal_delivered`--
-- pero NO vale para un aviso tardío ni para los que hay que cerrar a mano.
--
-- MEDIDO en seco, antes de este cambio: cerrar G231 y G764 --entregados a las
-- 15:29:57 y 16:16:04-- ponía `closed_at` a las 19:21:03, la hora del arreglo.
-- Tres y cuatro horas de más en el libro. Después: 15:29:57 y 16:16:04, iguales
-- a la entrega.
--
-- Se arregla en `close_sale` y no en quien la llama, porque son varios: el
-- disparador del cierre, el borde de la flota, el enlace del repartidor y el
-- cierre a mano. Una regla, un sitio.
--
-- VOLVER ATRÁS: el mismo `create or replace` con `coalesce(closed_at, now())`.
-- ============================================================================

create or replace function public.close_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_line uuid;
begin
  update sale
  set status     = 'closed',
      -- La entrega manda sobre el reloj: si la flota ya selló cuándo llegó,
      -- esa es la hora del cierre. `now()` solo para lo que nunca se entregó
      -- (plataforma, recogida) o para un cierre sin entrega sellada.
      closed_at  = coalesce(closed_at, delivered_at, now()),
      updated_at = now()
  where id = p_sale_id;

  for v_line in
    select id from sale_line
    where sale_id = p_sale_id and coalesce(line_type, 'product') = 'product'
  loop
    perform public.compute_sale_line_cost(v_line);
  end loop;

  perform public.generate_sale_consumption(p_sale_id);
end;
$fn$;

comment on function public.close_sale(uuid) is
'Cierra la venta. closed_at = la hora de ENTREGA cuando la flota la selló, y si no now(). Consolida el coste de las líneas y pasa por el escritor único del consumo, que desde el 16/09 no escribe si nada ha cambiado. URGENTE del 16/09 §3.1.';
