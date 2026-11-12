-- supabase/migrations/20261108T1511_g04_servicio_crear.sql
--
-- G04 · Tarea 4 (Julio, nº 15, 08/11/2026) · «+ Crear › Servicio» en «Tarifa
-- y paquetes». SOLO AÑADE: una función nueva. No se deja en pantalla un botón
-- que no guarda.
--
-- conta_tarifa_servicio_crear: un servicio nuevo de la empresa con su nombre y
-- su forma de cobro, y, si se da, su precio general desde un mes (lo guarda
-- conta_tarifa_precio_guardar, el mismo de siempre). Como el resto de la
-- tarifa: ensaya por defecto y solo escribe con los «cambios de tarifa»
-- encendidos en la empresa (_conta_tarifa_puede); en la cuenta real de QBO
-- siguen apagados hasta que Julio diga sí (06/11). Solo administrador o
-- encargado de la cuenta. No lee ni escribe en GoCardless ni en el CRM.
--
-- La clave del servicio nuevo empieza por «g04:» (las importadas son
-- «gestoria_mensual», «gestion_laboral»…): así la vuelta atrás sabe cuáles
-- creó esta función.
--
-- Prueba: supabase/staging/sql/20261108_g04_servicio_crear_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261108T1511_g04_servicio_crear.down.sql

create or replace function public.conta_tarifa_servicio_crear(p_company uuid, p_nombre text, p_forma text, p_periodo text,
  p_importe numeric, p_tramos jsonb, p_desde date, p_ensayo boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid := public._conta_tarifa_puede(p_company, not p_ensayo); v_nombre text := trim(coalesce(p_nombre, ''));
        v_forma text; v_clave text; v_base text; v_n int := 1; v_id uuid; v_con_precio boolean := p_importe is not null or p_tramos is not null;
        v_mes date := public._conta_tarifa_mes(p_desde); v_cobro text; v_frase text; v_precio jsonb;
begin
  if v_nombre = '' then raise exception 'Ponle un nombre al servicio.' using errcode = '22023'; end if;
  if p_forma not in ('fijo', 'por_trabajador', 'tramos', 'tramo_y_por_trabajador') then raise exception 'Esa forma de cobro no existe.' using errcode = '22023'; end if;
  if p_forma = 'fijo' and coalesce(p_periodo, 'mes') not in ('mes', 'anio', 'vez') then raise exception 'Di si se cobra cada mes, cada año o cada vez.' using errcode = '22023'; end if;
  if exists (select 1 from public.conta_servicio where company_id = p_company and lower(trim(nombre)) = lower(v_nombre)) then
    raise exception 'Ya hay un servicio «%» en esta empresa.', v_nombre using errcode = '23505';
  end if;
  if v_con_precio and v_mes is null then raise exception 'Di desde qué mes vale el precio.' using errcode = '22023'; end if;
  -- La forma del catálogo del G01: por trabajador lo que va por trabajadores; si no, fijo al año o al mes.
  v_forma := case when p_forma <> 'fijo' then 'por_empleado' when p_periodo = 'anio' then 'fijo_anio' else 'fijo_mes' end;
  v_cobro := case p_forma when 'fijo' then case coalesce(p_periodo, 'mes') when 'anio' then 'un precio fijo cada año' when 'vez' then 'un precio fijo cada vez' else 'un precio fijo cada mes' end
    when 'por_trabajador' then 'por trabajador' when 'tramos' then 'por tramos' else 'por un tramo y después por trabajador' end;
  v_frase := format('«%s», que se cobra %s', v_nombre, v_cobro);
  if p_ensayo then
    return jsonb_build_object('ensayo', true, 'frase', 'Se creará el servicio ' || v_frase || case when v_con_precio then ', con su precio de tarifa.' else ', sin precio de tarifa: cada cliente con el suyo.' end);
  end if;
  v_base := 'g04:' || coalesce(nullif(trim(both '_' from regexp_replace(lower(translate(v_nombre, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', '_', 'g')), ''), 'servicio');
  v_clave := v_base;
  while exists (select 1 from public.conta_servicio where company_id = p_company and clave = v_clave) loop
    v_n := v_n + 1; v_clave := v_base || '_' || v_n;
  end loop;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma, created_by_name)
  values (v_cuenta, p_company, v_clave, v_nombre, v_forma, public.conta_nombre_actor()) returning id into v_id;
  if v_con_precio then
    v_precio := public.conta_tarifa_precio_guardar(p_company, v_id, null, null, null, p_forma, p_periodo, p_importe, p_tramos, v_mes, false);
    return jsonb_build_object('id', v_id, 'frase', 'Creado el servicio ' || v_frase || '. ' || (v_precio->>'frase'));
  end if;
  return jsonb_build_object('id', v_id, 'frase', 'Creado el servicio ' || v_frase || ', sin precio de tarifa: cada cliente con el suyo.');
end $$;

revoke all on function public.conta_tarifa_servicio_crear(uuid, text, text, text, numeric, jsonb, date, boolean) from public, anon;
grant execute on function public.conta_tarifa_servicio_crear(uuid, text, text, text, numeric, jsonb, date, boolean) to authenticated, service_role;
comment on function public.conta_tarifa_servicio_crear(uuid, text, text, text, numeric, jsonb, date, boolean) is
  'G04 · «+ Crear › Servicio»: un servicio nuevo (nombre y forma de cobro) y, si se da, su precio general desde un mes. Ensaya por defecto; escribe solo con los cambios de tarifa encendidos en la empresa. Su clave empieza por «g04:».';
