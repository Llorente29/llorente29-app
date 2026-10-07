-- ============================================================================
-- C04 · Tarea 3 · Quita de staging la versión anterior de las 0100–0130 con su
-- propia vuelta atrás (staging no tiene ningún asiento: la guarda deja pasar).
-- Después, la prueba hace su foto de antes y se aplican las nuevas.
-- En producción nunca hubo versión anterior: allí entran directamente.
-- ============================================================================
\ir ../../vuelta-atras/20261010T0130_c04_lectura.down.sql
\ir ../../vuelta-atras/20261010T0120_c04_funciones.down.sql
\ir ../../vuelta-atras/20261010T0110_c04_enlaces.down.sql
\ir ../../vuelta-atras/20261010T0100_c04_libro.down.sql
