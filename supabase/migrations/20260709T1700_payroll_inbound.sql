-- 20260709T1700_payroll_inbound.sql
-- Folvy Team — Ingesta de nóminas por correo (Resend Inbound).
-- Guarda el alias de Folvy al que cada cliente reenvía las nóminas de su gestoría
-- (p.ej. nominas-llorente29@in.folvy.app). El webhook enruta por el campo `to`.

begin;

alter table public.payroll_settings
  add column if not exists inbound_address text;

-- Un alias apunta a una sola cuenta (routing sin ambigüedad).
create unique index if not exists ux_payroll_settings_inbound
  on public.payroll_settings (lower(inbound_address))
  where inbound_address is not null;

commit;
