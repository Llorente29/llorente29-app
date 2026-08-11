-- Aplicada: SÍ (Julio, 11/08, por MCP).
--
-- ENCARGO fix/kds-latido-raiz · Tarea D — mismo antipatrón (lectura que
-- escribe) detectado en el barrido de pg_proc por 'last_seen|heartbeat|
-- last_ping|seen_at' (encargo §1). Riesgo bajo (fila por sesión de comensal,
-- sin contención entre dispositivos como en kds_device), pero no se deja
-- deuda en silencio.
--
-- RECON del cliente (folvy_shop) hecho antes de decidir: getSessionCustomer()
-- (src/modules/shop/checkout/customerAuthService.ts) se llama al montar
-- ShopHubRoute/MyAccountRoute/CheckoutRoute — una vez por carga de ruta, SIN
-- ningún setInterval/tick propio. No hay un latido de cliente al que enganchar
-- un RPC dedicado (a diferencia del KDS): el fix proporcionado es el mismo
-- guard de 30s que llevaban las 13 funciones del KDS antes del rediseño de
-- raíz, no un kds_heartbeat-style RPC nuevo.
--
-- Validado por MCP con nombre temporal _tmp_check_customer_session_me antes
-- de escribir este fichero (compiló, corrió, se descartó).

CREATE OR REPLACE FUNCTION public.customer_session_me(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_cust      customer%rowtype;
  v_sess      customer_session%rowtype;
  v_consented boolean;
begin
  select * into v_sess from customer_session
  where token = nullif(btrim(p_token),'') and revoked_at is null and expires_at > now()
  limit 1;
  if v_sess.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;
  update customer_session set last_seen_at = now() where id = v_sess.id
    and (last_seen_at is null or last_seen_at < now() - interval '30 seconds');
  select * into v_cust from customer where id = v_sess.customer_id;
  select marketing_email into v_consented from customer_consent where customer_id = v_cust.id;
  return jsonb_build_object(
    'ok', true,
    'customerId', v_cust.id,
    'name', v_cust.name,
    'email', v_cust.email,
    'phone', v_cust.phone,
    'consented', coalesce(v_consented, false)
  );
end;
$function$;
