-- supabase/vuelta-atras/20261030T0900_s01d_retenciones_pago.down.sql
--
-- Vuelta atrás de 20261030T0900_s01d_retenciones_pago: las cinco funciones como estaban (del respaldo, con
-- su huella), fuera el disparador y las funciones nuevas.
-- Las columnas son de la 0855. Un apunte ya marcado como pago conserva su
-- modelo y su periodo, pero si su asiento sigue sin validar vuelve a pararlo
-- la regla de antes.
drop trigger if exists journal_entry_pago_modelo on public.journal_entry;
drop function if exists public.tg_journal_entry_pago_modelo();
drop function if exists public.conta_apunte_pago_modelo(uuid, int, text, text);
drop function if exists public.conta_modelo_pagado(uuid, text, text);
select public._restaurar_funcion('public.conta_impuesto_casar_cargo(uuid,uuid)', '20261030T0900_s01d_retenciones_pago');
select public._restaurar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261030T0900_s01d_retenciones_pago');
select public._restaurar_funcion('public.conta_impuesto_retenciones_diario(uuid,integer,text)', '20261030T0900_s01d_retenciones_pago');
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261030T0900_s01d_retenciones_pago');
select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261030T0900_s01d_retenciones_pago');
drop function if exists public.conta_modelo_periodo_texto(text, text);
