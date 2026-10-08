-- scripts/conta/produccion/salud-pedido.sql
--
-- W01 · La salud del camino del pedido de Foodint, con :cuenta, :t (marca
-- de tiempo) y :minutos. Una sola fila: «entrados», los pedidos creados en los
-- :minutos ANTES de :t, y «movidos», los cambios de estado (aceptado, listo,
-- entregado al rider, entregado, cerrado) DESDE :t. El workflow la lanza dos
-- veces: al empezar (para saber si hay servicio) y :minutos después del real
-- (para saber si los pedidos siguen avanzando). Solo lee.
select
  (select count(*) from public.sale
    where account_id = :'cuenta'
      and created_at >= (:'t')::timestamptz - make_interval(mins => :'minutos'::int)
      and created_at <  (:'t')::timestamptz) as entrados,
  (select count(*) from (
      select unnest(array[accepted_at, ready_at, handed_to_courier_at, delivered_at, closed_at]) as ts
        from public.sale
       where account_id = :'cuenta'
         and created_at >= (:'t')::timestamptz - interval '2 days') x
    where ts >= (:'t')::timestamptz) as movidos;
