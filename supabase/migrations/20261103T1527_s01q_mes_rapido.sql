-- supabase/migrations/20261103T1527_s01q_mes_rapido.sql
--
-- S01q·11 · Ventas › Liquidaciones en menos de 2 s (Julio, 03/11: «el tiempo
-- del mes, antes de fusionar»). Medido en producción, en solo lectura, sobre
-- Foodint: conta_liquidaciones_mes tardaba 8.716 ms en octubre, 11.790 ms en
-- agosto, 5.179 en septiembre y 4.196 en noviembre; el límite de una consulta
-- de usuario es 8 s. El motor de siempre, 7.403 ms con sus tres meses.
--
-- Por qué: las CTE de las dos funciones se encadenan (filas → cifras → dif →
-- estado; g → h → k → e) y PostgreSQL las pone en línea. Cada vez que una
-- expresión de la de arriba se repite en la de abajo (k.est sale en una docena
-- de «case»), se vuelven a calcular sus subconsultas, y las de lo vendido leen
-- unas 5.700 ventas cada vez (24 ms) para quedarse con las de su periodo.
--
-- Qué cambia: «filas» (en conta_liquidaciones) y «g» y «k» (en
-- conta_liquidaciones_mes) pasan a «as materialized»: se calculan una vez.
-- Nada más: el resto del texto de las dos funciones, igual. Misma firma, con
-- su respaldo.
-- Medido igual, con las dos copiadas en pg_temp, en la misma sesión y sobre la
-- misma base: octubre 1.037 ms, agosto 820, septiembre 739, noviembre 751; el
-- motor de tres meses, 1.121. El resultado, idéntico byte a byte en los cinco.
--
-- cambia: public.conta_liquidaciones · prueba: supabase/staging/sql/20261103_s01q_mes_rapido_prueba.sql
-- cambia: public.conta_liquidaciones_mes · prueba: supabase/staging/sql/20261103_s01q_mes_rapido_prueba.sql

select public._respaldar_funcion('public.conta_liquidaciones(uuid,date,date)', '20261103T1527_s01q_mes_rapido');
select public._respaldar_funcion('public.conta_liquidaciones_mes(uuid,date)', '20261103T1527_s01q_mes_rapido');

do $$
declare
  v_def text; v_n int; i int; f text;
  funcs text[] := array['public.conta_liquidaciones(uuid,date,date)', 'public.conta_liquidaciones_mes(uuid,date)', 'public.conta_liquidaciones_mes(uuid,date)'];
  a text[] := array[E'\n  filas as (', '), g as (', '), k as ('];
  b text[] := array[E'\n  filas as materialized (', '), g as materialized (', '), k as materialized ('];
begin
  for i in 1..3 loop
    f := funcs[i];
    v_def := pg_get_functiondef(f::regprocedure);
    if strpos(v_def, b[i]) > 0 then raise notice 'S01q·11: % ya lleva «%».', f, btrim(b[i]); continue; end if;
    v_n := (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]);
    if v_n <> 1 then raise exception 'S01q·11: % no tiene una sola vez «%» (la tiene % veces): no se cambia nada.', f, btrim(a[i]), v_n; end if;
    execute replace(v_def, a[i], b[i]);
  end loop;
end $$;
