-- 20260820T1700 · A) _post_goods_receipt_lines gana p_only_unposted.
-- Sin el parámetro se comporta EXACTAMENTE como hoy.
create or replace function public._post_goods_receipt_lines(
  p_receipt_id uuid,
  p_only_unposted boolean default false
)
 returns table(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt   goods_receipt%rowtype;
  v_line      goods_receipt_line%rowtype;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_fmt_qib   numeric;
  v_qib       numeric;
  v_eur_base  numeric;
  v_area_id   uuid;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception '_post_goods_receipt_lines: albarán % no existe', p_receipt_id;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  for v_line in
    select * from goods_receipt_line
    where goods_receipt_id = p_receipt_id
    order by position asc, created_at asc
  loop
    -- ENCARGO CODE (20/08) §3(A) — modo "solo lo que no ha posteado nunca".
    if p_only_unposted and exists (
      select 1 from stock_movement
      where source_type = 'goods_receipt_line' and source_id = v_line.id
    ) then
      continue;
    end if;

    v_qib := null;
    if v_line.purchase_format_id is not null then
      select f.qty_in_base into v_fmt_qib
        from recipe_item_purchase_format f
        where f.id = v_line.purchase_format_id and f.is_active;
      if v_fmt_qib is not null and v_fmt_qib > 0
         and v_line.qty_received is not null and v_line.qty_received > 0 then
        v_qib := v_line.qty_received * v_fmt_qib;
      end if;
    end if;
    if v_qib is null then
      v_qib := v_line.qty_in_base;
    end if;

    if v_line.recipe_item_id is null or v_qib is null or v_qib <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_qib is distinct from v_line.qty_in_base then
      update goods_receipt_line
        set qty_in_base = v_qib, updated_at = now()
        where id = v_line.id;
    end if;

    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);

    v_area_id := null;
    select sa.id into v_area_id
      from recipe_item_storage_area risa
      join storage_area sa on sa.id = risa.storage_area_id
      where risa.recipe_item_id = v_line.recipe_item_id
        and risa.account_id     = v_receipt.account_id
        and sa.location_id      = v_receipt.location_id
        and sa.active
      order by risa.position asc, sa.position asc
      limit 1;

    insert into stock_movement (
      account_id, location_id, recipe_item_id, storage_area_id,
      movement_type, qty_base, unit_cost, cost_provisional,
      source_type, source_id, lot_code, expiry_date,
      occurred_at, created_by, created_by_name
    )
    values (
      v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id, v_area_id,
      'recepcion', v_qib,
      coalesce(
        v_eur_base,
        case when v_line.unit_cost is not null and v_line.qty_received > 0
             then (v_line.unit_cost * v_line.qty_received) / v_qib end
      ),
      true,
      'goods_receipt_line', v_line.id,
      v_line.lot_code, v_line.expiry_date,
      coalesce(v_receipt.received_at, now()), v_user, v_user_name
    );

    perform recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

    if v_eur_base is not null and v_line.purchase_format_id is not null then
      update article_supplier
        set last_price = v_eur_base, updated_at = now()
        where account_id        = v_receipt.account_id
          and recipe_item_id    = v_line.recipe_item_id
          and purchase_format_id = v_line.purchase_format_id
          and is_active;
    end if;

    v_posted := v_posted + 1;
  end loop;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

drop function if exists public._post_goods_receipt_lines(uuid);
grant execute on function public._post_goods_receipt_lines(uuid, boolean) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_post_goods_receipt_lines') <> 1 then
    raise exception 'A: debería quedar EXACTAMENTE una _post_goods_receipt_lines';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_post_goods_receipt_lines'
      and p.pronargs = 2 and p.pronargdefaults = 1
  ) then
    raise exception 'A: no quedó con (uuid, boolean default)';
  end if;
end $$;