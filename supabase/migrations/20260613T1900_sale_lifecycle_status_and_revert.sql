-- supabase/migrations/20260613T1900_sale_lifecycle_status_and_revert.sql
-- ============================================================================
-- CAPA 0a del KDS — CICLO DE VIDA DE LA VENTA (modelo A) + REVERSIÓN DE CONSUMO
-- ============================================================================
-- Añade a `sale` el estado open/closed/cancelled + timestamps, y crea las
-- funciones CORE (canónicas, AGNÓSTICAS DEL ORIGEN) de la máquina de estados:
--   close_sale(sale_id)            -> consolida (coste + consumo) y cierra
--   cancel_sale(sale_id, reason)   -> cancela y revierte consumo
--   revert_sale_consumption(sale_id) -> borra consumo + recalcula stock
--
-- PRINCIPIO (Julio): cada ORIGEN (Last hoy; Otter/Deliverect/GrubTech/propio
-- mañana) es solo una FRONTERA que traduce sus eventos a abrir/cerrar/cancelar.
-- Estas funciones operan sobre la `sale` canónica y NUNCA miran `source`.
--
-- REVERSIÓN: el motor de consumo ya es idempotente (compute_sale_line_consumption
-- borra y reescribe por línea). Revertir = borrar los movimientos 'consumo' de la
-- venta y recalcular stock con recompute_location_stock_core (pieza existente).
--
-- SEGURIDAD: funciones de MOTOR (patrón Folvy: sin guard de usuario; la
-- autorización la hace la FRONTERA — token del webhook / RLS de la app).
-- SECURITY DEFINER para poder escribir bajo service_role. NO se ejecutan aquí
-- (solo se crean); se prueban desde la frontera, no en el SQL Editor.
--
-- DDL sin BEGIN/COMMIT (regla SQL Editor). Idempotente (re-ejecutable).
-- ============================================================================

-- 1) COLUMNAS (nullable primero, para poder backfillar el histórico) --------
alter table sale add column if not exists status        text;
alter table sale add column if not exists opened_at     timestamptz;
alter table sale add column if not exists closed_at      timestamptz;
alter table sale add column if not exists cancelled_at   timestamptz;
alter table sale add column if not exists cancel_reason  text;

-- 2) BACKFILL: TODO el histórico vino de tab:closed = ventas CERRADAS. --------
--    (sin esto quedarían 'open' por el default y romperían los informes)
update sale
set status    = coalesce(status, 'closed'),
    opened_at = coalesce(opened_at, sold_at, created_at),
    closed_at = coalesce(closed_at, sold_at, created_at)
where status is null;

-- 3) DEFAULT 'open' (para las NUEVAS que nazcan en tab:created) + NOT NULL ----
alter table sale alter column status set default 'open';
alter table sale alter column status set not null;

-- 4) CHECK del dominio de estados (guardado para re-ejecución) ----------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_status_valid') then
    alter table sale add constraint sale_status_valid
      check (status in ('open', 'closed', 'cancelled'));
  end if;
end $$;

-- Índice para los informes (filtran por estado) -------------------------------
create index if not exists sale_status_idx on sale (account_id, status);

-- ============================================================================
-- FUNCIONES CORE (canónicas, agnósticas del origen)
-- ============================================================================

-- revert_sale_consumption(sale_id):
--   borra los movimientos de CONSUMO de TODAS las líneas product de la venta y
--   recalcula el stock de cada (raw, local) tocado. Reutiliza la maquinaria
--   existente (recompute_location_stock_core). Idempotente: si no hay consumo,
--   no borra nada y no falla.
create or replace function public.revert_sale_consumption(p_sale_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc      uuid;
  v_affected uuid[];
  v_item     uuid;
  v_deleted  integer := 0;
begin
  select location_id into v_loc from sale where id = p_sale_id;

  -- raws afectados por el consumo de las líneas de esta venta (para recalcular)
  v_affected := array(
    select distinct sm.recipe_item_id
    from stock_movement sm
    join sale_line sl on sl.id = sm.source_id
    where sm.source_type   = 'sale'
      and sm.movement_type = 'consumo'
      and sl.sale_id       = p_sale_id
  );

  -- borrar el consumo de las líneas de esta venta
  delete from stock_movement sm
  using sale_line sl
  where sm.source_type   = 'sale'
    and sm.movement_type = 'consumo'
    and sm.source_id     = sl.id
    and sl.sale_id       = p_sale_id;
  get diagnostics v_deleted = row_count;

  -- recalcular stock de los (raw, local) tocados
  if v_loc is not null then
    foreach v_item in array coalesce(v_affected, '{}'::uuid[])
    loop
      perform public.recompute_location_stock_core(v_item, v_loc);
    end loop;
  end if;

  return v_deleted;
end;
$$;

-- close_sale(sale_id):
--   consolida la venta: marca 'closed' + calcula COSTE y CONSUMO de cada línea
--   product (lo que hoy hace el webhook en un bucle; ahora centralizado y
--   reutilizable por cualquier frontera). El consumo de stock se escribe AQUÍ,
--   nunca en 'open'.
create or replace function public.close_sale(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid;
begin
  update sale
  set status     = 'closed',
      closed_at  = coalesce(closed_at, now()),
      updated_at = now()
  where id = p_sale_id;

  -- 1) coste de cada línea product
  for v_line in
    select id from sale_line
    where sale_id = p_sale_id and coalesce(line_type, 'product') = 'product'
  loop
    perform public.compute_sale_line_cost(v_line);
  end loop;

  -- 2) consumo teórico de cada línea product (solo descuenta si hay computed_cost)
  for v_line in
    select id from sale_line
    where sale_id = p_sale_id and coalesce(line_type, 'product') = 'product'
  loop
    perform public.compute_sale_line_consumption(v_line);
  end loop;
end;
$$;

-- cancel_sale(sale_id, reason):
--   marca 'cancelled' y revierte el consumo (si lo hubiera). Vale tanto si la
--   venta estaba 'open' (no había consumo: revert es no-op) como 'closed'.
create or replace function public.cancel_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update sale
  set status        = 'cancelled',
      cancelled_at  = now(),
      cancel_reason = p_reason,
      updated_at    = now()
  where id = p_sale_id;

  perform public.revert_sale_consumption(p_sale_id);
end;
$$;
