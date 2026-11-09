-- supabase/vuelta-atras/20261109T1426_g05_t4_ingreso_gocardless.down.sql
-- Vuelta atrás de la 1426 (va después de la de la 1403, que la lee): fuera el
-- casado del ingreso de GoCardless, lo pendiente, los payouts y su enlace en los cobros.
drop function if exists public.conta_abono_gocardless_casar(uuid, text, text, text, text);
drop function if exists public.conta_abonos_gocardless_pendientes(uuid);
drop table if exists public.conta_gc_payout;
alter table public.conta_gc_cobro drop column if exists payout_gc_id;
