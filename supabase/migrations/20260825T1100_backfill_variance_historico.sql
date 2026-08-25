-- 20260825T1100_backfill_variance_historico.sql
-- PROPUESTA (NO EJECUTADA). Ejecutar DESPUÉS de
-- 20260825T1000_inventory_system_qty_desde_ledger.sql (usa theoretical_qty_at).
--
-- QUÉ REPARA Y QUÉ NO
-- ------------------------------------------------------------------------
-- REPARA: el INFORME. Recalcula system_qty / variance_qty / variance_pct /
--   variance_value / within_tolerance de los conteos ya cerrados, poniendo el
--   teórico donde debía estar: el ledger cortado en el counted_at de cada
--   línea.
-- NO TOCA: stock_movement. Ni un asiento. El stock físico ya se corrigió con
--   los ajustes aplicados y esos ajustes ERAN correctos (apply ya cortaba por
--   counted_at desde el 01-08). Lo único que estaba mal era el informe que se
--   enseñaba encima. Por eso esto no es "deshacer" nada: es dejar de mentir
--   sobre lo que ya pasó.
--
-- COSTE UNITARIO: se conserva el coste implícito de cada línea
--   (variance_value / variance_qty original) en vez de re-tarificar con el
--   avg_unit_cost de hoy. Así el delta en € es 100% atribuible a la
--   corrección de cantidades y no al drift de costes de dos meses.
--   Si la línea no tiene coste implícito derivable (variación 0, o valor ya
--   forzado a 0 por saneamiento / falta de materialización) se usa el
--   avg_unit_cost actual, que es lo que haría close_inventory_count.
--
-- REVERSIBLE: cada línea tocada queda con sus valores viejos y nuevos en
--   inventory_count_line_rebase_log. Al final del fichero está el UPDATE de
--   marcha atrás, comentado.
--
-- ALCANCE MEDIDO HOY (antes de ejecutar): 102 conteos cerrados desde el
--   14-06-2026; 1.948 líneas contadas; cambian 1.117 líneas de 81 conteos.
--   De esas, 1.021 habrían cambiado igual usando solo los movimientos que ya
--   existían al cerrar el conteo → el grueso es el bug. Las otras ~360 tienen
--   además movimientos retroactivos (documentos registrados tarde con
--   occurred_at anterior); rebasar las deja con la mejor estimación
--   disponible HOY del teórico de aquel instante, que es lo que queremos para
--   un informe de merma.
--
-- IDEMPOTENTE: re-ejecutarlo no vuelve a cambiar nada (el teórico ya coincide
--   con el ledger), y el coste implícito preservado se mantiene estable.

begin;

-- ── (0) Bitácora de la reparación (permite deshacer y auditar) ─────────────
create table if not exists public.inventory_count_line_rebase_log (
  id                    uuid primary key default gen_random_uuid(),
  batch                 text not null,
  rebased_at            timestamptz not null default now(),
  account_id            uuid,
  inventory_count_id    uuid not null,
  count_code            text,
  count_status          text,
  line_id               uuid not null,
  recipe_item_id        uuid not null,
  counted_at            timestamptz,
  cut_at                timestamptz not null,
  counted_qty           numeric,
  old_system_qty        numeric,
  new_system_qty        numeric,
  old_variance_qty      numeric,
  new_variance_qty      numeric,
  old_variance_pct      numeric,
  new_variance_pct      numeric,
  old_variance_value    numeric,
  new_variance_value    numeric,
  old_within_tolerance  boolean,
  new_within_tolerance  boolean
);

create index if not exists idx_iclrl_batch on public.inventory_count_line_rebase_log (batch);
create index if not exists idx_iclrl_line  on public.inventory_count_line_rebase_log (line_id);

alter table public.inventory_count_line_rebase_log enable row level security;
-- Sin políticas: tabla de oficina, solo accesible por service_role / SQL Editor.

