-- supabase/vuelta-atras/20261024T1650_v01_liquidaciones.down.sql
--
-- Vuelta atrás de 20261024T1650_v01_liquidaciones: borra sus dos funciones y
-- la tabla de lo resuelto (con lo que haya). Lo que ya hizo se queda, porque
-- es libro o es una decisión de alguien: el asiento validado de un gasto (se
-- anula, si hace falta, desde Contabilidad) y el «reclamado» de un pedido del
-- C11b en journal_dismissal (que es como «Se cobró por otro lado»).

drop function if exists public.conta_plataforma_resolver(uuid, uuid, uuid, date, date, uuid, text, numeric, text, date, jsonb, text);
drop function if exists public.conta_plataformas(uuid, date, date);
drop table if exists public.conta_liquidacion_resolucion;
