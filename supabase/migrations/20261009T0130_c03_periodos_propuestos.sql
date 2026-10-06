-- ============================================================================
-- C03 · 4 · DATOS: el periodo de las liquidaciones que no lo traen, PROPUESTO
-- ----------------------------------------------------------------------------
-- Respuesta 1 del C03, decisión 1. A las liquidaciones de plataforma sin
-- period_from/period_to se les PROPONE el periodo desde los pedidos que
-- contienen (el primero y el último), «por confirmar». Fila a fila: cada una
-- lleva en proposed_period_note de dónde sale («del 03/06 al 14/06, de sus 212
-- pedidos»). Donde no hay pedidos, no se inventa nada: se quedan sin periodo.
--
-- period_from / period_to NO se tocan: los lee Ventas (y el vigía B59 lee
-- settlement_date). Se copian a period_* solo cuando la persona confirma en la
-- ficha (channel_settlement_confirm_period). Antes = después para todo lo que
-- ya existía: la prueba de staging compara la huella de las columnas viejas.
--
-- Medido en producción el 06/10 (solo lectura, cuenta de Foodint): 149 sin
-- periodo (96 de import_csv_glovo, 53 de import_csv_je); con pedidos
-- enlazados, 47 (todas de Glovo). Las 102 restantes se quedan como están.
-- Vuelta atrás: supabase/vuelta-atras/20261009T0130_c03_periodos_propuestos.down.sql
-- ============================================================================

do $$
declare n int;
begin
  with p as (
    select o.settlement_id, min(o.order_date) desde, max(o.order_date) hasta, count(*) pedidos
      from public.channel_settlement_order o
     where o.settlement_id is not null and o.order_date is not null
     group by o.settlement_id
  )
  update public.channel_settlement cs
     set proposed_period_from = p.desde,
         proposed_period_to = p.hasta,
         proposed_period_note = format('Del %s al %s: el primer y el último de sus %s pedidos. Por confirmar.',
                                       to_char(p.desde, 'DD/MM/YYYY'), to_char(p.hasta, 'DD/MM/YYYY'), p.pedidos)
    from p
   where p.settlement_id = cs.id
     and cs.account_id = (select o.account_id from public.channel_settlement_order o where o.settlement_id = cs.id limit 1)
     and cs.period_from is null and cs.period_to is null
     and cs.proposed_period_from is null;
  get diagnostics n = row_count;
  raise notice 'C03 · periodos propuestos desde sus pedidos: %. Las que no tienen pedidos se quedan sin periodo.', n;
end $$;
