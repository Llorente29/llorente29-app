-- Vuelta atrás de 20261010T0130_c04_lectura.sql. No guarda datos: solo quita
-- la vista, las dos consultas y el permiso del agente.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    revoke select on table public.journal_entry, public.journal_line, public.journal_ledger, public.sales_day_summary,
                           public.payroll_summary, public.allocation_rule, public.entry_template, public.entry_template_line,
                        public.journal_correction, public.journal_dismissal from conta_lectura;
  end if;
end $$;
drop function if exists public.conta_resultado_por_local(uuid, date, date, boolean);
drop function if exists public.conta_sumas_saldos(uuid, date, date);
drop view if exists public.journal_ledger;
