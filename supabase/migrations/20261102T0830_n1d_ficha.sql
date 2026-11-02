-- supabase/migrations/20261102T0830_n1d_ficha.sql
--
-- N1 · PR 2 · Paso 1 (02/11/2026): lo que lee la ficha nueva de la persona
-- (pantallas 1, 2 y 3 de la maqueta: Resumen, Contrato y salario, Impuestos), y
-- poner la categoría que Cegid no trae.
--
--   1. lab_ficha(persona): todo lo de una ficha en un solo viaje, con cada
--      código ya resuelto contra los catálogos oficiales (lab_catalogo, 0817):
--      la palabra de la calle y el texto oficial. Lo que falta sale como null y
--      la pantalla lo enseña como «Falta», nunca lo inventa:
--        · el nivel formativo (Cegid trae su valor por defecto en todas: no se
--          da por bueno, respuesta de Julio del 02/11);
--        · la categoría (las 19 de Foodint, «Sin categoría» en Cegid): con la
--          lista del convenio para elegirla; sin ella, el mínimo del convenio
--          «no se puede calcular», con su porqué.
--      Lo privado (salario, IRPF, IBAN, NAF, DNI, nacimiento) solo va a quien
--      ve Laboral (current_user_ve_laboral, 1937). El encargado recibe la ficha
--      sin ello y con privado = false.
--   2. lab_poner_categoria(contrato, categoria, motivo): la categoría del
--      convenio, como una condición nueva del contrato con fecha de efecto hoy
--      (no pisa la de antes, lab_contrato_condicion) y su línea en el historial
--      (lab_cambio). Solo quien ve Laboral, y solo una categoría de las tablas
--      de su convenio.
--
-- SOLO AÑADE: funciones nuevas. Nada en el camino del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261102T0830_n1d_ficha.down.sql

create or replace function public._lab_cat(p_catalogo text, p_codigo text)
returns jsonb language sql stable as $$
  select case when p_codigo is null then null else coalesce(
    (select jsonb_build_object('codigo', c.codigo, 'calle', c.calle, 'oficial', c.oficial, 'vigente', c.vigente)
       from public.lab_catalogo c where c.catalogo = p_catalogo and c.codigo = btrim(p_codigo)),
    jsonb_build_object('codigo', btrim(p_codigo), 'calle', null, 'oficial', null, 'desconocido', true)) end
$$;
revoke all on function public._lab_cat(text, text) from public, anon, authenticated;

