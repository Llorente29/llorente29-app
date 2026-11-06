-- supabase/vuelta-atras/20261106T1932_g01_tarifas_y_reintentos.down.sql
--
-- G01 · La vuelta atrás de la 1932: fuera las dos funciones y el interruptor
-- de los reintentos. Va antes que la de la 1531 y la de la 1530.
-- sin prueba con datos: la prueba de staging (20261106_g01_clientes_cuotas_prueba.sql) la pasa en ROLLBACK con las otras dos y comprueba que todo queda como antes; el ensayo de producción la pasa entera, en ROLLBACK.

drop function if exists public.conta_gocardless_reintentos(uuid, boolean);
drop function if exists public.conta_gestoria_tarifa_guardar(uuid, uuid, uuid, numeric, text, date, text);
alter table public.conta_cobro_gocardless drop column if exists reintentos_inteligentes;
