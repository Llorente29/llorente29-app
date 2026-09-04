-- B59 §3 · 04/09/2026 — VIGIA DE LIQUIDACION, CALIBRADO CON SU PROPIA CADENCIA.
-- ===========================================================================
-- REGLA 23, Y AQUI IMPORTA MAS QUE EN NINGUN SITIO: nada de umbrales planos.
--   `ingesta_silencio` disparo 34 «CRITICO» en 7 dias, los 34 eran ciertos, y por
--   eso mismo no los lee nadie (B62). Un vigia que grita todos los dias no es un
--   vigia: es ruido con permiso.
--
-- LA CADENCIA NO SE SUPONE, SE MIDE, y cada plataforma tiene la suya. Medido el
--   04/09 sobre los huecos entre liquidaciones distintas:
--
--     import_csv_glovo  mediana 15 dias  (min 15 · max 16)   -> quincenal
--     import_csv_je     mediana 15 dias  (min 15 · max 16)   -> quincenal
--     import_csv_uber   mediana 30,5 dias (min 30 · max 31)  -> mensual
--
--   Por eso el umbral no es un numero en el codigo: sale de la propia historia
--   de cada fuente. Si Uber pasa a quincenal, el vigia se recalibra solo.
--
-- EL FACTOR ES 2x LA MEDIANA, y tiene motivo: los huecos reales se mueven entre
--   15-16 y 30-31 dias, es decir la variacion natural es de UN dia. Doblar la
--   mediana deja margen para una liquidacion que se retrase de verdad sin saltar
--   por el ruido de calendario (findes, festivos). Con menos de 4 huecos medidos
--   no hay mediana fiable: esa fuente NO se vigila y se dice por que, en vez de
--   inventar una cadencia con dos puntos.
--
-- ESTADO AL ESCRIBIRLO: las tres fuentes llevan 66 dias sin liquidacion nueva
--   (ultima el 30/06). O sea que este vigia salta el dia que se encienda, y
--   salta con razon: la importacion se paro el 30/06 porque dependia de una
--   persona. Ese es justo el agujero que viene a tapar.

begin;

create or replace function public.liquidacion_atrasada_watchdog(
  p_factor          numeric  default 2.0,
  p_min_huecos      integer  default 4,
  p_debounce_window interval default '7 days'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; v_n int := 0; v_lineas text := ''; v_firma text := '';
begin
  for r in
    with huecos as (
      select source, settlement_date,
             settlement_date - lag(settlement_date) over (partition by source order by settlement_date) as hueco
      from (select distinct source, settlement_date
              from public.channel_settlement where settlement_date is not null) t
    ),
    cadencia as (
      select source,
             count(*) filter (where hueco is not null) as n_huecos,
             percentile_cont(0.5) within group (order by hueco) as mediana
      from huecos group by source
    )
    select c.source, c.n_huecos, round(c.mediana::numeric,1) as mediana,
           (select max(settlement_date) from public.channel_settlement s where s.source = c.source) as ultima,
           current_date - (select max(settlement_date) from public.channel_settlement s where s.source = c.source) as dias,
           round((c.mediana * p_factor)::numeric,0) as umbral
      from cadencia c
     where c.n_huecos >= p_min_huecos
       and c.mediana is not null
       and (current_date - (select max(settlement_date) from public.channel_settlement s where s.source = c.source))
           > c.mediana * p_factor
     order by c.source
  loop
    v_n := v_n + 1;
    v_firma := v_firma || r.source || ':' || r.dias::text || ';';
    v_lineas := v_lineas
      || '- ' || r.source || chr(10)
      || '    lleva ' || r.dias || ' dias sin liquidacion nueva (ultima: '
      || to_char(r.ultima, 'DD/MM/YYYY') || ')' || chr(10)
      || '    su cadencia medida es de ' || r.mediana || ' dias sobre ' || r.n_huecos
      || ' huecos; el umbral es ' || r.umbral || ' (x' || p_factor || ')' || chr(10);
  end loop;

  if v_n = 0 then
    return 0;
  end if;

  perform public._queue_system_alert(
    'liquidacion_atrasada',
    v_n::text || ' plataforma(s) sin liquidacion nueva',
    'Hay plataformas que llevan mas tiempo del suyo habitual sin liquidar:' || chr(10) || chr(10)
      || v_lineas || chr(10)
      || 'El umbral NO es un numero fijo: es el doble de la cadencia que esa misma '
      || 'plataforma ha tenido hasta ahora. Si una cambia de ritmo, el vigia se '
      || 'recalibra solo.' || chr(10) || chr(10)
      || 'Sin liquidacion nueva no hay incidencias nuevas que reclamar, y el coste '
      || 'de incidencia que se le enseña al cliente se queda congelado en la ultima '
      || 'importada — pareciendo un dato al dia sin serlo.',
    'liquidacion_atrasada_' || md5(v_firma),
    p_debounce_window
  );

  return v_n;
end;
$function$;

revoke all on function public.liquidacion_atrasada_watchdog(numeric, integer, interval)
  from public, anon, authenticated;
grant execute on function public.liquidacion_atrasada_watchdog(numeric, integer, interval)
  to service_role;

comment on function public.liquidacion_atrasada_watchdog(numeric, integer, interval) is
  'B59 §3: avisa de plataformas que llevan mas de 2x su propia cadencia medida sin liquidacion nueva. Calibrado (regla 23), no plano. Con menos de 4 huecos medidos no vigila esa fuente.';

-- Cron diario a las 08:10 (Madrid = 06:10 UTC en horario de verano). Una
-- liquidacion no es urgente: mirarlo una vez al dia sobra, y el debounce de 7
-- dias evita repetir el mismo aviso mientras nadie actue.
do $$
begin
  perform cron.unschedule('b59-vigia-liquidacion-atrasada');
exception when others then
  null;
end $$;

select cron.schedule(
  'b59-vigia-liquidacion-atrasada',
  '10 6 * * *',
  $cron$ select public.liquidacion_atrasada_watchdog(); $cron$
);

commit;
