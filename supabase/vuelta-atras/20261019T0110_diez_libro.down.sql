-- Vuelta atrás de «C04b · T2 · Traer de Diez, enviar a Diez y comparar: el modelo».
-- Quita lo nuevo. Si ya se trajo algo de Diez, lo traído (journal_entry con
-- external_program) se queda: solo pierde su ejercicio de origen, su huella y
-- su lectura, y deja de estar protegido por el índice único.
drop table if exists public.external_balance_witness;
drop table if exists public.external_document;
drop table if exists public.external_compare_day;
drop table if exists public.external_entry_snapshot;
drop table if exists public.external_send;
drop index if exists public.journal_entry_external_uq;
alter table public.journal_line drop column if exists external_voucher;
alter table public.journal_line drop column if exists external_counterpart;
alter table public.journal_entry drop column if exists import_run_id;
alter table public.journal_entry drop column if exists external_hash;
alter table public.journal_entry drop column if exists external_year;
drop table if exists public.import_run;
