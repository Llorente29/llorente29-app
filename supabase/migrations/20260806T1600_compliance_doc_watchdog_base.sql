-- 20260806T1600_compliance_doc_watchdog_base.sql
-- Aplicada: 2026-08-06 por MCP. Verificada.
-- T5 (base): marcar caducados + log propio de recordatorios al proveedor.
-- El envío del email y el aviso al manager los hace la edge compliance-doc-notify.

create or replace function public.compliance_doc_mark_expired()
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with upd as (
    update compliance_document
       set status = 'expired', updated_at = now()
     where status = 'active'
       and expires_at is not null
       and expires_at < current_date
    returning 1
  )
  select coalesce(count(*), 0)::int from upd;
$$;

create table public.compliance_reminder_log (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  document_id     uuid null references compliance_document(id) on delete set null,
  to_email        text not null,
  subject         text,
  resend_email_id text,
  status          text not null check (status in ('sent', 'failed')),
  error_message   text,
  sent_at         timestamptz not null default now()
);
create index idx_compliance_reminder_log_account on public.compliance_reminder_log(account_id);
create index idx_compliance_reminder_log_document on public.compliance_reminder_log(document_id);

alter table public.compliance_reminder_log enable row level security;
create policy compliance_reminder_log_select on public.compliance_reminder_log
  for select using (belongs_to_account(account_id));
