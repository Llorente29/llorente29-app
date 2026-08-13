-- 20260813T2000_recepcion_v2_recibido_status.sql
-- ENCARGO CODE (13/08) feat/recepcion-v2-asistente, Tramo B — "el stock entra al recibir".
-- Diseño: claude_folvy_recepcion_pantalla_diseno_20260813.md §3/§4.
--
-- RECON verificado por MCP ANTES de escribir esto (13/08):
--   - Único trigger de goods_receipt: trg_set_goods_receipt_code (código, nada de stock).
--   - confirm_goods_receipt es hoy la ÚNICA función que postea a stock_movement, y exige
--     status='borrador'. Es "el motor de stock" — de ahí el patrón quirúrgico de abajo.
--   - goods_receipt.status es un CHECK, no un enum nativo — añadir 'recibido' es una
--     sustitución de constraint, no un ALTER TYPE con sus restricciones transaccionales.
--   - void_goods_receipt exige status='confirmado' — NO sirve para deshacer un movimiento de
--     un albarán 'recibido' (aún no confirmado). Point resuelto en adjust_goods_receipt_line
--     de abajo (reverso + reposteo por línea, mismo patrón que void_goods_receipt ya usa).
--
-- QUÉ CAMBIA:
--   1) goods_receipt.status admite 'recibido' entre 'borrador' y 'confirmado'.
--   2) goods_receipt_line.flagged_for_office (columna NUEVA): la ⚑ del asistente ("que lo
--      mire la oficina"). Se descarta reutilizar map_needs_review porque significa otra cosa
--      (certeza del casado, ya se escribe hoy con esa semántica) — mezclarlas rompería sus
--      consumidores actuales sin avisar. Ver RECON en el encargo, invitaba a decidir esto.
--   3) _post_goods_receipt_lines(uuid) — la LÓGICA DE POSTEO de confirm_goods_receipt,
--      extraída tal cual (copia byte a byte del bucle vivo, verificado por
--      pg_get_functiondef antes de escribir esto) a una función interna compartida. NINGÚN
--      cambio de comportamiento en ella.
--   4) confirm_goods_receipt: mismo cuerpo, con DOS cambios quirúrgicos —
--      (a) el guard admite 'borrador' O 'recibido' (antes solo 'borrador');
--      (b) el bucle de posteo se sustituye por una llamada a _post_goods_receipt_lines,
--          y SOLO se ejecuta si status='borrador' (camino antiguo, compatibilidad con
--          cualquier recepción que siga sin pasar por el asistente). Sobre 'recibido' NO
--          postea nada (el stock ya entró) — solo cierra a 'confirmado'. El resto de la
--          función (aviso a CTB, recompute_purchase_order_status) queda IDÉNTICO.
--   5) receive_goods_receipt(uuid) — NUEVA. Exige 'borrador', llama a
--      _post_goods_receipt_lines (misma lógica, sin duplicar), dEja status='recibido'.
--      NO encola aviso a CTB (eso es al CERRAR, con confirm_goods_receipt — el mismo sitio
--      de siempre, sin cambiar cuándo dispara).
--   6) adjust_goods_receipt_line(...) — NUEVA. La oficina corrige una línea de un albarán
--      YA 'recibido' (el stock ya entró): reversa el movimiento posteado con los valores
--      viejos y postea uno nuevo con los valores corregidos — mismo patrón "ajuste
--      registrado, ledger append-only" que void_goods_receipt ya usa para anular. Solo
--      escribe si algo relevante para el stock cambió de verdad (artículo/formato·cantidad/
--      coste); un guardado sin cambios no ensucia el ledger.
--
-- Grants: EXECUTE a anon/authenticated/service_role en las nuevas funciones, igual que
-- confirm_goods_receipt hoy (verificado por MCP: anon también puede — la autorización real
-- vive DENTRO de la función vía auth.uid()/belongs_to_account, no en el grant de rol).
--
-- ⚠️ NO se invoca aquí ninguna de las tres funciones contra datos reales — la migración solo
-- define el motor. Ejecutarlas para recibir/ajustar de verdad queda para cuando Julio lo
-- autorice explícitamente en pantalla (regla del encargo, §6: "confirmar mueve stock real").

-- ── 1) Estado nuevo ──────────────────────────────────────────────────────────
alter table goods_receipt drop constraint goods_receipt_status_valid;
alter table goods_receipt add constraint goods_receipt_status_valid
  check (status = any (array['borrador', 'recibido', 'confirmado', 'anulado']));

-- ── 2) La ⚑ del asistente ────────────────────────────────────────────────────
alter table goods_receipt_line
  add column if not exists flagged_for_office boolean not null default false;

