-- Vuelta atrás de 20261010T0100_c04_libro.sql. PARA si hay algo hecho con el
-- libro: un asiento (en el estado que sea), un resumen de ventas o de nóminas,
-- una regla de reparto, un predefinido, una corrección aprendida, un descarte,
-- la opción de validar solos los Seguros encendida, un ejercicio traído o un
-- mes cerrado por algo que no sea a mano.
do $$
declare v boolean;
begin
  if exists (select 1 from public.journal_entry) or exists (select 1 from public.sales_day_summary)
     or exists (select 1 from public.payroll_summary) or exists (select 1 from public.allocation_rule)
     or exists (select 1 from public.entry_template)
     or exists (select 1 from public.fiscal_year where origin <> 'folvy')
     or exists (select 1 from public.fiscal_period_lock where kind <> 'manual') then
    raise exception 'Hay asientos, resúmenes, reglas, predefinidos, ejercicios traídos o meses cerrados por otro motivo: no se quita nada.';
  end if;
  -- Lo que nació después en la misma migración (si está): se mira con EXECUTE
  -- para que la vuelta atrás valga también sobre una versión anterior de la 0100.
  if to_regclass('public.journal_correction') is not null then
    execute 'select exists (select 1 from public.journal_correction) or exists (select 1 from public.journal_dismissal)' into v;
    if v then raise exception 'Hay correcciones aprendidas o descartes: no se quita nada.'; end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_tax_profile' and column_name = 'journal_autovalidate_sales_day') then
    execute 'select exists (select 1 from public.company_tax_profile where journal_autovalidate_sales_day)' into v;
    if v then raise exception 'Hay una empresa con «validar solos los Seguros de ventas» encendido: no se quita nada.'; end if;
  end if;
end $$;

drop table if exists public.journal_dismissal;
drop table if exists public.journal_correction;
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
drop trigger if exists trg_fiscal_year_corte_cambiable on public.fiscal_year;
drop function if exists public.fiscal_year_corte_cambiable();
alter table public.company_tax_profile drop column if exists journal_autovalidate_sales_day;

alter table public.fiscal_period_lock drop constraint if exists fiscal_period_lock_kind_check, drop column if exists kind;
alter table public.fiscal_year
  drop constraint if exists fiscal_year_traido_coherente, drop constraint if exists fiscal_year_origin_check,
  drop column if exists origin, drop column if exists origin_program, drop column if exists imported_until;
