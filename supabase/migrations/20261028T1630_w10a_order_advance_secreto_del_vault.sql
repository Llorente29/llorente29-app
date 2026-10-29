-- supabase/migrations/20261028T1630_w10a_order_advance_secreto_del_vault.sql
--
-- W10a · Cambiar los tres secretos sin cortar nada (Julio, 28/10). El
-- repositorio es público y el secreto de order-advance va escrito en el cuerpo
-- de trg_sale_push_status desde el 19/06. Para poder cambiarlo, la función lo
-- lee del Vault (order_advance_secret): así, cuando Julio cambie el valor del
-- Vault, el disparador manda el nuevo sin tocar la función.
--
-- QUÉ CAMBIA en trg_sale_push_status, y nada más:
--   1. El secreto sale del Vault, no del cuerpo. En producción el Vault ya
--      tiene el MISMO valor (sembrado el 04/09; md5 da8c39f7 los dos): el
--      empuje sale igual. La guarda de abajo lo comprueba.
--   2. Si el Vault no tiene order_advance_secret, no llama y lo deja en
--      system_alert (regla 8), y el pedido se guarda igual. En producción no
--      pasa (lo tiene). En staging, que no lo tiene, deja de llamar: hasta hoy
--      mandaba a order-advance de producción el secreto de producción.
--   La dirección (la de producción, escrita) NO cambia aquí: es el W10b.
--
-- LA GUARDA, antes de tocar nada:
--   · la función está como se midió el 28/10 (md5 2470441d…): si alguien la
--     cambió, reescribirla pisaría ese cambio;
--   · si el Vault tiene order_advance_secret, el escrito en el cuerpo tiene que
--     ser ese mismo valor (si no, en producción cambiaría lo que se manda);
--   · en producción (se reconoce por la huella de su project_url, sin
--     escribirla) el Vault TIENE que tenerlo.
--   Si algo no cuadra, para y no cambia nada. Ningún valor va en este fichero.
--
-- La de antes se guarda con _respaldar_funcion y su vuelta atrás la restaura
-- byte a byte. Ojo: ese respaldo lleva el secreto viejo escrito (es la función
-- de antes); se borra cuando el secreto ya esté cambiado (paso final de Julio).
--
-- cambia: public.trg_sale_push_status · prueba: supabase/staging/sql/20261028_w10a_order_advance_secreto_del_vault_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql

-- ── La guarda ───────────────────────────────────────────────────────────────
do $guarda$
declare
  v_def      text := pg_get_functiondef('public.trg_sale_push_status()'::regprocedure);
  v_escrito  text := (regexp_match(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure), '''x-order-advance-secret'',\s*''([^'']+)'''))[1];
  v_vault    text := (select decrypted_secret from vault.decrypted_secrets where name = 'order_advance_secret');
  v_proyecto text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
begin
  if md5(v_def) <> '2470441d8329691b9c0e1d1017f87a41' then
    raise exception 'W10a: trg_sale_push_status ha cambiado desde el 28/10 (md5 %). No se toca nada.', md5(v_def);
  end if;
  if v_escrito is null then
    raise exception 'W10a: no encuentro el secreto escrito en trg_sale_push_status. No se toca nada.';
  end if;
  if md5(coalesce(v_proyecto, '')) = 'a07a3bc4f17fdd6fb4b41d0841a77f11' and v_vault is null then
    raise exception 'W10a: en producción el Vault no tiene order_advance_secret. No se toca nada.';
  end if;
  if v_vault is not null and v_vault <> v_escrito then
    raise exception 'W10a: el order_advance_secret del Vault no es el escrito en la función: cambiaría lo que se manda. No se toca nada.';
  end if;
  raise notice 'W10a · %', case when v_vault is null then 'sin order_advance_secret en el Vault: el disparador dejará de llamar (staging)'
                                else 'el Vault tiene el mismo secreto que el escrito: el empuje sale igual' end;
end
$guarda$;

-- ── La de antes, guardada ───────────────────────────────────────────────────
select public._respaldar_funcion('public.trg_sale_push_status()', '20261028T1630_w10a_order_advance_secreto_del_vault');

-- ── La función, con el secreto del Vault ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_sale_push_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pushable text[] := array[
    'in_preparation','awaiting_collection','awaiting_shipment',
    'in_delivery','completed','rejected','cancelled','delivery_failed'
  ];
  v_secret text;
begin
  -- solo canales con empuje y estados empujables
  if new.source = 'lastapp' and new.order_status = any(v_pushable) then
    -- W10a: el secreto, del Vault (order_advance_secret); ya no va escrito.
    -- Si falta, no se llama a nadie y queda dicho; el pedido sigue.
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'order_advance_secret';
    if v_secret is null then
      begin
        perform public._queue_system_alert(
          'vault',
          'Sin llamar a order-advance: falta order_advance_secret en el Vault',
          format('El pedido %s (estado %s) no ha avisado a order-advance porque el Vault de este proyecto no tiene order_advance_secret. El pedido se ha guardado; el aviso a la plataforma no ha salido.', new.id, new.order_status),
          'vault-order-advance');
      exception when others then
        raise warning 'trg_sale_push_status: falta order_advance_secret y no se pudo avisar (venta %): %', new.id, sqlerrm;
      end;
      return new;
    end if;
    perform net.http_post(
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
  end if;
  return new;
end;
$function$;
