-- 20260806T1600_compliance_doc_watchdog_base.sql
-- T5 (base): marcar caducados + log propio de recordatorios al proveedor.
-- El envío del email y el aviso al manager los hace la edge compliance-doc-notify.

-- 1) Marcar 'expired' los documentos vigentes cuya caducidad ya pasó (idempotente).
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

-- 2) Log de recordatorios enviados al proveedor (auditoría para inspección).
--    account_email_log no sirve (exige sender_user_id / recipient_employee_id).
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
-- Leer = miembro de la cuenta (para verlo en la carpeta de inspección). Escribir = solo service_role (sin policy de insert).
create policy compliance_reminder_log_select on public.compliance_reminder_log
  for select using (belongs_to_account(account_id));

do $$ begin
  if to_regclass('public.compliance_reminder_log') is null
     or not exists (select 1 from pg_proc where proname='compliance_doc_mark_expired')
  then raise exception 'compliance_doc_watchdog_base: falta un objeto'; end if;
end $$;