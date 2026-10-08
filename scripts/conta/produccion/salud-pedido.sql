-- scripts/conta/produccion/salud-pedido.sql
--
-- W01 · La salud del camino del pedido, POR CUENTA y para TODAS las cuentas
-- (respuesta 4 del C04: antes era solo Foodint). Variables: :t0, :t,
-- :minutos y :minimo. Una fila por cuenta con :minimo o más pedidos creados
-- en los :minutos ANTES de :t0 (las que tienen servicio):
--   cuenta · entrados · movidos
-- «movidos» son los cambios de estado (aceptado, listo, entregado al rider,
-- entregado, cerrado) de sus pedidos DESDE :t. El workflow la lanza dos
-- veces: al empezar (:t = :t0, para saber qué cuentas tienen servicio) y
-- :minutos después del real (:t = el final del real, para saber si sus pedidos
-- siguen avanzando); la cuenta de las dos veces es la misma porque «entrados»
-- se mide siempre antes de :t0. La comprobación suma las cuentas. Solo lee.
-- Regla 9: cada fila es de su cuenta; no hay número «de nadie».
with entrados as (
  select account_id, count(*) n
    from public.sale
   where created_at >= (:'t0')::timestamptz - make_interval(mins => :'minutos'::int)
     and created_at <  (:'t0')::timestamptz
   group by account_id
  having count(*) >= :'minimo'::int
)
select e.account_id, e.n as entrados,
       (select count(*) from (
          select unnest(array[s.accepted_at, s.ready_at, s.handed_to_courier_at, s.delivered_at, s.closed_at]) as ts
            from public.sale s
           where s.account_id = e.account_id
             and s.created_at >= (:'t0')::timestamptz - interval '2 days') x
         where ts >= (:'t')::timestamptz) as movidos
  from entrados e
 order by e.account_id;
