-- supabase/vuelta-atras/20261110T1222_g05_gocardless_del_mes.down.sql
-- G05 · Vuelta atrás de la 1222: fuera conta_gocardless_del_mes. La ficha y Clientes
-- publicadas antes no la leen; las de después se quedan sin la cifra del mes.
drop function if exists public.conta_gocardless_del_mes(uuid, text);
