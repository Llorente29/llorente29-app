-- supabase/vuelta-atras/20261028T1555_s01b2_lectura_releida.down.sql
--
-- Deshace 20261028T1555_s01b2_lectura_releida.sql: quita la función. Lo que ya
-- completó en las lecturas (supplier_invoice.reading->factura->proveedor y
-- ->releida) se queda: es lo que trae su PDF, y sin la función nadie lo vuelve
-- a escribir.

drop function if exists public.conta_lectura_proveedor_releida(uuid, uuid);
