-- supabase/staging/sql/20261102_a01_un_correo_por_problema_prueba.sql
--
-- SOLO STAGING. Prueba de la 1936 (A01-1: un correo por problema y techo
-- diario), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Nombra lo que cambia: public.encolar_alerta y public.last_catalog_watchdog.
-- sin usuario: los avisos los encolan los vigías y los disparadores como su dueño (security definer); ningún usuario de la app llama a encolar_alerta ni a las tablas nuevas, que no tienen permiso para anon ni authenticated (paso 6).
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA A01-1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- Lo que manda la prueba se queda en su transacción; nada sale (la cola se
-- vacía con el ROLLBACK antes de que la vea el drenaje).
create temp table _antes on commit drop as select max(id) as id from public.system_alert_queue;
create function pg_temp.mandados(p_clave text) returns integer language sql as $f$
  select count(*)::integer from public.system_alert_queue
   where id > coalesce((select id from _antes), 0) and (debounce_kind like p_clave || '%' or subject like '%' || p_clave || '%')
$f$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select to_regclass('public.aviso_problema') is not null as a01_1_aplicada \gset
\if :a01_1_aplicada
\i supabase/vuelta-atras/20261102T1936_a01_un_correo_por_problema.down.sql
\endif
-- El mismo problema con la fecha de dos días: hoy salen DOS correos.
select public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261101', interval '2 hours');
select public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261102', interval '2 hours');
do $$ begin
  if pg_temp.mandados('ingesta_silencio_a01prueba') <> 2 then
    raise exception 'PRUEBA A01-1 · 0: con el antirruido de antes no salen dos correos: la prueba no mediría nada.';
  end if;
  raise notice 'A01-1 · 0 (rojo a propósito): con lo de antes, el mismo problema con otra fecha manda otro correo (2).';
end $$;
delete from public.system_alert_queue where id > coalesce((select id from _antes), 0);

-- ── 1 · Recién aplicada ─────────────────────────────────────────────────────
\i supabase/migrations/20261102T1936_a01_un_correo_por_problema.sql
-- Para la prueba, las pasadas del vigía las decide la prueba (se va con el ROLLBACK).
create temp table _pasadas (n integer) on commit drop;
insert into _pasadas values (0);
create or replace function public._aviso_pasadas_desde(p_tarea text, p_desde timestamptz)
returns integer language sql stable as $f$ select n from _pasadas $f$;
-- Sin el techo por medio en los pasos 2 y 3: la cola de hoy, vacía (ROLLBACK).
delete from public.system_alert_queue where created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';

-- ── 2 · Abre, sigue, empeora ────────────────────────────────────────────────
do $$ declare v bigint; begin
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261101', interval '2 hours');
  if v is null then raise exception 'PRUEBA A01-1 · 2: el problema nuevo no manda correo.'; end if;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261102', interval '2 hours');
  if v is not null then raise exception 'PRUEBA A01-1 · 2: el mismo problema con otra fecha vuelve a mandar correo.'; end if;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261102', null);
  if v is not null then raise exception 'PRUEBA A01-1 · 2: el mismo problema sin ventana vuelve a mandar correo.'; end if;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_critico_20261102', interval '2 hours');
  if v is null or (select subject from public.system_alert_queue where id = v) not like 'Empeora · %' then
    raise exception 'PRUEBA A01-1 · 2: al pasar de alto a crítico no sale «Empeora».';
  end if;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261102', interval '2 hours');
  if v is not null then raise exception 'PRUEBA A01-1 · 2: al bajar de crítico a alto manda correo.'; end if;
  -- Un md5 que cambia en cada pasada es el mismo problema.
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · vende apagado', 'prueba', 'ingesta_vende_apagado_a01prueba_' || md5('uno'), interval '7 days');
  if v is null then raise exception 'PRUEBA A01-1 · 2: «vende apagado» nuevo no manda correo.'; end if;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · vende apagado', 'prueba', 'ingesta_vende_apagado_a01prueba_' || md5('dos'), interval '7 days');
  if v is not null then raise exception 'PRUEBA A01-1 · 2: «vende apagado» con otro md5 vuelve a mandar correo (el caso de Kitchen Grill).'; end if;
  if pg_temp.mandados('ingesta_silencio_a01prueba') <> 2 or pg_temp.mandados('ingesta_vende_apagado_a01prueba') <> 1 then
    raise exception 'PRUEBA A01-1 · 2: no salen 2 + 1 correos.';
  end if;
  raise notice 'A01-1 · 2: abre (1 correo), sigue con otra fecha y otro md5 (0), empeora a crítico (1), baja (0).';
end $$;

-- ── 3 · Se resuelve con dos pasadas, y si vuelve es nuevo ────────────────────
do $$ declare v bigint; n integer; begin
  update _pasadas set n = 1;
  perform public.avisos_resolver();
  if (select resuelto_at from public.aviso_problema where clave = 'ingesta_silencio_a01prueba') is not null then
    raise exception 'PRUEBA A01-1 · 3: con una sola pasada sin verlo ya lo da por resuelto.';
  end if;
  update _pasadas set n = 2;
  n := public.avisos_resolver();
  if (select resuelto_at from public.aviso_problema where clave = 'ingesta_silencio_a01prueba') is null then
    raise exception 'PRUEBA A01-1 · 3: con dos pasadas sin verlo no se resuelve.';
  end if;
  if (select count(*) from public.system_alert_queue where id > coalesce((select id from _antes), 0)
        and subject = 'Resuelto · A01 prueba · sin pedidos') <> 1 then
    raise exception 'PRUEBA A01-1 · 3: no sale un «Resuelto».';
  end if;
  update _pasadas set n = 0;
  v := public.encolar_alerta('ingesta_silencio', 'A01 prueba · sin pedidos', 'prueba', 'ingesta_silencio_a01prueba_alto_20261103', interval '2 hours');
  if v is null then raise exception 'PRUEBA A01-1 · 3: el problema que vuelve después de resuelto no manda correo.'; end if;
  raise notice 'A01-1 · 3: una pasada no basta; con dos sale «Resuelto»; si vuelve, es nuevo y manda correo.';
