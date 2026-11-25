-- X33c · vuelta atrás de 20261125T1810: conta_gc_asientos_preparar desde su respaldo y otra vez una factura por cobro
-- (la restricción única). Si ya hay una factura atada a más de un cobro, la restricción no se puede volver a poner: la
-- vuelta atrás para y lo dice, y esos enlaces se miran a mano antes.
select public._restaurar_funcion('public.conta_gc_asientos_preparar(uuid,date,text)', '20261125T1810_x33c_varios_cobros_por_factura');
drop index if exists public.conta_gc_cobro_factura_factura;
alter table public.conta_gc_cobro_factura add constraint conta_gc_cobro_factura_invoice_id_key unique (invoice_id);
