-- supabase/migrations/20261109T2345_gp_portal_bitrix.sql
--
-- GP · nº 17 (Code 3; para Code 4) · «INVITAR AL PORTAL» Y «CONTESTAR UN
-- MENSAJE» DESDE LA PESTAÑA DE BITRIX24, donde no hay sesión de Sumied. Solo
-- añade.
--
-- Las dos las llama SOLO el servidor (service_role), DESPUÉS de comprobar con
-- Bitrix24 quién mira (user.current) y que el token es de la aplicación de
-- Sumied (app.info), como conta_bitrix_pestana_leer y conta_bitrix_pestana_portal
-- de Code 4. Con la misma forma y los mismos estados:
--   1. la cuenta: la que tiene ese portal conectado (conta_crm.portal);
--   2. la persona: la de esa cuenta, activa, con ese correo; si no hay, o hay
--      más de una cuenta, se dice y no se hace nada;
--   3. el cliente: el de la ficha abierta (conta_gestoria_ficha / _cliente), nunca
--      uno que mande el navegador;
--   4. actúa como ella, en esa cuenta («usuario:cuenta», DM1), y llama a las
--      funciones de siempre del portal, que vuelven a comprobar sus permisos:
--        · conta_portal_invitar: solo un administrador o un encargado;
--        · conta_portal_mensaje_enviar: cualquiera de la cuenta (el aviso al
--          cliente lo manda el cron, como desde Sumied).
--   Devuelven { estado: 'ok', frase, … } o { estado, frase } con el porqué.
--
-- El correo de la invitación no sale de aquí: lo manda conta-portal (acción
-- «bitrix_invitar», solo con la clave de servicio), que llama a esta función y
-- después manda el enlace, como «Invitar al portal» desde Sumied.
--
-- Nada en el camino del pedido. No cambia nada de lo que existe.
-- Vuelta atrás: supabase/vuelta-atras/20261109T2345_gp_portal_bitrix.down.sql

-- Quién mira y qué cliente es la ficha abierta; deja puesta su identidad para esta transacción.
create or replace function public._conta_portal_bitrix_quien(p_portal text, p_correo text, p_tipo text, p_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int; v_cliente uuid;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then
    return jsonb_build_object('estado', 'ficha_rara', 'frase', 'Esta ficha de Bitrix24 no se reconoce.');
  end if;
  if v_portal = '' or v_correo = '' then
    return jsonb_build_object('estado', 'sin_acceso', 'frase', 'No se sabe quién eres: vuelve a abrir la pestaña.');
  end if;
  select count(*), min(c.account_id::text)::uuid into v_n, v_cuenta
    from public.conta_crm c
    join public.user_profiles up on up.account_id = c.account_id and up.active
    join auth.users u on u.id = up.user_id and lower(u.email) = v_correo
   where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'sin_acceso', 'frase', 'Tu correo de Bitrix24 no es de nadie de Sumied en esta cuenta.'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas', 'frase', 'Tu correo está en más de una cuenta de Sumied con este portal: hazlo desde Sumied.'); end if;
  select up.user_id, up.display_name into v_usuario, v_quien
    from public.user_profiles up join auth.users u on u.id = up.user_id
   where up.account_id = v_cuenta and up.active and lower(u.email) = v_correo
   limit 1;

  select f.party_id into v_cliente from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null or not exists (select 1 from public.party p where p.id = v_cliente and p.account_id = v_cuenta) then
    return jsonb_build_object('estado', 'sin_enlazar', 'frase', 'Esta ficha aún no es de ningún cliente de Sumied.');
  end if;

  -- Como esa persona, en esa cuenta (DM1: «usuario:cuenta»), solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_usuario::text || ':' || v_cuenta::text, true);
  return jsonb_build_object('estado', 'ok', 'cuenta', v_cuenta, 'usuario', v_usuario, 'quien', v_quien, 'cliente', v_cliente);
end $$;

-- «Invitar al portal» desde Bitrix24: el acceso (el correo lo manda conta-portal).
create or replace function public.conta_portal_bitrix_invitar(p_portal text, p_correo text, p_tipo text, p_id text,
  p_invitado text, p_nombre text default null, p_permiso text default 'todo')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_r jsonb;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q ->> 'estado' <> 'ok' then return v_q; end if;
  begin
    v_r := public.conta_portal_invitar((v_q ->> 'cliente')::uuid, p_invitado, p_nombre, coalesce(p_permiso, 'todo'));
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    return jsonb_build_object('estado', 'no', 'frase', sqlerrm);
  end;
  return v_r || jsonb_build_object('estado', 'ok', 'acceso_id', v_r ->> 'id', 'cuenta', v_q -> 'cuenta', 'cliente', v_q -> 'cliente');
end $$;

-- «Contestar» un mensaje desde Bitrix24: como si lo escribiera en Sumied (el aviso al cliente, el cron).
create or replace function public.conta_portal_bitrix_contestar(p_portal text, p_correo text, p_tipo text, p_id text, p_texto text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_r jsonb;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q ->> 'estado' <> 'ok' then return v_q; end if;
  if length(trim(coalesce(p_texto, ''))) > 4000 then return jsonb_build_object('estado', 'no', 'frase', 'Como mucho 4.000 letras por mensaje.'); end if;
  begin
    v_r := public.conta_portal_mensaje_enviar((v_q ->> 'cliente')::uuid, p_texto, '[]'::jsonb);
    -- Lo del cliente queda leído: quien contesta ya lo ha visto en la pestaña.
    perform public.conta_portal_mensajes_leidos((v_q ->> 'cliente')::uuid);
  exception when sqlstate '22023' or sqlstate '42501' or sqlstate 'P0002' then
    return jsonb_build_object('estado', 'no', 'frase', sqlerrm);
  end;
  return v_r || jsonb_build_object('estado', 'ok', 'cuenta', v_q -> 'cuenta', 'cliente', v_q -> 'cliente');
end $$;

-- Permisos: SOLO el servidor (Supabase da EXECUTE por defecto a anon y authenticated; se quita).
revoke all on function public._conta_portal_bitrix_quien(text, text, text, text) from public, anon, authenticated;
revoke all on function public.conta_portal_bitrix_invitar(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.conta_portal_bitrix_contestar(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public._conta_portal_bitrix_quien(text, text, text, text) to service_role;
grant execute on function public.conta_portal_bitrix_invitar(text, text, text, text, text, text, text) to service_role;
grant execute on function public.conta_portal_bitrix_contestar(text, text, text, text, text) to service_role;

comment on function public.conta_portal_bitrix_invitar(text, text, text, text, text, text, text) is
  'GP · «Invitar al portal» desde la pestaña de Bitrix24 (Code 4). Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Busca la cuenta por su portal, la persona por su correo y el cliente por la ficha abierta, y como ella llama a conta_portal_invitar (administrador o encargado). El correo lo manda conta-portal («bitrix_invitar»). Estados: ok, no, sin_acceso, sin_enlazar, varias_cuentas, ficha_rara.';
comment on function public.conta_portal_bitrix_contestar(text, text, text, text, text) is
  'GP · «Contestar» un mensaje del portal desde la pestaña de Bitrix24 (Code 4). Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Como la persona, llama a conta_portal_mensaje_enviar y deja leído lo del cliente; el aviso al cliente lo manda el cron. Estados: ok, no, sin_acceso, sin_enlazar, varias_cuentas, ficha_rara.';
