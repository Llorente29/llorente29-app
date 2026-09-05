-- ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, A.3 + A.3.bis —
-- construida desde pg_get_functiondef('public.adjust_goods_receipt_line') de
-- PRODUCCIÓN (14/08). El motor de reverso/reposteo NO se reescribe: se le
-- inserta el caso not_goods (A.3) y se corrige movement_type/occurred_at
-- cuando la línea NUNCA había posteado antes (A.3.bis, decisión de Julio):
-- eso no es una corrección, es una entrega que llega tarde.
create or replace function public.adjust_goods_receipt_line(
  p_line_id uuid,
  p_recipe_item_id uuid,
  p_purchase_format_id uuid,
  p_qty_received numeric,
  p_unit_cost numeric,
  p_discrepancy_reason text,
  p_not_goods boolean default false,
  p_not_goods_kind text default null
)
 returns table(closed_period_note text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_line          goods_receipt_line%rowtype;
  v_receipt       goods_receipt%rowtype;
  v_user          uuid;
  v_user_name     text;
  v_old_qib       numeric;
  v_new_qib       numeric;
  v_new_fmt_qib   numeric;
  v_new_eur       numeric;
  v_area_id       uuid;
  v_changed       boolean;
  v_had_movement  boolean;  -- A.3.bis: ¿esta línea ya posteó alguna vez?
  v_movement_type text;
  v_occurred_at   timestamptz;
  v_closed_at     timestamptz;  -- cierre de inventario más reciente que "encierra" el periodo
  v_note          text;
begin
  select * into v_line from goods_receipt_line where id = p_line_id;
  if not found then
    raise exception 'adjust_goods_receipt_line: línea % no existe', p_line_id;
  end if;
  select * into v_receipt from goods_receipt where id = v_line.goods_receipt_id;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'adjust_goods_receipt_line: sin acceso a la línea %', p_line_id;
  end if;
  if v_receipt.status <> 'recibido' then
    raise exception 'adjust_goods_receipt_line: el albarán % no está recibido (está %) — '
      'para revisar un borrador usa el flujo normal; para corregir una confirmada usa '
      'anular y corregir', v_receipt.id, v_receipt.status;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  -- qty_in_base NUEVO — mismo criterio server-side que _post_goods_receipt_lines.
  -- ENCARGO CODE (14/08) A.3 — si la oficina marca "no es mercancía", nunca
  -- resuelve a algo posteable (no se calcula ni se reposteará más abajo).
  v_new_qib := null;
  if not p_not_goods and p_purchase_format_id is not null then
    select f.qty_in_base into v_new_fmt_qib
      from recipe_item_purchase_format f
      where f.id = p_purchase_format_id and f.is_active;
    if v_new_fmt_qib is not null and v_new_fmt_qib > 0
       and p_qty_received is not null and p_qty_received > 0 then
      v_new_qib := p_qty_received * v_new_fmt_qib;
    end if;
  end if;

  v_old_qib := v_line.qty_in_base;
  v_changed := (v_line.recipe_item_id is distinct from p_recipe_item_id)
            or (v_old_qib is distinct from v_new_qib)
            or (v_line.unit_cost is distinct from p_unit_cost)
            or (v_line.not_goods is distinct from p_not_goods);

  if v_changed then
    -- REVERSO de lo ya posteado con el artículo VIEJO (si lo había) — al coste del
    -- último movimiento real de esta línea, no al unit_cost nuevo que aún no aplica.
    if v_line.recipe_item_id is not null and v_old_qib is not null and v_old_qib > 0 then
      insert into stock_movement (
        account_id, location_id, recipe_item_id,
        movement_type, qty_base, unit_cost, cost_provisional,
        source_type, source_id, lot_code, expiry_date,
        occurred_at, notes, created_by, created_by_name
      )
      select
        v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id,
        'ajuste', -v_old_qib, sm.unit_cost, sm.cost_provisional,
        'goods_receipt_line', v_line.id, v_line.lot_code, v_line.expiry_date,
        now(), 'Ajuste de oficina sobre ' || coalesce(v_receipt.code, v_receipt.id::text),
        v_user, v_user_name
      from stock_movement sm
      where sm.source_type = 'goods_receipt_line' and sm.source_id = v_line.id
      order by sm.occurred_at desc
      limit 1;

      perform recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);
    end if;

    -- REPOSTEO con el artículo/formato/cantidad/coste NUEVOS (si resuelve a algo
    -- posteable y no es "no es mercancía").
    if not p_not_goods and p_recipe_item_id is not null and v_new_qib is not null and v_new_qib > 0 then
      -- ENCARGO CODE (14/08) A.3.bis (decisión de Julio) — ¿esta línea ya había
      -- posteado alguna vez? Si NO, esto no es una corrección: es una entrega
      -- que llega tarde (la mercancía físicamente entró al recibir, día del
      -- albarán; la oficina solo la está casando ahora).
      select exists (
        select 1 from stock_movement
        where source_type = 'goods_receipt_line' and source_id = v_line.id
      ) into v_had_movement;

      if v_had_movement then
        v_movement_type := 'ajuste';
        v_occurred_at := now();
        v_note := null;
      else
        v_movement_type := 'recepcion';
        -- Excepción de periodo cerrado: si hay un inventario de este local YA
        -- CERRADO (closed_at no nulo) cuyo cierre cae DESPUÉS de la fecha del
        -- albarán, retrofechar tocaría un recuento ya asentado. Entra justo
        -- después del corte, nunca dentro del periodo ya contado.
        select max(ic.closed_at) into v_closed_at
          from inventory_count ic
         where ic.account_id = v_receipt.account_id
           and ic.location_id = v_receipt.location_id
           and ic.status <> 'anulado'
           and ic.closed_at is not null
           and ic.closed_at > coalesce(v_receipt.received_at, v_receipt.created_at);

        if v_closed_at is not null then
          v_occurred_at := v_closed_at + interval '1 second';
          v_note := 'Se contó el inventario después de este albarán, así que esta entrada se registra a partir del recuento.';
        else
          v_occurred_at := coalesce(v_receipt.received_at, now());
          v_note := null;
        end if;
      end if;

      v_new_eur := public._eur_base_from_format(p_purchase_format_id, p_unit_cost);

      v_area_id := null;
      select sa.id into v_area_id
        from recipe_item_storage_area risa
        join storage_area sa on sa.id = risa.storage_area_id
        where risa.recipe_item_id = p_recipe_item_id
          and risa.account_id     = v_receipt.account_id
          and sa.location_id      = v_receipt.location_id
          and sa.active
        order by risa.position asc, sa.position asc
        limit 1;

      insert into stock_movement (
        account_id, location_id, recipe_item_id, storage_area_id,
        movement_type, qty_base, unit_cost, cost_provisional,
        source_type, source_id, lot_code, expiry_date,
        occurred_at, notes, created_by, created_by_name
      )
      values (
        v_receipt.account_id, v_receipt.location_id, p_recipe_item_id, v_area_id,
        v_movement_type, v_new_qib,
        coalesce(
          v_new_eur,
          case when p_unit_cost is not null and p_qty_received > 0
               then (p_unit_cost * p_qty_received) / v_new_qib end
        ),
        true,
        'goods_receipt_line', v_line.id, v_line.lot_code, v_line.expiry_date,
        v_occurred_at,
        case when v_movement_type = 'ajuste'
             then 'Ajuste de oficina sobre ' || coalesce(v_receipt.code, v_receipt.id::text)
             else 'Entrada tardía (oficina) sobre ' || coalesce(v_receipt.code, v_receipt.id::text)
        end,
        v_user, v_user_name
      );

      perform recompute_location_stock(p_recipe_item_id, v_receipt.location_id);

      if v_new_eur is not null and p_purchase_format_id is not null then
        update article_supplier
          set last_price = v_new_eur, updated_at = now()
          where account_id        = v_receipt.account_id
            and recipe_item_id    = p_recipe_item_id
            and purchase_format_id = p_purchase_format_id
            and is_active;
      end if;
    end if;
  end if;

  update goods_receipt_line
    set recipe_item_id = p_recipe_item_id,
        purchase_format_id = p_purchase_format_id,
        qty_received = p_qty_received,
        qty_in_base = v_new_qib,
        unit_cost = p_unit_cost,
        discrepancy_reason = coalesce(p_discrepancy_reason, discrepancy_reason),
        not_goods = p_not_goods,
        not_goods_kind = case when p_not_goods then p_not_goods_kind else null end,
        updated_at = now()
    where id = p_line_id;

  closed_period_note := v_note;
  return next;
end;
$function$;

notify pgrst, 'reload schema';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='adjust_goods_receipt_line'
      and pg_get_function_arguments(p.oid) ilike '%p_not_goods%'
  ) then
    raise exception 'A.3: adjust_goods_receipt_line no quedó con p_not_goods en la firma';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='adjust_goods_receipt_line'
      and pg_get_functiondef(p.oid) ilike '%v_had_movement%'
  ) then
    raise exception 'A.3.bis: adjust_goods_receipt_line no quedó con la lógica de entrada tardía';
  end if;
end $$;