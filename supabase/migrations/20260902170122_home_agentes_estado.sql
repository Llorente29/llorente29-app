create or replace function public.home_agentes_estado(p_account_id uuid)
returns table (
  agent_key    text,
  nombre       text,
  cadencia     text,
  que_hace     text,
  ultima_vez   timestamptz,
  estado       text,
  corridas_24h int,
  fallos_24h   int,
  pausado      boolean,
  paused_at    timestamptz,
  paused_by    text,
  se_puede_pausar boolean,
  jobs_totales int,
  jobs_apagados int
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  -- `authenticated` NO tiene USAGE sobre `cron`, y no debe tenerlo: leer el
  -- planificador entero desde el navegador seria enseñar la infraestructura de
  -- las tres cuentas. Esta funcion enseña solo lo que el panel necesita.
  if not (p_account_id = any (public.current_user_account_ids())) then
    raise exception 'home_agentes_estado: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with def(clave, nom, cad, hace, patron, pausable) as (
    values
      ('ofertas',  'Ofertas',            'cada hora',
       'Enciende y apaga promociones segun la demanda',
       array['offers-agent-hourly'], false),
      ('campanas', 'Reglas de campana',  'cada 15 min',
       'Vigila valles de venta y dispara campanas con tope de gasto',
       array['evaluate-campaign-rules'], false),
      ('clima',    'Clima y reparto',    'cada 10 min',
       'Ajusta el reparto cuando va a llover',
       array['reparto-weather-poll','reparto-weather-apply'], false),
      ('social',   'Social',             'diario',
       'Prepara y publica el contenido del dia',
       array['social-agent-daily','social-publish-worker'], true),
      ('guardias', 'Guardias',           '15 vigias',
       'Pedidos atascados, tablets mudas, ventas sin mapear, salud de la base',
       array['%watchdog%','%-check','%-guard','%health%'], false)
  ),
  jobs as (
    select d.clave, j.jobid, j.jobname, j.active
    from def d
    join cron.job j
      on (d.clave <> 'guardias' and j.jobname = any(d.patron))
      or (d.clave =  'guardias' and exists (
            select 1 from unnest(d.patron) p where j.jobname like p))
  ),
  corridas as (
    select jb.clave,
           max(r.end_time)                                as ult,
           count(*)                                       as veces,
           count(*) filter (where r.status <> 'succeeded') as malas
    from jobs jb
    join cron.job_run_details r on r.jobid = jb.jobid
    where r.start_time > now() - interval '24 hours'
    group by 1
  ),
  resumen as (
    select jb.clave, count(*)::int as total,
           count(*) filter (where not jb.active)::int as apagados
    from jobs jb group by 1
  )
  select d.clave, d.nom, d.cad, d.hace,
         c.ult,
         case
           when ap.account_id is not null then 'pausado'
           when c.ult is null             then 'sin_datos'
           when coalesce(c.malas, 0) > 0  then 'con_fallos'
           else 'ok'
         end,
         coalesce(c.veces, 0)::int,
         coalesce(c.malas, 0)::int,
         (ap.account_id is not null),
         ap.paused_at,
         ap.paused_by_label,
         d.pausable,
         coalesce(rs.total, 0),
         coalesce(rs.apagados, 0)
  from def d
  left join corridas c  on c.clave  = d.clave
  left join resumen  rs on rs.clave = d.clave
  left join agent_pause ap
    on ap.account_id = p_account_id and ap.agent_key = d.clave
  order by array_position(array['ofertas','campanas','clima','social','guardias'], d.clave);
end;
$fn$;

revoke all on function public.home_agentes_estado(uuid) from public;
revoke all on function public.home_agentes_estado(uuid) from anon;
grant execute on function public.home_agentes_estado(uuid) to authenticated;

do $verif$
declare v_filas int; v_guardias int; v_apagados int;
begin
  if has_function_privilege('anon', 'public.home_agentes_estado(uuid)', 'EXECUTE') then
    raise exception 'anon puede ejecutar home_agentes_estado';
  end if;
  if has_function_privilege('public', 'public.home_agentes_estado(uuid)', 'EXECUTE') then
    raise exception 'PUBLIC puede ejecutar home_agentes_estado';
  end if;
  if not has_function_privilege('authenticated', 'public.home_agentes_estado(uuid)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar home_agentes_estado';
  end if;

  set local request.jwt.claims = '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}';

  select count(*) into v_filas
  from public.home_agentes_estado('51ad1792-6629-4ef7-833a-b57b09a86710');
  if v_filas <> 5 then raise exception 'deberian salir 5 agentes y salen %', v_filas; end if;

  select jobs_totales, jobs_apagados into v_guardias, v_apagados
  from public.home_agentes_estado('51ad1792-6629-4ef7-833a-b57b09a86710')
  where agent_key = 'guardias';
  if v_guardias < 10 then
    raise exception 'Guardias deberia agrupar los vigias y agrupa solo %', v_guardias;
  end if;

  raise notice 'VERIFICACION OK: 5 agentes, Guardias agrupa % vigias (% apagados)', v_guardias, v_apagados;
end;
$verif$;