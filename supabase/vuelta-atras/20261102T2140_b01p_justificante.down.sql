-- Vuelta atrás de supabase/migrations/20261102T2140_b01p_justificante.sql
-- Las funciones, la tabla (con los justificantes hechos: sus PDF se quedan en el
-- almacén) y la casilla del proveedor. El front, sin ellas, no enseña el bloque.
drop function if exists public.conta_factura_justificantes(uuid);
drop function if exists public.conta_justificante_publico(text);
drop function if exists public.conta_pago_justificante_correo(uuid, text, text, text);
drop function if exists public.conta_pago_justificante_guardar(uuid, text, text);
drop function if exists public.conta_pago_justificante_datos(uuid);
drop function if exists public.conta_pago_justificante_por_hacer(uuid);
drop table if exists public.conta_pago_justificante;
alter table public.supplier drop column if exists justificante_al_pagar;
