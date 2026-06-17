-- supabase/migrations/20260617T1600_al1_movements.sql
--
-- AL1 — Frente ① Movimientos (libro mayor del almacén).
--
-- 1) list_stock_movements: histórico del ledger con la REFERENCIA legible
--    resuelta por tipo en un solo query (sin N+1):
--      venta       → canal + nº pedido (sale_line→sale: channel/ext_ref)
--      recepción   → código/albarán (goods_receipt_line→goods_receipt)
--      ajuste      → motivo (stock_adjustment.reason_code)
--      merma       → motivo (stock_waste.reason_code)
--      traspaso    → el otro local (stock_transfer)
-- 2) stock_transfer + register_transfer: traspaso de mercancía ENTRE LOCALES
--    (dos movimientos enlazados: salida en origen, entrada en destino).
--
-- La entrada directa NO va aquí: reutiliza register_adjustment (sumar = fijar
-- conteo a saldo+N con motivo 'direct_receipt'). El traspaso entre ZONAS tampoco:
-- es recolocación (no mueve saldo de local), ya resuelta en Existencias.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Traspaso entre locales: tabla de evento + RPC (dos movimientos enlazados)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_transfer (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  from_location_id  uuid not null references public.locations(id) on delete cascade,
  to_location_id    uuid not null references public.locations(id) on delete cascade,
  recipe_item_id    uuid not null references public.recipe_item(id) on delete cascade,
  qty_base          numeric not null,
  unit_cost         numeric,           -- WAC del origen en el instante
  cost_eur          numeric,           -- qty_base * unit_cost
  notes             text,
  occurred_at       timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_stock_transfer_account on public.stock_transfer (account_id, occurred_at desc);

alter table public.stock_transfer enable row level security;
drop policy if exists stock_transfer_select on public.stock_transfer;
create policy stock_transfer_select on public.stock_transfer
  for select to authenticated
  using (account_id = any (current_user_account_ids()));


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Histórico del ledger con referencia legible
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.list_stock_movements(
  p_account uuid,
  p_location uuid,
  p_types text[] default null,   -- filtra por movement_type; null = todos
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 200,
  p_offset int default 0
) returns jsonb
language sql
security invoker
set search_path to 'public'
as $$
with base as (
  select sm.id, sm.movement_type, sm.source_type, sm.source_id,
         sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
         ri.name as item_name,
         ku.abbreviation as unit_abbr
  from stock_movement sm
  join recipe_item ri on ri.id = sm.recipe_item_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  where sm.account_id = p_account
    and sm.location_id = p_location
    and (p_types is null or sm.movement_type = any(p_types))
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to is null or sm.occurred_at < p_to)
),
resolved as (
  select b.*,
    case b.source_type
      when 'sale' then (
        select trim(both ' ·' from
          coalesce(sc.name, s.external_channel_text, 'Venta')
          || coalesce(' · ' || nullif(coalesce(s.external_ref, s.external_tab_ref), ''), ''))
        from sale_line sl
        join sale s on s.id = sl.sale_id
        left join sales_channel sc on sc.id = s.channel_id
        where sl.id = b.source_id
      )
      when 'goods_receipt_line' then (
        select coalesce(gr.code, 'Recepción')
          || coalesce(' · ' || nullif(gr.supplier_doc_number, ''), '')
        from goods_receipt_line grl
        join goods_receipt gr on gr.id = grl.goods_receipt_id
        where grl.id = b.source_id
      )
      when 'adjustment' then (
        select 'Ajuste · ' || sa.reason_code from stock_adjustment sa where sa.id = b.source_id
      )
      when 'waste' then (
        select 'Merma · ' || sw.reason_code from stock_waste sw where sw.id = b.source_id
      )
      when 'transfer' then (
        select case
          when st.from_location_id = p_location then '→ ' || coalesce(lt.name, 'otro local')
          else '← ' || coalesce(lf.name, 'otro local')
        end
        from stock_transfer st
        left join locations lf on lf.id = st.from_location_id
        left join locations lt on lt.id = st.to_location_id
        where st.id = b.source_id
      )
      else null
    end as reference
  from base b
)
select jsonb_build_object(
  'total', (select count(*) from base),
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id,
             'movement_type', r.movement_type,
             'source_type', r.source_type,
             'item_name', r.item_name,
             'unit_abbr', r.unit_abbr,
             'qty_base', r.qty_base,
             'unit_cost', r.unit_cost,
             'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
             'occurred_at', r.occurred_at,
             'created_by_name', r.created_by_name,
             'reference', r.reference,
             'notes', r.notes
           ) order by r.occurred_at desc)
    from (
      select * from resolved order by occurred_at desc
      limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) r
  ), '[]'::jsonb)
);
$$;

