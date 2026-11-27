-- K14b · vuelta atrás de 20261126T1240: bank_cuenta_alta desde su respaldo (vuelve a dejar dar de alta un IBAN
-- repetido), y fuera los dos disparadores del día de inicio y las dos funciones nuevas. Los before_cutover ya
-- recalculados se quedan como están (son los buenos).
select public._restaurar_funcion('public.bank_cuenta_alta(uuid,text,text,text,text,uuid,boolean)', '20261126T1240_k14b_un_banco_y_el_inicio');
drop trigger if exists trg_bank_settings_inicio_cambia on public.bank_settings;
drop trigger if exists trg_fiscal_year_inicio_cambia on public.fiscal_year;
drop function if exists public._tg_bank_inicio_cambia();
drop function if exists public._bank_antes_del_inicio_recalcular(uuid);
drop function if exists public._bank_juntar(uuid, uuid);
