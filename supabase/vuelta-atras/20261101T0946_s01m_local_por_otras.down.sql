-- supabase/vuelta-atras/20261101T0946_s01m_local_por_otras.down.sql
-- S01m · Vuelta atrás de la 0946: _conta_local_de_texto como estaba (su respaldo).
select public._restaurar_funcion('public._conta_local_de_texto(uuid,text[])', '20261101T0946_s01m_local_por_otras');
