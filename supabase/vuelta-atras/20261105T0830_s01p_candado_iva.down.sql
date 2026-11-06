-- supabase/vuelta-atras/20261105T0830_s01p_candado_iva.down.sql
-- Vuelta atrás de la 0830: las cinco funciones desde su respaldo, fuera los dos
-- disparadores y las funciones nuevas, y conta_mes_cambio como estaba (las marcas
-- sin candado de mes, que solo pone la 0830, se quitan para que lock_id vuelva a
-- ser obligatorio).
drop trigger if exists trg_journal_line_0_retencion_presentada on public.journal_line;
drop trigger if exists trg_journal_entry_0_traido_no_se_anula on public.journal_entry;
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261105T0830_s01p_candado_iva');
select public._restaurar_funcion('public._tg_s01p_trimestre_presentado()', '20261105T0830_s01p_candado_iva');
select public._restaurar_funcion('public.tg_journal_entry_no_antes_del_corte()', '20261105T0830_s01p_candado_iva');
select public._restaurar_funcion('public._tg_s01p_mes_cambio()', '20261105T0830_s01p_candado_iva');
select public._restaurar_funcion('public.conta_traspaso_lista(uuid,date)', '20261105T0830_s01p_candado_iva');
drop function if exists public._conta_retencion_candado_apunte();
drop function if exists public._tg_s01p_traido_no_se_anula();
drop function if exists public._conta_periodo_admite(uuid);
drop function if exists public._conta_retenciones_presentado(uuid, date);
drop function if exists public._conta_asiento_lleva_retencion(uuid);
drop function if exists public._conta_linea_retencion(uuid, uuid, numeric, text);
drop function if exists public._conta_asiento_lleva_iva(uuid);
drop function if exists public._conta_origen_con_iva(text);
delete from public.conta_mes_cambio where lock_id is null;
alter table public.conta_mes_cambio drop column if exists motivo;
alter table public.conta_mes_cambio alter column lock_id set not null;
