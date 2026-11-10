-- supabase/vuelta-atras/20261110T1403_gb_quien_lleva.down.sql
-- GB · la vuelta atrás de la 1403: fuera la función (solo leía). El responsable guardado en la ficha se queda: es lo que dice el CRM.
drop function if exists public.conta_portal_quien_lleva(uuid);
