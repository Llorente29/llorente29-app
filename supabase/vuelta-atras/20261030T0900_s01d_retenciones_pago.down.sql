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
-- La retención completa, como estaba: tipo, base y modelo, o nada. Un apunte ya
-- marcado como pago (modelo y periodo, sin tipo) la incumpliría: entonces para
-- y lo dice, en vez de borrarle el modelo a nadie.
do $$ begin
  if exists (select 1 from public.journal_line where withholding_rate_id is null and withholding_model is not null) then
    raise exception 'Hay apuntes marcados como pago de un modelo: la restricción de antes no los deja. Decide qué hacer con ellos antes de deshacer la 0900.';
  end if;
end $$;
alter table public.journal_line drop constraint if exists journal_line_retencion_completa;
alter table public.journal_line add constraint journal_line_retencion_completa check (
  (withholding_rate_id is null and withholding_base is null and withholding_model is null)
  or (withholding_rate_id is not null and withholding_base is not null and withholding_model is not null));
