-- supabase/vuelta-atras/20261122T0100_i01_plazos.down.sql
--
-- Vuelta atrás de 20261122T0100_i01_plazos: los festivos, las reglas de plazo y
-- conta_impuesto_plazo. ANTES, la de la 0110 (tax_return guarda plazos
-- calculados con esto). Se quitan también las dos fuentes del BOE que puso
-- (boe-fiestas-laborales-2026 y -2027; no estaban en producción el 18/10).
-- No hay nada de personas: son datos del BOE, y salen otra vez de la 0100.

drop function if exists public.conta_impuesto_plazo(text, text, int, text, text);
drop function if exists public.conta_impuesto_habil(date, text[]);
drop function if exists public.conta_impuesto_fin_periodo(text, text);
drop table if exists public.tax_form_deadline;
drop table if exists public.tax_holiday;
drop table if exists public.tax_holiday_year;
delete from public.official_source where key in ('boe-fiestas-laborales-2026', 'boe-fiestas-laborales-2027');
