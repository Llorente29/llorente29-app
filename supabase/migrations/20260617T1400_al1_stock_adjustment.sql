-- supabase/migrations/20260617T1400_al1_stock_adjustment.sql
--
-- AL1 — Ajuste de stock con motivo.
--
-- El usuario FIJA el conteo real de un artículo en un local; Folvy calcula la
-- DIFERENCIA contra el saldo actual y la escribe como movimiento 'ajuste' al
-- ledger (puede ser + o −), con un MOTIVO obligatorio. Mismo motor que la merma
-- (register_waste): evento con causa → stock_movement → recompute. El coste sale
-- del WAC del instante; nada se inventa.
--
-- Espejo de stock_waste, con dos diferencias: guardamos counted_base (lo contado)
-- y delta_base (el movimiento con signo) en vez del qty_base único de la merma.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tabla de eventos de ajuste (cabecera con causa, unidad amigable, foto, lote)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_adjustment (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  recipe_item_id  uuid not null references public.recipe_item(id) on delete cascade,
  reason_code     text not null,
  counted_base    numeric not null,          -- conteo real introducido, en unidad base
  previous_base   numeric not null,          -- saldo que el sistema creía, en unidad base
  delta_base      numeric not null,          -- counted - previous (con signo) = el movimiento
  use_unit_label  text,                       -- unidad amigable en que contó ("bolsa")
  use_unit_factor numeric,                    -- factor de esa unidad a base
  use_qty         numeric,                    -- cantidad en esa unidad amigable
  unit_cost       numeric,                    -- WAC del instante
  cost_eur        numeric,                    -- delta_base * unit_cost (con signo)
  photo_url       text,
  lot_code        text,
  expiry_date     date,
  notes           text,
  occurred_at     timestamptz not null default now(),
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_stock_adjustment_item_loc
  on public.stock_adjustment (recipe_item_id, location_id, occurred_at desc);
create index if not exists idx_stock_adjustment_account
  on public.stock_adjustment (account_id, occurred_at desc);

alter table public.stock_adjustment enable row level security;

-- RLS: igual que el resto del módulo, acotado a las cuentas del usuario.
drop policy if exists stock_adjustment_select on public.stock_adjustment;
create policy stock_adjustment_select on public.stock_adjustment
  for select to authenticated
  using (account_id = any (current_user_account_ids()));

-- Inserción solo vía RPC SECURITY DEFINER; no abrimos insert directo desde el cliente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RPC: registrar un ajuste fijando el conteo real
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.register_adjustment(
  p_account_id     uuid,
  p_location_id    uuid,
  p_recipe_item_id uuid,
  p_reason_code    text,
  p_counted_base   numeric,                       -- conteo real, en unidad base
  p_use_unit_label text    default null,
  p_use_unit_factor numeric default null,
  p_use_qty        numeric default null,
  p_photo_url      text    default null,
  p_lot_code       text    default null,
  p_expiry_date    date    default null,
  p_notes          text    default null,
  p_user_id        uuid    default null,
  p_user_name      text    default null
) returns table(adjustment_id uuid, delta_base numeric, cost_eur numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item_account uuid;
  v_previous     numeric;
  v_unit_cost    numeric;
  v_delta        numeric;
  v_cost_eur     numeric;
  v_adj_id       uuid;
begin
  -- Guard: el usuario debe pertenecer a la cuenta.
  if not belongs_to_account(p_account_id) then
    raise exception 'register_adjustment: sin acceso a la cuenta %', p_account_id;
  end if;
  -- El conteo real no puede ser negativo (sí puede ser 0 = "no queda nada").
  if p_counted_base is null or p_counted_base < 0 then
    raise exception 'register_adjustment: el conteo debe ser >= 0';
  end if;
  if p_reason_code is null or length(trim(p_reason_code)) = 0 then
    raise exception 'register_adjustment: el motivo es obligatorio';
  end if;
  -- El artículo debe existir y pertenecer a la cuenta.
  select account_id into v_item_account
    from public.recipe_item where id = p_recipe_item_id;
  if v_item_account is null then
    raise exception 'register_adjustment: el artículo % no existe', p_recipe_item_id;
  end if;
  if v_item_account <> p_account_id then
    raise exception 'register_adjustment: el artículo no pertenece a la cuenta';
  end if;

  -- Saldo actual y WAC del instante (0/NULL si el artículo aún no tiene fila/coste).
  select coalesce(qty_on_hand, 0), coalesce(avg_unit_cost, 0)
    into v_previous, v_unit_cost
    from public.recipe_item_location_stock
    where recipe_item_id = p_recipe_item_id
      and location_id = p_location_id
      and account_id = p_account_id;
  v_previous  := coalesce(v_previous, 0);
  v_unit_cost := coalesce(v_unit_cost, 0);

  v_delta    := p_counted_base - v_previous;     -- movimiento con signo
  v_cost_eur := v_delta * v_unit_cost;

  -- Sin cambio real: no escribimos ruido en el ledger.
  if v_delta = 0 then
    insert into public.stock_adjustment (
      account_id, location_id, recipe_item_id, reason_code,
      counted_base, previous_base, delta_base,
      use_unit_label, use_unit_factor, use_qty,
      unit_cost, cost_eur, photo_url, lot_code, expiry_date, notes,
      occurred_at, created_by, created_by_name
    ) values (
      p_account_id, p_location_id, p_recipe_item_id, p_reason_code,
      p_counted_base, v_previous, 0,
      p_use_unit_label, p_use_unit_factor, p_use_qty,
      v_unit_cost, 0, p_photo_url, p_lot_code, p_expiry_date, p_notes,
      now(), p_user_id, p_user_name
    ) returning id into v_adj_id;
    return query select v_adj_id, 0::numeric, 0::numeric;
    return;
  end if;

  -- 1) Evento de ajuste (cabecera con causa, conteo, diferencia, unidad amigable…).
  insert into public.stock_adjustment (
    account_id, location_id, recipe_item_id, reason_code,
    counted_base, previous_base, delta_base,
    use_unit_label, use_unit_factor, use_qty,
    unit_cost, cost_eur, photo_url, lot_code, expiry_date, notes,
    occurred_at, created_by, created_by_name
  ) values (
    p_account_id, p_location_id, p_recipe_item_id, p_reason_code,
    p_counted_base, v_previous, v_delta,
    p_use_unit_label, p_use_unit_factor, p_use_qty,
    v_unit_cost, v_cost_eur, p_photo_url, p_lot_code, p_expiry_date, p_notes,
    now(), p_user_id, p_user_name
  ) returning id into v_adj_id;

  -- 2) Movimiento al ledger: tipo 'ajuste', qty = diferencia (puede ser + o −).
  insert into public.stock_movement (
    account_id, location_id, recipe_item_id, movement_type, qty_base,
    unit_cost, cost_provisional, source_type, source_id, occurred_at,
    lot_code, expiry_date, created_by, created_by_name, notes
  ) values (
    p_account_id, p_location_id, p_recipe_item_id, 'ajuste', v_delta,
    v_unit_cost, false, 'adjustment', v_adj_id, now(),
    p_lot_code, p_expiry_date, p_user_id, p_user_name,
    coalesce('Ajuste: ' || p_reason_code, 'Ajuste')
  );

  -- 3) Recalcular el saldo del artículo en el local (core: somos SECURITY DEFINER).
  perform public.recompute_location_stock_core(p_recipe_item_id, p_location_id);

  return query select v_adj_id, v_delta, v_cost_eur;
end;
$function$;

grant execute on function public.register_adjustment(
  uuid, uuid, uuid, text, numeric, text, numeric, numeric, text, text, date, text, uuid, text
) to authenticated;
