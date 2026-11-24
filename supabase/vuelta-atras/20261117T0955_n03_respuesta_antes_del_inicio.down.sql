-- supabase/vuelta-atras/20261117T0955_n03_respuesta_antes_del_inicio.down.sql
--
-- N03 · la vuelta atrás de lo que añade: las cuatro funciones y la respuesta en la factura.
-- Va después de la de la 0956 (que deja de llamarlas). Las respuestas guardadas se pierden: la
-- factura vuelve a como estaba antes del N03 (se contabiliza al primer día abierto sin preguntar).
drop function if exists public._conta_recibida_antes_del_inicio_para(uuid, uuid);
drop function if exists public.conta_recibida_responder_antes_del_inicio(uuid, text, text);
drop function if exists public.conta_recibida_antes_del_inicio(uuid);
drop function if exists public._conta_programa_de_antes(uuid);
alter table public.supplier_invoice drop constraint if exists supplier_invoice_before_start_answer_check;
alter table public.supplier_invoice drop column if exists before_start_answered_by_name;
alter table public.supplier_invoice drop column if exists before_start_answered_at;
alter table public.supplier_invoice drop column if exists before_start_answer;
