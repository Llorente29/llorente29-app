-- supabase/vuelta-atras/20261029T1012_s01c_facturas_solas.down.sql
--
-- Vuelta atrás de 20261029T1012_s01c_facturas_solas: vuelve a poner las dos
-- funciones de Compras tal como estaban (byte a byte, del respaldo: _restaurar_funcion comprueba la huella),
-- quita el disparador y las funciones nuevas y las columnas que añadió. Lo que
-- casó el disparador mientras estuvo puesto se queda casado, y las líneas que
-- se añadieron en oficina se quedan con su movimiento de stock: son datos.

select public._restaurar_funcion('public._compras_camino_calcula(uuid)', '20261029T1012_s01c_facturas_solas');
select public._restaurar_funcion('public.tg_goods_receipt_path_factura()', '20261029T1012_s01c_facturas_solas');
drop trigger if exists supplier_invoice_casar_sola on public.supplier_invoice;
drop function if exists public.tg_supplier_invoice_casar_sola();
drop function if exists public._compras_casar_solo(uuid);
drop function if exists public.compras_cuando_llegan_poner(uuid, text);
drop function if exists public.compras_esperando_detalle(uuid, date);
drop function if exists public.compras_hueco_recepcion(uuid, text);
drop function if exists public.compras_recepcion_linea_anadir(uuid, uuid, numeric, numeric, text);
drop function if exists public.conta_correo_facturas(uuid);
drop function if exists public.compras_factura_lineas(uuid);
drop function if exists public._compras_lineas_comparar(uuid);
drop function if exists public._compras_texto_norm(text);
alter table public.goods_receipt drop column if exists unread_gap_at;
alter table public.goods_receipt drop column if exists unread_gap_by_name;
alter table public.goods_receipt drop column if exists unread_gap_reason;
alter table public.goods_receipt drop column if exists unread_gap_amount;
alter table public.supplier drop column if exists invoice_arrival;
