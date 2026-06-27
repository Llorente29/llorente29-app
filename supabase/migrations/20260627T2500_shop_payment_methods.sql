-- 20260627T2500_shop_payment_methods.sql
-- Aplicada: (pendiente)
--
-- Métodos de pago del Folvy Shop, configurables POR CUENTA (cada restaurante
-- decide qué acepta). Viven en accounts, junto al resto de ajustes shop_*.
--
--   shop_pay_online        : acepta pago online (tarjeta/Bizum vía Stripe). Default true.
--   shop_pay_cash_pickup   : acepta efectivo AL RECOGER (pickup).           Default false.
--   shop_pay_cash_delivery : acepta efectivo CONTRA ENTREGA (delivery).     Default false.
--
-- El checkout lee estos flags (por slug, tienda pública) y muestra solo los
-- métodos permitidos según el modo de entrega elegido. place_shop_order ya
-- distingue payment.mode='cash' (nace aceptado) de online (espera al webhook).

alter table public.accounts
  add column if not exists shop_pay_online        boolean not null default true,
  add column if not exists shop_pay_cash_pickup   boolean not null default false,
  add column if not exists shop_pay_cash_delivery boolean not null default false;

-- Lectura pública de la config del Shop por slug (tienda sin sesión).
-- Devuelve solo lo que la tienda necesita para pintar métodos de pago; nada
-- sensible. SECURITY DEFINER para saltar RLS de accounts de forma controlada.
create or replace function public.shop_payment_config(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'ok', true,
           'online',        coalesce(a.shop_pay_online, true),
           'cashPickup',    coalesce(a.shop_pay_cash_pickup, false),
           'cashDelivery',  coalesce(a.shop_pay_cash_delivery, false)
         )
  into v
  from accounts a
  where a.slug = p_slug;

  if v is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;
  return v;
end;
$$;

grant execute on function public.shop_payment_config(text) to anon, authenticated;
