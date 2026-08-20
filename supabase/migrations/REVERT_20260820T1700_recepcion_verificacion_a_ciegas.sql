-- REVERT de 20260820T1700_recepcion_verificacion_a_ciegas.sql
--
-- NO es una migración: es el botón de deshacer. Transcrito de
-- pg_get_functiondef() de PRODUCCIÓN el 20/08/2026 ANTES de aplicar, para las
-- tres funciones que la migración toca. Deja la base exactamente como estaba.
--
-- Uso: solo si la migración causa un problema. Después de ejecutarlo hay que
-- volver el frontend a un commit anterior a 81b4f6c, o dejarlo: el cliente
-- llama con UN argumento cuando hold=false, así que sigue funcionando.

begin;

-- ── A) _post_goods_receipt_lines: volver a la firma de 1 argumento ───────
create or replace function public._post_goods_receipt_lines(p_receipt_id uuid)
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

-- ── B) receive_goods_receipt: volver a la firma de 1 argumento ───────────
create or replace function public.receive_goods_receipt(p_receipt_id uuid)
 returns table(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt goods_receipt%rowtype;
  v_posted  integer := 0;
  v_skipped integer := 0;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'receive_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'receive_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status <> 'borrador' then
    raise exception 'receive_goods_receipt: el albarán % no está en borrador (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  select p.posted_lines, p.skipped_lines into v_posted, v_skipped
    from public._post_goods_receipt_lines(p_receipt_id) p;

  update goods_receipt
    set status = 'recibido', received_at = coalesce(received_at, now()),
        needs_review = (v_skipped > 0), updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- ── C) confirm_goods_receipt: sin posteo tardío y sin exigir cabecera ────
create or replace function public.confirm_goods_receipt(p_receipt_id uuid)
 returns table(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt   goods_receipt%rowtype;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_notify    text;
  v_has_diff  boolean;
  v_undecided integer;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status not in ('borrador', 'recibido') then
    raise exception 'confirm_goods_receipt: el albarán % no está en borrador ni recibido (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  if v_receipt.status = 'recibido' then
    select count(*) into v_undecided
      from goods_receipt_line
     where goods_receipt_id = p_receipt_id
       and not not_goods
       and (recipe_item_id is null or qty_in_base is null or qty_in_base <= 0);
    if v_undecided > 0 then
      raise exception 'confirm_goods_receipt: quedan % línea(s) sin decidir en % — cada una tiene '
        'que entrar al almacén o marcarse como que no es mercancía', v_undecided, v_receipt.code;
    end if;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  if v_receipt.status = 'borrador' then
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id) p;
  end if;

  update goods_receipt
    set status = 'confirmado', received_at = coalesce(received_at, now()),
        needs_review = exists (
          select 1 from goods_receipt_line
           where goods_receipt_id = p_receipt_id
             and not not_goods
             and (recipe_item_id is null or qty_in_base is null or qty_in_base <= 0)
        ),
        updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  v_notify := null;
  if v_receipt.supplier_id is not null then
    select notify_group into v_notify from supplier where id = v_receipt.supplier_id;
  end if;
  if v_notify = 'ctb' then
    select exists (
      select 1 from goods_receipt_line
      where goods_receipt_id = p_receipt_id
        and discrepancy_reason is not null
        and btrim(discrepancy_reason) <> ''
    ) into v_has_diff;

    insert into ctb_notification_queue (
      account_id, goods_receipt_id, location_id, supplier_id,
      notify_group, has_differences, status
    )
    values (
      v_receipt.account_id, p_receipt_id, v_receipt.location_id, v_receipt.supplier_id,
      v_notify, coalesce(v_has_diff, false), 'pendiente'
    )
    on conflict (goods_receipt_id) do update
      set has_differences = excluded.has_differences,
          location_id     = excluded.location_id,
          supplier_id     = excluded.supplier_id,
          updated_at      = now();
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- Fuera las firmas de 2 argumentos que introdujo la migración.
drop function if exists public._post_goods_receipt_lines(uuid, boolean);
drop function if exists public.receive_goods_receipt(uuid, boolean);

grant execute on function public._post_goods_receipt_lines(uuid) to authenticated;
grant execute on function public.receive_goods_receipt(uuid) to authenticated;
grant execute on function public.confirm_goods_receipt(uuid) to authenticated;

commit;
