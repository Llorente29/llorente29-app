-- B60 · 04/09/2026 — EL VIGIA DE IMPRESORA. QUE ALGUIEN SE ENTERE.
-- ===========================================================================
-- NO ARREGLA LA IMPRESORA: eso es fisico y es del local. Lo que falta es que
-- alguien se entere. La «Pegatina» de Alcala llevaba sin imprimir desde las
-- 18:39 del 03/09, con 34 fallos de socket a 192.168.1.151:9100 esa tarde y 68
-- errores de 254 en toda su historia (26,8 %). «Pase» (84 trabajos ese dia, 0
-- errores) y «Cocina» (87, 0 errores) del mismo local iban perfectas: no es la
-- red del local, es esa impresora. Y nadie lo supo hasta mirarlo a mano.
--
-- Familia de B36, y requisito del escalon 1 del frente de embolsado: toda la
-- arquitectura de etiquetas se apoya en que la impresora este viva.
--
-- ── LAS DOS REGLAS, Y POR QUE SON DOS ──────────────────────────────────────
-- (A) FALLA: N trabajos seguidos en error desde el ultimo que salio bien.
--     Es el caso de la Pegatina. Medido hoy: 43 fallos desde su ultimo OK.
-- (B) MUDA: tiene cola y lleva horas sin completar ni uno. Hoy NO se dispara
--     en ningun sitio —los trabajos van directos a done o a error y `en_cola`
--     es 0 en las cinco impresoras activas— pero es un modo de fallo DISTINTO
--     (la app que no recoge la cola, no la impresora que rechaza) y el dia que
--     pase no habria nada mirandolo. Se deja puesta a proposito.
--
-- ── LA GUARDA QUE EVITA EL FALSO POSITIVO ──────────────────────────────────
-- «NT311 Plaza Castilla» lleva 1.099 HORAS sin completar un trabajo. No esta
-- rota: el local no imprime desde el 20/07. Sin la guarda de trafico reciente,
-- este vigia gritaria todos los dias por un local parado, y a la tercera nadie
-- lo leeria — que es como se pierde un vigia que funciona (regla 7).
-- Por eso la regla A exige que haya habido ALGUN trabajo en las ultimas 24 h.
--
-- DEBOUNCE 6 h, no 20 como el de deriva de edge: una impresora caida se arregla
-- en el turno, y si sigue caida en el siguiente servicio hay que volver a
-- decirlo. La clave lleva el id de la impresora, asi que una impresora nueva
-- que caiga avisa al momento sin esperar a que caduque la de otra.

begin;

create or replace function public.impresora_muda_watchdog(
  p_fallos_seguidos integer default 3,
  p_horas_con_cola  integer default 2,
  p_debounce_window interval default '6 hours'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_n integer := 0;
  v_lineas text := '';
  v_firma  text := '';
begin
  for r in
    with estado as (
      select pr.id, pr.name as impresora, l.name as local, a.name as cuenta,
             ult.done as ultimo_ok,
             (select count(*) from print_job e
               where e.printer_id = pr.id and e.status = 'error'
                 and e.created_at > coalesce(ult.done, '-infinity'::timestamptz)) as fallos,
             (select count(*) from print_job q
               where q.printer_id = pr.id and q.status in ('pending','sent'))     as en_cola,
             (select max(c.created_at) from print_job c where c.printer_id = pr.id) as ultimo_trabajo
        from printer pr
        join locations l on l.id = pr.location_id
        join accounts  a on a.id = pr.account_id
        left join lateral (
          select max(d.done_at) as done from print_job d
           where d.printer_id = pr.id and d.status = 'done'
        ) ult on true
       where pr.is_active
    )
    select *,
           round(extract(epoch from (now() - ultimo_ok)) / 3600.0, 1) as horas_sin_ok,
           case
             when fallos >= p_fallos_seguidos
                  and ultimo_trabajo > now() - interval '24 hours' then 'falla'
             when en_cola > 0
                  and coalesce(ultimo_ok, '-infinity'::timestamptz)
                      < now() - make_interval(hours => p_horas_con_cola) then 'muda'
           end as motivo
      from estado
     where (fallos >= p_fallos_seguidos and ultimo_trabajo > now() - interval '24 hours')
        or (en_cola > 0 and coalesce(ultimo_ok, '-infinity'::timestamptz)
                            < now() - make_interval(hours => p_horas_con_cola))
     order by local, impresora
  loop
    v_n := v_n + 1;
    v_firma := v_firma || r.id::text || ':' || r.motivo || ';';
    v_lineas := v_lineas
      || '- ' || r.impresora || ' (' || r.local || ') [' || r.motivo || ']' || chr(10)
      || case when r.motivo = 'falla'
              then '    ' || r.fallos || ' trabajos seguidos en error desde el ultimo que salio bien.'
              else '    ' || r.en_cola || ' trabajo(s) en cola y ninguno completado.' end || chr(10)
      || '    ultimo trabajo OK: '
      || coalesce(to_char(r.ultimo_ok at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), 'nunca')
      || case when r.ultimo_ok is not null
              then ' (hace ' || r.horas_sin_ok || ' h)' else '' end || chr(10);
  end loop;

  if v_n = 0 then
    return 0;
  end if;

  perform public._queue_system_alert(
    'impresora_muda',
    v_n::text || ' impresora(s) sin imprimir',
    'Hay impresoras activas que no estan sacando trabajos:' || chr(10) || chr(10)
      || v_lineas || chr(10)
      || 'Que significa cada motivo:' || chr(10)
      || '  falla  la impresora RECHAZA los trabajos (fallo de socket, sin papel, '
      || 'apagada). Los trabajos se encolan y mueren en error.' || chr(10)
      || '  muda   hay cola y no se completa nada. Apunta a la tablet que no esta '
      || 'recogiendo, no a la impresora.' || chr(10) || chr(10)
      || 'Esto NO se arregla desde aqui: es fisico y es del local. Lo que hace '
      || 'este aviso es que alguien se entere el mismo dia, en vez de descubrirlo '
      || 'al mirar por otra cosa — que es lo que paso el 03/09 con la Pegatina de '
      || 'Alcala, parada desde las 18:39.',
    'impresora_muda_' || md5(v_firma),
    p_debounce_window
  );

  return v_n;
end;
$function$;

revoke all on function public.impresora_muda_watchdog(integer, integer, interval)
  from public, anon, authenticated;
grant execute on function public.impresora_muda_watchdog(integer, integer, interval)
  to service_role;

comment on function public.impresora_muda_watchdog(integer, integer, interval) is
  'B60: avisa de impresoras activas que fallan (N errores seguidos) o estan mudas (cola sin completar). Exige trafico en 24 h para no gritar por un local parado. Ver cabecera de 20260904071500.';

-- ── Cron cada 15 minutos (patron de la casa: unschedule defensivo + schedule) ──
do $$
begin
  perform cron.unschedule('b60-vigia-de-impresora');
exception when others then
  null;
end $$;

select cron.schedule(
  'b60-vigia-de-impresora',
  '*/15 * * * *',
  $cron$ select public.impresora_muda_watchdog(); $cron$
);

commit;
