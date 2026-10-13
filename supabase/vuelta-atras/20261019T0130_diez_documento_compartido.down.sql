-- Vuelta atrás de 20261019T0130_diez_documento_compartido.sql.
--
-- Deja external_document como la dejó la 0110: único por (empresa, sha256) y
-- tres estados. Si ya hay un fichero enlazado a más de un asiento, o filas en
-- «no_requiere», NO se puede volver sin perder qué asiento respalda cada
-- fichero: el índice o el CHECK fallan y la vuelta atrás se para entera, con
-- el error de Postgres. No se borra nada a escondidas para que entre.

alter table public.external_document drop constraint if exists external_document_no_requiere_check;
alter table public.external_document drop constraint if exists external_document_status_check;
alter table public.external_document add constraint external_document_status_check
  check (status in ('enlazado', 'revisar', 'pendiente_diez'));
create unique index if not exists external_document_sha_uq on public.external_document (company_id, sha256) where sha256 is not null;
drop index if exists public.external_document_sha_entry_uq;
comment on column public.external_document.status is null;
