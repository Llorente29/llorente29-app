-- supabase/vuelta-atras/20261117T1603_r05_dia_tpv_anulado.down.sql
--
-- Vuelta atrás de la 1603 (R05): quita el disparador de journal_entry y su
-- función. Un asiento anulado después ya no devolverá su día a «guardado».

drop trigger if exists trg_journal_entry_tpv_anulado on public.journal_entry;
drop function if exists public._tg_conta_tpv_dia_anulado();
