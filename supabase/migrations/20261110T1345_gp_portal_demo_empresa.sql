-- supabase/migrations/20261110T1345_gp_portal_demo_empresa.sql
-- cambia: public.conta_portal_demo_preparar · prueba: supabase/staging/sql/20261110_gp_portal_demo_empresa_prueba.sql
-- cambia: public.conta_portal_cuenta · prueba: supabase/staging/sql/20261110_gp_portal_demo_empresa_prueba.sql
--
-- GP · nº 28 (Code 3; Julio, 10/11) · EL PORTAL DE LA DEMO, COMO LA MAQUETA. Cambia
-- en caliente dos funciones propias del portal (la misma firma, con respaldo):
--
--   conta_portal_demo_preparar(cuenta), lo de antes y además (SOLO cuentas demo):
--     · La empresa de Talleres Ruiz en Sumied: otra cuenta demo
--       (de000000-…-0000000000b1, con su sociedad …b2) que «Volver a empezar» no
--       borra. La crea la plataforma (esta migración, o «Volver a empezar» si
--       faltara); la ficha del cliente solo apunta a ella. Así funcionan «Subir
--       una factura», Documentos, «Lo último» y la petición de facturas de gasto.
--     · Sus impuestos presentados: 303, 111 y 115 del último trimestre ya
--       presentado y el 200 del último ejercicio, con su justificante.
--     · Las nóminas de los dos últimos meses y los seguros sociales del último,
--       de los trabajadores que enseña la pestaña Trabajadores (las líneas de
--       Gestión laboral, de Code 2), con el nombre bien escrito.
--     · Lucía Pardo con «Facturas y documentos», una conversación en Mensajes
--       (ya avisada: no sale correo) y el contacto de la gestoría
--       (hola@gestoriademo.example · 910 000 000), todo inventado.
--     Los justificantes y las nóminas son PDF de la demo: los hace conta-portal
--     la primera vez que se abren (rutas «demo/…», solo en cuentas demo).
--   conta_portal_cuenta: «Correo para las facturas» es adonde va de verdad la
--   factura (lo mismo que correoDelCliente, de Code 1): el de la última factura,
--   el del cliente en ella o el que tiene GoCardless.
--
-- Las facturas y los pagos de meses anteriores NO van aquí: los siembra Code 2 en
-- «Volver a empezar», con la cadena entera (factura, cobro e ingreso en el banco).
-- Tampoco el acceso de Felipe Herrera ni el mes del cobro (Code 2).
-- Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1345_gp_portal_demo_empresa.down.sql

select public._respaldar_funcion('public.conta_portal_demo_preparar(uuid)', '20261110T1345_gp_portal_demo_empresa');
select public._respaldar_funcion('public.conta_portal_cuenta(uuid)', '20261110T1345_gp_portal_demo_empresa');

