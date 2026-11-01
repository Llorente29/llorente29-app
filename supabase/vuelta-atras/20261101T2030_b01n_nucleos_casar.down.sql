-- supabase/vuelta-atras/20261101T2030_b01n_nucleos_casar.down.sql
--
-- B01 · PR 3a · La vuelta atrás de los núcleos de casar: las tres públicas,
-- restauradas del respaldo que guardó la 2030 (_restaurar_funcion: las de
-- producción del 01/11, md5 de pg_get_functiondef bank_casar 0f253b11,
-- conta_remesa_casar 57bb45e3, mark_supplier_invoice_paid 927ffeee), y fuera
-- los núcleos y conta_pago_casar_banco. Primero las públicas, que dejan de
-- llamar a los núcleos; después se quitan.

set local lock_timeout = '5s';

select public._restaurar_funcion('public.mark_supplier_invoice_paid(uuid,date,text)', '20261101T2030_b01n_nucleos_casar');
select public._restaurar_funcion('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)', '20261101T2030_b01n_nucleos_casar');
select public._restaurar_funcion('public.conta_remesa_casar(uuid,uuid,uuid[])', '20261101T2030_b01n_nucleos_casar');

drop function if exists public.conta_pago_casar_banco(uuid);
drop function if exists public._conta_remesa_casar_nucleo(uuid, uuid, uuid[], text);
drop function if exists public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid);
drop function if exists public._mark_supplier_invoice_paid_nucleo(uuid, date, text, text);
