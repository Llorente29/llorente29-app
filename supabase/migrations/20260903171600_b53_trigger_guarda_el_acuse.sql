-- B53 §2 · 03/09/2026 — EL TRIGGER DEJA DE TIRAR EL IDENTIFICADOR DEL EMPUJE.
-- ===========================================================================
-- ⚠️ ESTA MIGRACION TOCA EL CAMINO VIVO DE LOS PEDIDOS (regla F6).
--    Se aplica FUERA de la banda 12:15 -> 23:45 (hora de Madrid), y NO antes de
--    que exista el secreto `order_advance_secret` en Vault. Consecuencia
--    esperada, escrita ANTES: ninguna. El empuje sigue saliendo igual y ademas
--    queda una fila por paso en sale_step_event. Si el secreto no existiera, el
--    empuje NO sale (401) — por eso la guarda de abajo lo comprueba y lo deja
--    escrito en el registro en vez de fallar en silencio.
--
-- QUE CAMBIA:
--   1. `perform net.http_post(...)` pasa a `v_req := net.http_post(...)`. El
--      `perform` descartaba el bigint que devuelve la funcion, que es el id con
--      el que pg_net indexa la respuesta en net._http_response. Tirarlo es lo que
--      nos dejo sin poder rebatir a Cloudtown.
--   2. Se escribe UNA FILA POR CAMBIO DE order_status, se empuje o no. El encargo
--      se titula "todos los pasos", y el vocabulario del §1 incluye 'recibido' y
--      'aceptado', que NO son empujables: si solo registraramos los empujes, el
--      registro mentiria por omision.
--   3. El secreto se lee de Vault (B55), no va en el cuerpo. Ver §5.
--
-- EL REGISTRO ES CONTABILIDAD, NO OPERACION: el insert va envuelto en su propio
--   bloque con `exception when others then raise warning`. Que falle el registro
--   NUNCA puede impedir que salga el pedido. Al reves no: el empuje se queda
--   fuera del bloque a proposito, para que un fallo suyo siga siendo ruidoso.
--
-- Y UN AVISO SOBRE EL `raise warning`: un warning va al log de Postgres, que no
--   lee nadie — es exactamente la trampa del autocierre (185 "succeeded" con cero
--   movimientos). Por eso la señal duradera es LA FILA, no el warning.

begin;

-- ── GUARDA PREVIA (B55): sin el secreto en Vault, esta funcion no puede empujar.
-- Aplicarla igualmente dejaria TODOS los empujes a Last en 401 hasta que alguien
-- se diera cuenta. Mejor que la migracion se niegue a entrar.
do $guarda$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'order_advance_secret') then
    raise exception
      'B53/B55: falta el secreto `order_advance_secret` en Vault. Crealo con el valor '
      'ROTADO y ponlo tambien en ORDER_ADVANCE_SECRET de la Edge order-advance ANTES '
      'de aplicar esta migracion. Ver docs/RUNBOOK_b53_b55_b54_20260903.md.';
  end if;
end
$guarda$;

create or replace function public.trg_sale_push_status()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pushable text[] := array[
    'in_preparation','awaiting_collection','awaiting_shipment',
    'in_delivery','completed','rejected','cancelled','delivery_failed'
  ];
  v_secret text;
  v_req    bigint;
  v_paso   text;
  v_estado text;
  v_detalle text;
begin
  -- Vocabulario del §1. Lo que no este mapeado se guarda tal cual: preferimos un
  -- valor desconocido a la vista que un 'cancelado' que se traga la diferencia
  -- entre rejected, cancelled y delivery_failed (B47: el delivery_failed conserva
  -- consumo A PROPOSITO, porque la comida se hizo).
  v_paso := case new.order_status
    when 'new'                 then 'recibido'
    when 'received'            then 'recibido'
    when 'accepted'            then 'aceptado'
    when 'in_preparation'      then 'en_preparacion'
    when 'awaiting_collection' then 'listo'
    when 'awaiting_shipment'   then 'listo'
    when 'in_delivery'         then 'en_reparto'
    when 'completed'           then 'entregado'
    when 'rejected'            then 'cancelado'
    when 'cancelled'           then 'cancelado'
    when 'delivery_failed'     then 'cancelado'
    else new.order_status
  end;

  if new.source = 'lastapp' and new.order_status = any(v_pushable) then
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'order_advance_secret';

    if v_secret is null or v_secret = '' then
      -- No se empuja a ciegas con una cabecera vacia: seria un 401 silencioso.
      v_estado  := 'rechazado';
      v_detalle := 'no hay secreto order_advance_secret en Vault: no se empuja';
      raise warning 'trg_sale_push_status: falta order_advance_secret en Vault; venta % sin empujar', new.id;
    else
      v_req := net.http_post(
        url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/order-advance',
        headers := jsonb_build_object(
          'Content-Type',            'application/json',
          'x-order-advance-secret',  v_secret
        ),
        body    := jsonb_build_object(
          'sale_id',    new.id,
          'new_status', new.order_status,
          'internal',   true
        )
      );
      v_estado := 'pendiente';
    end if;
  else
    v_estado  := 'no_procede';
    v_detalle := case
      when new.source <> 'lastapp' then 'canal sin empuje saliente'
      else 'estado no se propaga'
    end;
  end if;

  -- ── Contabilidad. Blindada: que falle esto no puede parar un pedido. ──
  begin
    insert into public.sale_step_event
      (account_id, location_id, sale_id, paso, paso_origen, origen,
       push_request_id, push_estado, push_detalle)
    values
      (new.account_id, new.location_id, new.id, v_paso, new.order_status, 'trigger',
       v_req, v_estado, v_detalle);
  exception when others then
    raise warning 'trg_sale_push_status: no se pudo registrar el paso de la venta % (%): %',
      new.id, new.order_status, sqlerrm;
  end;

  return new;
end;
$function$;

commit;
