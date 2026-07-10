-- 20260709T1800_payroll_inbox.sql
-- Folvy Team — Que NINGUNA nómina desaparezca en silencio.
-- payroll_inbox registra TODA nómina que llega (subida o Gmail), case o no:
--   matched   → casó por DNI y se escribió el coste (payroll_cost_id).
--   unmatched → leída pero sin empleado (sin DNI, DNI que no casa, sin periodo).
--   error     → no se pudo leer.
--   resolved  → un humano la asignó a mano.
-- La cabina muestra unmatched/error como bandeja; el aviso sale de aquí.

begin;

create table if not exists public.payroll_inbox (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null,
  source              text not null default 'gmail',      -- gmail | nomina_upload | manual
  email_id            text,                                -- id del correo en Resend (traza)
  file_path           text,                                -- ruta del PDF en Storage
  document_id         uuid,                                -- doc en la ficha, si se adjuntó
  read_dni            text,                                -- DNI leído por la IA
  read_name           text,                                -- nombre leído por la IA
  period_year         int,
  period_month        int,
  gross               numeric,
  employer_ss         numeric,
  total_cost          numeric,
  status              text not null default 'unmatched'
                        check (status in ('matched','unmatched','error','resolved')),
  reason              text,                                -- motivo si no casa
  matched_employee_id uuid,
  payroll_cost_id     uuid,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid
);

-- Dedup por PDF: reprocesar el mismo correo actualiza la fila, no la duplica.
create unique index if not exists ux_payroll_inbox_file on public.payroll_inbox(file_path) where file_path is not null;
create index if not exists ix_payroll_inbox_acct on public.payroll_inbox(account_id, status);

alter table public.payroll_inbox enable row level security;
drop policy if exists payroll_inbox_read  on public.payroll_inbox;
drop policy if exists payroll_inbox_write on public.payroll_inbox;
create policy payroll_inbox_read  on public.payroll_inbox
  for select using (account_id = any (current_user_account_ids()));
create policy payroll_inbox_write on public.payroll_inbox
  for all using (current_user_is_admin_of(account_id))
          with check (current_user_is_admin_of(account_id));

commit;
