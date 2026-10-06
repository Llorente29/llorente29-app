-- Vuelta atrás de 20261010T0100_c04_libro.sql. PARA si hay algo hecho con el
-- libro: un asiento (en el estado que sea), un resumen de ventas o de nóminas,
-- una regla de reparto, un predefinido, un ejercicio traído o un mes cerrado
-- por algo que no sea a mano.
do $$
begin
  if exists (select 1 from public.journal_entry) or exists (select 1 from public.sales_day_summary)
     or exists (select 1 from public.payroll_summary) or exists (select 1 from public.allocation_rule)
     or exists (select 1 from public.entry_template)
     or exists (select 1 from public.fiscal_year where origin <> 'folvy')
     or exists (select 1 from public.fiscal_period_lock where kind <> 'manual') then
    raise exception 'Hay asientos, resúmenes, reglas, predefinidos, ejercicios traídos o meses cerrados por otro motivo: no se quita nada.';
  end if;
end $$;

drop table if exists public.entry_template_line;
drop table if exists public.entry_template;
drop table if exists public.allocation_rule;
drop table if exists public.payroll_summary;
drop table if exists public.sales_day_summary;
drop table if exists public.journal_line;
drop table if exists public.journal_entry;
drop function if exists public.journal_line_inalterable();
drop function if exists public.journal_entry_inalterable();
drop function if exists public.journal_line_coherente();

alter table public.fiscal_period_lock drop constraint if exists fiscal_period_lock_kind_check, drop column if exists kind;
alter table public.fiscal_year
  drop constraint if exists fiscal_year_traido_coherente, drop constraint if exists fiscal_year_origin_check,
  drop column if exists origin, drop column if exists origin_program, drop column if exists imported_until;
