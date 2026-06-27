-- 20260627T2600_expire_unpaid_shop_orders.sql
-- Aplicada: (pendiente)
--
-- Caducidad de pedidos del Shop creados pero NO pagados (pago online abandonado).
-- Un pedido online nace en order_status='new' y solo pasa a 'accepted' cuando el
-- webhook de Stripe confirma el pago. Si el cliente nunca paga, queda en 'new'
-- para siempre. Esta función los cancela tras un margen prudente.
--
-- Solo afecta a pago ONLINE abandonado: los de EFECTIVO nacen 'accepted'
-- (place_shop_order), así que el filtro order_status='new' ya los excluye.
--
-- Se cancela (no se borra): conserva la traza para analítica de conversión.
-- Programado vía pg_cron cada 5 min (mismo patrón que los demás jobs).

create or replace function public.expire_unpaid_shop_orders(p_minutes int default 30)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count int;
begin
  with caducados as (
    update sale
    set order_status = 'cancelled',
        status       = 'cancelled',
        cancelled_at = now()
    where source = 'folvy_shop'
      and order_status = 'new'
      and coalesce(payment_status, '') <> 'paid'
      and created_at < now() - make_interval(mins => p_minutes)
    returning id
  )
  select count(*) into v_count from caducados;
  return v_count;
end;
$$;

revoke all on function public.expire_unpaid_shop_orders(int) from public, anon, authenticated;

-- Cron: cada 5 minutos, caduca los no pagados de más de 30 min.
select cron.schedule(
  'expire-unpaid-shop-orders',
  '*/5 * * * *',
  $$ select public.expire_unpaid_shop_orders(30); $$
);
