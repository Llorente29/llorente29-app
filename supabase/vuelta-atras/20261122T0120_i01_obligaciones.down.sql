-- supabase/vuelta-atras/20261122T0120_i01_obligaciones.down.sql
--
-- Vuelta atrás de 20261122T0120_i01_obligaciones: quita las reglas con nombre
-- y las dos funciones que las usan. ANTES, el front de antes del I01a (el alta
-- del I01a llama a conta_impuesto_obligaciones_calcular).
-- Lo que escribieron las reglas en tax_obligation se queda: lo quita, si toca,
-- la vuelta atrás de la 0110. Ningún dato se pierde aquí.

drop function if exists public.conta_impuesto_obligacion_decidir(uuid, text, boolean, text);
drop function if exists public.conta_impuesto_obligaciones_calcular(uuid);
drop function if exists public.conta_impuesto_reglas(uuid);
