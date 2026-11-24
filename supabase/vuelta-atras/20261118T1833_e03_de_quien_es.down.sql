-- supabase/vuelta-atras/20261118T1833_e03_de_quien_es.down.sql
--
-- E03 · Vuelta atrás de la 1833: quita las cuatro funciones nuevas, la
-- restricción y las tres columnas de la respuesta. Va la última (las otras dos
-- vueltas atrás usan sus columnas).
drop function if exists public.conta_recibida_pasar_a(uuid, uuid, text);
drop function if exists public.conta_recibida_de_quien(uuid, text, text);
drop function if exists public.conta_de_quien_es(uuid);
drop function if exists public._conta_de_quien(uuid);
alter table public.supplier_invoice drop constraint if exists supplier_invoice_e03_respuesta;
alter table public.supplier_invoice drop column if exists recipient_answered_by_name;
alter table public.supplier_invoice drop column if exists recipient_answered_at;
alter table public.supplier_invoice drop column if exists recipient_answer;
