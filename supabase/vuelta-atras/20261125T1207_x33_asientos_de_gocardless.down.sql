-- X33 · vuelta atrás de 20261125T1207: quita lo que prepara los asientos de GoCardless (su tabla y sus funciones).
-- Los asientos ya propuestos con ella se quedan en los libros como cualquier otro propuesto: se descartan a mano.
drop function if exists public.conta_gc_asientos_del_mes(uuid, date);
drop function if exists public.conta_gc_asientos_preparar(uuid, date, text);
drop function if exists public._conta_gc_asientos_plan(uuid, date);
drop function if exists public._conta_gc_factura_del_cobro(uuid, uuid, numeric, date);
drop table if exists public.conta_gc_asiento;
