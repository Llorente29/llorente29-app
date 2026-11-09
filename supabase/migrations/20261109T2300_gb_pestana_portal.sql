-- supabase/migrations/20261109T2300_gb_pestana_portal.sql
--
-- GB · Segunda parte (nº 9), punto 5 · «Su portal» en la pestaña «Sumied» de
-- Bitrix24: quién entra y lo que pide el cliente, con «Hacerla».
--
-- Va DESPUÉS de la 2235 (#549): apunta en su conta_bitrix_pestana_cambio. No
-- cambia nada de lo que ya existe: añade dos funciones.
--   1. _conta_bitrix_pestana_bitrix_de(cuenta, tipo, ficha): lo que necesita la
--      función para actualizar la cuota de Bitrix24 sin pisar nada (el campo del
--      mapa, lo que Sumied leyó allí y lo último que escribió la pestaña).
--   2. conta_bitrix_pestana_portal(portal, correo, tipo, ficha, solicitud,
--      servicio): solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario
--      y la aplicación. Actúa como la persona (la misma comprobación que la
--      lectura) y:
--        · sin solicitud: lee el portal del cliente con la función de Code 3,
--          conta_portal_ficha (quién entra, lo que pide, los mensajes sin leer);
--        · con solicitud: «Hacerla», con la función de Code 3,
--          conta_portal_solicitud_hacer (que llama a las de la ficha del G04 y
--          comprueba que la persona es administradora o encargada). Solo una
--          petición del cliente de la ficha abierta.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2300_gb_pestana_portal.down.sql

create or replace function public._conta_bitrix_pestana_bitrix_de(p_cuenta uuid, p_tipo text, p_id text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'campo', (select x->>'codigo' from public.conta_crm c, jsonb_array_elements(coalesce(c.mapa->'campos', '[]'::jsonb)) x
               where c.account_id = p_cuenta and c.crm = 'bitrix24' and x->>'campo' = 'cuota_referencia' and x->>'etiqueta' = 'Cuota mensual'
                 and coalesce(x->>'codigo', '') <> '' limit 1),
    'conocida', (select q->>'texto' from public.conta_gestoria_ficha f, jsonb_array_elements(coalesce(f.ficha->'cuotasReferencia', '[]'::jsonb)) q
                  where f.account_id = p_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = p_id and q->>'etiqueta' = 'Cuota mensual' limit 1),
    'escrita', (select b.bitrix->>'escrito' from public.conta_bitrix_pestana_cambio b
                 where b.account_id = p_cuenta and b.tipo_ficha = p_tipo and b.id_externo = p_id and b.bitrix ? 'escrito'
                 order by b.bitrix_at desc nulls last limit 1))
$$;

create or replace function public.conta_bitrix_pestana_portal(p_portal text, p_correo text, p_tipo text, p_id text,
  p_solicitud uuid default null, p_servicio uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int; v_cliente uuid;
  v_f jsonb; v_s public.conta_solicitud; v_r jsonb; v_cambio uuid;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then return jsonb_build_object('estado', 'ficha_rara'); end if;
  if v_portal = '' or v_correo = '' then return jsonb_build_object('estado', 'sin_acceso'); end if;

  -- La persona, igual que en la lectura.
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

  select f.party_id into v_cliente from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null then return jsonb_build_object('estado', 'sin_enlazar'); end if;

  if p_solicitud is null then
    v_f := public.conta_portal_ficha(v_cliente);
    return jsonb_build_object('estado', 'ok',
      'accesos', coalesce((select jsonb_agg(jsonb_build_object('nombre', a->>'nombre', 'correo', a->>'correo', 'permiso', a->>'permiso', 'entro', a->>'entro_at')
                  order by a->>'invitado_at') from jsonb_array_elements(coalesce(v_f->'accesos', '[]'::jsonb)) a where a->>'revocado_at' is null), '[]'::jsonb),
      'solicitudes', coalesce((select jsonb_agg(jsonb_build_object('id', s->>'id', 'tipo', s->>'tipo', 'nombre', s->>'empleado_nombre', 'empresa', s->>'company_id',
                  'fecha', coalesce(s->>'fecha_efecto', s->>'mes'), 'desde_el_portal', s->>'portal_acceso_id' is not null) order by s->>'pedida_at')
                  from jsonb_array_elements(coalesce(v_f->'solicitudes', '[]'::jsonb)) s where s->>'estado' = 'pedida'), '[]'::jsonb),
      'mensajes_sin_leer', (select count(*) from jsonb_array_elements(coalesce(v_f->'mensajes', '[]'::jsonb)) m where m->>'de' = 'cliente' and m->>'leido' is null));
  end if;

  -- «Hacerla»: solo una petición del cliente de la ficha abierta.
  select * into v_s from public.conta_solicitud where id = p_solicitud;
  if v_s.id is null or v_s.account_id <> v_cuenta or v_s.party_id <> v_cliente then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa petición no es de este cliente.');
  end if;
  begin
    v_r := public.conta_portal_solicitud_hacer(p_solicitud, p_servicio);
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.');
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, resultado_id, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, v_id, v_s.tipo, jsonb_build_object('solicitud', p_solicitud, 'servicio', p_servicio, 'nombre', v_s.empleado_nombre),
          coalesce(v_r->>'frase', ''), nullif(v_r->>'linea_id', '')::uuid, v_usuario, v_quien)
  returning id into v_cambio;
  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'cambio', v_cambio, 'id', v_r->>'linea_id', 'empresa', v_s.company_id, 'cliente', v_cliente,
    'tipo', v_s.tipo, 'nombre', v_s.empleado_nombre, 'bitrix', public._conta_bitrix_pestana_bitrix_de(v_cuenta, p_tipo, v_id));
end $$;

revoke all on function public._conta_bitrix_pestana_bitrix_de(uuid, text, text) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_portal(text, text, text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_portal(text, text, text, text, uuid, uuid) to service_role;

comment on function public.conta_bitrix_pestana_portal(text, text, text, text, uuid, uuid) is
  'GB · «Su portal» en la pestaña de Bitrix24. Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Actúa como la persona: sin solicitud, lee el portal del cliente (conta_portal_ficha, de Code 3); con solicitud, «Hacerla» (conta_portal_solicitud_hacer, de Code 3), solo del cliente de la ficha abierta.';
