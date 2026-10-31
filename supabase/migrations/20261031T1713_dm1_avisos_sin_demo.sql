-- cambia: public.encolar_alerta · prueba: supabase/staging/sql/20261031_dm1_avisos_sin_demo_prueba.sql
--
-- supabase/migrations/20261031T1713_dm1_avisos_sin_demo.sql
--
-- DM1 · PR 2a · Una demo no cuenta en los avisos del sistema (31/10/2026).
-- CAMBIA EN CALIENTE encolar_alerta (misma firma, respaldada antes): si el
-- aviso es de una cuenta de demo —la que dice p_account_id, o la del local
-- (p_location_id) o la de la marca (p_brand_id)—, no se encola y devuelve NULL
-- («callado a propósito», como el antirruido). Para las demás, idéntica.
-- La llama _queue_system_alert sin cuenta: esos avisos siguen igual (son de
-- la plataforma o de un vigía que recorre todas las cuentas; ver la tanda).
--
-- Guarda: antes de tocar nada, encolar_alerta tiene que ser la medida el 31/10
-- (md5 36a9dfb7…, la misma en producción y en staging); si no, para.
--
-- Vuelta atrás: supabase/vuelta-atras/20261031T1713_dm1_avisos_sin_demo.down.sql

do $$
begin
  if md5(pg_get_functiondef('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)'::regprocedure)) <> '36a9dfb7e8c958467e85b8d2955331ca' then
    raise exception 'DM1 avisos PARADA: encolar_alerta no es la medida el 31/10 (md5 36a9dfb7…). Reescribirla pisaría ese cambio.';
  end if;
end $$;

select public._respaldar_funcion('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)', '20261031T1713_dm1_avisos_sin_demo');

CREATE OR REPLACE FUNCTION public.encolar_alerta(p_kind text, p_subject text, p_message text, p_debounce_kind text DEFAULT NULL::text, p_debounce_window interval DEFAULT NULL::interval, p_account_id uuid DEFAULT NULL::uuid, p_location_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_severity text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id bigint;
  v_cuenta uuid;
BEGIN
  -- DM1 · PR 2a (31/10): una cuenta de demo no cuenta en los avisos. La del
  -- aviso, o la de su local, o la de su marca; sin ninguna, sigue como antes.
  v_cuenta := coalesce(
    p_account_id,
    (SELECT l.account_id FROM public.locations l WHERE l.id = p_location_id),
    (SELECT b.account_id FROM public.brand b WHERE b.id = p_brand_id));
  IF v_cuenta IS NOT NULL AND NOT public.cuenta_puede_salir(v_cuenta) THEN
    RETURN NULL;
  END IF;

  -- El antirruido, igual que antes. Devuelve NULL cuando NO encola, para que
  -- el llamador pueda distinguir «encolado» de «callado a propósito». La vieja
  -- devolvía void y las dos cosas se veían igual desde fuera.
  IF p_debounce_kind IS NOT NULL THEN
    -- 1) Ya hay uno pendiente con esta clave: no apilar.
    IF EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind AND status = 'pending'
    ) THEN
      RETURN NULL;
    END IF;

    -- 2) Ya se encoló uno con esta clave dentro de la ventana: no repetir.
    IF p_debounce_window IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.system_alert_queue
       WHERE debounce_kind = p_debounce_kind
         AND created_at > now() - p_debounce_window
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.system_alert_queue
    (kind, subject, message, debounce_kind, account_id, location_id, brand_id, severity)
  VALUES
    (p_kind, p_subject, p_message, p_debounce_kind,
     p_account_id, p_location_id, p_brand_id, p_severity)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;
