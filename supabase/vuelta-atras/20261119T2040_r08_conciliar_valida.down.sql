-- R08 · la vuelta atrás de 2040: _bank_casar_nucleo, bank_deshacer y journal_entry_inalterable vuelven, byte a
-- byte, a como estaban (del respaldo que dejó la 2040) y se quitan las dos nuevas. Lo ya validado se queda validado.
select public._restaurar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T2040_r08_conciliar_valida');
select public._restaurar_funcion('public.bank_deshacer(uuid,text)', '20261119T2040_r08_conciliar_valida');
select public._restaurar_funcion('public.journal_entry_inalterable()', '20261119T2040_r08_conciliar_valida');
drop function if exists public._bank_asiento_quitar(uuid, text);
drop function if exists public._bank_asiento_razon_contra(uuid);
