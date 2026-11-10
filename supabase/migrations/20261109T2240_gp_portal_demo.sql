-- supabase/migrations/20261109T2240_gp_portal_demo.sql
--
-- GP · Tarea 5 (Code 3; Julio, nº 9, nº 14 y nº 15 del 09/11) · EL PORTAL DE
-- LA DEMO, para Talleres Ruiz, S.L. en «Gestoría Demo». Solo añade.
--
--   conta_portal_demo_preparar(cuenta): SOLO cuentas de demostración
--   (accounts.is_demo). La llama su administrador o encargado (el botón
--   «Preparar el portal de la demo» de la pestaña Portal) o el servidor. Se puede
--   pasar las veces que haga falta, también después de «Volver a empezar» (que
--   vacía las tablas del portal): lo que ya está, lo deja.
--     · Cómo se paga un devuelto: desde el banco y con tarjeta o Bizum (nº 9).
--     · Talleres Ruiz: el acceso de Tomás Ruiz (correo inventado, de
--       talleresruiz.example; sin usuario hasta que entre con el enlace), un
--       mensaje de bienvenida de la gestoría y una petición: subir las facturas
--       de gasto del mes, para el día 10 del que viene. El mensaje y la petición
--       van ya avisados: preparar la demo no manda ningún correo.
--   Las fechas salen de hoy (Madrid), para que no caduquen ni choquen con el
--   cargo del recibo (el día 4 o 5, de Code 1): «para el 10 de …».
--
-- La migración la llama una vez para «Gestoría Demo» (si está). Lo demás de la
-- demo es de Code 2 y de Code 1, y no se toca: Talleres Ruiz se busca por su
-- nombre DENTRO de la cuenta demo (regla 9). Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2240_gp_portal_demo.down.sql

create or replace function public.conta_portal_demo_preparar(p_cuenta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_cliente uuid; v_hechas text[] := '{}'; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_limite date; v_correo constant text := 'tomas.ruiz@talleresruiz.example';
  v_mes text;
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

  return jsonb_build_object('hecho', true, 'cliente_id', v_cliente,
    'frase', case when cardinality(v_hechas) = 0 then 'El portal de la demo ya estaba preparado: no hacía falta nada.'
                  else 'Portal de la demo preparado: ' || array_to_string(v_hechas, ', ') || '.' end);
end $$;
comment on function public.conta_portal_demo_preparar(uuid) is
  'GP · Prepara el portal de una cuenta de demostración (Talleres Ruiz en «Gestoría Demo»): ajustes del devuelto, el acceso de Tomás Ruiz, un mensaje y una petición. Se puede pasar otra vez (también después de «Volver a empezar»). Solo cuentas demo; su administrador o encargado, o el servidor.';
revoke all on function public.conta_portal_demo_preparar(uuid) from public, anon, authenticated;
grant execute on function public.conta_portal_demo_preparar(uuid) to authenticated, service_role;

-- Una vez, para «Gestoría Demo», si está (en staging no tiene clientes: no hace nada).
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
