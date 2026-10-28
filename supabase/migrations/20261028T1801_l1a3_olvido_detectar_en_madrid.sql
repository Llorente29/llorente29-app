-- supabase/migrations/20261028T1801_l1a3_olvido_detectar_en_madrid.sql
--
-- L1a · PR 3 · segunda de dos (28/10/2026): lo que CAMBIA. Va después de la
-- 1800, que añade la detección nueva (avisos_olvido_debidos).
--
-- enqueue_clockout_reminders() deja de detectar por su cuenta y usa la nueva.
-- La de antes miraba la hora en UTC, la última marca del día fuera del tipo
-- que fuera y el día en UTC: de los 51 avisos que mandó desde el 05/08, 48
-- eran a gente que ya había fichado la salida o seguía trabajando dentro de su
-- turno (auditoría L0 §3.1). La nueva: una por entrada abierta, en hora de
-- Madrid, al fin del turno publicado más el margen (o a las 12 h sin turno), y
-- el WhatsApp solo dentro de la franja de la empresa.
--
-- Misma firma, mismo llamador (la función de borde clockout-reminder y, desde
-- la 1800, el vigía). Con respaldo: la vuelta atrás la deja byte a byte.
--
-- Y en caliente, en dos tablas que existen:
--   · clockout_reminder_log: tres CHECK que solo miran columnas que añade la
--     1800 (canal, respuesta, respondida_via; las 111 filas de antes, nulas);
--   · clock_entries: el disparador NUEVO de fuera del radio (después de
--     insertar, solo cuando within_radius es false y la ubicación es precisa,
--     precision_m de 100 m o menos; nunca rompe el fichaje: si falla, lo dice
--     a sistema y el fichaje sigue).
--
-- cambia: public.enqueue_clockout_reminders · prueba: supabase/staging/sql/20261028_l1a3_avisos_prueba.sql
-- cambia: public.clockout_reminder_log · prueba: supabase/staging/sql/20261028_l1a3_avisos_prueba.sql
-- cambia: public.clock_entries · prueba: supabase/staging/sql/20261028_l1a3_avisos_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261028T1801_l1a3_olvido_detectar_en_madrid.down.sql

select public._respaldar_funcion('public.enqueue_clockout_reminders()', '20261028T1801_l1a3_olvido_detectar_en_madrid');

create or replace function public.enqueue_clockout_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count integer := 0;
begin
  insert into public.clockout_reminder_log (
    account_id, employee_id, clock_entry_id, location_id, to_phone, scheduled_end,
    entrada_at, inicio_turno, fin_turno, salta_at, canal, status, skip_reason)
  select d.account_id, d.employee_id, d.clock_entry_id, d.location_id, d.to_phone,
         to_char(d.fin_turno at time zone 'Europe/Madrid', 'HH24:MI'),
         d.entrada_at, d.inicio_turno, d.fin_turno, d.salta_at, d.canal, d.status, d.skip_reason
    from public.avisos_olvido_debidos(now()) d
  on conflict (clock_entry_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.enqueue_clockout_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_clockout_reminders() to service_role;

-- ── Los CHECK de las columnas nuevas ───────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clockout_reminder_canal_chk') then
    alter table public.clockout_reminder_log add constraint clockout_reminder_canal_chk
      check (canal is null or canal in ('whatsapp', 'portal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clockout_reminder_respuesta_chk') then
    alter table public.clockout_reminder_log add constraint clockout_reminder_respuesta_chk
      check (respuesta is null or respuesta in ('a_su_hora', 'otra_hora', 'sigo'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clockout_reminder_via_chk') then
    alter table public.clockout_reminder_log add constraint clockout_reminder_via_chk
      check (respondida_via is null or respondida_via in ('whatsapp', 'portal'));
  end if;
end $$;

-- ── Fuera del radio: el disparador ────────────────────────────────────────
drop trigger if exists trg_fichaje_fuera_del_radio on public.clock_entries;
create trigger trg_fichaje_fuera_del_radio
  after insert on public.clock_entries
  for each row when (new.within_radius = false and new.precision_m is not null and new.precision_m <= 100)
  execute function public.tg_fichaje_fuera_del_radio();
