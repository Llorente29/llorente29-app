create or replace function public._ultimo_bundle_publicado()
returns table (bundle_id int, publicado_en timestamptz)
language sql
stable
security definer
set search_path to 'public', 'storage'
as $$
  select (regexp_replace(o.name, '\D', '', 'g'))::int, o.created_at
  from storage.objects o
  where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
  order by 1 desc
  limit 1;
$$;

revoke all on function public._ultimo_bundle_publicado() from public, anon;
grant execute on function public._ultimo_bundle_publicado() to authenticated, service_role;

create or replace function public.kds_device_bundle_status(p_location_id uuid default null)
returns table (
  device_id      uuid,
  label          text,
  local          text,
  is_active      boolean,
  app_version    text,
  bundle_actual  int,
  ultimo_bundle  int,
  atraso_bundles int,
  horas_desfase  int,
  last_seen_at   timestamptz,
  estado         text
)
language plpgsql
stable
security definer
set search_path to 'public', 'storage'
as $$
declare
  v_ultimo int;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;

  return query
  with d as (
    select dev.id, dev.label, coalesce(l.name, 'sin local') as loc, dev.is_active,
           dev.app_version, dev.last_seen_at, dev.account_id,
           (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int as b_actual,
           (dev.app_version is not null and dev.app_version !~ '· bundle \d+') as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.account_id = any(public.current_user_account_ids())
      and (p_location_id is null or dev.location_id = p_location_id)
  )
  select
    d.id, d.label, d.loc, d.is_active, d.app_version,
    d.b_actual, v_ultimo,
    case when d.b_actual is not null then v_ultimo - d.b_actual end,
    case when d.b_actual is not null and v_ultimo > d.b_actual then (
      select round(extract(epoch from (now() - min(o.created_at)))/3600)::int
      from storage.objects o
      where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
        and (regexp_replace(o.name, '\D', '', 'g'))::int > d.b_actual
    ) end,
    d.last_seen_at,
    case
      when d.es_builtin                              then 'builtin'
      when d.b_actual is null                        then 'desconocido'
      when d.b_actual >= v_ultimo                    then 'al_dia'
      when (select round(extract(epoch from (now() - min(o.created_at)))/3600)
              from storage.objects o
             where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
               and (regexp_replace(o.name, '\D', '', 'g'))::int > d.b_actual) >= 24
                                                     then 'muy_atrasado'
      else 'atrasado'
    end
  from d
  order by
    case when d.b_actual is null then 0 else 1 end,
    d.b_actual asc nulls first, d.label;
end;
$$;

revoke all on function public.kds_device_bundle_status(uuid) from public, anon;
grant execute on function public.kds_device_bundle_status(uuid) to authenticated, service_role;

create or replace function public.kds_device_stale_bundle_check()
returns integer
language plpgsql
security definer
set search_path to 'public', 'storage'
as $$
declare
  v_ultimo int;
  v_d      record;
  v_n      int := 0;
  v_txt    text;
begin
  select b.bundle_id into v_ultimo from public._ultimo_bundle_publicado() b;
  if v_ultimo is null then
    raise warning 'kds_device_stale_bundle_check: no hay ningun bundle en el bucket apps';
    return 0;
  end if;

  for v_d in
    select dev.id, dev.label, coalesce(l.name,'sin local') as loc, dev.account_id,
           dev.app_version,
           (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int as b_actual,
           (dev.app_version is not null and dev.app_version !~ '· bundle \d+') as es_builtin
    from kds_device dev
    left join locations l on l.id = dev.location_id
    where dev.is_active
      and dev.app_version is not null
  loop
    v_txt := null;

    if v_d.es_builtin then
      v_txt := 'Nunca ha aplicado ninguna actualizacion: sigue con el codigo empotrado en el APK. '
            || 'Es la version mas antigua que puede correr un aparato.';
    elsif v_d.b_actual is null then
      v_txt := 'No se ha podido leer que version corre (reporta "' || v_d.app_version || '"). '
            || 'Mientras no se pueda leer, este aparato NO esta vigilado.';
    elsif v_d.b_actual < v_ultimo then
      declare v_h int;
      begin
        select round(extract(epoch from (now() - min(o.created_at)))/3600)::int into v_h
        from storage.objects o
        where o.bucket_id = 'apps' and o.name ~ '^bundle-\d+\.zip$'
          and (regexp_replace(o.name,'\D','','g'))::int > v_d.b_actual;
        if v_h >= 24 then
          v_txt := 'Corre el bundle ' || v_d.b_actual || ' y el ultimo publicado es el ' || v_ultimo
                || ' (' || (v_ultimo - v_d.b_actual) || ' por detras). '
                || 'Hay version mas nueva desde hace ' || v_h || ' horas y no la ha cogido.';
        end if;
      end;
    end if;

    continue when v_txt is null;

    v_n := v_n + 1;
    raise warning 'kds_device_stale_bundle_check: % (%) desfasado', v_d.label, v_d.loc;

    perform public._queue_system_alert(
      'kds_device_desfasado',
      'Tablet con codigo viejo: ' || v_d.label || ' (' || v_d.loc || ')',
      'La tablet "' || v_d.label || '" del local ' || v_d.loc || ' esta sirviendo comandas con '
      || 'codigo antiguo. ' || v_txt || ' '
      || 'Late y contesta con normalidad, que es lo que hace esto dificil de notar. '
      || 'Suele bastar con dejarla encendida y con red un rato fuera de servicio: la '
      || 'actualizacion se aplica sola en ventana segura, nunca en mitad de un pedido.',
      'kds_desfasado_' || v_d.id::text,
      interval '20 hours'
    );
  end loop;

  return v_n;
end;
$$;

revoke all on function public.kds_device_stale_bundle_check() from public, anon, authenticated;
grant execute on function public.kds_device_stale_bundle_check() to service_role;

select cron.unschedule('kds-device-stale-bundle-daily')
where exists (select 1 from cron.job where jobname = 'kds-device-stale-bundle-daily');

select cron.schedule(
  'kds-device-stale-bundle-daily',
  '30 7 * * *',
  $cron$select public.kds_device_stale_bundle_check()$cron$
);

do $verif$
declare
  v_n int;
begin
  if to_regprocedure('public.kds_device_bundle_status(uuid)') is null then
    raise exception 'kds_device_bundle_status no quedo creada';
  end if;

  if has_function_privilege('anon', 'public.kds_device_stale_bundle_check()', 'execute')
     or has_function_privilege('authenticated', 'public.kds_device_stale_bundle_check()', 'execute') then
    raise exception 'el vigia nacio alcanzable por anon o authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.kds_device_stale_bundle_check()', 'execute') then
    raise exception 'service_role no puede ejecutar el vigia';
  end if;

  if not exists (select 1 from cron.job where jobname = 'kds-device-stale-bundle-daily' and active) then
    raise exception 'el cron diario no quedo programado';
  end if;

  select count(*) into v_n
  from kds_device dev
  where dev.is_active and dev.app_version is not null
    and (regexp_match(dev.app_version, '· bundle (\d+)'))[1]::int
        < (select bundle_id from public._ultimo_bundle_publicado());
  if v_n = 0 then
    raise exception 'el parseo de app_version no lee ningun bundle: el vigia seria un placebo';
  end if;
  raise notice 'VERIFICACION OK: % aparato(s) por detras del ultimo bundle', v_n;
end;
$verif$;