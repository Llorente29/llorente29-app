-- supabase/vuelta-atras/20261028T1800_l1a3_avisos_olvido_radio_vigia.down.sql
--
-- Quita todo lo que añade la 1800: el vigía y su cron, el aviso fuera del
-- radio (disparador y función), los avisos a la empresa, lo que llegó del
-- webhook, la respuesta en un toque, la cola, la detección nueva y las
-- columnas nuevas del registro y de los ajustes. Va DESPUÉS de la vuelta
-- atrás de la 1801 (que deja enqueue_clockout_reminders sin usar la
-- detección nueva). Se pierden los avisos a la empresa, lo que llegó de Meta
-- y las respuestas guardadas entre medias; las peticiones de corrección que
-- se crearon se quedan (son del encargado).

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'avisos-olvido-vigia') then
      perform cron.unschedule('avisos-olvido-vigia');
    end if;
  end if;
end $$;

drop function if exists public.vigia_avisos_olvido(boolean, timestamptz);
drop function if exists public.whatsapp_error_en_palabras(text);
drop trigger if exists trg_fichaje_fuera_del_radio on public.clock_entries;
drop function if exists public.tg_fichaje_fuera_del_radio();
-- _metros: la tuvo una versión anterior de la 1800 (el «sitio habitual», quitado el 28/10).
drop function if exists public._metros(double precision, double precision, double precision, double precision);
drop function if exists public.avisos_empresa_por_enviar(integer);
drop table if exists public.aviso_empresa;
drop function if exists public.whatsapp_estado(text, text, timestamptz, text);
drop table if exists public.whatsapp_entrada;
drop function if exists public.mis_avisos_olvido();
drop function if exists public.responder_aviso_olvido(uuid, text, timestamptz);
drop function if exists public.responder_aviso_olvido_whatsapp(uuid, text, text, text);
drop function if exists public._aviso_olvido_responder(uuid, text, timestamptz, text);
drop function if exists public.aviso_olvido_cola(integer, timestamptz);
drop function if exists public.avisos_olvido_debidos(timestamptz);

drop index if exists public.ix_clockout_reminder_wamid;
drop index if exists public.ix_clockout_reminder_empleado;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_canal_chk;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_respuesta_chk;
alter table public.clockout_reminder_log drop constraint if exists clockout_reminder_via_chk;
alter table public.clockout_reminder_log
  drop column if exists leido_at, drop column if exists entregado_at, drop column if exists correction_request_id,
  drop column if exists respondida_via, drop column if exists respondida_at, drop column if exists respuesta,
  drop column if exists canal, drop column if exists salta_at, drop column if exists fin_turno,
  drop column if exists inicio_turno, drop column if exists entrada_at, drop column if exists location_id;
alter table public.app_settings drop column if exists aviso_olvido_hasta, drop column if exists aviso_olvido_desde;
alter table public.clock_entries drop column if exists precision_m;
