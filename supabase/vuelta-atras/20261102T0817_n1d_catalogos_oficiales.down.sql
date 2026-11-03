-- supabase/vuelta-atras/20261102T0817_n1d_catalogos_oficiales.down.sql
--
-- Vuelta atrás de la 0817: fuera los catálogos oficiales de Laboral.
drop table if exists public.lab_catalogo;
drop table if exists public.lab_catalogo_fuente;
