-- `offers-agent` v54 se desplego el 02/09 a las 18:51:05 de Madrid, 27 segundos
-- despues del commit e147d57c que le metio la lectura de `agent_pause`, y desde
-- el runner de GitHub Actions (la ruta del entrypoint lo prueba: /home/runner/).
-- Asi que YA lee la pausa y su interruptor puede aparecer.
--
-- Que su fila no tuviera interruptor NO era el despliegue: era este `false`
-- escrito a mano aqui. La regla era «el interruptor sale cuando el agente ya
-- lee la pausa», y el que no se habia enterado de que ya la leia era el panel.
create or replace function public.home_agentes_estado(p_account_id uuid)
returns table (
  agent_key text, nombre text, cadencia text, que_hace text,
  ultima_vez timestamptz, estado text, corridas_24h int, fallos_24h int,
  pausado boolean, paused_at timestamptz, paused_by text,
  se_puede_pausar boolean, jobs_totales int, jobs_apagados int
)
language plpgsql stable security definer set search_path to 'public'
as $fn$
begin
  if not (p_account_id = any (public.current_user_account_ids())) then
    raise exception 'home_agentes_estado: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  with def(clave, nom, cad, hace, patron, pausable) as (
    values
      ('ofertas',  'Ofertas',            'cada hora',
       'Enciende y apaga promociones segun la demanda',
       array['offers-agent-hourly'], true),          -- v54, 02/09 18:51
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
    select jb.clave, max(r.end_time) as ult, count(*) as veces,
           count(*) filter (where r.status <> 'succeeded') as malas
    from jobs jb join cron.job_run_details r on r.jobid = jb.jobid
    where r.start_time > now() - interval '24 hours'
    group by 1
  ),
  resumen as (
    select jb.clave, count(*)::int as total,
           count(*) filter (where not jb.active)::int as apagados
    from jobs jb group by 1
  )
  select d.clave, d.nom, d.cad, d.hace, c.ult,
         case when ap.account_id is not null then 'pausado'
              when c.ult is null             then 'sin_datos'
              when coalesce(c.malas, 0) > 0  then 'con_fallos'
              else 'ok' end,
         coalesce(c.veces, 0)::int, coalesce(c.malas, 0)::int,
         (ap.account_id is not null), ap.paused_at, ap.paused_by_label,
         d.pausable, coalesce(rs.total, 0), coalesce(rs.apagados, 0)
  from def d
  left join corridas c  on c.clave  = d.clave
  left join resumen  rs on rs.clave = d.clave
  left join agent_pause ap on ap.account_id = p_account_id and ap.agent_key = d.clave
  order by array_position(array['ofertas','campanas','clima','social','guardias'], d.clave);
end;
$fn$;

revoke all on function public.home_agentes_estado(uuid) from public;
revoke all on function public.home_agentes_estado(uuid) from anon;
grant execute on function public.home_agentes_estado(uuid) to authenticated;

do $verif$
declare v_ofertas boolean; v_social boolean; v_guardias boolean; v_firmas int;
begin
  select count(*) into v_firmas from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='home_agentes_estado';
  if v_firmas <> 1 then raise exception 'home_agentes_estado tiene % firmas (Regla 2)', v_firmas; end if;

  if has_function_privilege('anon', 'public.home_agentes_estado(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.home_agentes_estado(uuid)', 'EXECUTE') then
    raise exception 'anon o PUBLIC pueden ejecutar home_agentes_estado';
  end if;

  set local request.jwt.claims = '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}';

  select se_puede_pausar into v_ofertas from public.home_agentes_estado('51ad1792-6629-4ef7-833a-b57b09a86710') where agent_key='ofertas';
  select se_puede_pausar into v_social  from public.home_agentes_estado('51ad1792-6629-4ef7-833a-b57b09a86710') where agent_key='social';
  select se_puede_pausar into v_guardias from public.home_agentes_estado('51ad1792-6629-4ef7-833a-b57b09a86710') where agent_key='guardias';

  if not v_ofertas then raise exception 'Ofertas deberia poder pausarse: su edge function ya lee agent_pause'; end if;
  if not v_social  then raise exception 'Social deberia poder pausarse'; end if;
  -- Y los que NO leen la pausa siguen sin interruptor: la regla no se relaja.
  if v_guardias then raise exception 'Guardias NO lee la pausa todavia y no puede ensenar interruptor'; end if;

  raise notice 'VERIFICACION OK: Ofertas y Social con interruptor; Guardias sin el, que es lo correcto';
end;
$verif$;