create or replace function public.conta_portal_demo_preparar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_cliente uuid; v_hechas text[] := '{}'; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_limite date; v_correo constant text := 'tomas.ruiz@talleresruiz.example';
  v_mes text;
  -- nº 28 · La empresa de Talleres Ruiz en Sumied (otra cuenta demo, que «Volver a empezar» no borra) y su sociedad.
  v_prop constant uuid := 'de000000-0000-4000-8000-0000000000b1'; v_soc constant uuid := 'de000000-0000-4000-8000-0000000000b2';
  v_qfin date; v_presentado date; v_anio_q int; v_q text; v_ej200 int; v_200 date; v_n int; v_m int; v_ini date; v_fin date;
  v_nombre_mes text; v_emp uuid; v_primero uuid; w record; v_marca jsonb;
  MESES constant text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'Solo se prepara el portal de una cuenta de demostración.' using errcode = '42501';
  end if;
  if not (v_servidor or public.current_user_is_admin_or_manager_of(p_cuenta)) then
    raise exception 'Prepara la demo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  select id into v_cliente from public.party where account_id = p_cuenta and name = 'Talleres Ruiz, S.L.' order by created_at limit 1;
  if v_cliente is null then
    return jsonb_build_object('hecho', false, 'frase', 'En la demo aún no está Talleres Ruiz, S.L.: lee antes los clientes del CRM y vuelve a pulsar.');
  end if;

  -- 1 · Cómo se paga un devuelto: los dos caminos.
  if not exists (select 1 from public.conta_portal_ajustes where account_id = p_cuenta and pagar_devuelto @> array['banco', 'tarjeta']) then
    insert into public.conta_portal_ajustes (account_id, pagar_devuelto, updated_at, updated_by_name)
    values (p_cuenta, array['banco', 'tarjeta'], now(), 'Preparación de la demo')
    on conflict (account_id) do update set pagar_devuelto = excluded.pagar_devuelto, updated_at = now(), updated_by_name = excluded.updated_by_name;
    v_hechas := array_append(v_hechas, 'el devuelto se paga desde el banco o con tarjeta');
  end if;

  -- 2 · El acceso de Tomás Ruiz (sin usuario: lo pone el enlace al entrar).
  if not exists (select 1 from public.conta_portal_acceso where party_id = v_cliente and lower(correo) = v_correo and revocado_at is null) then
    if exists (select 1 from public.conta_portal_acceso where party_id = v_cliente and lower(correo) = v_correo) then
      update public.conta_portal_acceso set revocado_at = null, revocado_por_name = null, permiso = 'todo', invitado_at = now(), invitado_por_name = 'Preparación de la demo'
       where party_id = v_cliente and lower(correo) = v_correo;
    else
      insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso, invitado_por_name)
      values (p_cuenta, v_cliente, v_correo, 'Tomás Ruiz', 'todo', 'Preparación de la demo');
    end if;
    v_hechas := array_append(v_hechas, ('acceso de Tomás Ruiz (' || v_correo || ')'));
  end if;

  -- 3 · Un mensaje de bienvenida, si aún no os habéis escrito (ya avisado: no sale correo).
  if not exists (select 1 from public.conta_portal_mensaje where party_id = v_cliente) then
    insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto, created_at, avisado_at)
    values (p_cuenta, v_cliente, 'gestoria', 'Gestoría Demo',
            'Hola, Tomás: ya tienes aquí tu espacio. Ves tus facturas y tus recibos, nos subes los documentos y nos escribes por aquí. Si el banco te devuelve un recibo, lo pagas desde Inicio en un minuto.',
            now() - interval '1 day', now());
    v_hechas := array_append(v_hechas, 'un mensaje de bienvenida');
  end if;

  -- 4 · Una petición: subir las facturas de gasto del mes, para el día 10 del que viene (ya avisada).
  if not exists (select 1 from public.conta_portal_peticion where party_id = v_cliente and estado = 'pendiente') then
    v_limite := (date_trunc('month', v_hoy) + interval '1 month' + interval '9 days')::date;
    v_mes := (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from v_hoy)::int];
    insert into public.conta_portal_peticion (account_id, party_id, tipo, titulo, detalle, fecha_limite, creada_por_name, avisado_at)
    values (p_cuenta, v_cliente, 'subir', 'Facturas de gasto de ' || v_mes,
            'Las de proveedores y los tiques del mes. Una foto con el móvil vale.', v_limite, 'Gestoría Demo', now());
    v_hechas := array_append(v_hechas, ('la petición «Facturas de gasto de ' || v_mes || '», para el ' || to_char(v_limite, 'DD/MM')));
  end if;

  -- 5 · nº 28 · La empresa de Talleres Ruiz en Sumied: una cuenta demo propia, con su sociedad. La crea la
  --     plataforma (la migración o «Volver a empezar»): marcar una cuenta como demo no lo puede hacer una sesión.
  if not exists (select 1 from public.accounts where id = v_prop) then
    if auth.uid() is null then
      insert into public.accounts (id, name, legal_name, slug, status, business_type, product_brand, is_demo)
      values (v_prop, 'Talleres Ruiz, S.L.', 'Talleres Ruiz, S.L.', 'talleres-ruiz-demo', 'active', 'otra_actividad', 'sumied', true);
      insert into public.company (id, account_id, legal_name, trade_name, tax_id, entity_kind, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province)
      values (v_soc, v_prop, 'Talleres Ruiz, S.L.', 'Talleres Ruiz', 'B00001115', 'company', 'Calle Mayor, 1', '28001', 'Getafe', 'Madrid');
      v_hechas := array_append(v_hechas, 'la empresa de Talleres Ruiz en Sumied');
    else
      v_hechas := array_append(v_hechas, 'la empresa de Talleres Ruiz en Sumied no está: la crea la plataforma («Volver a empezar»)');
    end if;
  end if;
  if exists (select 1 from public.accounts where id = v_prop and is_demo is true) then
    -- Su ficha de cliente apunta a su empresa (la ficha la siembra Code 2; aquí solo el enlace).
    if not exists (select 1 from public.conta_gestoria_cliente where party_id = v_cliente and account_id = p_cuenta and cuenta_propia_account_id = v_prop) then
      if exists (select 1 from public.conta_gestoria_cliente where party_id = v_cliente and account_id = p_cuenta) then
        update public.conta_gestoria_cliente set cuenta_propia_account_id = v_prop where party_id = v_cliente and account_id = p_cuenta;
      else
        insert into public.conta_gestoria_cliente (party_id, account_id, cuenta_propia_account_id) values (v_cliente, p_cuenta, v_prop);
      end if;
      v_hechas := array_append(v_hechas, 'Talleres Ruiz ya sube documentos al portal');
    end if;

    -- 6 · Los impuestos presentados (como la maqueta): el 303, el 111 y el 115 del último trimestre ya presentado
    --     (el día 20 del mes siguiente) y el 200 del último ejercicio (el 24 de julio). Con su justificante (un PDF
    --     de la demo, que hace conta-portal al abrirlo).
    v_qfin := (date_trunc('quarter', v_hoy) - interval '1 day')::date;
    if (v_qfin + 20) > v_hoy then v_qfin := (date_trunc('quarter', v_qfin) - interval '1 day')::date; end if;
    v_presentado := v_qfin + 20; v_anio_q := extract(year from v_qfin)::int; v_q := extract(quarter from v_qfin)::int || 'T';
    v_ej200 := extract(year from v_hoy)::int - case when v_hoy >= make_date(extract(year from v_hoy)::int, 7, 24) then 1 else 2 end;
    v_200 := make_date(v_ej200 + 1, 7, 24);
    insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount,
                                   filed_at, filed_via, filed_by_name, presenter_kind, aeat_csv, receipt_source, receipt_document_path)
    select v_prop, v_soc, x.modelo, x.ejercicio, x.cadencia, x.periodo, x.dia, 'filed', x.resultado, x.importe,
           (x.dia + time '10:30') at time zone 'Europe/Madrid', 'sumied', 'Gestoría Demo', 'advisor', 'DEMO' || upper(substr(md5(x.modelo || x.ejercicio || x.periodo), 1, 12)),
           'upload', 'demo/' || v_prop || '/impuestos/' || x.modelo || '-' || x.ejercicio || '-' || x.periodo || '.pdf'
      from (values ('303', v_anio_q, 'quarterly', v_q, v_presentado, 'to_pay', 1842.50),
                   ('111', v_anio_q, 'quarterly', v_q, v_presentado, 'to_pay', 1204.00),
                   ('115', v_anio_q, 'quarterly', v_q, v_presentado, 'to_pay', 342.00),
                   ('200', v_ej200, 'annual', '0A', v_200, 'to_refund', 312.40)) x(modelo, ejercicio, cadencia, periodo, dia, resultado, importe)
    on conflict (company_id, form_code, fiscal_year, period, sequence) do nothing;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_hechas := array_append(v_hechas, v_n || ' impuestos presentados (303, 111 y 115 del ' || v_q || ' y el 200 de ' || v_ej200 || ')'); end if;

    -- 7 · Las nóminas de los dos últimos meses (y los seguros sociales del último), de los trabajadores que
    --     enseña la pestaña Trabajadores (las líneas de Gestión laboral de Code 2), con el nombre bien escrito.
    v_m := 0;
    for i in reverse 2..1 loop
      v_ini := (date_trunc('month', v_hoy) - make_interval(months => i))::date;
      v_fin := (v_ini + interval '1 month' - interval '1 day')::date;
      v_nombre_mes := MESES[extract(month from v_ini)::int] || ' ' || extract(year from v_ini);
      v_primero := null;
      for w in select distinct initcap(lower(btrim(l.empleado_nombre))) as nombre
                 from public.conta_linea l
                where l.account_id = p_cuenta and l.party_id = v_cliente and l.empleado_nombre is not null
                  and l.desde <= v_fin and (l.hasta is null or l.hasta >= v_ini)
                order by 1 loop
        select id into v_emp from public.employees where account_id = v_prop and name = w.nombre limit 1;
        if v_emp is null then
          insert into public.employees (account_id, name, position, contract_type, active) values (v_prop, w.nombre, 'Mecánico', 'indefinido', true) returning id into v_emp;
        end if;
        v_primero := coalesce(v_primero, v_emp);
        insert into public.documents (employee_id, type, name, file_path, carpeta, origen, uploaded_role, created_at)
        select v_emp, 'nomina', 'Nómina ' || v_nombre_mes || ' · ' || w.nombre || '.pdf',
               'demo/' || v_prop || '/nominas/' || to_char(v_ini, 'YYYY-MM') || '/' || v_emp || '.pdf', 'nominas', 'sumied', 'gestor',
               (v_fin + time '10:00') at time zone 'Europe/Madrid'
         where not exists (select 1 from public.documents d where d.employee_id = v_emp and d.file_path = 'demo/' || v_prop || '/nominas/' || to_char(v_ini, 'YYYY-MM') || '/' || v_emp || '.pdf');
        get diagnostics v_n = row_count; v_m := v_m + v_n;
      end loop;
      if i = 1 and v_primero is not null then
        insert into public.documents (employee_id, type, name, file_path, carpeta, origen, uploaded_role, created_at)
        select v_primero, 'seguros_sociales', 'Seguros sociales ' || v_nombre_mes || '.pdf',
               'demo/' || v_prop || '/ss/' || to_char(v_ini, 'YYYY-MM') || '.pdf', 'ss_sepe', 'sumied', 'gestor', (v_fin + time '09:00') at time zone 'Europe/Madrid'
         where not exists (select 1 from public.documents d where d.file_path = 'demo/' || v_prop || '/ss/' || to_char(v_ini, 'YYYY-MM') || '.pdf');
        get diagnostics v_n = row_count; v_m := v_m + v_n;
      end if;
    end loop;
    if v_m > 0 then v_hechas := array_append(v_hechas, v_m || ' documentos de laboral (nóminas y seguros sociales)'); end if;
  end if;

  -- 8 · nº 28 · Una segunda persona, con «Facturas y documentos» (sin usuario; preparar no manda la invitación).
  if not exists (select 1 from public.conta_portal_acceso where party_id = v_cliente and lower(correo) = 'administracion@talleresruiz.example') then
    insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso, invitado_por_name, invitado_at)
    values (p_cuenta, v_cliente, 'administracion@talleresruiz.example', 'Lucía Pardo', 'facturas_documentos', 'Preparación de la demo', now() - interval '1 hour');
    v_hechas := array_append(v_hechas, 'Lucía Pardo, con «Facturas y documentos»');
  end if;

  -- 9 · nº 28 · Una conversación con la gestoría (como la maqueta), si Tomás aún no ha escrito. Ya avisada: no sale correo.
  if not exists (select 1 from public.conta_portal_mensaje where party_id = v_cliente and de = 'cliente') then
    insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto, created_at, avisado_at, leido_at) values
      (p_cuenta, v_cliente, 'gestoria', 'Gestoría Demo', 'Hola, Tomás. Ya está hecha el alta del trabajador nuevo. ¿Tiene jornada completa o parcial? Lo necesito para su nómina.',
       now() - interval '18 hours', now(), now() - interval '2 hours'),
      (p_cuenta, v_cliente, 'cliente', 'Tomás Ruiz', 'Completa, 40 horas a la semana. El contrato firmado te lo paso mañana.',
       now() - interval '40 minutes', now(), null),
      (p_cuenta, v_cliente, 'gestoria', 'Gestoría Demo', 'Perfecto, recibido. Su primera nómina sale con la del mes que viene.',
       now() - interval '20 minutes', now(), null);
    v_hechas := array_append(v_hechas, 'una conversación en Mensajes');
  end if;

  -- 10 · nº 28 · El contacto de la gestoría que ve el cliente (inventado: correo de .example y teléfono de prueba).
  v_marca := public._conta_portal_marca(p_cuenta, v_cliente);
  if (v_marca ->> 'empresa_id') is not null and (v_marca ->> 'correo' is distinct from 'hola@gestoriademo.example' or v_marca ->> 'telefono' is distinct from '910000000') then
    update public.company set email = 'hola@gestoriademo.example', phone = '910000000' where id = (v_marca ->> 'empresa_id')::uuid and account_id = p_cuenta;
    v_hechas := array_append(v_hechas, 'el contacto de la gestoría (hola@gestoriademo.example · 910 000 000)');
  end if;

  return jsonb_build_object('hecho', true, 'cliente_id', v_cliente,
    'frase', case when cardinality(v_hechas) = 0 then 'El portal de la demo ya estaba preparado: no hacía falta nada.'
                  else 'Portal de la demo preparado: ' || array_to_string(v_hechas, ', ') || '.' end);
