-- supabase/migrations/20261109T1905_gb_bitrix_pestana.sql
--
-- GB · La pestaña «Sumied» dentro de la ficha de Bitrix24 (primera parte: solo
-- ver). Julio, nº 2 del GB (09/11): no se copia la lectura del G04; se lee
-- ACTUANDO COMO la persona de Sumied, igual que las siembras del GD.
--
-- Añade UNA función, conta_bitrix_pestana_leer(portal, correo, tipo, ficha),
-- que solo puede llamar el servidor (service_role). La llama la función
-- conta-bitrix-pestana DESPUÉS de comprobar con Bitrix24 quién mira (user.current)
-- y que el token es de la aplicación de Sumied (app.info). Dentro:
--   1. la cuenta: la que tiene ese portal conectado (conta_crm.portal);
--   2. la persona: la de esa cuenta, activa, con ese correo (auth.users);
--      si no hay ninguna, «sin_acceso» y nada más;
--   3. actúa como ella, en esa cuenta («usuario:cuenta», DM1), y
--   4. busca el cliente de esa ficha (conta_gestoria_ficha: empresa o contacto)
--      y devuelve lo que pintan Clientes y la ficha del G04, llamando a SUS
--      funciones (conta_pantalla_clientes y conta_pantalla_ficha), que vuelven a
--      comprobar la cuenta con belongs_to_account. Cada uno ve lo que ve en Sumied.
-- Solo lee: no escribe en ninguna tabla. No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T1905_gb_bitrix_pestana.down.sql

create or replace function public.conta_bitrix_pestana_leer(p_portal text, p_correo text, p_tipo text, p_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int;
  v_cliente uuid; v_de_empresa text;
begin
  if p_tipo is null or p_tipo not in ('empresa', 'contacto') or v_id !~ '^[0-9]{1,18}$' then
    return jsonb_build_object('estado', 'ficha_rara');
  end if;
  if v_portal = '' or v_correo = '' then
    return jsonb_build_object('estado', 'sin_acceso');
  end if;
  if not exists (select 1 from public.conta_crm c where c.crm = 'bitrix24' and lower(c.portal) = v_portal) then
    return jsonb_build_object('estado', 'portal_desconocido');
  end if;

  -- La persona: de una cuenta con ese portal conectado, activa, con ese correo.
  select count(*), min(c.account_id::text)::uuid into v_n, v_cuenta
    from public.conta_crm c
    join public.user_profiles up on up.account_id = c.account_id and up.active
    join auth.users u on u.id = up.user_id and lower(u.email) = v_correo
   where c.crm = 'bitrix24' and lower(c.portal) = v_portal;
  if v_n = 0 then return jsonb_build_object('estado', 'sin_acceso'); end if;
  if v_n > 1 then return jsonb_build_object('estado', 'varias_cuentas'); end if;
  select up.user_id, up.display_name into v_usuario, v_quien
    from public.user_profiles up join auth.users u on u.id = up.user_id
   where up.account_id = v_cuenta and up.active and lower(u.email) = v_correo
   limit 1;

  -- Como esa persona, en esa cuenta (DM1: «usuario:cuenta»), solo en esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_usuario::text || ':' || v_cuenta::text, true);

  -- El cliente de esa ficha: la suya primero; si es una persona de contacto de una empresa cliente, el de la empresa.
  select f.party_id, f.de_empresa into v_cliente, v_de_empresa
    from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa
   limit 1;
  if v_cliente is null then
    select g.party_id, '' into v_cliente, v_de_empresa from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;

  if v_cliente is null then
    return jsonb_build_object('estado', 'sin_enlazar', 'cuenta', v_cuenta, 'quien', v_quien,
      'cuenta_nombre', (select a.name from public.accounts a where a.id = v_cuenta));
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'cuenta', v_cuenta,
    'cuenta_nombre', (select a.name from public.accounts a where a.id = v_cuenta),
    'quien', v_quien,
    'cliente', v_cliente,
    'cliente_nombre', (select p.name from public.party p where p.id = v_cliente and p.account_id = v_cuenta),
    'de_empresa', nullif(v_de_empresa, ''),
    'empresas', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', coalesce(nullif(c.trade_name, ''), c.legal_name)) order by c.created_at)
        from public.company c where c.account_id = v_cuenta and c.is_active and public.belongs_to_account(v_cuenta)), '[]'::jsonb),
    'clientes', public.conta_pantalla_clientes(v_cuenta),
    'ficha', public.conta_pantalla_ficha(v_cuenta, v_cliente));
end $$;

revoke all on function public.conta_bitrix_pestana_leer(text, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_leer(text, text, text, text) to service_role;

comment on function public.conta_bitrix_pestana_leer(text, text, text, text) is
  'GB · La pestaña «Sumied» de la ficha de Bitrix24, en una sola lectura. Solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Busca la cuenta por su portal, la persona por su correo (activa en esa cuenta) y, actuando como ella («usuario:cuenta»), el cliente de la ficha y lo que leen Clientes y la ficha del G04 (sus funciones, sin copia). Estados: ok, sin_acceso, sin_enlazar, portal_desconocido, varias_cuentas, ficha_rara. Solo lee.';
