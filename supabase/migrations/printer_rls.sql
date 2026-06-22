-- ============================================================================
-- FOLVY IMPRIME · PIEZA 2 — RLS de printer / print_job
-- ----------------------------------------------------------------------------
-- Calcado del patrón de kds_device: SELECT por pertenencia (belongs_to_account),
-- escritura (INSERT/UPDATE/DELETE) por admin o manager de la cuenta.
-- El ADAPTADOR de transporte (Edge Function) accede con service_role, que se
-- salta RLS — estas políticas son para la UI de gestión, no para el adaptador.
-- ============================================================================

alter table public.printer    enable row level security;
alter table public.print_job  enable row level security;

-- ── printer ─────────────────────────────────────────────────────────────────
drop policy if exists printer_select on public.printer;
create policy printer_select on public.printer
  for select using (belongs_to_account(account_id));

drop policy if exists printer_insert on public.printer;
create policy printer_insert on public.printer
  for insert with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists printer_update on public.printer;
create policy printer_update on public.printer
  for update using (current_user_is_admin_or_manager_of(account_id));

drop policy if exists printer_delete on public.printer;
create policy printer_delete on public.printer
  for delete using (current_user_is_admin_or_manager_of(account_id));

-- ── print_job ───────────────────────────────────────────────────────────────
drop policy if exists print_job_select on public.print_job;
create policy print_job_select on public.print_job
  for select using (belongs_to_account(account_id));

drop policy if exists print_job_insert on public.print_job;
create policy print_job_insert on public.print_job
  for insert with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists print_job_update on public.print_job;
create policy print_job_update on public.print_job
  for update using (current_user_is_admin_or_manager_of(account_id));

drop policy if exists print_job_delete on public.print_job;
create policy print_job_delete on public.print_job
  for delete using (current_user_is_admin_or_manager_of(account_id));
