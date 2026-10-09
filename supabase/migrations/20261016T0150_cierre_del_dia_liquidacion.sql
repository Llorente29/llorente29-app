-- ============================================================================
-- El día se cierra a las 6:00 — 6 · LA LIQUIDACIÓN MANDA (regla 4 de Julio)
-- ----------------------------------------------------------------------------
-- Un pedido que el cierre del día dejó como no confirmado y que luego una
-- liquidación de la plataforma PAGA es venta de su día. Esta función dice
-- cuáles son, para que «Proponer lo pendiente» proponga cada uno aparte
-- (sales_adjustment, origen = la venta) con su porqué: «Glovo ha pagado el
-- pedido 234, que se cerró sin confirmar el 6 de octubre».
--
--   · Pagado = una línea de liquidación CASADA con esa venta
--     (channel_settlement_match_recompute la casa por código y fecha, sin
--     mirar el estado de la venta) y con importe de productos > 0.
--   · Fuera lo que ya tiene su propuesta viva (propuesto, borrador o
--     validado) y lo descartado (journal_dismissal de sales_adjustment con la
--     venta como clave): journal_entry_proponer y journal_entry_descartar ya
--     usan esa clave para cualquier origen que no sea el día.
--   · Sin rango de fechas: el pago llega días o semanas después.
--   · dia_validado: si el día ya tiene su asiento de ventas validado (la
--     propuesta lo dice; el validado no se toca).
--
-- Solo lee. Security invoker: cada uno ve lo suyo (sale_read).
-- Añade: una función nueva. Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261016T0150_cierre_del_dia_liquidacion.down.sql
-- ============================================================================

create or replace function public.conta_no_confirmados_pagados(p_company uuid)
returns table (sale_id uuid, location_id uuid, dia date, codigo text, canal_id uuid, marca_id uuid, total numeric,
               settlement_order_id uuid, settlement_ref text, settlement_date date, pagado numeric, dia_validado boolean)
language sql stable
set search_path = public
as $$
  select distinct on (s.id)
         s.id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date,
         coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.channel_id, s.brand_id, s.total,
         co.id, coalesce(cs.settlement_ref, co.settlement_ref), cs.settlement_date, co.products,
         exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                  where d.company_id = p_company and d.location_id = s.location_id
                    and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date and e.status = 'validado')
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    join public.channel_settlement_order co on co.sale_id = s.id and co.account_id = s.account_id
    left join public.channel_settlement cs on cs.id = co.settlement_id
   where s.unconfirmed_at is not null and s.status = 'cancelled'
     and coalesce(co.matched, false) and coalesce(co.products, 0) > 0
     and not exists (select 1 from public.journal_entry e
                      where e.company_id = p_company and e.source_type = 'sales_adjustment' and e.source_id = s.id
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_adjustment' and x.source_key = s.id::text)
   order by s.id, cs.settlement_date nulls last
$$;
comment on function public.conta_no_confirmados_pagados(uuid) is
  'Cierre del día: los pedidos cerrados como no confirmados que una liquidación de la plataforma ha pagado, sin propuesta viva ni descarte. Lo que «Proponer lo pendiente» propone aparte como venta de su día.';
