-- supabase/vuelta-atras/20261104T1120_s01p_candado.down.sql
-- Vuelta atrás de la 1120: las dos funciones, las de antes (desde su respaldo);
-- fuera los disparadores, las funciones nuevas, la tabla de cambios y las dos columnas.
select public._restaurar_funcion('public.conta_primer_dia_abierto(uuid,date)', '20261104T1120_s01p_candado');
select public._restaurar_funcion('public.conta_mes_cerrado(uuid,date)', '20261104T1120_s01p_candado');
drop trigger if exists trg_journal_entry_0_trimestre_presentado on public.journal_entry;
drop trigger if exists s01p_mes_cambio on public.journal_entry;
drop function if exists public._tg_s01p_trimestre_presentado();
drop function if exists public._tg_s01p_mes_cambio();
drop function if exists public._s01p_iva_presentado_el(uuid, date);
drop function if exists public.conta_mes_cambios(uuid, date);
drop table if exists public.conta_mes_cambio;
drop function if exists public.conta_empresa_dias_guardar(uuid, smallint, smallint[]);
alter table public.company drop constraint if exists company_payroll_pay_days_check;
alter table public.company drop constraint if exists company_month_close_day_check;
alter table public.company drop column if exists payroll_pay_days;
alter table public.company drop column if exists month_close_day;
