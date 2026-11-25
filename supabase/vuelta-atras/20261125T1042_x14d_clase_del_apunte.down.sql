-- supabase/vuelta-atras/20261125T1042_x14d_clase_del_apunte.down.sql
-- X14 · 2 · Quita la función de la clase de una línea (no la llama nadie todavía).
drop function if exists public._conta_traer_clase_apunte(numeric, numeric);
