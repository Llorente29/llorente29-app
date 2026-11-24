-- supabase/vuelta-atras/20261117T0832_n02_carga_abierta.down.sql
--
-- Vuelta atrás de la 0832 (N02): los cinco CHECK, como estaban antes (medidos
-- en staging el 17/11 con pg_get_constraintdef). Solo entra si ninguna fila usa
-- todavía un valor nuevo; si alguna lo usa, falla entera y no cambia nada (lo
-- que se haya traído con la carga nueva se deshace antes, con su carga).

alter table public.import_run
  drop constraint import_run_program_check,
  add constraint import_run_program_check check (program = 'diez'::text),
  drop constraint import_run_kind_check,
  add constraint import_run_kind_check check (kind = any (array['historico', 'al_dia', 'documentos', 'sumas_saldos']::text[])),
  drop constraint import_run_status_check,
  add constraint import_run_status_check check (status = any (array['en_curso', 'hecho', 'fallido']::text[]));

alter table public.supplier_invoice
  drop constraint supplier_invoice_source_check,
  add constraint supplier_invoice_source_check check (source = any (array['manual', 'ocr', 'lote', 'liquidacion']::text[]));

alter table public.customer_invoice
  drop constraint customer_invoice_origin_check,
  add constraint customer_invoice_origin_check check (origin = any (array['a_mano', 'recurrente', 'presupuesto', 'cierre_dia', 'tienda', 'automatica']::text[]));

comment on column public.import_run.status is null;
