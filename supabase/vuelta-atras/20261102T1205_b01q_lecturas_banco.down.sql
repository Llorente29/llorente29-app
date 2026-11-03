-- Vuelta atrás de supabase/migrations/20261102T1205_b01q_lecturas_banco.sql
-- Quita el registro de las lecturas y su función. La función de cada noche
-- sigue funcionando sin ellos (si no está la función, no apunta la lectura y
-- no para).
drop function if exists public.bank_agregador_lectura_apuntar(uuid, text, text, text, date, date, date, integer, integer, integer, integer, numeric, integer, numeric, text, numeric, numeric);
drop table if exists public.bank_aggregator_lectura;