grant execute on function public.list_stock_movements(uuid, uuid, text[], timestamptz, timestamptz, int, int) to authenticated;

create or replace function public.register_transfer(
  p_account_id      uuid,
  p_from_location   uuid,
  p_to_location     uuid,
  p_recipe_item_id  uuid,
  p_qty_base        numeric,
  p_notes           text default null,
  p_user_id         uuid default null,
  p_user_name       text default null
) returns table(transfer_id uuid, cost_eur numeric)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item_account uuid;
  v_unit_cost    numeric;
  v_cost_eur     numeric;
  v_avail        numeric;
  v_transfer_id  uuid;
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'register_transfer: sin acceso a la cuenta %', p_account_id;
  end if;
  if p_qty_base is null or p_qty_base <= 0 then
    raise exception 'register_transfer: la cantidad debe ser mayor que 0';
  end if;
  if p_from_location = p_to_location then
    raise exception 'register_transfer: origen y destino no pueden ser el mismo local';
  end if;

  select account_id into v_item_account from public.recipe_item where id = p_recipe_item_id;
  if v_item_account is null then
    raise exception 'register_transfer: el artículo % no existe', p_recipe_item_id;
  end if;
  if v_item_account <> p_account_id then
    raise exception 'register_transfer: el artículo no pertenece a la cuenta';
  end if;

  -- WAC y saldo del origen.
  select coalesce(avg_unit_cost, 0), coalesce(qty_on_hand, 0)
    into v_unit_cost, v_avail
    from public.recipe_item_location_stock
    where recipe_item_id = p_recipe_item_id
      and location_id = p_from_location
      and account_id = p_account_id;
  v_unit_cost := coalesce(v_unit_cost, 0);
  v_avail := coalesce(v_avail, 0);
  if p_qty_base > v_avail then
    raise exception 'register_transfer: no hay stock suficiente en origen (disponible %, pedido %)', v_avail, p_qty_base;
  end if;

  v_cost_eur := p_qty_base * v_unit_cost;

  insert into public.stock_transfer(
    account_id, from_location_id, to_location_id, recipe_item_id,
    qty_base, unit_cost, cost_eur, notes, occurred_at, created_by, created_by_name
  ) values (
    p_account_id, p_from_location, p_to_location, p_recipe_item_id,
    p_qty_base, v_unit_cost, v_cost_eur, p_notes, now(), p_user_id, p_user_name
  ) returning id into v_transfer_id;

  -- Salida del origen.
  insert into public.stock_movement(
    account_id, location_id, recipe_item_id, movement_type, qty_base,
    unit_cost, cost_provisional, source_type, source_id, occurred_at,
    created_by, created_by_name, notes
  ) values (
    p_account_id, p_from_location, p_recipe_item_id, 'traspaso_salida', -p_qty_base,
    v_unit_cost, false, 'transfer', v_transfer_id, now(),
    p_user_id, p_user_name, coalesce('Traspaso: ' || p_notes, 'Traspaso')
  );

  -- Entrada en el destino (con el coste del origen).
  insert into public.stock_movement(
    account_id, location_id, recipe_item_id, movement_type, qty_base,
    unit_cost, cost_provisional, source_type, source_id, occurred_at,
    created_by, created_by_name, notes
  ) values (
    p_account_id, p_to_location, p_recipe_item_id, 'traspaso_entrada', p_qty_base,
    v_unit_cost, false, 'transfer', v_transfer_id, now(),
    p_user_id, p_user_name, coalesce('Traspaso: ' || p_notes, 'Traspaso')
  );

  -- Recalcular ambos saldos.
  perform public.recompute_location_stock_core(p_recipe_item_id, p_from_location);
  perform public.recompute_location_stock_core(p_recipe_item_id, p_to_location);

  return query select v_transfer_id, v_cost_eur;
end;
$function$;

grant execute on function public.register_transfer(uuid, uuid, uuid, uuid, numeric, text, uuid, text) to authenticated;