create or replace function public.lab_ficha(p_employee_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  e        public.employees;
  v_priv   boolean;
  lp       public.lab_persona;
  k        public.lab_contrato;
  cc       public.lab_contrato_condicion;
  v_conv   public.lab_convenio;
  v_nom    jsonb;
  v_pagas  int;
  v_min    numeric;
  v_mes    numeric;
begin
  select * into e from public.employees where id = p_employee_id;
  if e.id is null or not public.current_user_ve_persona(e.id, e.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'Esta ficha no es de tu cuenta.';
  end if;
  v_priv := public.current_user_ve_laboral(e.account_id);
  select * into lp from public.lab_persona where employee_id = e.id;
  -- El contrato que manda: el vigente (sin baja) más reciente; si no hay, el último.
  select * into k from public.lab_contrato where employee_id = e.id
   order by (fecha_baja is null) desc, fecha_alta desc nulls last limit 1;
  if k.id is not null then
    select * into cc from public.lab_contrato_condicion where contrato_id = k.id
     order by vigente_desde desc limit 1;
  end if;
  if cc.convenio_codigo is not null then
    select * into v_conv from public.lab_convenio where account_id = e.account_id and codigo = cc.convenio_codigo;
  end if;
  v_pagas := 12 + (case when nullif(btrim(v_conv.paga_13), '') is not null then 1 else 0 end)
                + (case when nullif(btrim(v_conv.paga_14), '') is not null then 1 else 0 end);

  -- Su última nómina de Cegid (del lote del que vino la persona).
  if lp.lote_id is not null and lp.codigo_cegid is not null then
    select jsonb_build_object('periodo', lpad((n.datos ->> 'mes'), 2, '0') || '/' || (n.datos ->> 'anio'),
             'bruto', public._lab_num(n.datos ->> 'Devengado'), 'liquido', public._lab_num(n.datos ->> 'Líquido'),
             'coste', public._lab_num(n.datos ->> 'Coste'), 'retencion', public._lab_num(n.datos ->> 'Retención'),
             'base_irpf', public._lab_num(n.datos ->> 'Base I.R.P.F.'))
      into v_nom
      from public.lab_import_fila n
     where n.lote_id = lp.lote_id and n.hoja = 'nominas' and public._lab_txt(n.datos, 'trabajador') = lp.codigo_cegid
     order by public._lab_num(n.datos ->> 'anio') desc, public._lab_num(n.datos ->> 'mes') desc limit 1;
  end if;

  select sum(importe) into v_mes from public.lab_persona_concepto
   where employee_id = e.id and vigente_hasta is null and periodicidad = 'mes';
  -- El mínimo del convenio: lo mensual de sus tablas para su categoría. Sin categoría, no se puede calcular.
  if cc.categoria is not null and cc.convenio_codigo is not null then
    select sum(importe) into v_min from public.lab_convenio_tabla
     where account_id = e.account_id and convenio_codigo = cc.convenio_codigo and categoria = cc.categoria
       and coalesce(public._lab_norm(modo_pago), '') not like '%paga%';
  end if;

  return jsonb_build_object(
    'privado', v_priv,
    'persona', jsonb_build_object(
      'id', e.id, 'nombre', e.name, 'foto', e.photo, 'puesto', e.position, 'activa', e.active,
      'local', (select jsonb_build_object('id', l.id, 'nombre', l.name) from public.locations l where l.id = e.location_id),
      'movil', e.phone, 'correo', e.email,
      'portal', exists (select 1 from public.user_profiles up where up.employee_id = e.id and up.active),
      'documento', case when v_priv then e.dni end,
      'nacimiento', case when v_priv then e.birth_date end,
      'naf', case when v_priv then lp.naf end,
      'iban', case when v_priv then lp.iban end,
      'domicilio', case when v_priv then nullif(concat_ws(' · ', lp.domicilio, nullif(concat_ws(' ', lp.cp, lp.poblacion), '')), '') end,
      'nacionalidad', public._lab_cat('pais', lp.nacionalidad),
      'nivel_formativo', null,
      'discapacidad', lp.discapacidad,
      'de_cegid', lp.employee_id is not null),
    'contrato', case when k.id is null then null else jsonb_build_object(
      'id', k.id, 'numero', k.numero, 'tipo', public._lab_cat('contrato', k.clave),
      'desde', k.fecha_alta, 'hasta', k.fecha_fin_prevista, 'baja', k.fecha_baja,
      'prueba_dias', k.periodo_prueba_dias, 'antiguedad', coalesce(k.antiguedad_reconocida, k.fecha_alta),
      'puesto', cc.puesto,
      'centro', (select jsonb_build_object('id', l.id, 'nombre', l.name) from public.locations l where l.id = cc.location_id),
      'cuenta_cotizacion', cc.cuenta_cotizacion,
      'grupo', public._lab_cat('grupo_cotizacion', cc.grupo_cotizacion),
      'ocupacion', public._lab_cat('ocupacion', cc.cno),
      'categoria', cc.categoria,
      'categoria_nombre', (select t.categoria_nombre from public.lab_convenio_tabla t
                            where t.account_id = e.account_id and t.convenio_codigo = cc.convenio_codigo and t.categoria = cc.categoria limit 1),
      'jornada', cc.jornada, 'coef_parcial', cc.coef_parcial, 'horas_semana', cc.horas_semana,
      'bonificaciones', cc.bonificaciones,
      'convenio', case when cc.convenio_codigo is null then null else jsonb_build_object(
        'codigo', cc.convenio_codigo, 'nombre', v_conv.nombre, 'horas_anuales', v_conv.horas_anuales,
        'horas_dia', v_conv.horas_dia, 'vacaciones', v_conv.vacaciones, 'paga_13', v_conv.paga_13, 'paga_14', v_conv.paga_14,
        'cargado', v_conv.id is not null) end,
      'categorias', (select coalesce(jsonb_agg(jsonb_build_object('categoria', x.categoria, 'nombre', x.categoria_nombre) order by x.categoria_nombre), '[]')
                       from (select distinct categoria, categoria_nombre from public.lab_convenio_tabla
                              where account_id = e.account_id and convenio_codigo = cc.convenio_codigo) x)) end,
    'salario', case when not v_priv then null else jsonb_build_object(
      'conceptos', (select coalesce(jsonb_agg(jsonb_build_object('codigo', p.concepto_codigo, 'nombre', p.concepto_nombre, 'importe', p.importe,
                                                                 'periodicidad', p.periodicidad, 'origen', p.origen) order by p.origen, p.importe desc), '[]')
                      from public.lab_persona_concepto p where p.employee_id = e.id and p.vigente_hasta is null),
      'bruto_mes', v_mes, 'pagas', v_pagas,
      'minimo_convenio', v_min,
      'minimo_porque', case when cc.categoria is null then 'sin_categoria'
                            when v_conv.id is null then 'sin_convenio'
                            when v_min is null then 'sin_tablas' end,
      'nomina_cegid', v_nom) end,
    'irpf', case when not v_priv then null else jsonb_build_object(
      'pct', lp.irpf_cegid_pct, 'nomina_cegid', v_nom,
      'modelo_145', (select jsonb_build_object('efecto_desde', m.efecto_desde,
                       'situacion', public._lab_cat('situacion_familiar_irpf', m.situacion_familiar::text),
                       'discapacidad', public._lab_cat('discapacidad_irpf', m.discapacidad), 'firmado_at', m.firmado_at,
                       'hijos', jsonb_array_length(m.hijos), 'ascendientes', jsonb_array_length(m.ascendientes),
                       'tipo_voluntario', m.tipo_voluntario_pct)
                       from public.lab_modelo_145 m where m.employee_id = e.id order by m.efecto_desde desc limit 1)) end);
end $$;
revoke all on function public.lab_ficha(uuid) from public, anon;
grant execute on function public.lab_ficha(uuid) to authenticated;

create or replace function public.lab_poner_categoria(p_contrato_id uuid, p_categoria text, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k  public.lab_contrato;
  cc public.lab_contrato_condicion;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_nombre text;
begin
  select * into k from public.lab_contrato where id = p_contrato_id;
  if k.id is null or not public.current_user_ve_laboral(k.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'La categoría la pone quien tiene el permiso de Laboral.';
  end if;
  select * into cc from public.lab_contrato_condicion where contrato_id = k.id order by vigente_desde desc limit 1;
  if cc.id is null or cc.convenio_codigo is null then
    raise exception 'SIN_CONVENIO' using errcode = '22023', hint = 'El contrato no tiene convenio: no hay lista de categorías.';
  end if;
  select categoria_nombre into v_nombre from public.lab_convenio_tabla
   where account_id = k.account_id and convenio_codigo = cc.convenio_codigo and categoria = btrim(p_categoria) limit 1;
  if not found then
    raise exception 'CATEGORIA_DESCONOCIDA' using errcode = '22023', hint = 'Esa categoría no está en las tablas de su convenio.';
  end if;
  if cc.categoria is not distinct from btrim(p_categoria) then
    return jsonb_build_object('categoria', cc.categoria, 'nombre', v_nombre, 'cambia', false);
  end if;
  if cc.vigente_desde >= v_hoy then
    update public.lab_contrato_condicion set categoria = btrim(p_categoria), motivo = coalesce(p_motivo, motivo) where id = cc.id;
  else
    update public.lab_contrato_condicion set vigente_hasta = v_hoy - 1 where id = cc.id;
    insert into public.lab_contrato_condicion (account_id, contrato_id, vigente_desde, grupo_cotizacion, grupo_desc, cno, categoria, puesto,
                                               convenio_codigo, location_id, centro_cegid, cuenta_cotizacion, jornada, coef_parcial,
                                               horas_semana, bonificaciones, motivo)
    values (cc.account_id, cc.contrato_id, v_hoy, cc.grupo_cotizacion, cc.grupo_desc, cc.cno, btrim(p_categoria), cc.puesto,
            cc.convenio_codigo, cc.location_id, cc.centro_cegid, cc.cuenta_cotizacion, cc.jornada, cc.coef_parcial,
            cc.horas_semana, cc.bonificaciones, coalesce(p_motivo, 'Categoría del convenio'));
  end if;
  insert into public.lab_cambio (account_id, employee_id, tabla, registro_id, campo, antes, despues, fecha_efecto, motivo, quien)
  values (k.account_id, k.employee_id, 'lab_contrato_condicion', k.id, 'categoria', to_jsonb(cc.categoria), to_jsonb(btrim(p_categoria)),
          v_hoy, coalesce(p_motivo, 'Categoría del convenio'), auth.uid());
  return jsonb_build_object('categoria', btrim(p_categoria), 'nombre', v_nombre, 'cambia', true);
end $$;
revoke all on function public.lab_poner_categoria(uuid, text, text) from public, anon;
grant execute on function public.lab_poner_categoria(uuid, text, text) to authenticated;
