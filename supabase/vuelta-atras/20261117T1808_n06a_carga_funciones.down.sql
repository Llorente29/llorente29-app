-- supabase/vuelta-atras/20261117T1808_n06a_carga_funciones.down.sql
--
-- N06a · la vuelta atrás de las funciones: las quita. Lo que hayan traído (si se trajo algo) se queda
-- donde está: se deshace antes con «Deshacer el traspaso».
drop function if exists public.conta_empresa_dia_de_inicio(uuid);
drop function if exists public.conta_traer_dejar_fuera(uuid, uuid[], boolean);
drop function if exists public.conta_traer_deshacer(uuid, text);
drop function if exists public.conta_traer_cargar(uuid, text, jsonb, text);
drop function if exists public._conta_traer_kind(text);
drop function if exists public._conta_traer_ocupada(uuid, text, uuid);
drop function if exists public._conta_traer_cuantos(int, text, text);
drop function if exists public._conta_traer_euros(numeric);
