-- supabase/staging/sql/20261008_c02c_reaplicar_0100.sql
--
-- C02c · En staging la 0100 entró con un fallo (ejecución 37377481112): un
-- alias «x» en company_chart_import_apply chocaba con la variable «x» del
-- bucle. Se corrigió en la propia 0100, que aún no está en producción. Aquí
-- se vuelve a aplicar: su vuelta atrás (no queda nada traído: la prueba fue
-- con ROLLBACK) y la 0100 corregida. La 0110 y la 0120 no cambian.
\ir ../../vuelta-atras/20261008T0100_c02c_traer_plan.down.sql
\ir ../../migrations/20261008T0100_c02c_traer_plan.sql
