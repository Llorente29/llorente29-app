-- 20260709T1600_payroll_cost.sql
-- Folvy Team — Coste laboral REAL desde nóminas (capa exacta) + config de buzón.
--
-- Modelo de dos capas (decidido con Julio):
--   · BASE (estimación honesta): employees.salary (bruto anual) + employer_ss_annual
--     → coste empresa base = bruto + SS, sin factor 1,30 y sin ambigüedad.
--   · EXACTO (verdad): payroll_cost, un registro por empleado y mes, extraído de
--     la nómina real (Asesoría QBO). La nómina manda; la base solo cubre meses
--     sin nómina. Cada cifra queda marcada como real o estimada en el informe.
--
-- DISCIPLINA: solo DDL, ninguna SECURITY DEFINER se ejecuta aquí. Verificación
-- en consulta separada.

begin;

-- 1) Campo base: coste SS empresa ANUAL, junto al bruto anual (salary)
alter table public.employees
  add column if not exists employer_ss_annual numeric;

-- 2) Coste REAL de nómina por empleado y mes
create table if not exists public.payroll_cost (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null,
  employee_id        uuid not null references public.employees(id) on delete cascade,
  period_year        int  not null,
  period_month       int  not null check (period_month between 1 and 12),
  status             text not null default 'borrador' check (status in ('borrador','definitiva')),
  gross              numeric,   -- total devengado del mes (bruto)
  employer_ss        numeric,   -- SS a cargo de la empresa (suma de aportaciones)
  total_cost         numeric,   -- coste empresa = gross + employer_ss
  contribution_base  numeric,   -- base de cotización CC (útil para extras/nocturnidad)
  net                numeric,    -- líquido a percibir (opcional)
  source             text not null default 'manual' check (source in ('manual','nomina_upload','gmail')),
  document_id        uuid,      -- PDF de la nómina (documento del empleado)
  needs_review       boolean not null default false,
  raw                jsonb,     -- extracción cruda + totales de validación (auditoría IA)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- permite coexistir borrador y definitiva del mismo mes; la definitiva manda
  unique (employee_id, period_year, period_month, status)
);
create index if not exists ix_payroll_cost_emp on public.payroll_cost(employee_id, period_year, period_month);
create index if not exists ix_payroll_cost_acct on public.payroll_cost(account_id, period_year, period_month);

alter table public.payroll_cost enable row level security;
drop policy if exists payroll_cost_read  on public.payroll_cost;
drop policy if exists payroll_cost_write on public.payroll_cost;
create policy payroll_cost_read  on public.payroll_cost
  for select using (account_id = any (current_user_account_ids()));
create policy payroll_cost_write on public.payroll_cost
  for all using (current_user_is_admin_of(account_id))
          with check (current_user_is_admin_of(account_id));

-- 3) Config de nóminas por cuenta (los dos correos: de quién vienen / a cuál llegan)
create table if not exists public.payroll_settings (
  account_id     uuid primary key,
  source_email   text,      -- remitente de la gestoría (p.ej. contacto@asesoriaqbo.es)
  mailbox_email  text,      -- buzón donde se reciben (p.ej. jgcolon@idasal.com)
  gestoria_name  text,      -- etiqueta legible (p.ej. Asesoría QBO)
  subject_hint   text default 'NÓMINAS',  -- pista de asunto para filtrar
  connected      boolean not null default false,
  last_sync_at   timestamptz,
  updated_at     timestamptz not null default now()
);
alter table public.payroll_settings enable row level security;
drop policy if exists payroll_settings_read  on public.payroll_settings;
drop policy if exists payroll_settings_write on public.payroll_settings;
create policy payroll_settings_read  on public.payroll_settings
  for select using (account_id = any (current_user_account_ids()));
create policy payroll_settings_write on public.payroll_settings
  for all using (current_user_is_admin_of(account_id))
          with check (current_user_is_admin_of(account_id));

commit;
