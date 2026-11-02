-- supabase/vuelta-atras/20261102T1311_s01q_ya_contabilizada.down.sql
--
-- Vuelta atrás de la 1311: las pasadas y Facturas recibidas como estaban, fuera la
-- guarda, y el CHECK de antes. Las facturas que la guarda marcó «ya contabilizada»
-- vuelven a «no» con su motivo (el enlace a su asiento de Diez se queda: es un dato).
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261102T1311_s01q_ya_contabilizada');
select public._restaurar_funcion('public._conta_plataforma_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
select public._restaurar_funcion('public._conta_factura_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
drop function if exists public._conta_factura_guarda(uuid);
drop function if exists public._conta_factura_ya_contabilizada(uuid);
update public.supplier_invoice_auto set estado = 'no', at = now() where estado = 'ya_contabilizada';
alter table public.supplier_invoice_auto drop constraint if exists supplier_invoice_auto_estado_check;
alter table public.supplier_invoice_auto add constraint supplier_invoice_auto_estado_check
  check (estado in ('apuntada', 'no', 'deshecha'));
