-- 20260814T1310_recepcion_oficina_a2_confirm_guard_undecided.sql
-- ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, Tramo A.2
-- Aplicada: 14/08/2026 vía MCP, verificada con query independiente contra pg_proc.
--
-- Construida desde pg_get_functiondef('public.confirm_goods_receipt') de
-- PRODUCCIÓN (14/08), no desde el repo (producción va por delante). Dos
-- cambios sobre el cuerpo vivo:
--   1) Puerta nueva: sobre el camino 'recibido' (el asistente ya metió el
--      stock), no se puede cerrar con líneas sin decidir (ni casadas al
--      almacén ni marcadas not_goods). El botón deshabilitado del cliente es
--      la cortesía; esta es la guarda real — "ninguna línea se pierde en
--      silencio". El camino 'borrador' conserva su comportamiento de
--      siempre (compatibilidad con lo que no pasa por el asistente).
--   2) needs_review real: antes era (v_skipped > 0) y en el camino
--      'recibido' v_skipped es SIEMPRE 0 (no postea nada ahí) → confirmar
--      dejaba needs_review=false con líneas nunca ingresadas. Sustituido por
--      el cálculo real (mismo criterio que la puerta nueva); con la puerta
--      de arriba será false por construcción en el camino nuevo, hace falta
--      para el histórico y para el camino 'borrador'.

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
  v_undecided integer;   -- ENCARGO CODE (14/08) A.2 — líneas sin decidir en 'recibido'
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

  -- ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, A.2 — la guarda real.
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
        needs_review = exists (
          select 1 from goods_receipt_line
           where goods_receipt_id = p_receipt_id
             and not not_goods
             and (recipe_item_id is null or qty_in_base is null or qty_in_base <= 0)
        ),
        updated_at = now()
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

-- ── Verificación (aborta si el objeto no quedó) ──────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='confirm_goods_receipt'
      and pg_get_functiondef(p.oid) ilike '%v_undecided%'
  ) then
    raise exception 'A.2: confirm_goods_receipt no quedó con la guarda v_undecided';
  end if;
end $$;
