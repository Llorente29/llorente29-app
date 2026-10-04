-- supabase/staging/sql/20261007_c02_reaplicar_0150.sql
--
-- Solo staging: la 0150 entró en staging antes de corregir el cambio de plan
-- (la hoja nueva 2550 del general chocaba con la 255 de pymes). Se deshace con
-- su vuelta atrás y se aplica la corregida, en UNA transacción. En producción
-- la 0150 entra una sola vez, ya corregida.
\ir ../../vuelta-atras/20261007T0150_c02_deshacer_cambio_plan.down.sql
\ir ../../migrations/20261007T0150_c02_deshacer_cambio_plan.sql
