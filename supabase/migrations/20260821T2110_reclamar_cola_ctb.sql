-- 20260821T2110_reclamar_cola_ctb.sql
-- ENCARGO CODE (21/08) §3 — la cola de CTB aprende a colgar de un PEDIDO.
-- APLICADA: 21/08/2026 vía MCP, verificada (55 filas intactas, CHECK activo,
-- reclamación de prueba encolada y borrada).
--
-- ── La pregunta del §3 sobre WhatsApp, contestada ────────────────────────
-- ctb_notification_queue lleva 55 notificaciones ENVIADAS, la última hoy, y YA
-- SALE POR WHATSAPP: CtbNotifyPage usa Web Share con el albarán adjunto y, en
-- PC, portapapeles + abrir el fichero. No hay proveedor de mensajería; el
-- humano es el transporte, a propósito ("no hay canal oficial robusto a grupos
-- de WhatsApp", dice su propia cabecera). Así que no hay canal que añadir ni
-- nada que preguntar: ya es WhatsApp.
--
-- ⚠️ goods_receipt_id pasa a ser NULLABLE. Es lo que permite una notificación
-- de pedido, y el CHECK garantiza que siga siendo imposible una fila sin
-- ninguno de los dos — que es lo que el NOT NULL protegía de verdad.
-- La UNIQUE (goods_receipt_id) se queda: en Postgres los NULL son distintos
-- entre sí, así que no estorba a las filas de pedido y sigue sosteniendo el
-- `on conflict (goods_receipt_id)` de confirm_goods_receipt.

alter table public.ctb_notification_queue
  alter column goods_receipt_id drop not null;

alter table public.ctb_notification_queue
  add column if not exists purchase_order_id uuid references public.purchase_order(id) on delete cascade;

-- Una notificación es de una recepción O de un pedido. Nunca de las dos, nunca
-- de ninguna. Lo verifica el motor, no la buena voluntad (criterio 4).
alter table public.ctb_notification_queue
  drop constraint if exists ctb_queue_recepcion_o_pedido;
alter table public.ctb_notification_queue
  add constraint ctb_queue_recepcion_o_pedido
  check (num_nonnulls(goods_receipt_id, purchase_order_id) = 1);

-- NO se pone unique sobre purchase_order_id: reclamar dos veces tiene que poder
-- hacerse y VERSE (§3.5). El rastro es el valor, no un candado.
create index if not exists idx_ctb_queue_purchase_order
  on public.ctb_notification_queue (purchase_order_id)
  where purchase_order_id is not null;

comment on column public.ctb_notification_queue.purchase_order_id is
  'Reclamación de lo que falta de un pedido. Excluyente con goods_receipt_id (ctb_queue_recepcion_o_pedido).';

-- ── Encolar una reclamación ──────────────────────────────────────────────
create or replace function public.queue_ctb_order_claim(p_order_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order  purchase_order%rowtype;
  v_notify text;
  v_faltan integer;
  v_id     uuid;
begin
  select * into v_order from purchase_order where id = p_order_id;
  if not found then
    raise exception 'queue_ctb_order_claim: el pedido % no existe', p_order_id;
  end if;
  if not public.belongs_to_account(v_order.account_id) then
    raise exception 'queue_ctb_order_claim: sin acceso al pedido %', p_order_id;
  end if;

  if v_order.supplier_id is null then
    raise exception 'queue_ctb_order_claim: el pedido % no tiene proveedor', coalesce(v_order.code, p_order_id::text);
  end if;
  select notify_group into v_notify from supplier where id = v_order.supplier_id;
  if coalesce(v_notify, '') <> 'ctb' then
    -- Sin fallo mudo: se dice POR QUÉ no se puede, no se devuelve null.
    raise exception 'queue_ctb_order_claim: el proveedor de % no comunica por el grupo de CTB, no hay a dónde reclamar desde aquí',
      coalesce(v_order.code, p_order_id::text);
  end if;

  -- No se reclama un pedido al que no le falta nada: sería mandar ruido al grupo.
  select count(*) into v_faltan
    from public.purchase_order_shortfall(p_order_id) s where s.qty_missing > 0;
  if v_faltan = 0 then
    raise exception 'queue_ctb_order_claim: a % no le falta nada que reclamar', coalesce(v_order.code, p_order_id::text);
  end if;

  insert into ctb_notification_queue (
    account_id, goods_receipt_id, purchase_order_id, location_id, supplier_id,
    notify_group, has_differences, status
  )
  values (
    v_order.account_id, null, p_order_id, v_order.location_id, v_order.supplier_id,
    'ctb', true, 'pendiente'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.queue_ctb_order_claim(uuid) to authenticated;

-- ── Verificación ─────────────────────────────────────────────────────────
do $$
declare v_po uuid; v_id uuid; v_ok boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}', true);

  -- 1) Las 55 de siempre siguen ahí y siguen siendo de recepción (criterio 6).
  if (select count(*) from ctb_notification_queue) <> 55 then
    raise exception 'la cola debería seguir con 55 filas';
  end if;
  if (select count(*) from ctb_notification_queue where goods_receipt_id is null) <> 0 then
    raise exception 'alguna fila existente se quedó sin goods_receipt_id';
  end if;

  -- 2) El CHECK impide de verdad las dos a null (criterio 4).
  begin
    insert into ctb_notification_queue (account_id, goods_receipt_id, purchase_order_id, notify_group, has_differences, status)
    values ((select id from accounts limit 1), null, null, 'ctb', false, 'pendiente');
    raise exception 'FALLO: dejó insertar una fila SIN recepción y SIN pedido';
  exception when check_violation then null;
  end;

  -- 3) Encolar una reclamación real de PED-00042 y deshacerla.
  select id into v_po from purchase_order where code = 'PED-00042';
  if v_po is not null then
    v_id := public.queue_ctb_order_claim(v_po);
    select (purchase_order_id = v_po and goods_receipt_id is null and status = 'pendiente')
      into v_ok from ctb_notification_queue where id = v_id;
    if not coalesce(v_ok, false) then
      raise exception 'FALLO: la reclamación no quedó bien formada';
    end if;
    delete from ctb_notification_queue where id = v_id;
  end if;

  raise notice 'OK: cola con 55 intactas, CHECK activo, reclamación de pedido válida';
end $$;
