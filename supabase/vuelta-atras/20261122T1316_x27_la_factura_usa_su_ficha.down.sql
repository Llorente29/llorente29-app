-- supabase/vuelta-atras/20261122T1316_x27_la_factura_usa_su_ficha.down.sql
-- X27 · La vuelta atrás de la 1316: quita los dos disparadores y sus funciones. Lo que las recibidas ya copiaron de
-- su ficha se queda en ellas. Va antes que la de la 1315.
drop trigger if exists x27_linea_plataforma on public.supplier_invoice_expense;
drop function if exists public.tg_x27_linea_plataforma();
drop trigger if exists x27_recibida_nace on public.supplier_invoice;
drop function if exists public.tg_x27_recibida_nace();
