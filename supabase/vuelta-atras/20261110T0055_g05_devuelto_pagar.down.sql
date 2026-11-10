-- supabase/vuelta-atras/20261110T0055_g05_devuelto_pagar.down.sql
-- G05 · Vuelta atrás de la 0055: fuera las cuatro funciones del devuelto. Los
-- eventos que hayan apuntado (enlace_para_pagar, pasado_de_nuevo) se quedan: son
-- lo que pasó.
drop function if exists public.conta_recibo_devuelto_opciones(uuid);
drop function if exists public._conta_recibo_devuelto_opciones(uuid);
drop function if exists public._conta_recibo_devuelto_hecho(uuid, text, text, jsonb, text);
drop function if exists public._conta_usuario_cobra(uuid, uuid);
