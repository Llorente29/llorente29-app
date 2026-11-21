-- supabase/vuelta-atras/20261117T2240_n06b_traida_sin_pagar.down.sql
--
-- N06b · la vuelta atrás de los candados: quita los tres disparadores y sus dos funciones (va después
-- de la de la 2241, que las usa en las listas).
drop trigger if exists trg_supplier_invoice_n06b_en_prueba on public.supplier_invoice;
drop trigger if exists trg_supplier_invoice_payment_n06b_en_prueba on public.supplier_invoice_payment;
drop trigger if exists trg_conta_pago_remesa_linea_n06b_en_prueba on public.conta_pago_remesa_linea;
drop function if exists public.tg_n06b_traida_no_se_paga();
drop function if exists public._conta_traida_en_prueba(text, uuid, text);