end $$;

-- ── 4 · El techo: 10 al día; lo crítico pasa; un solo aviso de techo ─────────
do $$ declare v bigint; i integer; n integer; begin
  delete from public.system_alert_queue where created_at >= (date_trunc('day', now() at time zone 'Europe/Madrid')) at time zone 'Europe/Madrid';
  for i in 1..12 loop
    perform public.encolar_alerta('a01_prueba_techo', 'A01 prueba · techo ' || i, 'prueba', null, null, null, null, null, 'aviso');
  end loop;
  select count(*) into n from public.system_alert_queue where id > coalesce((select id from _antes), 0) and kind = 'a01_prueba_techo';
  if n <> 10 then raise exception 'PRUEBA A01-1 · 4: con el techo salen % y no 10.', n; end if;
  if (select count(*) from public.aviso_callado where kind = 'a01_prueba_techo') <> 2 then
    raise exception 'PRUEBA A01-1 · 4: los 2 de más no quedan en aviso_callado.';
  end if;
  if (select count(*) from public.system_alert_queue where debounce_kind = 'aviso-techo-diario'
        and id > coalesce((select id from _antes), 0)) <> 1 then
    raise exception 'PRUEBA A01-1 · 4: no sale un solo aviso de «Techo de avisos alcanzado».';
  end if;
  v := public.encolar_alerta('a01_prueba_techo', 'A01 prueba · crítico', 'prueba', null, null, null, null, null, 'critico');
  if v is null then raise exception 'PRUEBA A01-1 · 4: un crítico con el techo lleno no sale.'; end if;
  raise notice 'A01-1 · 4: salen 10, los 2 de más se guardan en aviso_callado, un solo aviso de techo, y el crítico pasa.';
end $$;

-- ── 5 · El espejo de Last: las horas, solo de 12 a 24 UTC ────────────────────
do $$ begin
  if round(public._last_horas_en_horario('2026-11-01 23:00:08+00', '2026-11-02 12:00:01+00'), 2) <> 1.00 then
    raise exception 'PRUEBA A01-1 · 5: la sincronización de las 23:00 a las 12:00:01 del día siguiente no cuenta 1 h (%).',
      public._last_horas_en_horario('2026-11-01 23:00:08+00', '2026-11-02 12:00:01+00');
  end if;
  if round(public._last_horas_en_horario('2026-11-02 12:00:00+00', '2026-11-02 15:30:00+00'), 2) <> 3.50 then
    raise exception 'PRUEBA A01-1 · 5: de 12:00 a 15:30 del mismo día no son 3,5 h.';
  end if;
  if round(public._last_horas_en_horario('2026-11-01 13:00:00+00', '2026-11-02 12:30:00+00'), 2) <> 11.50 then
    raise exception 'PRUEBA A01-1 · 5: de las 13:00 a las 12:30 del día siguiente no son 11,5 h.';
  end if;
  if pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure) not like '%public._last_horas_en_horario(x.max_synced) > 3%'
     or pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure) like '%x.max_synced < now() - interval ''3 hours''%' then
    raise exception 'PRUEBA A01-1 · 5: last_catalog_watchdog no mide con el horario.';
  end if;
  raise notice 'A01-1 · 5: la de las 23:00 a las 12:00:01 lleva 1 h, no 13; el vigía mide así.';
end $$;

-- ── 6 · La app no ve nada de esto ───────────────────────────────────────────
do $$ begin
  if has_table_privilege('authenticated', 'public.aviso_problema', 'select')
     or has_table_privilege('anon', 'public.aviso_callado', 'select')
     or has_function_privilege('authenticated', 'public.avisos_resolver()', 'execute') then
    raise exception 'PRUEBA A01-1 · 6: la app puede leer las tablas nuevas o llamar al resolver.';
  end if;
  raise notice 'A01-1 · 6: ni anon ni authenticated leen las tablas nuevas ni llaman al resolver.';
end $$;

-- ── 7 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261102T1936_a01_un_correo_por_problema.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)'::regprocedure)) <> '3e00b834580b069b93b8b5a1693c9585'
     or md5(pg_get_functiondef('public.last_catalog_watchdog()'::regprocedure)) <> 'c48e0f7bc1ff688279f84268594611b3' then
    raise exception 'PRUEBA A01-1 · 7: la vuelta atrás no deja las dos funciones como estaban.';
  end if;
  if to_regclass('public.aviso_problema') is not null or to_regprocedure('public.avisos_resolver()') is not null then
    raise exception 'PRUEBA A01-1 · 7: queda algo de lo nuevo.';
  end if;
  raise notice 'A01-1 · 7: la vuelta atrás deja las dos funciones byte a byte y quita lo nuevo.';
end $$;

rollback;
