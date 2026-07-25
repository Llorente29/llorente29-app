-- supabase/migrations/20260725T0000_kpi_cocina_sellado_hitos.sql
-- ============================================================================
-- KPI DE COCINA — SELLADO DE HITOS en `sale` (accepted_at / ready_at).
-- ============================================================================
-- El reloj de cocina se sella EN LA BBDD, agnóstico de superficie: da igual que
-- el cambio de estado venga de `set_order_status` (sesión) o de
-- `set_order_status_by_token` (Estación de tablet). El front solo dispara la
-- transición con el botón "Listo"; los tiempos los sella este trigger.
--
--   · accepted_at  -> se sella en el INSERT (autoaceptación: el pedido entra en
--                     Folvy y arranca el reloj, mismo instante que el ticket de
--                     cocina y las pegatinas). Fallback en UPDATE por si la fila
--                     existía sin sello.
--   · ready_at     -> primera vez que el pedido SALE de preparación, es decir al
--                     entrar en awaiting_collection / awaiting_shipment /
--                     in_delivery. Se sella una sola vez. (`completed` NO sella
--                     ready_at: un pedido que se cierra sin pasar por "listo" no
--                     tiene hito de cocina válido — corregido en prod por Julio.)
--
-- Complementa a `handed_to_courier_at` (Capa 4, sellado al pasar delivery_state a
-- in_delivery), que mide "desde cuándo está en reparto". Aquí medimos cocina.
-- DDL sin BEGIN/COMMIT. Idempotente.
--
-- NOTA DE VERSIONADO: ESTA MIGRACIÓN YA ESTÁ APLICADA EN PRODUCCIÓN (aplicada a
-- mano el 25/07/2026). Este fichero es el REGISTRO versionado para no dejar drift;
-- NO se vuelve a ejecutar. Reconstruido exacto desde la BBDD (fuente de verdad):
-- pg_get_functiondef(tg_sale_seal_kpi_hitos) + pg_get_triggerdef.
-- ============================================================================

-- ── 1. Columnas de hitos (nullable, sin default) ─────────────────────────────
alter table public.sale add column if not exists accepted_at timestamptz;
alter table public.sale add column if not exists ready_at    timestamptz;

-- ── 2. Función de sellado ────────────────────────────────────────────────────
create or replace function public.tg_sale_seal_kpi_hitos()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    -- Autoaceptación: el pedido entra en Folvy y arranca el reloj (mismo
    -- instante que el ticket de cocina y las pegatinas).
    if new.accepted_at is null then
      new.accepted_at := now();
    end if;
    return new;
  end if;

  -- UPDATE
  if new.order_status is distinct from old.order_status then
    -- Fallback de inicio (por si la fila existía sin accepted_at).
    if new.accepted_at is null
       and new.order_status in ('received','accepted','in_preparation') then
      new.accepted_at := now();
    end if;
    -- LISTO: primera vez que sale de preparación.
    if new.ready_at is null
       and new.order_status in ('awaiting_collection','awaiting_shipment','in_delivery') then
      new.ready_at := now();
    end if;
  end if;
  return new;
end;
$function$;

-- ── 3. Trigger (BEFORE INSERT OR UPDATE, sella antes de escribir la fila) ─────
drop trigger if exists trg_sale_seal_kpi_hitos on public.sale;
create trigger trg_sale_seal_kpi_hitos
  before insert or update on public.sale
  for each row execute function public.tg_sale_seal_kpi_hitos();
