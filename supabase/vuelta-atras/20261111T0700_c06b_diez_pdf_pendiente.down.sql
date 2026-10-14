-- supabase/vuelta-atras/20261111T0700_c06b_diez_pdf_pendiente.down.sql
--
-- Vuelta atrás de 20261111T0700_c06b_diez_pdf_pendiente.sql. ANTES,
-- conta-diez-enviar tiene que volver a la versión que exige el PDF adjunto en
-- Diez (si no, intentaría escribir «pendiente_diez» y fallaría el CHECK).
--
-- PARA si ya hay algo que se perdería: una factura en Diez con su PDF
-- pendiente, un PDF marcado como adjunto a mano o una autorización de Julio.
-- Eso no se deshace callando: se mira primero.
do $$
declare n_pend int; n_mano int; n_aut int;
begin
  select count(*) into n_pend from public.external_send where document_status = 'pendiente_diez';
  select count(*) into n_mano from public.external_send where document_attached_via is not null;
  select count(*) into n_aut from public.conta_diez_autorizo;
  if n_pend + n_mano + n_aut > 0 then
    raise exception 'Vuelta atrás de la 0700: hay % facturas con el PDF pendiente en Diez, % adjuntos marcados y % autorizaciones. No se toca nada.', n_pend, n_mano, n_aut;
  end if;
end $$;
drop function if exists public.conta_diez_adjunto_a_mano(uuid, text);
drop table if exists public.conta_diez_autorizo;
alter table public.external_send drop column if exists document_attached_by_name;
alter table public.external_send drop column if exists document_attached_by;
alter table public.external_send drop column if exists document_attached_via;
alter table public.external_send drop constraint if exists external_send_document_status_check;
alter table public.external_send add constraint external_send_document_status_check
  check (document_status in ('pendiente', 'adjunto', 'fallo'));
