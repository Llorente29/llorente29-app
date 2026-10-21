-- supabase/staging/sql/20261129_autoconteo_limpiar.sql
--
-- AUTOCONTEO · para que la tanda de staging se pueda volver a pasar: si la
-- 0400 o la 0390 ya están puestas (de un run anterior), las quita con SUS
-- PROPIAS vueltas atrás. Así, en cada run, staging ensaya también las dos
-- .down.sql antes de volver a aplicar. Va delante de la 0390 en
-- supabase/staging/aplicar.txt.
select to_regprocedure('public._autoconteo_aplicar(uuid,text,uuid,text)') is not null as hay_0360 \gset
\if :hay_0360
\echo 'autoconteo: la 0400 ya estaba; se quita con su vuelta atrás'
\i supabase/vuelta-atras/20261129T0400_autoconteo_se_aplica_entero.down.sql
\endif
select to_regclass('public.autoconteo_anulacion_20261021') is not null as hay_0350 \gset
\if :hay_0350
\echo 'autoconteo: la 0390 ya estaba; se quita con su vuelta atrás'
\i supabase/vuelta-atras/20261129T0390_autoconteo_anula_atascados.down.sql
\endif
