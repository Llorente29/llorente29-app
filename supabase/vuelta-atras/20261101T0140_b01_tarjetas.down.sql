-- ============================================================================
-- Vuelta atrás de B01 · 5 · tarjetas, IBAN recordados y tickets.
-- ----------------------------------------------------------------------------
-- PARA si hay tickets enlazados a un movimiento (son justificantes: quitar la
-- columna se llevaría el enlace de un ticket de verdad).
--
-- EL BUCKET «banco-tickets» SE QUEDA, con sus dos políticas
-- (banco_tickets_select y banco_tickets_insert). No se toca storage.buckets
-- ni storage.objects con SQL: Supabase no deja borrar de sus tablas sin la
-- Storage API («Direct deletion from storage tables is not allowed»; ensayo
-- #64 de producción, 14/10), y aflojar ese freno no se hace sin autorización.
--   · Queda vacío: la tanda lo crea vacío y, sin tickets enlazados (guarda de
--     abajo), no hay nada que guardar. Si alguien subió un fichero sin llegar
--     a enlazarlo, se queda en el bucket y se quita con la Storage API.
--   · Sus políticas solo usan funciones de antes del B01
--     (current_user_account_ids, current_user_is_admin_or_manager_of): siguen
--     siendo válidas sin el B01.
--   · Volver a aplicar la 0140 no choca: crea el bucket con «on conflict do
--     nothing» y las políticas solo si no existen.
--   · Quitarlo del todo, si se quiere: desde el panel de Supabase o la Storage
--     API (vaciar y borrar «banco-tickets»), y luego las dos políticas.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.bank_movement where receipt_path is not null) then
    raise exception 'Hay tickets enlazados a movimientos: guárdalos antes de quitar las tarjetas.';
  end if;
end $$;
drop function if exists public.bank_tarjeta_del_movimiento(uuid, uuid);
drop function if exists public.bank_ticket_guardar(uuid, text);
drop function if exists public.bank_iban_recordar(uuid, text);
drop function if exists public.bank_tarjeta_baja(uuid);
drop function if exists public.bank_tarjeta_guardar(uuid, uuid, text, text, uuid, boolean);
alter table public.bank_movement drop column if exists receipt_at;
alter table public.bank_movement drop column if exists receipt_path;
alter table public.bank_movement drop column if exists card_id;
drop table if exists public.bank_account_iban;
drop table if exists public.bank_card;
