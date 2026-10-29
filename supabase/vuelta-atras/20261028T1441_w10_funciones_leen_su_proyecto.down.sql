-- supabase/vuelta-atras/20261028T1441_w10_funciones_leen_su_proyecto.down.sql
--
-- Deja las 23 como antes de la 20261028T1441, byte a byte, desde su
-- respaldo (_restaurar_funcion compara la huella). Ojo: la de
-- trg_sale_push_status vuelve con el secreto escrito en el cuerpo, como estaba.

select public._restaurar_funcion('public.verifactu_despertar_cuadre()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.verifactu_despertar()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.trg_sale_push_status()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.tg_auto_dispatch()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.system_alert_queue_drain()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_products_availability_bulk_by_token(text,uuid[],boolean,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_products_availability_bulk(uuid[],boolean,uuid,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_product_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_product_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_modifier_option_availability_by_token(text,uuid,boolean,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_modifier_option_availability(uuid,boolean,uuid,text,timestamp with time zone,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_location_status_by_token(text,text,timestamp with time zone,text,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.set_location_status(uuid,text,timestamp with time zone,text,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.request_social_generation(uuid)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.push_location_opening_hours(uuid)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.last_catalog_sync_dispatch()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.last_catalog_import_dispatch()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.db_health_connection_guard()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.conta_recordatorios_despertar()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.conta_recibida_pdf_despertar()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.conta_lote_releer_lanzar(uuid,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public.conta_diez_despertar()', '20261028T1441_w10_funciones_leen_su_proyecto');
select public._restaurar_funcion('public._set_brand_closure_core(uuid,uuid[],text,timestamp with time zone,text,text,uuid,uuid,text,text)', '20261028T1441_w10_funciones_leen_su_proyecto');
