-- supabase/vuelta-atras/20261122T0210_i01b_presentados.down.sql
--
-- Vuelta atrás de 20261122T0210_i01b_presentados. ANTES, el front tiene que
-- volver al de antes del I01b (Impuestos › Presentados la llama). Solo quita
-- una función que lee: no se pierde ningún dato.

drop function if exists public.conta_impuesto_presentados(uuid);
