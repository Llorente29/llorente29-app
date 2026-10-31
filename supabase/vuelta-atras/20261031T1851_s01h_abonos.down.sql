-- supabase/vuelta-atras/20261031T1851_s01h_abonos.down.sql
--
-- S01h · Vuelta atrás de la 1851: fuera los dos disparadores y sus funciones.
-- Los abonos ya ligados y las compensaciones ya hechas se quedan (son datos
-- con su asiento): quitarlos sería deshacer pagos.

drop trigger if exists s01h_abono_validado on public.journal_entry;
drop trigger if exists s01h_abono_ligar on public.supplier_invoice;
drop function if exists public._conta_abono_validado();
drop function if exists public.conta_abono_compensar(uuid);
drop function if exists public._conta_abono_ligar();
drop function if exists public._conta_abono_clave(text);
