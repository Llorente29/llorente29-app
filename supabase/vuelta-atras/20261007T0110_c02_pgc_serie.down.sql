-- supabase/vuelta-atras/20261007T0110_c02_pgc_serie.down.sql
--
-- Deshace 20261007T0110_c02_pgc_serie.sql: vacía la serie del plan contable
-- (la tabla se queda) y quita las dos fuentes que trajo esa migración. Si otra
-- tabla las citara, la clave ajena lo impide y no se deshace nada (mejor eso
-- que dejar una fila sin su fuente).
delete from public.pgc_account;
delete from public.official_source where key in ('rd-1515-2007', 'rd-1-2021');
