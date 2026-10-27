-- supabase/vuelta-atras/20261027T1350_v04_recibida_fecha_entrada.down.sql
--
-- Vuelta atrás de 20261027T1350_v04_recibida_fecha_entrada: _journal_entry_proponer
-- vuelve a ser EXACTAMENTE la de antes (la de la 1233), desde su respaldo y con
-- la huella comprobada; y se quita _conta_recibida_no_antes_de_entrar. No toca
-- datos: lo que se propuso con la fecha de entrada se queda así.

select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261027T1350_v04_recibida_fecha_entrada');
drop function if exists public._conta_recibida_no_antes_de_entrar(uuid, jsonb);
