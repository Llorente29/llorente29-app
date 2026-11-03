-- supabase/vuelta-atras/20261103T0744_s01q_liquidacion_no_repite.down.sql
-- Vuelta atrás de la 0744: fuera la regla hermana (sus disparadores y funciones). No toca datos.
drop trigger if exists trg_journal_entry_liquidacion_no_repite on public.journal_entry;
drop trigger if exists trg_journal_line_liquidacion_no_repite on public.journal_line;
drop function if exists public.tg_journal_entry_liquidacion_no_repite();
drop function if exists public.tg_journal_line_liquidacion_no_repite();
drop function if exists public._conta_liquidacion_no_repite(uuid, uuid);
drop function if exists public._conta_liquidacion_comision_asiento(uuid);
