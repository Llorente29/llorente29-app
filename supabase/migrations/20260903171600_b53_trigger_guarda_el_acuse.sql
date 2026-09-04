-- B53 §2 · 03/09/2026, REESCRITA EL 04/09 — EL TRIGGER DEJA DE TIRAR EL ID.
-- ===========================================================================
-- ⚠️ POR QUE ESTA REESCRITA: la primera version RETRANSCRIBIA la funcion entera
--    con `create or replace`. La regla F5 lo prohibe, y con razon: el cuerpo vivo
--    tiene CRLF (comprobado hoy: position(chr(13) in def) > 0) y la copia del
--    repo no, asi que una retranscripcion «identica» no lo era. Ahora se parchea
--    la definicion VIVA, fragmento a fragmento, y cada uno se cuenta antes de
--    tocarlo: si no aparece exactamente una vez, aborta y no se toca nada.
--    Por eso TODOS los anclajes son de una sola linea — asi el CRLF da igual.
--
-- ⚠️ TOCA EL CAMINO VIVO DE LOS PEDIDOS (regla F6). Fuera de la banda
--    12:15 -> 23:45 (Madrid). Consecuencia esperada, escrita ANTES: NINGUNA.
--    El empuje sale igual y con el MISMO secreto de siempre — Vault ya lleva el
--    valor vigente (sembrado el 04/09, copiado del cuerpo de esta misma funcion
--    y verificado por md5). No hay cambio de secreto, luego no hay precipicio.
--    Lo unico nuevo es que queda una fila por paso en sale_step_event.
--
-- QUE CAMBIA, en cuatro cortes:
--   1. Se declaran v_req, v_secret y v_detalle.
--   2. `perform net.http_post(...)` pasa a `v_req := net.http_post(...)`. El
--      `perform` descartaba el bigint que devuelve la funcion, que es el id con
--      el que pg_net indexa la respuesta en net._http_response. Tirarlo es lo
--      que nos dejo sin poder rebatir a Cloudtown.
--   3. El literal del secreto se sustituye por v_secret, leido de Vault (B55).
--      El literal NO aparece en este fichero: se localiza por expresion regular
--      sobre el cuerpo vivo. Meterlo aqui seria commitear otra copia de un
--      secreto que ya sabemos expuesto.
--   4. Se escribe UNA FILA POR CAMBIO DE order_status, se empuje o no. El
--      encargo se titula «todos los pasos» y el vocabulario del §1 incluye
--      'recibido' y 'aceptado', que NO son empujables: registrar solo los
--      empujes seria mentir por omision.
--
-- EL REGISTRO ES CONTABILIDAD, NO OPERACION: el insert va en su propio bloque
--   con `exception when others then raise warning`. Que falle el registro NUNCA
--   puede impedir que salga el pedido. El empuje se queda FUERA de ese bloque a
--   proposito, para que un fallo suyo siga siendo ruidoso.
--   Y ojo con el warning: va al log de Postgres, que no lee nadie — es la trampa
--   del autocierre (185 «succeeded» con cero movimientos). La señal duradera es
--   LA FILA, no el warning.

begin;

-- ── GUARDA PREVIA (B55): sin el secreto en Vault, esta funcion no podria empujar.
do $guarda$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'order_advance_secret') then
    raise exception
      'B53/B55: falta el secreto `order_advance_secret` en Vault. Ver §5 del encargo L0a '
      'y docs/RUNBOOK_b53_b55_b54_20260903.md.';
  end if;
end
$guarda$;

do $do$
declare
  v_def   text;
  v_old   text;
  v_new   text;
  v_veces int;
  i       int;
  v_pares text[][] := array[
    -- (1) las tres variables nuevas
    array[
      $q$  v_pushable text[] := array[$q$,
      $q$  v_req     bigint;
  v_secret  text;
  v_detalle text;
  v_pushable text[] := array[$q$
    ],
    -- (2) capturar el id, y leer el secreto de Vault antes de empujar
    array[
      $q$    perform net.http_post($q$,
      $q$    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'order_advance_secret';
    if v_secret is null or v_secret = '' then
      -- No se empuja a ciegas con una cabecera vacia: seria un 401 silencioso.
      v_detalle := 'no hay secreto order_advance_secret en Vault: no se empuja';
      raise warning 'trg_sale_push_status: falta order_advance_secret en Vault; venta % sin empujar', new.id;
    else
    v_req := net.http_post($q$
    ],
    -- (3) cerrar el else que abre el fragmento anterior
    array[
      $q$    );$q$,
      $q$    );
    end if;$q$
    ],
    -- (4) la contabilidad, antes de devolver
    array[
      $q$  return new;$q$,
      $q$  begin
    insert into public.sale_step_event
      (account_id, location_id, sale_id, paso, paso_origen, origen,
       push_request_id, push_estado, push_detalle)
    values (
      new.account_id, new.location_id, new.id,
      case new.order_status
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
      end,
      new.order_status, 'trigger', v_req,
      case when v_req is not null      then 'pendiente'
           when v_detalle is not null  then 'rechazado'
           else 'no_procede' end,
      case when v_req is not null then null
           else coalesce(v_detalle,
                  case when new.source <> 'lastapp' then 'canal sin empuje saliente'
                       else 'estado no se propaga' end) end
    );
  exception when others then
    raise warning 'trg_sale_push_status: no se pudo registrar el paso de la venta % (%): %',
      new.id, new.order_status, sqlerrm;
  end;
  return new;$q$
    ]
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trg_sale_push_status';

  if v_def is null then
    raise exception 'B53: no se encuentra public.trg_sale_push_status';
  end if;

  for i in 1 .. array_length(v_pares, 1) loop
    v_old := v_pares[i][1];
    v_new := v_pares[i][2];
    v_veces := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_veces <> 1 then
      raise exception 'B53: el fragmento % aparece % veces, se esperaba 1. No se toca nada. Fragmento: %',
        i, v_veces, v_old;
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;

  -- (5) EL SECRETO. Se localiza por patron sobre el cuerpo vivo, nunca escrito
  --     aqui. Si no aparece exactamente una vez, aborta: puede que ya se haya
  --     aplicado, o que alguien lo haya cambiado de forma.
  v_veces := (select count(*) from regexp_matches(v_def, '''fv_oadv_[A-Za-z0-9_-]+''', 'g'));
  if v_veces <> 1 then
    raise exception 'B53/B55: el literal del secreto aparece % veces, se esperaba 1. No se toca nada.', v_veces;
  end if;
  v_def := regexp_replace(v_def, '''fv_oadv_[A-Za-z0-9_-]+''', 'v_secret');

  execute v_def;
end
$do$;

commit;
