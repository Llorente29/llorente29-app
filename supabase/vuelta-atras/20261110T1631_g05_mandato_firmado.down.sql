-- supabase/vuelta-atras/20261110T1631_g05_mandato_firmado.down.sql
-- G05 · Vuelta atrás de la 1631: conta_lista_que_hacer como estaba (de su respaldo, byte a byte).
select public._restaurar_funcion('public.conta_lista_que_hacer(uuid)', '20261110T1631_g05_mandato_firmado');