-- ── (1) Cálculo: qué línea cambia y a qué valores ─────────────────────────
create temporary table _rebase_calc on commit drop as
with src as (
  select
    ic.id                         as count_id,
    ic.code                       as count_code,
    ic.status                     as count_status,
    ic.account_id,
    ic.location_id,
    coalesce(ic.started_at, ic.closed_at, ic.created_at, now()) as v_instant,
    l.id                          as line_id,
    l.recipe_item_id,
    l.abc_class,
    l.counted_at,
    l.counted_qty,
    l.system_qty                  as old_sys,
    l.variance_qty                as old_vq,
    l.variance_pct                as old_vpct,
    l.variance_value              as old_vv,
    l.within_tolerance            as old_wt
  from public.inventory_count ic
  join public.inventory_count_line l on l.inventory_count_id = ic.id
  -- Solo conteos ya terminados. Los que están 'abierto'/'contando' se
  -- reconstruyen solos al cerrar y no se tocan aquí.
  where ic.status in ('aprobado', 'en_revision')
),
calc as (
  select
    s.*,
    coalesce(s.counted_at, s.v_instant) as cut_at,
    public.theoretical_qty_at(s.recipe_item_id, s.location_id,
                              coalesce(s.counted_at, s.v_instant)) as new_sys,
    case
      when s.old_vq is not null and s.old_vq <> 0
       and s.old_vv is not null and s.old_vv <> 0
      then s.old_vv / s.old_vq
      else coalesce(ril.avg_unit_cost, 0)
    end as unit_cost,
    coalesce(ss.tol_a_pct, 2) as tol_a,
    coalesce(ss.tol_b_pct, 3) as tol_b,
    coalesce(ss.tol_c_pct, 5) as tol_c
  from src s
  left join public.recipe_item_location_stock ril
    on ril.recipe_item_id = s.recipe_item_id
   and ril.location_id    = s.location_id
   and ril.account_id     = s.account_id
  left join public.supply_settings ss
    on ss.account_id = s.account_id
)
select
  c.count_id, c.count_code, c.count_status, c.account_id, c.line_id,
  c.recipe_item_id, c.counted_at, c.cut_at, c.counted_qty,
  c.old_sys, c.new_sys, c.old_vq, c.old_vpct, c.old_vv, c.old_wt,
  -- variación en cantidad
  case when c.counted_qty is null then null
       else c.counted_qty - c.new_sys end as new_vq,
  -- variación en %
  case when c.counted_qty is null then null
       when coalesce(c.new_sys, 0) = 0 then null
       else (c.counted_qty - c.new_sys) / c.new_sys * 100 end as new_vpct,
  -- variación en €: saneamiento de teórico negativo = 0, igual que close
  case when c.counted_qty is null then c.old_vv
       when coalesce(c.new_sys, 0) < 0 then 0
       else (c.counted_qty - c.new_sys) * c.unit_cost end as new_vv,
  -- dentro de tolerancia, con la misma regla y el mismo saneamiento que close
  case when c.counted_qty is null then null
       when coalesce(c.new_sys, 0) < 0 then true
       when coalesce(c.new_sys, 0) = 0 then (c.counted_qty = 0)
       else abs((c.counted_qty - c.new_sys) / c.new_sys * 100) <=
            case c.abc_class when 'A' then c.tol_a when 'B' then c.tol_b else c.tol_c end
  end as new_wt
from calc c
-- Solo las líneas cuyo teórico realmente se mueve.
where abs(c.new_sys - coalesce(c.old_sys, 0)) > 0.0001;

-- ── (2) Bitácora ANTES de tocar nada ──────────────────────────────────────
insert into public.inventory_count_line_rebase_log (
  batch, account_id, inventory_count_id, count_code, count_status, line_id,
  recipe_item_id, counted_at, cut_at, counted_qty,
  old_system_qty, new_system_qty, old_variance_qty, new_variance_qty,
  old_variance_pct, new_variance_pct, old_variance_value, new_variance_value,
  old_within_tolerance, new_within_tolerance
)
select
  '20260825_system_qty_desde_ledger',
  c.account_id, c.count_id, c.count_code, c.count_status, c.line_id,
  c.recipe_item_id, c.counted_at, c.cut_at, c.counted_qty,
  c.old_sys, c.new_sys, c.old_vq, c.new_vq,
  c.old_vpct, c.new_vpct, c.old_vv, c.new_vv,
  c.old_wt, c.new_wt
from _rebase_calc c;

-- ── (3) Reparación del informe ────────────────────────────────────────────
update public.inventory_count_line l
   set system_qty       = c.new_sys,
       variance_qty     = c.new_vq,
       variance_pct     = c.new_vpct,
       variance_value   = c.new_vv,
       within_tolerance = c.new_wt
  from _rebase_calc c
 where l.id = c.line_id;

-- ── (4) Informe de lo hecho (mirar ANTES de hacer commit) ─────────────────
select
  count(*)                                                as lineas_reparadas,
  count(distinct count_id)                                as conteos_afectados,
  count(*) filter (where old_wt = false and new_wt = true) as dejan_de_ser_anomalia,
  count(*) filter (where old_wt = true and new_wt = false) as pasan_a_ser_anomalia,
  round(sum(coalesce(old_vv, 0)), 2)                      as merma_informada_antes_eur,
  round(sum(coalesce(new_vv, 0)), 2)                      as merma_informada_despues_eur,
  round(sum(coalesce(new_vv, 0)) - sum(coalesce(old_vv, 0)), 2) as delta_eur
from _rebase_calc;

-- Detalle por conteo (los 30 de mayor corrección económica).
select
  count_code,
  count_status,
  count(*)                                   as lineas,
  round(sum(coalesce(old_vv, 0)), 2)         as antes_eur,
  round(sum(coalesce(new_vv, 0)), 2)         as despues_eur,
  round(sum(coalesce(new_vv, 0)) - sum(coalesce(old_vv, 0)), 2) as delta_eur
from _rebase_calc
group by 1, 2
order by abs(sum(coalesce(new_vv, 0)) - sum(coalesce(old_vv, 0))) desc
limit 30;

commit;

-- ── MARCHA ATRÁS (no ejecutar salvo que haga falta) ───────────────────────
-- begin;
-- update public.inventory_count_line l
--    set system_qty       = g.old_system_qty,
--        variance_qty     = g.old_variance_qty,
--        variance_pct     = g.old_variance_pct,
--        variance_value   = g.old_variance_value,
--        within_tolerance = g.old_within_tolerance
--   from public.inventory_count_line_rebase_log g
--  where g.line_id = l.id
--    and g.batch = '20260825_system_qty_desde_ledger';
-- delete from public.inventory_count_line_rebase_log
--  where batch = '20260825_system_qty_desde_ledger';
-- commit;
