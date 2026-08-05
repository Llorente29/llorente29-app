-- 20260805T1220_training_notice_manual_estado_cron.sql
-- RPC manual del botón "Avisar" + RPC de estado (para el webhook de Meta) + cron
-- drenador cada minuto. Cuerpo idéntico al vivo en producción.

CREATE OR REPLACE FUNCTION public.notify_employee_courses(p_employee_id uuid, p_course_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(course_id uuid, notice_id uuid, result text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc uuid;
  r record;
  v_nid uuid;
BEGIN
  SELECT l.account_id INTO v_acc
  FROM employees e JOIN locations l ON l.id = e.location_id
  WHERE e.id = p_employee_id;

  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'empleado no encontrado o sin local';
  END IF;

  IF NOT current_user_is_admin_or_manager_of(v_acc) THEN
    RAISE EXCEPTION 'sin acceso a la cuenta del empleado';
  END IF;

  FOR r IN
    SELECT ca.id AS assignment_id, ca.course_id
    FROM course_assignment ca
    JOIN course c ON c.id = ca.course_id
    WHERE ca.employee_id = p_employee_id
      AND ca.account_id = v_acc
      AND c.status = 'published'
      AND (p_course_id IS NULL OR ca.course_id = p_course_id)
      AND NOT EXISTS (
        SELECT 1 FROM course_attempt at
        WHERE at.assignment_id = ca.id AND at.passed
      )
  LOOP
    v_nid := enqueue_training_notice(r.assignment_id, 'manual', auth.uid());
    RETURN QUERY SELECT r.course_id, v_nid,
      CASE WHEN v_nid IS NULL THEN 'omitido (ya avisado/sin gancho/sin teléfono)'
           ELSE 'encolado' END;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION notify_employee_courses(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION notify_employee_courses(uuid, uuid) TO authenticated;

-- Estado desde el webhook de Meta (entregado/leído/fallido). Casa por wamid.
CREATE OR REPLACE FUNCTION public.training_notice_mark_status(p_wamid text, p_status text, p_at timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE training_notice tn
  SET status = CASE WHEN p_status IN ('delivered','read','failed') THEN p_status ELSE tn.status END,
      delivered_at = CASE WHEN p_status='delivered' AND tn.delivered_at IS NULL THEN p_at ELSE tn.delivered_at END,
      read_at      = CASE WHEN p_status='read'      AND tn.read_at      IS NULL THEN p_at ELSE tn.read_at END,
      updated_at   = now()
  WHERE tn.provider_message_id = p_wamid;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION training_notice_mark_status(text,text,timestamptz) FROM public, anon;

-- Cron drenador (cada minuto), gemelo de customer-notify-drain.
SELECT cron.schedule(
  'training-notify-drain',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/training-notify',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);
