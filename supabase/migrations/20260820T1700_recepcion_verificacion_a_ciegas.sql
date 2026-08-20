-- 20260820T1700_recepcion_verificacion_a_ciegas.sql
-- ENCARGO CODE (20/08) «Verificar un albarán a ciegas» — §3.
--
-- PROPUESTA. NO APLICADA. Claude Code propone, Julio ejecuta y verifica.
--
-- ── El problema ──────────────────────────────────────────────────────────
-- La IA marca needs_review con motivos (documento manuscrito, no cuadra la
-- base imponible, confianza baja) y ese aviso NO llega al albarán:
--
--   1) ReceiptWizard llama a createGoodsReceipt SIN needsReview → false.
--   2) Aunque lo pasara, receive_goods_receipt PISA la columna:
--        needs_review = (v_skipped > 0)
--      así que un albarán con todas las líneas casadas sale needs_review=false
--      por definición, diga lo que diga la IA.
--   3) _post_goods_receipt_lines postea el stock antes de que nadie mire.
--
-- Caso real: ALB-00119 (20/08, Alcalá, Pamela). Sesión de IA con
-- needs_review=true y tres motivos; recepción creada con needs_review=false;
-- 424,27 € de milanesas posteados con unit_cost NULL.
--
-- ── Lo que hace esta migración ───────────────────────────────────────────
--   A) _post_goods_receipt_lines(p_receipt_id, p_only_unposted default false)
--      Parámetro nuevo: postear SOLO las líneas que nunca han posteado
--      (sin stock_movement con source_id = la línea). Sin el parámetro se
--      comporta EXACTAMENTE como hoy.
--
--   B) receive_goods_receipt(p_receipt_id, p_hold default false)
--      p_hold = "la IA pidió revisión": deja el albarán en 'recibido' para
--      que la oficina lo pueda abrir y corregir, pero NO postea NADA y marca
--      needs_review=true. Sin el parámetro se comporta como hoy, salvo que
--      ya no PISA un needs_review que venga puesto de antes:
--        needs_review = (v_skipped > 0) OR v_receipt.needs_review
--
--   C) confirm_goods_receipt(p_receipt_id)
--      Al cerrar un 'recibido', postea las líneas que aún no habían posteado
--      (p_only_unposted := true). Eso es lo que hace que la mercancía de un
--      albarán retenido entre al almacén cuando un humano lo cierra, y NO
--      antes. Para un 'recibido' normal no cambia nada: todas sus líneas
--      posteables ya tienen movimiento, así que no postea ninguna otra vez.
--
-- ── Por qué 'recibido' y no 'borrador' ───────────────────────────────────
-- Un borrador va a GoodsReceiptForm, no a la pantalla de oficina, y
-- adjust_goods_receipt_line EXIGE status='recibido'. Retener en 'borrador'
-- dejaría el albarán fuera del único sitio donde se puede corregir. Por eso
-- se retiene el POSTEO, no el estado.
--
-- El reposteo tardío ya tiene camino hecho: adjust_goods_receipt_line A.3.bis
-- (14/08) detecta que una línea nunca posteó y la mete como 'recepcion'
-- retrofechada al received_at del albarán, no como 'ajuste'. Una línea
-- retenida que la oficina corrige entra por ahí; las que no toque entran al
-- cerrar, por (C).
--
-- ⚠️ CREATE OR REPLACE con una lista de parámetros distinta crea una
-- SOBRECARGA nueva, no sustituye la función. Se DROPean las firmas viejas.

begin;

-- ── A) _post_goods_receipt_lines: postear solo lo no posteado ────────────
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
    -- Una línea que ya tiene movimiento no se vuelve a postear jamás: es lo
    -- que hace que cerrar un albarán retenido sea seguro aunque la oficina
    -- ya haya corregido parte de sus líneas por adjust_goods_receipt_line.
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

-- ── B) receive_goods_receipt: retener el posteo si la IA pidió revisión ──
create or replace function public.receive_goods_receipt(
  p_receipt_id uuid,
  p_hold boolean default false
)
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

  if p_hold then
    -- ENCARGO CODE (20/08) §3(B) — la IA pidió revisión: NADA entra al
    -- almacén. El albarán queda en 'recibido' para que la oficina lo pueda
    -- abrir y corregir; el stock entra cuando un humano lo cierre.
    select count(*) into v_skipped
      from goods_receipt_line
     where goods_receipt_id = p_receipt_id and not not_goods;
  else
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id) p;
  end if;

  update goods_receipt
    set status = 'recibido', received_at = coalesce(received_at, now()),
        -- Ya no se PISA la bandera: si venía puesta (la IA pidió revisión al
        -- crear la recepción), se respeta.
        needs_review = (p_hold or v_skipped > 0 or coalesce(needs_review, false)),
        updated_at = now()
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

drop function if exists public.receive_goods_receipt(uuid);

-- ── C) confirm_goods_receipt: al cerrar, entra lo que aún no había entrado ─
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
    -- La cabecera es parte de la verificación: un albarán sin emisor no se
    -- puede casar con su factura ni reclamar. Solo en el cierre de OFICINA
    -- ('recibido' → 'confirmado'), que es la pantalla que tiene los campos;
    -- un borrador manual sigue como estaba para no levantar un muro sin
    -- puerta en un sitio donde no se puede arreglar.
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
    -- ENCARGO CODE (20/08) §3(C) — 'recibido': entra lo que nunca entró. En
    -- un albarán normal no hay nada que postear (todas sus líneas posteables
    -- ya tienen movimiento); en uno retenido por la IA, entra todo aquí.
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

-- ── Permisos ─────────────────────────────────────────────────────────────
grant execute on function public._post_goods_receipt_lines(uuid, boolean) to authenticated;
grant execute on function public.receive_goods_receipt(uuid, boolean) to authenticated;
grant execute on function public.confirm_goods_receipt(uuid) to authenticated;

-- ── Verificación (falla la transacción si algo no quedó como se dice) ────
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_post_goods_receipt_lines') <> 1 then
    raise exception 'A: debería quedar EXACTAMENTE una _post_goods_receipt_lines';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'receive_goods_receipt') <> 1 then
    raise exception 'B: debería quedar EXACTAMENTE una receive_goods_receipt';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = '_post_goods_receipt_lines'
      and pg_get_function_identity_arguments(p.oid) = 'uuid, boolean'
  ) then
    raise exception 'A: _post_goods_receipt_lines no quedó con (uuid, boolean)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'receive_goods_receipt'
      and pg_get_function_identity_arguments(p.oid) = 'uuid, boolean'
  ) then
    raise exception 'B: receive_goods_receipt no quedó con (uuid, boolean)';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_goods_receipt'
      and pg_get_functiondef(p.oid) like '%_post_goods_receipt_lines(p_receipt_id, true)%'
  ) then
    raise exception 'C: confirm_goods_receipt no quedó posteando lo no posteado';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'confirm_goods_receipt'
      and pg_get_functiondef(p.oid) like '%no tiene nº de albarán%'
  ) then
    raise exception 'C: confirm_goods_receipt no quedó exigiendo nº de albarán';
  end if;
end $$;

commit;
