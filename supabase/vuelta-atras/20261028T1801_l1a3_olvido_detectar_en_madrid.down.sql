-- supabase/vuelta-atras/20261028T1801_l1a3_olvido_detectar_en_madrid.down.sql
--
-- Deja enqueue_clockout_reminders() como antes de la 1801, byte a byte, desde
-- su respaldo (_restaurar_funcion compara la huella), y quita el disparador de
-- fuera del radio y los tres CHECK. Lo de la 1800 se queda: lo quita su propia
-- vuelta atrás.

drop trigger if exists trg_fichaje_fuera_del_radio on public.clock_entries;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_canal_chk;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_respuesta_chk;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_via_chk;

select public._restaurar_funcion('public.enqueue_clockout_reminders()', '20261028T1801_l1a3_olvido_detectar_en_madrid');
