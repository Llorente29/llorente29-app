-- B47 · 03/09/2026 — LA PANTALLA DE COCINA NO SUELTA LOS PEDIDOS CANCELADOS.
-- ===========================================================================
-- HALLAZGO: kds_board filtra por `sale.status <> 'cancelled'`, pero cuando la
--   plataforma cancela o rechaza un pedido lo que cambia es `order_status`
--   (cancelled / rejected / delivery_failed); `status` se queda en 'open' y
--   nadie sella la venta. El ticket no cae NUNCA.
--
-- MEDIDO el 03/09 al vaciar la pantalla con A5: de los 42 tickets vivos que
--   quedaban en Foodint, los 42 eran de esta clase — CERO legitimos.
--   Carabanchel 31 (desde el 15/08) · Alcala 11 (el mas antiguo, del 24/06).
--
-- ES SOLO PANTALLA, NO STOCK: comprobado uno a uno — 40 cancelled y 1 rejected
--   ya NO tienen consumo (trg_sale_consumption_on_complete devolvio el stock en
--   su momento). El unico que conserva consumo es el `delivery_failed`, y es
--   correcto: la comida se hizo. Por eso este arreglo NO toca ni una fila de
--   datos, solo la consulta.
--
-- CRITERIO: misma gracia de 2 h que ya se aplica a los cerrados — la cocina ve
--   la cancelacion y despues el ticket cae. `cancelled_at` esta a null en los 42
--   (nadie lo escribe nunca: deuda aparte, apuntada en B47), de ahi el coalesce
--   con updated_at, que es cuando se escribio la cancelacion.
--
-- CONSECUENCIA MEDIDA (regla 11): las dos pantallas de Foodint pasan de 42
--   tickets a 0 a las 7 de la manana, que es lo que deben ensenar.
--
-- FORMA DEL PARCHE: no se reescribe la funcion a mano (6.937 caracteres, un
--   error de transcripcion se lleva la pantalla de cocina por delante). Se lee
--   su definicion viva, se sustituye EXACTAMENTE una linea y se comprueba que
--   aparecia una sola vez antes de tocar nada. Si no, la migracion falla.

do $do$
declare
  v_def   text;
  v_old   text;
  v_new   text;
  v_veces int;
begin
  v_old := $q$and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')$q$;

  v_new := $q$and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')
      -- B47 (03/09/2026): un pedido cancelado o rechazado por la plataforma deja
      -- order_status en cancelled/rejected/delivery_failed y sale.status en 'open'.
      -- Sin esta linea el ticket no cae nunca (42 asi el dia que se midio, el mas
      -- antiguo del 24/06). Misma gracia de 2 h que los cerrados.
      and (coalesce(s.order_status, '') not in ('cancelled', 'rejected', 'delivery_failed')
           or coalesce(s.cancelled_at, s.updated_at, s.sold_at) >= now() - interval '2 hours')$q$;

  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kds_board';

  if v_def is null then
    raise exception 'B47: no se encuentra public.kds_board';
  end if;

  v_veces := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_veces <> 1 then
    raise exception 'B47: el filtro de los 2 h aparece % veces en kds_board, se esperaba exactamente 1. No se toca nada.', v_veces;
  end if;

  execute replace(v_def, v_old, v_new);
end
$do$;
