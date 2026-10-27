-- supabase/vuelta-atras/20261027T1233_v04_iva_presentado_candado.down.sql
--
-- Vuelta atrás de 20261027T1233_v04_iva_presentado_candado (el candado del IVA).
--   · _journal_entry_proponer vuelve a ser EXACTAMENTE la de antes: se ejecuta
--     el texto que la migración guardó en funcion_respaldo, y _restaurar_funcion
--     comprueba la huella.
--   · Se quitan los tres disparadores y las funciones nuevas.
-- No borra nada: lo que el candado movió al periodo abierto (la fecha de un
-- asiento propuesto) se queda donde está, que es donde debe estar.

select public._restaurar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261027T1233_v04_iva_presentado_candado');

drop trigger if exists trg_journal_entry_0_iva_presentado on public.journal_entry;
drop trigger if exists trg_journal_line_0_iva_presentado on public.journal_line;
drop trigger if exists trg_vat_book_entry_0_iva_presentado on public.vat_book_entry;
drop function if exists public._conta_iva_candado_asiento();
drop function if exists public._conta_iva_candado_apunte();
drop function if exists public._conta_iva_candado_libro();
drop function if exists public._conta_iva_ajustar_propuesta(uuid, jsonb, jsonb);
drop function if exists public.conta_iva_presentados(uuid, int);
drop function if exists public._conta_iva_dia_del_libro(text, smallint, text, date, date, date);
drop function if exists public._conta_iva_asiento_con_iva(uuid);
drop function if exists public._conta_iva_exento(text, uuid, uuid);
drop function if exists public.conta_iva_presentado_mensaje(uuid, jsonb, text);
drop function if exists public.conta_primer_dia_iva_abierto(uuid, date);
drop function if exists public.conta_iva_periodo_de(text, date);
drop function if exists public.conta_iva_periodo_frase(text, text, int, boolean);
drop function if exists public.conta_iva_periodo_nombre(text, int, boolean);
drop function if exists public.conta_iva_presentado(uuid, date);
