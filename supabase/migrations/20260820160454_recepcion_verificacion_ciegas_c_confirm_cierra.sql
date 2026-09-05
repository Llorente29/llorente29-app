-- 20260820T1700 · C) confirm_goods_receipt: al cerrar un 'recibido' entra lo
-- que nunca entró, y sin proveedor ni nº de albarán no se cierra.
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

    -- ENCARGO CODE (20/08) §2.3 — sin proveedor ni nº de albarán no se cierra.
    -- Solo en el cierre de OFICINA ('recibido' → 'confirmado'), que es la
    -- pantalla que tiene los campos; un borrador manual sigue como estaba
    -- para no levantar un muro sin puerta donde no se puede arreglar.
    if v_receipt.supplier_id is null then
      raise exception 'confirm_goods_receipt: el albarán % no tiene proveedor — ponlo antes de cerrar',
        coalesce(v_receipt.code, p_receipt_id::text);
    end if;
    if v_receipt.supplier_doc_number is null or btrim(v_receipt.supplier_doc_number) = '' then
      raise exception 'confirm_goods_receipt: el albarán % no tiene nº de albarán — ponlo antes de cerrar',
        coalesce(v_receipt.code, p_receipt_id::text);
    end if;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  if v_receipt.status = 'borrador' then
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id, false) p;
  else
    -- ENCARGO CODE (20/08) §3(C) — 'recibido': entra lo que nunca entró. En un
    -- albarán normal no hay nada que postear (todas sus líneas posteables ya
    -- tienen movimiento); en uno retenido por la IA, entra todo aquí.
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id, true) p;
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

grant execute on function public.confirm_goods_receipt(uuid) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'confirm_goods_receipt') <> 1 then
    raise exception 'C: debería quedar EXACTAMENTE una confirm_goods_receipt';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_goods_receipt'
      and pg_get_functiondef(p.oid) like '%_post_goods_receipt_lines(p_receipt_id, true)%'
  ) then
    raise exception 'C: no quedó posteando lo no posteado';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_goods_receipt'
      and pg_get_functiondef(p.oid) like '%no tiene nº de albarán%'
  ) then
    raise exception 'C: no quedó exigiendo nº de albarán';
  end if;
end $$;