-- supabase/vuelta-atras/20261028T1630_w10a_order_advance_secreto_del_vault.down.sql
--
-- Deja trg_sale_push_status como antes de la 1630, byte a byte, desde su
-- respaldo (_restaurar_funcion compara la huella): vuelve con el secreto
-- escrito en el cuerpo.
--
-- OJO: solo sirve ANTES de que Julio cambie el secreto. Después, el escrito ya
-- no vale y order-advance rechazaría todos los avisos (401): no se usa.

select public._restaurar_funcion('public.trg_sale_push_status()', '20261028T1630_w10a_order_advance_secreto_del_vault');
