-- supabase/migrations/20261101T2248_n1c_centro_de_folvy.sql
--
-- cambia: public.lab_centros_del_lote · prueba: supabase/staging/sql/20261101_n1c_centro_de_folvy_prueba.sql
-- cambia: public.lab_volcar_lote · prueba: supabase/staging/sql/20261101_n1c_centro_de_folvy_prueba.sql
--
-- N1 · Respuesta 3 de Julio (01/11/2026, con el paquete real en producción):
-- en Cegid no se llevaba el centro de cada persona; el único que trae el
-- paquete es el de la empresa. El local bueno es el de su ficha en Folvy. La
-- regla, para cualquier empresa:
--
--   1. Si la persona está en Folvy (por su NIF, en la cuenta), su local es el
--      de su ficha, traiga o no centro Cegid, y sus contratos llevan ese mismo
--      local. (En producción, los contratos de 3 personas quedaron con el local
--      del centro de Cegid: al volver a pasar a las fichas, el on conflict do
--      update los deja con el de Folvy.)
--   2. Si no está en Folvy y Cegid no trae centro, lab_centros_del_lote enseña
--      una fila más, «__sin_centro__» («Sin centro en Cegid · N personas»), que
--      se confirma con lab_confirmar_centro como cualquier centro.
--   3. «En Cegid su centro es otro local que el de Folvy» deja de ser aviso:
--      manda Folvy, y es una línea «para saber» («Se deja el local de Folvy
--      (X); en Cegid ponía Y»), que el resultado devuelve en «para_saber».
--
-- Las dos funciones, con la misma firma; nada en el camino del pedido.
-- Respaldo con _respaldar_funcion; la vuelta atrás las restaura de él.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T2248_n1c_centro_de_folvy.down.sql

select public._respaldar_funcion('public.lab_centros_del_lote(uuid)', '20261101T2248_n1c_centro_de_folvy');
select public._respaldar_funcion('public.lab_volcar_lote(uuid)', '20261101T2248_n1c_centro_de_folvy');

create or replace function public.lab_centros_del_lote(p_lote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lote public.lab_import_lote;
begin
  select * into v_lote from public.lab_import_lote where id = p_lote;
  if v_lote.id is null or not public.current_user_is_admin_of(v_lote.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El volcado lo hace el administrador de la cuenta.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'centro', c.centro,
             'personas', c.personas,
             'propuesto', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                             from public.locations l
                            where l.account_id = v_lote.account_id and c.centro <> '__sin_centro__'
                              and (public._lab_norm(l.name) like '%' || public._lab_norm(c.centro) || '%'
                                   or public._lab_norm(c.centro) like '%' || public._lab_norm(l.name) || '%')
                            order by abs(length(l.name) - length(c.centro)), l.name limit 1),
             'confirmado', (select jsonb_build_object('id', l.id, 'nombre', l.name)
                              from public.lab_centro_local cl join public.locations l on l.id = cl.location_id
                             where cl.account_id = v_lote.account_id and cl.centro = c.centro))
           order by c.centro)
      from (select public._lab_txt(f.datos, 'centro') centro,
                   count(distinct coalesce(public._lab_txt(f.datos, 'trabajador'), f.fila_n::text)) filter (where f.hoja = 'trabajadores') personas
              from public.lab_import_fila f
             where f.lote_id = p_lote and f.hoja in ('trabajadores', 'contratos') and public._lab_txt(f.datos, 'centro') is not null
             group by 1
            union all
            -- N1 · respuesta 3: las que no traen centro y no están en Folvy (las de Folvy llevan el local de su ficha).
            select '__sin_centro__', count(*)
              from public.lab_import_fila f
             where f.lote_id = p_lote and f.hoja = 'trabajadores' and public._lab_txt(f.datos, 'centro') is null
               and not exists (select 1 from public.employees e where e.account_id = v_lote.account_id
                                  and public._lab_nif(e.dni) = public._lab_nif(f.datos ->> 'nif'))
            having count(*) > 0) c), '[]'::jsonb);
end $$;
revoke all on function public.lab_centros_del_lote(uuid) from public, anon;
grant execute on function public.lab_centros_del_lote(uuid) to authenticated;

