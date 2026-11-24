-- supabase/vuelta-atras/20261112T0938_g06_enlace_gocardless.down.sql
--
-- G06 · Vuelta atrás de la 0938: quita la vista y la tabla del enlace único. Los dos enlaces de antes
-- (conta_gc_cliente.party_id y conta_cobro_cliente.gc_cliente_id) no se tocaron: siguen como estaban.
-- Lo que la lectura haya escrito en conta_gc_enlace desde entonces se pierde con la tabla; lo enlazado a mano
-- sigue en conta_gestoria_decision.
drop view if exists public.conta_gc_enlace_elegido;
drop table if exists public.conta_gc_enlace;
