-- cambia: public.conta_bitrix_pestana_hacer · prueba: supabase/staging/sql/20261110_gb_pestana_dia_dni_prueba.sql
-- supabase/migrations/20261110T1324_gb_pestana_dia_dni.sql
--
-- GB · nº 17, D · El alta y la baja de un trabajador desde la pestaña «Sumied» de
-- Bitrix24 con su DÍA EXACTO y su DNI o NIE (maqueta «Trabajar desde Bitrix24»),
-- con las funciones de Code 1 (1108, #590): conta_gestoria_alta_trabajador y
-- conta_gestoria_baja_trabajador (la letra de control la comprueba Code 1).
--
-- Cambia en caliente (declarado arriba, con su prueba) una sola función, con la
-- MISMA firma: conta_bitrix_pestana_hacer(portal, correo, tipo, ficha, acción, datos).
--   · Alta con «dia» (y «documento», opcional): conta_gestoria_alta_trabajador.
--   · Baja con «dia»: conta_gestoria_baja_trabajador.
--   · Sin «dia», lo de siempre (G01: conta_gestoria_alta_empleado y
--     conta_gestoria_baja_linea), para la página que aún no lo manda.
--   · En lo apuntado desde la pestaña (conta_bitrix_pestana_cambio.datos) NO se
--     guarda el documento, solo si lo había: el DNI o NIE vive en la línea (Code 1).
-- El resto, igual que en la 2250. La de antes se guarda con _respaldar_funcion y
-- la vuelta atrás la restaura byte a byte. Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1324_gb_pestana_dia_dni.down.sql

select public._respaldar_funcion('public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb)', '20261110T1324_gb_pestana_dia_dni');

create or replace function public.conta_bitrix_pestana_hacer(p_portal text, p_correo text, p_tipo text, p_id text, p_accion text, p_datos jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_d jsonb := coalesce(p_datos, '{}'::jsonb);
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int;
  v_cliente uuid; v_empresa uuid; v_r jsonb; v_linea public.conta_linea; v_cambio uuid; v_nivel uuid; v_frases text[];
  v_campo text; v_conocida text; v_escrita text;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then
    return jsonb_build_object('estado', 'ficha_rara');
  end if;
  if p_accion is null or p_accion not in ('alta', 'baja', 'tarifa') then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa acción no se puede hacer desde la pestaña.');
  end if;
  if v_portal = '' or v_correo = '' then return jsonb_build_object('estado', 'sin_acceso'); end if;

  -- La persona, igual que en la lectura: de una cuenta con ese portal conectado, activa, con ese correo.
  select count(*), min(c.account_id::text)::uuid into v_n, v_cuenta
    from public.conta_crm c
    join public.user_profiles up on up.account_id = c.account_id and up.active
    join auth.users u on u.id = up.user_id and lower(u.email) = v_correo
   where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'sin_acceso'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas'); end if;
  select up.user_id, up.display_name into v_usuario, v_quien
    from public.user_profiles up join auth.users u on u.id = up.user_id
   where up.account_id = v_cuenta and up.active and lower(u.email) = v_correo limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_usuario::text || ':' || v_cuenta::text, true);

  -- El cliente de la ficha abierta: solo se cambia lo suyo.
  select f.party_id into v_cliente from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null then return jsonb_build_object('estado', 'sin_enlazar'); end if;

  begin
    if p_accion = 'alta' then
      v_empresa := nullif(v_d->>'empresa', '')::uuid;
      -- nº 17, D · Con el día (y el DNI o NIE, si se da), la de Code 1 (1108); sin él, la del G01 de siempre.
      if nullif(v_d->>'dia', '') is not null then
        v_r := public.conta_gestoria_alta_trabajador(v_empresa, v_cliente, nullif(v_d->>'servicio', '')::uuid, v_d->>'nombre',
                 (v_d->>'dia')::date, nullif(trim(coalesce(v_d->>'documento', '')), ''));
      else
        v_r := public.conta_gestoria_alta_empleado(v_empresa, v_cliente, nullif(v_d->>'servicio', '')::uuid, v_d->>'nombre', nullif(v_d->>'desde', '')::date);
      end if;
    elsif p_accion = 'baja' then
      select * into v_linea from public.conta_linea where id = nullif(v_d->>'linea', '')::uuid;
      if v_linea.id is null or v_linea.account_id <> v_cuenta or v_linea.party_id <> v_cliente then
        return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Ese trabajador no es de este cliente.');
      end if;
      v_empresa := v_linea.company_id;
      if nullif(v_d->>'dia', '') is not null then
        v_r := public.conta_gestoria_baja_trabajador(v_linea.id, (v_d->>'dia')::date);
      else
        v_r := public.conta_gestoria_baja_linea(v_linea.id, nullif(v_d->>'mes', '')::date);
      end if;
    else
      -- nº 9, punto 2 · El nivel y el precio especial, con las funciones de la ficha del G04:
      -- conta_tarifa_nivel_cambiar y conta_tarifa_precio_guardar (las dos, de verdad, p_ensayo = false).
      select * into v_linea from public.conta_linea where id = nullif(v_d->>'linea', '')::uuid;
      if v_linea.id is null or v_linea.account_id <> v_cuenta or v_linea.party_id <> v_cliente then
        return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Ese servicio no es de este cliente.');
      end if;
      v_empresa := v_linea.company_id;
      v_nivel := coalesce(nullif(v_d->>'nivel', '')::uuid, v_linea.nivel_id);
      v_frases := '{}';
      if v_nivel is distinct from v_linea.nivel_id then
        v_r := public.conta_tarifa_nivel_cambiar(v_linea.id, v_nivel, nullif(v_d->>'desde', '')::date, false);
        v_frases := v_frases || (v_r->>'frase');
      end if;
      if v_d ? 'precio' then
        if coalesce(trim(v_d->>'motivo'), '') = '' then
          return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Di por qué tiene un precio especial: lo verá tu equipo.');
        end if;
        -- Un servicio que se cobra por trabajador, por trabajador; los demás, al mes.
        v_r := public.conta_tarifa_precio_guardar(v_empresa, v_linea.servicio_id, v_nivel, null, v_cliente,
                 case when (select x.forma from public.conta_servicio x where x.id = v_linea.servicio_id) = 'por_empleado' then 'por_trabajador' else 'fijo' end,
                 case when (select x.forma from public.conta_servicio x where x.id = v_linea.servicio_id) = 'por_empleado' then null else 'mes' end,
                 (v_d->>'precio')::numeric, null, nullif(v_d->>'desde', '')::date, false);
        v_frases := v_frases || (v_r->>'frase');
      end if;
      if cardinality(v_frases) = 0 then return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'No hay nada que cambiar.'); end if;
      v_r := jsonb_build_object('id', v_r->>'id', 'frase', array_to_string(v_frases, ' '));
    end if;
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.');
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;

  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, resultado_id, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, v_id, p_accion,
          case when v_d ? 'documento' then (v_d - 'documento') || jsonb_build_object('con_documento', nullif(trim(coalesce(v_d->>'documento', '')), '') is not null) else v_d end,
          coalesce(v_r->>'frase', ''), nullif(v_r->>'id', '')::uuid, v_usuario, v_quien)
  returning id into v_cambio;

  -- Para actualizar Bitrix24 sin pisar nada: el campo de la cuota en el mapa
  -- confirmado, lo que Sumied leyó allí y lo último que escribió la pestaña.
  select x->>'codigo' into v_campo from public.conta_crm c, jsonb_array_elements(coalesce(c.mapa->'campos', '[]'::jsonb)) x
   where c.account_id = v_cuenta and c.crm = 'bitrix24' and x->>'campo' = 'cuota_referencia' and x->>'etiqueta' = 'Cuota mensual'
     and coalesce(x->>'codigo', '') <> '' limit 1;
  select q->>'texto' into v_conocida from public.conta_gestoria_ficha f, jsonb_array_elements(coalesce(f.ficha->'cuotasReferencia', '[]'::jsonb)) q
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id and q->>'etiqueta' = 'Cuota mensual' limit 1;
  select b.bitrix->>'escrito' into v_escrita from public.conta_bitrix_pestana_cambio b
   where b.account_id = v_cuenta and b.tipo_ficha = p_tipo and b.id_externo = v_id and b.bitrix ? 'escrito'
   order by b.bitrix_at desc nulls last limit 1;

  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'cambio', v_cambio, 'id', v_r->>'id', 'empresa', v_empresa, 'cliente', v_cliente,
    'bitrix', jsonb_build_object('campo', v_campo, 'conocida', v_conocida, 'escrita', v_escrita));
end $$;

comment on function public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb) is
  'GB · Alta y baja de un trabajador, cambio de nivel y precio especial desde la pestaña de Bitrix24. Solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Actúa como la persona («usuario:cuenta») y llama a las funciones de la ficha del G04 (conta_gestoria_alta_empleado y conta_gestoria_baja_linea, o, con el día, conta_gestoria_alta_trabajador y conta_gestoria_baja_trabajador de la 1108; conta_tarifa_nivel_cambiar y conta_tarifa_precio_guardar), que comprueban su permiso. Solo sobre el cliente de la ficha abierta.';
