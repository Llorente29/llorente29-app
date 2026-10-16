-- R03 · 3 · Los pedidos que siguen abiertos, con su código, sus indicaciones y
-- su nota (Julio, 16/10: «rellenar los pedidos que sigan abiertos»).
--
-- VA APARTE porque escribe en `sale`, una tabla del pedido: necesita su
-- `autorizo`. Va detrás de la 0310 (las columnas y la función que las lee).
-- Solo los ABIERTOS de las últimas 48 horas de Last y HubRise:
--   1. las tres columnas nuevas (código, indicaciones, nota), que estaban
--      vacías: no cambia nada que ya hubiera;
--   2. los Uber sin mandar a Catcher se recolocan por las tres señales (calle,
--      coordenadas y cargo de envío), la misma regla que el disparador de la
--      0310 aplica a los que entren. Se guarda cómo estaban.
-- Lo que cambia sale contado al final (sin textos de cliente).
-- Vuelta atrás: supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
--   (las vuelve a poner a null en esos mismos pedidos).

create table if not exists public.r03_entrega_relleno (
  sale_id      uuid primary key,
  account_id   uuid not null,
  -- null = solo se rellenaron las columnas; si no, el tipo de reparto que tenía (Uber recolocado).
  service_type_antes text,
  rellenado_at timestamptz not null default now()
);
comment on table public.r03_entrega_relleno is
  'R03: los pedidos abiertos a los que 20261118T0320 rellenó customer_phone_code, delivery_instructions y order_customer_note. Para la vuelta atrás.';

with c as (
  select s.id, s.account_id, e.*
    from public.sale s
    cross join lateral public.sale_entrega_desde_raw(s.source, s.raw_tab) e
   where s.status = 'open'
     and s.source in ('lastapp', 'hubrise')
     and s.sold_at > now() - interval '48 hours'
     and s.customer_phone_code is null and s.delivery_instructions is null and s.order_customer_note is null
     and (e.customer_phone_code is not null or e.delivery_instructions is not null or e.order_customer_note is not null)
), u as (
  update public.sale s
     set customer_phone_code = c.customer_phone_code,
         delivery_instructions = c.delivery_instructions,
         order_customer_note = c.order_customer_note
    from c where s.id = c.id
  returning s.id, s.account_id
)
insert into public.r03_entrega_relleno (sale_id, account_id)
select id, account_id from u on conflict (sale_id) do nothing;

-- Uber, abiertos y sin Catcher: quién reparte, por las tres señales (calle,
-- coordenadas y cargo de envío), la misma regla que el disparador de la 0310.
-- Con «tal cual», para que ningún disparador lo cambie por detrás.
select set_config('folvy.reparto_tal_cual', 'on', true);
with c as (
  select s.id, s.account_id, s.service_type, s.delivery_by_reason, g.*
    from public.sale s
    cross join lateral public.uber_senales_de_reparto(s.raw_tab) g
   where s.status = 'open'
     and s.source = 'hubrise'
     and s.service_type in ('own_delivery', 'platform_delivery')
     and lower(coalesce(s.external_channel_text, '')) like '%uber%'
     and s.carrier_order_id is null
     and s.sold_at > now() - interval '48 hours'
     and coalesce(s.delivery_by_reason, '') not in ('decidido_propio', 'decidido_uber')
     and coalesce(btrim(s.delivery_address_fixed), '') = ''
     and g.calle is not null  -- raw_tab ilegible: no se recoloca
), n as (
  select c.*,
         case when calle and coordenadas and cargo_envio then 'own_delivery'
              when not calle and not coordenadas and not cargo_envio then 'platform_delivery'
              else 'own_delivery' end as st_nuevo,
         case when calle and coordenadas and cargo_envio then null
              when not calle and not coordenadas and not cargo_envio then 'fuera_de_zona'
              else 'uber_decidir' end as reason_nuevo
    from c
), u as (
  update public.sale s
     set service_type = n.st_nuevo, delivery_by_reason = n.reason_nuevo
    from n
   where s.id = n.id
     and (s.service_type is distinct from n.st_nuevo or s.delivery_by_reason is distinct from n.reason_nuevo)
  returning s.id, s.account_id, n.service_type as antes
)
insert into public.r03_entrega_relleno (sale_id, account_id, service_type_antes)
select id, account_id, antes from u
on conflict (sale_id) do update set service_type_antes = excluded.service_type_antes;
select set_config('folvy.reparto_tal_cual', '', true);

select account_id,
       count(*) filter (where service_type_antes is null) as rellenados,
       count(*) filter (where service_type_antes is not null) as uber_recolocados
  from public.r03_entrega_relleno group by 1;
