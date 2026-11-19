-- R08 · la vuelta atrás de 2040: _bank_casar_nucleo y bank_deshacer vuelven, byte a byte, a como
-- estaban antes (del respaldo que dejó la 2040). Los asientos ya validados se quedan validados.
select public._restaurar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T2040_r08_conciliar_valida');
select public._restaurar_funcion('public.bank_deshacer(uuid,text)', '20261119T2040_r08_conciliar_valida');
