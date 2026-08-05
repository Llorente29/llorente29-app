-- 20260805T1200_training_notice_ddl.sql
-- Cola de avisos de formación al empleado (WhatsApp). Separada de
-- customer_notification (que gira sobre venta). Aquí gira sobre empleado+curso.
-- Desconexión digital (art. 88 LOPDGDD): el aviso solo sale si el empleado está
-- fichado en entrada (lo aplica el Edge training-notify, no esta tabla).

CREATE TABLE IF NOT EXISTS training_notice (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES course_assignment(id) ON DELETE SET NULL,
  channel       text NOT NULL DEFAULT 'whatsapp',
  template      text NOT NULL DEFAULT 'formacion_curso_disponible',
  lang          text NOT NULL DEFAULT 'es',
  to_phone      text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin        text NOT NULL DEFAULT 'auto',
  status        text NOT NULL DEFAULT 'queued',
  skip_reason   text,
  attempts      int  NOT NULL DEFAULT 0,
  provider_message_id text,
  error         text,
  requested_by  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_notice_status_chk
    CHECK (status IN ('queued','sent','delivered','read','failed','skipped')),
  CONSTRAINT training_notice_origin_chk
    CHECK (origin IN ('auto','manual'))
);

CREATE INDEX IF NOT EXISTS ix_training_notice_queued
  ON training_notice (channel, status) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ix_training_notice_wamid
  ON training_notice (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_training_notice_emp
  ON training_notice (employee_id, course_id, created_at DESC);

ALTER TABLE training_notice ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS training_notice_select ON training_notice;
CREATE POLICY training_notice_select ON training_notice
  FOR SELECT USING (
    current_user_is_admin_or_manager_of(account_id)
    OR current_user_is_employee(employee_id, account_id)
  );

DROP POLICY IF EXISTS training_notice_write ON training_notice;
CREATE POLICY training_notice_write ON training_notice
  FOR ALL USING (current_user_is_admin_or_manager_of(account_id));

COMMENT ON TABLE training_notice IS
  'Cola de avisos de formación al empleado por WhatsApp. Desconexión digital: solo se despacha si el empleado está fichado en entrada.';
