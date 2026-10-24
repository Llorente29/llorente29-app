-- supabase/vuelta-atras/20261122T0190_i01b_calendario.down.sql
--
-- Vuelta atrás de 20261122T0190_i01b_calendario. ANTES, el front tiene que
-- volver al de antes del I01b (Impuestos › Calendario llama a la función que
-- esto quita). Solo quita funciones que no escriben nada: no se pierde ningún dato.

drop function if exists public.conta_impuesto_calendario(uuid, date);
drop function if exists public.conta_impuesto_periodos(uuid, int);
drop function if exists public.conta_impuesto_plazo_si_hay(text, text, int, text);