create or replace function public.lab_volcar_lote(p_lote uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lote      public.lab_import_lote;
  v_acc       uuid;
  v_ccc       text;
  v_conv_cod  text;
  v_hoy       date := (now() at time zone 'Europe/Madrid')::date;
  f           record;
  v_emp       uuid;
  v_loc       uuid;
  v_loc_folvy uuid;
  v_centro    text;
  v_alta      boolean;
  v_nif       text;
  v_nombre    text;
  v_msg       text[];
  v_estado    text;
  v_contrato  uuid;
  v_desde     date;
  v_fin       date;
  v_coef      numeric;
  v_periodo   int;
  v_bruto     numeric;
  v_conv      numeric;
  v_pact      numeric;
  v_irpf      numeric;
  v_base      numeric;
  n_nuevas    int := 0;
  n_ya        int := 0;
  n_contratos int := 0;
  n_aviso     int := 0;
  n_error     int := 0;
  v_sin_centro text[] := '{}';
  v_no_cuadra jsonb := '[]';
begin
  select * into v_lote from public.lab_import_lote where id = p_lote;
  if v_lote.id is null or not public.current_user_is_admin_of(v_lote.account_id) then
    raise exception 'NO_AUTORIZADO' using errcode = '42501', hint = 'El volcado lo hace el administrador de la cuenta.';
  end if;
  if v_lote.estado <> 'leido' then
    raise exception 'LOTE_NO_LEIDO' using errcode = '22023', hint = 'Se vuelca un lote leído y con sus filas cargadas.';
  end if;
  if not exists (select 1 from public.lab_import_fila where lote_id = p_lote and hoja = 'trabajadores') then
    raise exception 'SIN_FILAS' using errcode = '22023', hint = 'Primero «Cargar las filas en Sumied».';
  end if;
  v_acc := v_lote.account_id;
  v_ccc := public._lab_campo(p_lote, 'empresa', 'CCC');

  -- 1 · Convenio, tablas salariales y conceptos.
  if exists (select 1 from public.lab_import_fila where lote_id = p_lote and hoja = 'convenio') then
    insert into public.lab_convenio (account_id, codigo, nombre, codigo_oficial, horas_anuales, horas_dia, vacaciones, paga_13, paga_14, datos, lote_id, updated_at)
    select v_acc, coalesce(public._lab_campo(p_lote, 'convenio', 'código ERP10'), public._lab_campo(p_lote, 'empresa', 'convenio'), 'convenio'),
           public._lab_campo(p_lote, 'convenio', 'nombre'), public._lab_campo(p_lote, 'convenio', 'código oficial'),
           public._lab_num(public._lab_campo(p_lote, 'convenio', 'horas anuales')), public._lab_num(public._lab_campo(p_lote, 'convenio', 'horas día')),
           public._lab_campo(p_lote, 'convenio', 'vacaciones'), public._lab_campo(p_lote, 'convenio', 'paga 13'), public._lab_campo(p_lote, 'convenio', 'paga 14'),
           (select coalesce(jsonb_object_agg(datos ->> 'campo', datos -> 'valor'), '{}') from public.lab_import_fila where lote_id = p_lote and hoja = 'convenio' and datos ? 'valor'),
           p_lote, now()
    on conflict (account_id, codigo) do update
       set nombre = excluded.nombre, codigo_oficial = excluded.codigo_oficial, horas_anuales = excluded.horas_anuales,
           horas_dia = excluded.horas_dia, vacaciones = excluded.vacaciones, paga_13 = excluded.paga_13, paga_14 = excluded.paga_14,
           datos = excluded.datos, lote_id = excluded.lote_id, updated_at = now();
  end if;

  insert into public.lab_convenio_tabla (account_id, convenio_codigo, categoria, categoria_nombre, concepto_codigo, concepto_nombre, importe, modo_pago, lote_id)
  select distinct on (c, cat, con) v_acc, c, cat, public._lab_txt(datos, 'categoria_nombre'), con, public._lab_txt(datos, 'concepto_nombre'),
         public._lab_num(datos ->> 'importe'), public._lab_txt(datos, 'modo_pago'), p_lote
    from (select datos, public._lab_txt(datos, 'convenio') c, public._lab_txt(datos, 'categoria') cat, public._lab_txt(datos, 'concepto') con, fila_n
            from public.lab_import_fila where lote_id = p_lote and hoja = 'tablas_salariales') t
   where c is not null and cat is not null and con is not null
   order by c, cat, con, fila_n desc
  on conflict (account_id, convenio_codigo, categoria, concepto_codigo) do update
     set categoria_nombre = excluded.categoria_nombre, concepto_nombre = excluded.concepto_nombre, importe = excluded.importe,
         modo_pago = excluded.modo_pago, lote_id = excluded.lote_id;
  update public.lab_import_fila set estado = 'ok', mensajes = '{}', destino_tabla = 'lab_convenio_tabla'
   where lote_id = p_lote and hoja = 'tablas_salariales';

  insert into public.lab_concepto (account_id, codigo, nombre, tipo, codigo_red, lote_id)
  select distinct on (cod) v_acc, cod, public._lab_txt(datos, 'concepto'), public._lab_txt(datos, 'tipo'), public._lab_txt(datos, 'codigo_red'), p_lote
    from (select datos, public._lab_txt(datos, 'codigo') cod, fila_n from public.lab_import_fila where lote_id = p_lote and hoja = 'conceptos') t
   where cod is not null order by cod, fila_n desc
  on conflict (account_id, codigo) do update
     set nombre = excluded.nombre, tipo = excluded.tipo, codigo_red = excluded.codigo_red, lote_id = excluded.lote_id;
  update public.lab_import_fila set estado = 'ok', mensajes = '{}', destino_tabla = 'lab_concepto'
   where lote_id = p_lote and hoja = 'conceptos';

  -- 2 · Las personas (hoja Trabajadores).
  for f in select * from public.lab_import_fila where lote_id = p_lote and hoja = 'trabajadores' order by fila_n loop
    v_msg := '{}'; v_estado := 'ok'; v_emp := null;
    v_nif := public._lab_nif(f.datos ->> 'nif');
    v_nombre := coalesce(public._lab_txt(f.datos, 'nombre'), 'fila ' || f.fila_n);
    v_alta := public._lab_si(f.datos ->> 'en_alta_hoy');
    v_centro := coalesce(public._lab_txt(f.datos, 'centro'), '__sin_centro__');
    -- N1 · respuesta 3: primero quién es. La que ya está en Folvy lleva el local
    -- de su ficha, traiga o no centro Cegid; la que no, el confirmado de su centro
    -- (o el de «Sin centro en Cegid»).
    v_loc_folvy := null;
    select e.id, e.location_id into v_emp, v_loc_folvy from public.employees e
     where e.account_id = v_acc and v_nif is not null and public._lab_nif(e.dni) = v_nif
     order by e.active desc, e.created_at limit 1;
    select cl.location_id into v_loc from public.lab_centro_local cl
     where cl.account_id = v_acc and cl.centro = v_centro;

    if v_nif is null then
      v_estado := 'error'; v_msg := array[v_nombre || ': no trae NIF, y por el NIF se sabe quién es.']; v_emp := null;
    elsif v_emp is null and v_loc is null then
      v_estado := 'aviso';
      v_msg := array[v_nombre || case when v_centro = '__sin_centro__'
                                      then ': no está en Folvy y Cegid no trae su centro. Elige el local de «Sin centro en Cegid» arriba y vuelve a pasar a las fichas.'
                                      else ': su centro «' || v_centro || '» no tiene local confirmado. Confírmalo arriba y vuelve a pasar a las fichas.' end];
      v_sin_centro := array_append(v_sin_centro, case when v_centro = '__sin_centro__' then 'Sin centro en Cegid' else v_centro end);
    else
      if v_emp is null and v_alta then
        v_estado := 'aviso';
        v_msg := array[v_nombre || ': en Cegid está de alta y no está en Folvy. No se crea sola: dala de alta desde Equipo y vuelve a volcar.'];
      elsif v_emp is null then
        -- Una baja que falta (respuesta 6): sin local primero (la formación de bienvenida no la encuentra), después su local.
        insert into public.employees (account_id, location_id, name, dni, birth_date, phone, email, position, active,
                                      start_date, contract_type, weekly_hours)
        values (v_acc, null, v_nombre, f.datos ->> 'nif', public._lab_fecha(f.datos ->> 'nacimiento'),
                coalesce(public._lab_txt(f.datos, 'movil'), public._lab_txt(f.datos, 'telefono')), public._lab_txt(f.datos, 'email'),
                public._lab_txt(f.datos, 'puesto'), false,
                coalesce(public._lab_fecha(f.datos ->> 'antiguedad'), public._lab_fecha(f.datos ->> 'primera_alta')), null, 40)
        returning id into v_emp;
        update public.employees set location_id = v_loc where id = v_emp;
        n_nuevas := n_nuevas + 1;
        v_msg := array[v_nombre || ': de baja en Cegid y no estaba en Folvy: entra como baja.'];
      else
        n_ya := n_ya + 1;
        -- De la que ya está, solo lo vacío; lo que no cuadra, como aviso.
        update public.employees e
           set dni = coalesce(nullif(e.dni, ''), f.datos ->> 'nif'),
               birth_date = coalesce(e.birth_date, public._lab_fecha(f.datos ->> 'nacimiento')),
               phone = coalesce(nullif(e.phone, ''), public._lab_txt(f.datos, 'movil'), public._lab_txt(f.datos, 'telefono')),
               email = coalesce(nullif(e.email, ''), public._lab_txt(f.datos, 'email')),
               position = coalesce(nullif(e.position, ''), public._lab_txt(f.datos, 'puesto'))
         where e.id = v_emp;
        if exists (select 1 from public.employees e where e.id = v_emp and e.active and not v_alta) then
          v_estado := 'aviso'; v_msg := v_msg || (v_nombre || ': en Cegid está de baja y en Folvy sigue de alta. No se cambia sola: revísalo en su ficha.');
        end if;
        -- Manda Folvy (respuesta 3): no es un aviso, es una línea para saber.
        if v_loc is not null and v_loc is distinct from v_loc_folvy then
          v_msg := v_msg || (v_nombre || ': se deja el local de Folvy (' || coalesce((select name from public.locations where id = v_loc_folvy), 'sin local')
                             || '); en Cegid ponía ' || v_centro || '.');
        end if;
      end if;

      if v_emp is not null then
        insert into public.lab_persona (employee_id, account_id, codigo_cegid, naf, iban, nacionalidad, sexo, nivel_formativo,
                                        domicilio, cp, poblacion, provincia, discapacidad, lote_id, fila_n, updated_at)
        values (v_emp, v_acc, public._lab_txt(f.datos, 'trabajador'), public._lab_txt(f.datos, 'naf'), public._lab_txt(f.datos, 'iban'),
                public._lab_txt(f.datos, 'nacionalidad'), public._lab_txt(f.datos, 'sexo'), public._lab_txt(f.datos, 'nivel_formativo'),
                public._lab_txt(f.datos, 'domicilio'), public._lab_txt(f.datos, 'cp'), public._lab_txt(f.datos, 'poblacion'),
                public._lab_txt(f.datos, 'provincia'), public._lab_txt(f.datos, 'minusvalia'), p_lote, f.fila_n, now())
        on conflict (employee_id) do update
           set codigo_cegid = excluded.codigo_cegid, naf = excluded.naf, iban = excluded.iban, nacionalidad = excluded.nacionalidad,
               sexo = excluded.sexo, nivel_formativo = excluded.nivel_formativo, domicilio = excluded.domicilio, cp = excluded.cp,
               poblacion = excluded.poblacion, provincia = excluded.provincia, discapacidad = excluded.discapacidad,
               lote_id = excluded.lote_id, fila_n = excluded.fila_n, updated_at = now();
      end if;
    end if;

    if v_estado = 'aviso' then n_aviso := n_aviso + 1; elsif v_estado = 'error' then n_error := n_error + 1; end if;
    update public.lab_import_fila
       set estado = v_estado, mensajes = v_msg, destino_tabla = case when v_emp is null then null else 'employees' end, destino_id = v_emp
     where id = f.id;
  end loop;

  -- 3 · Los contratos (hoja Contratos), de las personas que entraron.
  for f in select c.*, t.destino_id emp, public._lab_txt(t.datos, 'centro') centro_t
             from public.lab_import_fila c
             left join lateral (select x.destino_id, x.datos from public.lab_import_fila x
                                 where x.lote_id = p_lote and x.hoja = 'trabajadores' and x.destino_id is not null
                                   and public._lab_txt(x.datos, 'trabajador') = public._lab_txt(c.datos, 'trabajador') limit 1) t on true
            where c.lote_id = p_lote and c.hoja = 'contratos' order by c.fila_n loop
    v_msg := '{}'; v_estado := 'ok'; v_contrato := null;
    v_nombre := coalesce(public._lab_txt(f.datos, 'nombre'), 'trabajador ' || coalesce(public._lab_txt(f.datos, 'trabajador'), '?'));
    v_desde := public._lab_fecha(f.datos ->> 'fecha_alta');
    v_fin := public._lab_fecha(f.datos ->> 'fecha_fin');
    -- N1 · respuesta 3: el contrato lleva el local de la ficha de su persona (el de
    -- Folvy si ya estaba; el confirmado si entra ahora), no el del centro de Cegid.
    select e.location_id into v_loc from public.employees e where e.id = f.emp;
    if f.emp is null then
      v_estado := 'aviso'; v_msg := array['Contrato ' || coalesce(public._lab_txt(f.datos, 'contrato_n'), '?') || ' de ' || v_nombre || ': su persona no ha entrado (mira su fila en Trabajadores).'];
    elsif v_desde is null then
      v_estado := 'error'; v_msg := array['Contrato ' || coalesce(public._lab_txt(f.datos, 'contrato_n'), '?') || ' de ' || v_nombre || ': no trae fecha de alta.'];
    else
      insert into public.lab_contrato (account_id, employee_id, numero, clave, descripcion, fecha_alta, fecha_fin_prevista, fecha_baja,
                                       origen, lote_id, fila_n, updated_at)
      values (v_acc, f.emp, coalesce(public._lab_txt(f.datos, 'contrato_n'), '1'), public._lab_txt(f.datos, 'tipo_contrato'),
              public._lab_txt(f.datos, 'tipo_contrato'), v_desde, v_fin, case when v_fin is not null and v_fin < v_hoy then v_fin end,
              'cegid', p_lote, f.fila_n, now())
      on conflict (account_id, employee_id, numero) do update
         set clave = excluded.clave, descripcion = excluded.descripcion, fecha_alta = excluded.fecha_alta,
             fecha_fin_prevista = excluded.fecha_fin_prevista, fecha_baja = coalesce(public.lab_contrato.fecha_baja, excluded.fecha_baja),
             lote_id = excluded.lote_id, fila_n = excluded.fila_n, updated_at = now()
      returning id into v_contrato;
      n_contratos := n_contratos + 1;

      v_coef := public._lab_num(f.datos ->> 'coef_parcial');
      insert into public.lab_contrato_condicion (account_id, contrato_id, vigente_desde, grupo_cotizacion, grupo_desc, puesto,
                                                 convenio_codigo, location_id, centro_cegid, cuenta_cotizacion, jornada, coef_parcial, lote_id, fila_n)
      values (v_acc, v_contrato, v_desde, public._lab_txt(f.datos, 'grupo_cotizacion'), public._lab_txt(f.datos, 'grupo_desc'),
              public._lab_txt(f.datos, 'puesto'), public._lab_txt(f.datos, 'convenio'), v_loc, coalesce(public._lab_txt(f.datos, 'centro'), f.centro_t),
              v_ccc, case when v_coef is null or v_coef in (0, 1, 100, 1000) then 'completa' else 'parcial' end, v_coef, p_lote, f.fila_n)
      on conflict (contrato_id, vigente_desde) do update
         set grupo_cotizacion = excluded.grupo_cotizacion, grupo_desc = excluded.grupo_desc, puesto = excluded.puesto,
             convenio_codigo = excluded.convenio_codigo, location_id = excluded.location_id, centro_cegid = excluded.centro_cegid,
             cuenta_cotizacion = coalesce(public.lab_contrato_condicion.cuenta_cotizacion, excluded.cuenta_cotizacion),
             jornada = excluded.jornada, coef_parcial = excluded.coef_parcial, lote_id = excluded.lote_id, fila_n = excluded.fila_n;
    end if;
    if v_estado = 'aviso' then n_aviso := n_aviso + 1; elsif v_estado = 'error' then n_error := n_error + 1; end if;
    update public.lab_import_fila
       set estado = v_estado, mensajes = v_msg, destino_tabla = case when v_contrato is null then null else 'lab_contrato' end, destino_id = v_contrato
     where id = f.id;
  end loop;

  -- La baja de una baja: su último contrato, cerrado. Si no trae fecha de fin, se dice.
  update public.lab_import_fila x set estado = 'aviso',
         mensajes = x.mensajes || (coalesce(public._lab_txt(x.datos, 'nombre'), 'Una baja') || ': de baja, pero su último contrato no trae fecha de fin. Ponla en su ficha.')
   where x.lote_id = p_lote and x.hoja = 'trabajadores' and x.destino_id is not null and not public._lab_si(x.datos ->> 'en_alta_hoy')
     and not exists (select 1 from public.lab_contrato c where c.employee_id = x.destino_id and c.fecha_baja is not null)
     and x.estado <> 'aviso';

  -- 4 · Lo que cobra cada una: convenio + pactado, y la última nómina de Cegid al lado.
  for f in select x.destino_id emp, x.datos from public.lab_import_fila x
            where x.lote_id = p_lote and x.hoja = 'trabajadores' and x.destino_id is not null loop
    select max(public._lab_num(n.datos ->> 'anio')::int * 100 + public._lab_num(n.datos ->> 'mes')::int) into v_periodo
      from public.lab_import_fila n
     where n.lote_id = p_lote and n.hoja = 'nominas' and public._lab_txt(n.datos, 'trabajador') = public._lab_txt(f.datos, 'trabajador');
    select c.id, coalesce(cc.convenio_codigo, public._lab_txt(f.datos, 'convenio')) into v_contrato, v_conv_cod
      from public.lab_contrato c left join public.lab_contrato_condicion cc on cc.contrato_id = c.id
     where c.employee_id = f.emp order by c.fecha_alta desc nulls last, cc.vigente_desde desc nulls last limit 1;
    v_desde := coalesce(make_date(v_periodo / 100, v_periodo % 100, 1),
                        (select max(c.fecha_alta) from public.lab_contrato c where c.employee_id = f.emp), v_hoy);

    delete from public.lab_persona_concepto where employee_id = f.emp and lote_id = p_lote;
    update public.lab_persona_concepto set vigente_hasta = v_desde - 1
     where employee_id = f.emp and vigente_hasta is null and vigente_desde < v_desde;

    -- Lo del convenio, por su convenio y su categoría.
    insert into public.lab_persona_concepto (account_id, employee_id, contrato_id, concepto_codigo, concepto_nombre, importe, periodicidad, origen, vigente_desde, lote_id)
    select v_acc, f.emp, v_contrato, t.concepto_codigo, t.concepto_nombre, t.importe,
           case when public._lab_norm(t.modo_pago) like '%paga%' then 'paga' else 'mes' end, 'convenio', v_desde, p_lote
      from public.lab_convenio_tabla t
     where t.account_id = v_acc and t.convenio_codigo = v_conv_cod and t.categoria = public._lab_txt(f.datos, 'categoria') and t.importe is not null;

    -- Lo pactado: los devengos de su última nómina que no son del convenio.
    if v_periodo is not null then
      insert into public.lab_persona_concepto (account_id, employee_id, contrato_id, concepto_codigo, concepto_nombre, importe, periodicidad, origen, vigente_desde, lote_id)
      select v_acc, f.emp, v_contrato, cod, max(nom), sum(imp), 'mes', 'pactado', v_desde, p_lote
        from (select coalesce(public._lab_txt(n.datos, 'concepto_codigo'), public._lab_txt(n.datos, 'concepto')) cod,
                     public._lab_txt(n.datos, 'concepto') nom, public._lab_num(n.datos ->> 'importe') imp,
                     coalesce(public._lab_txt(n.datos, 'tipo'), k.tipo) tipo
                from public.lab_import_fila n
                left join public.lab_concepto k on k.account_id = v_acc and k.codigo = public._lab_txt(n.datos, 'concepto_codigo')
               where n.lote_id = p_lote and n.hoja = 'nominas_conceptos'
                 and public._lab_txt(n.datos, 'trabajador') = public._lab_txt(f.datos, 'trabajador')
                 and public._lab_num(n.datos ->> 'anio')::int * 100 + public._lab_num(n.datos ->> 'mes')::int = v_periodo) n
       where cod is not null and imp is not null
         and public._lab_norm(tipo) !~ '(deduc|descuent|retenc|cotiz|aportac|irpf|seg soc)'
         and not exists (select 1 from public.lab_persona_concepto p
                          where p.employee_id = f.emp and p.lote_id = p_lote and p.origen = 'convenio' and p.concepto_codigo = n.cod)
       group by cod;
    end if;

    select sum(importe) filter (where origen = 'convenio' and periodicidad = 'mes'), sum(importe) filter (where origen = 'pactado')
      into v_conv, v_pact
      from public.lab_persona_concepto where employee_id = f.emp and lote_id = p_lote;
    select public._lab_num(n.datos ->> 'Devengado'), public._lab_num(n.datos ->> 'Retención'), public._lab_num(n.datos ->> 'Base I.R.P.F.')
      into v_bruto, v_irpf, v_base
      from public.lab_import_fila n
     where n.lote_id = p_lote and n.hoja = 'nominas' and v_periodo is not null
       and public._lab_txt(n.datos, 'trabajador') = public._lab_txt(f.datos, 'trabajador')
       and public._lab_num(n.datos ->> 'anio')::int * 100 + public._lab_num(n.datos ->> 'mes')::int = v_periodo
     order by n.fila_n limit 1;
    update public.lab_persona
       set bruto_cegid_mes = v_bruto,
           bruto_cegid_periodo = case when v_periodo is null then null else lpad((v_periodo % 100)::text, 2, '0') || '/' || (v_periodo / 100) end,
           bruto_conceptos_mes = coalesce(v_conv, 0) + coalesce(v_pact, 0),
           irpf_cegid_pct = case when v_base > 0 then round(v_irpf / v_base * 100, 2) end
     where employee_id = f.emp;
    if v_bruto is not null and abs(v_bruto - (coalesce(v_conv, 0) + coalesce(v_pact, 0))) >= 0.01 then
      v_no_cuadra := v_no_cuadra || jsonb_build_object('persona', public._lab_txt(f.datos, 'nombre'), 'cegid', v_bruto,
                                                       'conceptos', coalesce(v_conv, 0) + coalesce(v_pact, 0));
    end if;
  end loop;
  update public.lab_import_fila set estado = 'ok', mensajes = '{}', destino_tabla = 'lab_persona_concepto'
   where lote_id = p_lote and hoja in ('nominas', 'nominas_conceptos');

  update public.lab_import_lote
     set resumen = coalesce(resumen, '{}') || jsonb_build_object('volcado', jsonb_build_object('at', now(), 'por', auth.uid()))
   where id = p_lote;

  return jsonb_build_object(
    'personas', (select count(distinct destino_id) from public.lab_import_fila where lote_id = p_lote and hoja = 'trabajadores' and destino_id is not null),
    'nuevas_de_baja', n_nuevas,
    'ya_estaban', n_ya,
    'contratos', (select count(*) from public.lab_contrato where lote_id = p_lote),
    'trabajadores_en_cegid', (select count(*) from public.lab_import_fila where lote_id = p_lote and hoja = 'trabajadores'),
    'contratos_en_cegid', (select count(*) from public.lab_import_fila where lote_id = p_lote and hoja = 'contratos'),
    'avisos', n_aviso,
    'errores', n_error,
    'centros_sin_confirmar', (select coalesce(jsonb_agg(distinct c), '[]') from unnest(v_sin_centro) c),
    'no_cuadra', v_no_cuadra,
    'mensajes', (select coalesce(jsonb_agg(m order by hoja, fila_n), '[]')
                   from (select hoja, fila_n, unnest(mensajes) m from public.lab_import_fila
                          where lote_id = p_lote and estado in ('aviso', 'error')) x),
    -- N1 · respuesta 3: lo que no es un aviso pero se cuenta (el local que manda, las bajas que entran).
    'para_saber', (select coalesce(jsonb_agg(m order by hoja, fila_n), '[]')
                     from (select hoja, fila_n, unnest(mensajes) m from public.lab_import_fila
                            where lote_id = p_lote and estado = 'ok') x));
end $$;
revoke all on function public.lab_volcar_lote(uuid) from public, anon;
grant execute on function public.lab_volcar_lote(uuid) to authenticated;
grant execute on function public.lab_volcar_lote(uuid) to authenticated;
