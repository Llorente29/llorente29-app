-- supabase/vuelta-atras/20261106T2000_g01_ficha_acciones.down.sql
--
-- G01 · La vuelta atrás de la 2000: fuera las seis funciones de la ficha, sus
-- ayudantes y las decisiones. Va antes que la de la 1932, la 1531 y la 1530.
-- sin prueba con datos: la prueba de staging (20261106_g01_clientes_cuotas_prueba.sql) la pasa en ROLLBACK con las otras tres y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

drop function if exists public.conta_gestoria_revisada(uuid, text);
drop function if exists public.conta_gestoria_enlazar(uuid, text, uuid);
drop function if exists public.conta_gestoria_no_contar(uuid, text, text);
drop function if exists public.conta_gestoria_linea_desde_gc(uuid, text, uuid, text);
drop function if exists public.conta_gestoria_baja_linea(uuid, date);
drop function if exists public.conta_gestoria_alta_empleado(uuid, uuid, uuid, text, date);
drop function if exists public._conta_gestoria_euros(numeric);
drop function if exists public._conta_gestoria_mes(date);
drop function if exists public._conta_gestoria_puede(uuid);
drop table if exists public.conta_gestoria_decision;
