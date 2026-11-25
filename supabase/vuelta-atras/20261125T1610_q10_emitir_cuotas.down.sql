-- supabase/vuelta-atras/20261125T1610_q10_emitir_cuotas.down.sql
--
-- Vuelta atrás de la 1610 (Q10 · emitir las cuotas ya cobradas): quita la función. Lo que ya se emitió con ella NO se
-- des-emite (una factura emitida se corrige con una rectificativa, como cualquiera), ni su enlace en
-- conta_gc_cobro_factura, ni la serie «1» que creó la primera emisión.

drop function if exists public.conta_cuotas_emitir(uuid, text, int, text, jsonb);
