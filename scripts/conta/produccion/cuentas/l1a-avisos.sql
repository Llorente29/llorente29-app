-- scripts/conta/produccion/cuentas/l1a-avisos.sql
--
-- L1a · PR 3 (28/10) · LO QUE CUENTA LA TANDA (1800 y 1801), antes y después.
-- SOLO LEE, y solo el catálogo (pg_proc, pg_trigger, tablas, columnas y el
-- cron): nada crece solo.
select clave, valor from (
  select 1 o, 'huella de enqueue_clockout_reminders (la que cambia)' clave,
    (select left(md5(pg_get_functiondef(p.oid)), 8) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = 'enqueue_clockout_reminders') valor union all
  select 2, 'funciones nuevas (detección, cola, respuesta, estados, avisos a la empresa, vigía)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('avisos_olvido_debidos', 'aviso_olvido_cola', '_aviso_olvido_responder', 'responder_aviso_olvido_whatsapp',
                        'responder_aviso_olvido', 'mis_avisos_olvido', 'whatsapp_estado', 'avisos_empresa_por_enviar',
                        'tg_fichaje_fuera_del_radio', 'whatsapp_error_en_palabras', 'vigia_avisos_olvido'))::text union all
  select 3, 'tablas nuevas (whatsapp_entrada, aviso_empresa)',
    (select count(*) from (values ('public.whatsapp_entrada'), ('public.aviso_empresa')) x(t) where to_regclass(x.t) is not null)::text union all
  select 4, 'columnas nuevas (12 del registro de avisos, 2 de los ajustes y la precisión del fichaje)',
    (select count(*) from information_schema.columns where table_schema = 'public'
      and ((table_name = 'clockout_reminder_log' and column_name in ('location_id', 'entrada_at', 'inicio_turno', 'fin_turno', 'salta_at', 'canal',
             'respuesta', 'respondida_at', 'respondida_via', 'correction_request_id', 'entregado_at', 'leido_at'))
        or (table_name = 'app_settings' and column_name in ('aviso_olvido_desde', 'aviso_olvido_hasta'))
        or (table_name = 'clock_entries' and column_name = 'precision_m')))::text union all
  select 5, 'disparador nuevo (fuera del radio)',
    (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_fichaje_fuera_del_radio')::text union all
  select 7, 'fichar() y fichar_con_precision(): sus firmas y huellas (la 1934 añade la segunda y fichar la llama)',
    (select string_agg(p.proname || ' ' || pronargs || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ' · ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('fichar', 'fichar_con_precision')) union all
  -- quieta: el cron solo lo programa la 1800; no se mueve con el uso.
  select 6, 'cron del vigía (avisos-olvido-vigia)',
    (select count(*) from cron.job where jobname = 'avisos-olvido-vigia')::text
) t order by o;
