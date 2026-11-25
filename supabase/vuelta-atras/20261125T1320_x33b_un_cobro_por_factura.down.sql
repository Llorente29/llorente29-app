-- X33b · vuelta atrás de 20261125T1320: las tres funciones de los asientos de GoCardless desde su respaldo, y fuera la
-- función, la tabla de enlace y las dos columnas nuevas. Los cobros ya apuntados en sus facturas se quedan (son cobros de verdad).
select public._restaurar_funcion('public._conta_gc_asientos_plan(uuid,date)', '20261125T1320_x33b_un_cobro_por_factura');
select public._restaurar_funcion('public.conta_gc_asientos_preparar(uuid,date,text)', '20261125T1320_x33b_un_cobro_por_factura');
select public._restaurar_funcion('public.conta_gc_asientos_del_mes(uuid,date)', '20261125T1320_x33b_un_cobro_por_factura');
drop function if exists public._conta_gc_factura_de_cobro(uuid, text);
drop table if exists public.conta_gc_cobro_factura;
alter table public.conta_gc_asiento drop column if exists nota;
alter table public.conta_gc_asiento drop column if exists factura_id;
