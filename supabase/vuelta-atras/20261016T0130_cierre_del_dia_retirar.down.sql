-- Vuelta atrás de «El día se cierra a las 6:00» · 4 · retirar lo propuesto antes del cierre.
-- No se devuelve el asiento retirado: era una propuesta de un día a medias, y
-- el proponedor la hará entera cuando el día cierre. La copia se queda en
-- _retirado_cierre_del_dia (no se borra aquí: es lo único que dice qué había).
drop function if exists public.conta_propuestos_antes_del_cierre(uuid);
