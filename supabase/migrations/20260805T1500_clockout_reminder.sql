-- 20260805T1500_clockout_reminder.sql
-- Recordatorio de olvido de fichaje de salida por WhatsApp.
-- Aviso al EMPLEADO (opt-in, puede renunciar desde su portal → desconexión
-- digital como ayuda consentida). Detección contra horario publicado.
-- Todo idéntico a lo vivo en producción.

-- 1) Opt-out del empleado (default true = ayuda activada).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS forgot_clockout_reminder boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN employees.forgot_clockout_reminder IS
  'El empleado quiere recibir recordatorio si olvida fichar salida. Default true. Opt-out desde el portal del trabajador (desconexion digital: ayuda consentida).';

-- 2) Log/cola de recordatorios (anti-repetición por jornada + auditoría).
CREATE TABLE IF NOT EXISTS clockout_reminder_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  clock_entry_id uuid NOT NULL REFERENCES clock_entries(id) ON DELETE CASCADE,
  to_phone       text,
  scheduled_end  text,
  status         text NOT NULL DEFAULT 'queued',
  skip_reason    text,
  provider_message_id text,
  error          text,
  attempts       int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clockout_reminder_unique UNIQUE (clock_entry_id),
  CONSTRAINT clockout_reminder_status_chk CHECK (status IN ('queued','sent','failed','skipped'))
);

CREATE INDEX IF NOT EXISTS ix_clockout_reminder_queued
  ON clockout_reminder_log (status) WHERE status = 'queued';

ALTER TABLE clockout_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clockout_reminder_select ON clockout_reminder_log;
CREATE POLICY clockout_reminder_select ON clockout_reminder_log
  FOR SELECT USING (
    current_user_is_admin_or_manager_of(account_id)
    OR current_user_is_employee(employee_id, account_id)
  );

DROP POLICY IF EXISTS clockout_reminder_write ON clockout_reminder_log;
CREATE POLICY clockout_reminder_write ON clockout_reminder_log
  FOR ALL USING (current_user_is_admin_or_manager_of(account_id));

-- 3) Detección + encolado. Empareja la entrada abierta con el turno publicado
--    más cercano; si su salida teórica pasó hace >forgot_clockout_min y el
--    empleado no ha renunciado y no se le avisó ya, encola. Cuerpo idéntico al vivo.
CREATE OR REPLACE FUNCTION public.enqueue_clockout_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_forgot_min int;
  v_count int := 0;
  r record;
BEGIN
  SELECT forgot_clockout_min INTO v_forgot_min FROM app_settings WHERE scope='global' LIMIT 1;
  v_forgot_min := COALESCE(v_forgot_min, 30);

  FOR r IN
    WITH abiertos AS (
      SELECT DISTINCT ON (ce.employee_id)
             ce.id AS clock_entry_id, ce.employee_id, ce.datetime AS entrada_at,
             e.name, e.location_id, e.phone, e.forgot_clockout_reminder,
             l.account_id
      FROM clock_entries ce
      JOIN employees e ON e.id = ce.employee_id
      JOIN locations l ON l.id = e.location_id
      WHERE NOT ce.voided AND ce.datetime::date = now()::date
      ORDER BY ce.employee_id, ce.datetime DESC
    ),
    candidatos AS (
      SELECT a.*, st.start_time, st.end_time,
             abs(EXTRACT(epoch FROM (a.entrada_at::time - st.start_time))) AS dist_seg
      FROM abiertos a
      JOIN schedules s ON s.location_id = a.location_id
        AND s.week_start = date_trunc('week', now())::date
        AND s.status = 'published'
      JOIN shift_templates st ON st.location_id = a.location_id AND st.active
      WHERE a.forgot_clockout_reminder = true
        AND s.cells ? st.id::text
        AND s.cells->(st.id::text) ? (((EXTRACT(dow FROM now())::int + 6) % 7)::text)
        AND s.cells->(st.id::text)->(((EXTRACT(dow FROM now())::int + 6) % 7)::text)
            @> to_jsonb(a.employee_id::text)
    ),
    mejor_turno AS (
      SELECT DISTINCT ON (employee_id) *
      FROM candidatos
      ORDER BY employee_id, dist_seg ASC
    )
    SELECT clock_entry_id, employee_id, account_id, name, phone, entrada_at,
           start_time, end_time
    FROM mejor_turno mt
    WHERE
      (
        CASE
          WHEN mt.end_time > mt.start_time THEN
            now()::time > (mt.end_time + make_interval(mins => v_forgot_min))
            AND now()::time > mt.start_time
          ELSE
            now() > (mt.entrada_at::date + interval '1 day' + mt.end_time + make_interval(mins => v_forgot_min))
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM clockout_reminder_log crl WHERE crl.clock_entry_id = mt.clock_entry_id
      )
  LOOP
    INSERT INTO clockout_reminder_log (account_id, employee_id, clock_entry_id, to_phone, scheduled_end, status)
    VALUES (r.account_id, r.employee_id, r.clock_entry_id, r.phone,
            to_char(r.end_time, 'HH24:MI'),
            CASE WHEN r.phone IS NULL OR btrim(r.phone)='' THEN 'skipped' ELSE 'queued' END)
    ON CONFLICT (clock_entry_id) DO NOTHING;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- 4) Cron drenador cada 10 min (un olvido no es urgente). Idempotente.
SELECT cron.schedule(
  'clockout-reminder-drain',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/clockout-reminder',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $$
);
