-- supabase/vuelta-atras/20261110T1622_g05_anual_en_su_mes.down.sql
-- G05 · Vuelta atrás de la 1622: conta_linea_al_mes como estaba (de su respaldo, byte a byte).
select public._restaurar_funcion('public.conta_linea_al_mes(uuid,date)', '20261110T1622_g05_anual_en_su_mes');
