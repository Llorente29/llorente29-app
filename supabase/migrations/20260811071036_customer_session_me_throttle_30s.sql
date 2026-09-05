-- ENCARGO fix/kds-latido-raiz · Tarea D — lectura que escribe (mismo antipatron
-- que el KDS, riesgo bajo: fila por sesion de comensal, sin contencion entre
-- dispositivos). RECON: el cliente folvy_shop no tiene tick propio al que
-- enganchar un heartbeat dedicado -> guard de 30s, como las 13 del KDS.
-- Revisada contra la definicion viva (pg_get_functiondef) el 11/08: identica
-- salvo el guard; atributos (SECURITY DEFINER, search_path, volatilidad, coste)
-- preservados.
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

-- Guard: aborta si el freno no quedo escrito (no fiarse del "Success").
do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'customer_session_me'
      and p.prosrc ~* 'last_seen_at\s*<\s*now\(\)\s*-\s*interval'
  ) then
    raise exception 'customer_session_me: el guard de 30s NO quedo aplicado';
  end if;
end;
$guard$;

notify pgrst, 'reload schema';