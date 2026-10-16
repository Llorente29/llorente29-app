-- R03 · 3 · Los pedidos que siguen abiertos, con su código, sus indicaciones y
-- su nota (Julio, 16/10: «rellenar los pedidos que sigan abiertos»).
--
-- VA APARTE porque escribe en `sale`, una tabla del pedido: necesita su
-- `autorizo`. Va detrás de la 0310 (las columnas y la función que las lee).
-- Solo los ABIERTOS de las últimas 48 horas de Last y HubRise, y solo las tres
-- columnas nuevas, que hasta ahora estaban vacías: no cambia nada que ya
-- hubiera. Lo que cambia sale contado al final (sin textos de cliente).
-- Vuelta atrás: supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
--   (las vuelve a poner a null en esos mismos pedidos).

create table if not exists public.r03_entrega_relleno (
  sale_id     uuid primary key,
  account_id  uuid not null,
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

select account_id, count(*) as pedidos_rellenados from public.r03_entrega_relleno group by 1;