end $$;
comment on function public.conta_portal_demo_preparar(uuid) is
  'GP · Prepara el portal de una cuenta de demostración (Talleres Ruiz en «Gestoría Demo»): ajustes del devuelto, los accesos de Tomás Ruiz y Lucía Pardo, mensajes, una petición, la empresa de Talleres Ruiz en Sumied con sus impuestos y nóminas, y el contacto de la gestoría. Se puede pasar otra vez (también después de «Volver a empezar»). Solo cuentas demo; su administrador o encargado, o el servidor.';


create or replace function public.conta_portal_cuenta(p_party uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y public.conta_portal_acceso := public._conta_portal_yo(p_party, true); e uuid;
begin
  e := public._conta_portal_empresa(y.account_id, y.party_id);
  return jsonb_build_object(
    'domiciliacion', (select jsonb_build_object('estado', m.estado, 'firmada', m.creado,
                        'cuenta_final', m.cuenta_final, 'cuenta_pais', m.cuenta_pais, 'banco', m.banco)
                        from public.conta_gc_mandato m
                        join public.conta_cobro_cliente cc on cc.company_id = m.company_id and cc.gc_cliente_id = m.gc_cliente_id
                       where cc.account_id = y.account_id and cc.party_id = y.party_id and m.estado not in ('cancelled', 'failed', 'expired', 'consumed', 'blocked')
                       order by m.creado desc nulls last limit 1),
    'cambio_en_marcha', (select jsonb_build_object('estado', o.estado, 'url', o.externo_url, 'creada', o.created_at)
                           from public.conta_portal_operacion o where o.party_id = y.party_id and o.tipo = 'cambiar_cuenta'
                            and o.estado in ('creada', 'esperando') order by o.created_at desc limit 1),
    'datos', (select jsonb_build_object('razon_social', coalesce(cf.legal_name, p.name), 'nif', p.tax_id,
                'direccion', concat_ws(' · ', cf.fiscal_street, nullif(concat_ws(' ', cf.fiscal_postal_code, cf.fiscal_city), '')),
                -- nº 28 · Adonde va de verdad la factura (lo mismo que correoDelCliente, de Code 1): el de la última factura,
                -- el del cliente en ella o el que tiene GoCardless de ese cliente.
                'correo_facturas', coalesce(
                   (select coalesce(nullif(btrim(f.email_to), ''), nullif(btrim(f.customer ->> 'correo'), '')) from public.customer_invoice f
                     where f.party_id = p.id and f.status = 'emitida' and coalesce(nullif(btrim(f.email_to), ''), nullif(btrim(f.customer ->> 'correo'), '')) is not null
                     order by f.issue_date desc limit 1),
                   (select g.correo from public.conta_gc_cliente g where g.party_id = p.id and g.company_id = e and nullif(btrim(g.correo), '') is not null limit 1)))
                from public.party p left join public.customer_fiscal cf on cf.party_id = p.id where p.id = y.party_id),
    'cambio_datos_abierto', exists (select 1 from public.conta_portal_incidencia i where i.party_id = y.party_id and i.tipo = 'cambio_datos' and i.estado = 'abierta'),
    'personas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', coalesce(x.nombre, x.correo), 'correo', x.correo,
        'permiso', x.permiso, 'soy_yo', x.id = y.id, 'ha_entrado', x.entro_at is not null) order by x.invitado_at)
      from public.conta_portal_acceso x where x.party_id = y.party_id and x.revocado_at is null), '[]'::jsonb),
    'contratado', coalesce((public._conta_portal_proximo(y.account_id, y.party_id)) -> 'lineas',
                           (select r.lineas from public.conta_recibo r where r.account_id = y.account_id and r.party_id = y.party_id order by r.mes desc limit 1),
                           '[]'::jsonb),
    'empresa_id', e);
end $$;

-- Una vez, para «Gestoría Demo», si está, como la plataforma: crea la empresa de Talleres Ruiz y lo demás.
do $$
declare v jsonb;
begin
  if not exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0' and is_demo) then
    raise notice 'GP: no está «Gestoría Demo»: no se prepara su portal.';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v := public.conta_portal_demo_preparar('de000000-0000-4000-8000-0000000000a0');
  perform set_config('request.jwt.claims', '', true);
  raise notice 'GP: %', v->>'frase';
end $$;
