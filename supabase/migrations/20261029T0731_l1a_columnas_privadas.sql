-- supabase/migrations/20261029T0731_l1a_columnas_privadas.sql
--
-- L1a · PR 2b («Cerrar»), segundo fichero (29/10/2026). El salario, el DNI, la
-- fecha de nacimiento y el coste anual de Seguridad Social de employees dejan
-- de poder LEERSE con la sesión (authenticated y anon). Se siguen pudiendo
-- escribir (la ficha los guarda) y los lee quien tiene derecho por funciones
-- de servidor: empleados_datos_privados (1905, solo el administrador),
-- export_gestoria_mensual (0730, solo el administrador) y el informe para la
-- Inspección (0705).
--
-- Cómo: Postgres no deja quitar el SELECT de unas columnas si hay SELECT de
-- tabla. Se quita el de tabla y se da el de cada columna que NO es privada,
-- leyéndolas del catálogo al aplicar (así no se queda ninguna fuera).
--
-- OJO para después: una columna que se añada a employees a partir de aquí NO
-- la puede leer la sesión hasta que su migración haga
--   grant select (<columna>) on public.employees to authenticated, anon;
--
-- Es el segundo paso de dos (W01). El primero lo publicó el PR 2 (#370): el
-- front guarda la ficha con INSERT o UPDATE y no con upsert (un upsert ON
-- CONFLICT sobre employees falla con estas columnas cerradas; medido en local
-- el 28/10). Medido el 29/10 en el código de main y de la rama de LS1 (#388):
-- nadie lee esas columnas de employees con la sesión salvo el respaldo de
-- leerDatosPrivadosDeEmpleados, que solo corre si falta la función de la 1905
-- (en producción está). En la base: ninguna vista depende de esas columnas, y
-- la única función con los permisos de quien llama que las leía es
-- export_gestoria_mensual, que la 0730 pasa a servidor.
--
-- cambia: public.employees · prueba: supabase/staging/sql/20261029_l1a_cerrar_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261029T0731_l1a_columnas_privadas.down.sql

do $$
declare
  v_columnas text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_columnas
    from pg_attribute a
   where a.attrelid = 'public.employees'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname not in ('salary', 'dni', 'birth_date', 'employer_ss_annual');
  if v_columnas is null then
    raise exception 'employees sin columnas: algo no cuadra';
  end if;
  revoke select on public.employees from authenticated, anon;
  execute format('grant select (%s) on public.employees to authenticated, anon', v_columnas);
end $$;
