-- supabase/vuelta-atras/20261030T0855_s01d_columnas_retencion.down.sql
--
-- Vuelta atrás de la 0855: fuera las dos columnas (lo que guardan se pierde).
alter table public.company_account drop column if exists withholding_model;
alter table public.journal_line drop column if exists withholding_period;
