-- supabase/vuelta-atras/20261117T1655_n05c_sin_historico_decision.down.sql
--
-- N05c · la vuelta atrás de lo que añade: las cinco funciones y la decisión de cada ejercicio. Va
-- después de la de la 1656 (que deja de llamarlas). Una decisión tomada se pierde: el ejercicio
-- vuelve a no dejar validar nada hasta traer lo anterior, como antes del N05c.
drop function if exists public.conta_trabajar_sin_historico_retirar(uuid, text);
drop function if exists public.conta_trabajar_sin_historico(uuid, text, text);
drop function if exists public._conta_falta_historico_motivo(uuid);
drop function if exists public._conta_inicio_del_ejercicio(public.fiscal_year);
drop function if exists public._conta_de_programa(text);
alter table public.fiscal_year drop column if exists works_without_history_by_name;
alter table public.fiscal_year drop column if exists works_without_history_by;
alter table public.fiscal_year drop column if exists works_without_history_at;
