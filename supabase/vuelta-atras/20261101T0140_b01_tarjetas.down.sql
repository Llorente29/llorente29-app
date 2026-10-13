-- ============================================================================
-- Vuelta atrás de B01 · 5 · tarjetas, IBAN recordados y tickets. PARA si hay
-- tickets subidos (son justificantes: se sacan antes del bucket a mano).
-- ============================================================================
do $$
begin
  if exists (select 1 from public.bank_movement where receipt_path is not null) then
    raise exception 'Hay tickets subidos: guárdalos antes de quitar el bucket.';
  end if;
end $$;
drop function if exists public.bank_tarjeta_del_movimiento(uuid, uuid);
drop function if exists public.bank_ticket_guardar(uuid, text);
drop function if exists public.bank_iban_recordar(uuid, text);
drop function if exists public.bank_tarjeta_baja(uuid);
drop function if exists public.bank_tarjeta_guardar(uuid, uuid, text, text, uuid, boolean);
drop policy if exists banco_tickets_insert on storage.objects;
drop policy if exists banco_tickets_select on storage.objects;
delete from storage.buckets where id = 'banco-tickets';
alter table public.bank_movement drop column if exists receipt_at;
alter table public.bank_movement drop column if exists receipt_path;
alter table public.bank_movement drop column if exists card_id;
drop table if exists public.bank_account_iban;
drop table if exists public.bank_card;
