create or replace function public.home_en_cocina_ahora(
  p_account_id uuid,
  p_location_id uuid default null
)
returns table (
  employee_id   uuid,
  nombre        text,
  location_id   uuid,
  location_name text,
  estado        text,
  abierta_desde timestamptz,
  minutos_hoy   numeric
)
language plpgsql
stable
set search_path to 'public'
as $fn$
begin
  -- GUARDA DE CUENTA DENTRO, no solo confiada a la RLS. `employee_clock_status`
  -- hace ademas la suya por empleado: dos puertas, ninguna abierta de mas.
  if not (p_account_id = any(public.current_user_account_ids())) then
    raise exception 'home_en_cocina_ahora: sin acceso a la cuenta %', p_account_id;
  end if;

  return query
  select e.id, e.name, l.id, l.name,
         s.j->>'estado',
         nullif(s.j->>'abierta_desde','')::timestamptz,
         nullif(s.j->>'minutos_hoy','')::numeric
  from employees e
  join locations l on l.id = e.location_id and l.active
  cross join lateral (select public.employee_clock_status(e.id) as j) s
  where e.account_id = p_account_id
    and e.active
    and (p_location_id is null or e.location_id = p_location_id)
  order by l.name, e.name;
end;
$fn$;

-- Por NOMBRE, los dos, y en este orden. La leccion de `_queue_system_alert`:
-- un `revoke from public` no quita lo que ya se concedio a `anon` por su
-- nombre, y al reves tampoco.
revoke all on function public.home_en_cocina_ahora(uuid, uuid) from public;
revoke all on function public.home_en_cocina_ahora(uuid, uuid) from anon;
grant execute on function public.home_en_cocina_ahora(uuid, uuid) to authenticated;

do $verif$
declare
  v_firmas int; v_dentro int; v_total int; v_plaza int;
begin
  -- Regla 2: una sola firma.
  select count(*) into v_firmas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='home_en_cocina_ahora';
  if v_firmas <> 1 then
    raise exception 'home_en_cocina_ahora tiene % firmas (Regla 2)', v_firmas;
  end if;

  -- Permisos: se pregunta al MOTOR, no se lee el texto del ACL.
  if has_function_privilege('anon', 'public.home_en_cocina_ahora(uuid,uuid)', 'EXECUTE') then
    raise exception 'anon puede ejecutar home_en_cocina_ahora';
  end if;
  if has_function_privilege('public', 'public.home_en_cocina_ahora(uuid,uuid)', 'EXECUTE') then
    raise exception 'PUBLIC puede ejecutar home_en_cocina_ahora';
  end if;
  if not has_function_privilege('authenticated', 'public.home_en_cocina_ahora(uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated NO puede ejecutar home_en_cocina_ahora';
  end if;

  -- Para poder verificar el CONTENIDO hace falta una identidad: la funcion
  -- exige la cuenta del llamante y como `postgres` no la tiene. Se presta la de
  -- Julio con `set local`, que muere al cerrar la transaccion.
  set local request.jwt.claims = '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}';

  select count(*) filter (where estado = 'trabajando'), count(*)
    into v_dentro, v_total
  from public.home_en_cocina_ahora('51ad1792-6629-4ef7-833a-b57b09a86710');

  if v_total <> 6 then
    raise exception 'deberian salir 6 empleados activos de locales abiertos y salen %', v_total;
  end if;
  if v_dentro <> 2 then
    raise exception 'deberia haber 2 trabajando y hay %', v_dentro;
  end if;

  select count(*) into v_plaza
  from public.home_en_cocina_ahora('51ad1792-6629-4ef7-833a-b57b09a86710')
  where location_name = 'Foodint Plaza Castilla';
  if v_plaza <> 0 then
    raise exception 'un local cerrado no puede aparecer (% filas)', v_plaza;
  end if;

  raise notice 'VERIFICACION OK: 2 trabajando de 6, cero filas de Plaza Castilla, anon y PUBLIC sin EXECUTE';
end;
$verif$;