-- ── 3) Lógica de posteo compartida (extraída de confirm_goods_receipt, sin cambios) ──
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
  v_eur_base  numeric;   -- €/base canónico (precio_formato / qty_in_base_formato)
  v_area_id   uuid;      -- zona principal del artículo en el local (nullable)
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
    -- qty_in_base SERVER-SIDE (cantidad que entra al stock) — sin cambios.
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

    -- ZONA PRINCIPAL del artículo en el local (menor position, zona activa).
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

-- ── 4) confirm_goods_receipt: guard ampliado + posteo condicional vía el helper ──
-- Cuerpo idéntico al vivo (verificado por pg_get_functiondef antes de escribir esto,
-- hash fbe0e760b9aa926e5f5198dc55f4e320) salvo los dos puntos marcados ENCARGO CODE
-- de abajo. El aviso a CTB y recompute_purchase_order_status quedan EXACTAMENTE igual.
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
  v_notify    text;      -- grupo de notificación del proveedor (p.ej. 'ctb')
  v_has_diff  boolean;   -- la recepción trae descuadre (línea con discrepancy_reason)
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  -- ENCARGO CODE (13/08) feat/recepcion-v2-asistente: admite 'recibido' además de
  -- 'borrador' — el camino nuevo (asistente → receive_goods_receipt → oficina cierra
  -- aquí) y el camino antiguo (confirmar postea Y cierra en un solo paso, compatibilidad
  -- con lo que no pase por el asistente) conviven.
  if v_receipt.status not in ('borrador', 'recibido') then
    raise exception 'confirm_goods_receipt: el albarán % no está en borrador ni recibido (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  -- ENCARGO CODE (13/08) feat/recepcion-v2-asistente: el bucle de posteo (antes
  -- inline aquí) vive ahora en _post_goods_receipt_lines, compartido con
  -- receive_goods_receipt — no se duplica la lógica de movimientos. Sobre 'recibido'
  -- el stock YA entró al recibir: no se postea nada aquí, solo se cierra.
  if v_receipt.status = 'borrador' then
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id) p;
  end if;

  update goods_receipt
    set status = 'confirmado', received_at = coalesce(received_at, now()),
        needs_review = (v_skipped > 0), updated_at = now()
    where id = p_receipt_id;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  -- ── ENCOLAR AVISO A CTB si el proveedor es del grupo de notificación ──
  v_notify := null;
  if v_receipt.supplier_id is not null then
    select notify_group into v_notify from supplier where id = v_receipt.supplier_id;
  end if;
  if v_notify = 'ctb' then
    -- diferencia = alguna línea con motivo de descuadre (de más / de menos / importe)
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

-- ── 5) receive_goods_receipt: nueva, el botón del asistente ("Recibir y meter al stock") ──
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

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- ── 6) adjust_goods_receipt_line: la oficina corrige una línea YA en stock ──────
-- Mismo patrón "ajuste registrado, ledger append-only" que void_goods_receipt (reversa +
-- postea, nunca UPDATE del qty_base de un movimiento ya sellado). Solo toca el ledger si
-- algo que afecta a stock/valoración cambió de verdad; un guardado sin cambios no lo ensucia.
create or replace function public.adjust_goods_receipt_line(
  p_line_id uuid,
  p_recipe_item_id uuid,
  p_purchase_format_id uuid,
  p_qty_received numeric,
  p_unit_cost numeric,
  p_discrepancy_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line        goods_receipt_line%rowtype;
  v_receipt     goods_receipt%rowtype;
  v_user        uuid;
  v_user_name   text;
  v_old_qib     numeric;
  v_new_qib     numeric;
  v_new_fmt_qib numeric;
  v_new_eur     numeric;
  v_area_id     uuid;
  v_changed     boolean;
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
  v_new_qib := null;
  if p_purchase_format_id is not null then
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
            or (v_line.unit_cost is distinct from p_unit_cost);

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

    -- REPOSTEO con el artículo/formato/cantidad/coste NUEVOS (si resuelve a algo posteable).
    if p_recipe_item_id is not null and v_new_qib is not null and v_new_qib > 0 then
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
        'ajuste', v_new_qib,
        coalesce(
          v_new_eur,
          case when p_unit_cost is not null and p_qty_received > 0
               then (p_unit_cost * p_qty_received) / v_new_qib end
        ),
        true,
        'goods_receipt_line', v_line.id, v_line.lot_code, v_line.expiry_date,
        now(), 'Ajuste de oficina sobre ' || coalesce(v_receipt.code, v_receipt.id::text),
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
        updated_at = now()
    where id = p_line_id;
end;
$function$;

-- ── 7) Grants — mismo patrón que confirm_goods_receipt (verificado por MCP: anon
--      también puede; la autorización real vive dentro de la función) ──────────
grant execute on function public._post_goods_receipt_lines(uuid) to anon, authenticated, service_role;
grant execute on function public.receive_goods_receipt(uuid) to anon, authenticated, service_role;
grant execute on function public.adjust_goods_receipt_line(uuid, uuid, uuid, numeric, numeric, text) to anon, authenticated, service_role;
