-- supabase/vuelta-atras/20261104T1640_s01p_recibido_con_factura.down.sql
-- Vuelta atrás de la 1640: _compras_fin_de_mes, la de antes (desde su respaldo), y fuera el disparador.
drop trigger if exists s01p_albaran_facturado on public.goods_receipt_path;
drop function if exists public._tg_s01p_albaran_facturado();
select public._restaurar_funcion('public._compras_fin_de_mes(uuid,date)', '20261104T1640_s01p_recibido_con_factura');
