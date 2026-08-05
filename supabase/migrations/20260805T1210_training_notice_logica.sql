-- 20260805T1210_training_notice_logica.sql
-- Lógica de encolado de avisos de formación. El envío lo hace el Edge
-- training-notify (drenado por cron); aquí solo se encola con guardarraíles.
-- Cuerpo idéntico al vivo en producción (pg_get_functiondef).

CREATE OR REPLACE FUNCTION public.training_is_clocked_in(p_employee_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ce.type = 'entrada'
     FROM clock_entries ce
     WHERE ce.employee_id = p_employee_id AND NOT ce.voided
     ORDER BY ce.datetime DESC
     LIMIT 1),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_training_notice(p_assignment_id uuid, p_origin text DEFAULT 'auto'::text, p_requested_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc   uuid;
  v_emp   uuid;
  v_course uuid;
  v_phone text;
  v_name  text;
  v_hook  text;
  v_min   int;
  v_status text;
  v_min_txt text;
  v_notice_id uuid;
BEGIN
  SELECT ca.account_id, ca.employee_id, ca.course_id
    INTO v_acc, v_emp, v_course
  FROM course_assignment ca
  WHERE ca.id = p_assignment_id;

  IF v_emp IS NULL THEN
    RETURN NULL;  -- asignación por rol/puesto sin empleado concreto: no se avisa aquí
  END IF;

  -- Solo cursos publicados con gancho.
  SELECT c.whatsapp_hook, c.estimated_minutes
    INTO v_hook, v_min
  FROM course c
  WHERE c.id = v_course AND c.status = 'published';

  IF NOT FOUND THEN
    RETURN NULL;  -- borrador o inexistente: no se avisa
  END IF;

  SELECT e.name, e.phone INTO v_name, v_phone
  FROM employees e WHERE e.id = v_emp;

  -- Guardarraíl anti-repetición: ya avisado (o en cola) en las últimas 48h.
  IF EXISTS (
    SELECT 1 FROM training_notice tn
    WHERE tn.employee_id = v_emp AND tn.course_id = v_course
      AND tn.created_at > now() - interval '48 hours'
      AND tn.status IN ('queued','sent','delivered','read')
  ) THEN
    RETURN NULL;  -- ya hay un aviso vigente, no duplicar
  END IF;

  v_min_txt := COALESCE(v_min::text, '10');
  IF v_hook IS NULL OR btrim(v_hook) = '' THEN
    v_status := 'skipped';
  ELSIF v_phone IS NULL OR btrim(v_phone) = '' THEN
    v_status := 'skipped';
  ELSE
    v_status := 'queued';
  END IF;

  INSERT INTO training_notice (
    account_id, employee_id, course_id, assignment_id,
    to_phone, payload, origin, status, skip_reason, requested_by
  ) VALUES (
    v_acc, v_emp, v_course, p_assignment_id,
    v_phone,
    jsonb_build_object('nombre', COALESCE(v_name,'Hola'), 'gancho', COALESCE(v_hook,''), 'minutos', v_min_txt),
    p_origin,
    v_status,
    CASE
      WHEN v_hook IS NULL OR btrim(v_hook) = '' THEN 'sin_gancho'
      WHEN v_phone IS NULL OR btrim(v_phone) = '' THEN 'sin_telefono'
      ELSE NULL
    END,
    p_requested_by
  )
  RETURNING id INTO v_notice_id;

  RETURN v_notice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_training_notice_on_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.employee_id IS NOT NULL THEN
    PERFORM enqueue_training_notice(NEW.id, 'auto', NULL);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_training_notice_on_assign ON course_assignment;
CREATE TRIGGER trg_training_notice_on_assign
  AFTER INSERT ON course_assignment
  FOR EACH ROW
  EXECUTE FUNCTION tg_training_notice_on_assign();
