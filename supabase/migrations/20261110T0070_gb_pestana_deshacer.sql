-- cambia: public.conta_bitrix_pestana_cambio · prueba: supabase/staging/sql/20261110_gb_pestana_deshacer_prueba.sql
-- supabase/migrations/20261110T0070_gb_pestana_deshacer.sql
--
-- GB · nº 13 · «Deshacer» en la pestaña «Sumied» de Bitrix24, con las funciones
-- de Code 1 (#562, 0010): conta_linea_operaciones_hoy y conta_linea_deshacer.
-- VA DESPUÉS DEL REAL DE LA 0010 (#562): sin ella, la pestaña dice que no se
-- puede deshacer y no cambia nada.
--
--   1. conta_bitrix_pestana_cambio: la acción «deshacer» (el CHECK solo
--      AMPLÍA: alta, baja, tarifa y deshacer, medido en producción el 10/11).
--   2. conta_bitrix_pestana_deshacer(portal, correo, tipo, ficha, empresa,
--      cuando): solo el servidor (conta-bitrix-pestana), DESPUÉS de comprobar
--      con Bitrix24 al usuario y la aplicación. Actúa como la persona (la misma
--      comprobación que la lectura), solo sobre el cliente de la ficha abierta:
--      · sin «cuando»: lo que se ha hecho hoy con sus líneas y si se puede
--        deshacer (conta_linea_operaciones_hoy);
--      · con «cuando»: lo deshace (conta_linea_deshacer, que comprueba que la
--        persona es administradora o encargada, que es de hoy, la última de esas
--        líneas y que no ha entrado en un recibo enviado) y lo apunta, con lo que
--        necesita la función para actualizar Bitrix24 sin pisar nada.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0070_gb_pestana_deshacer.down.sql

alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa', 'deshacer'));

create or replace function public.conta_bitrix_pestana_deshacer(p_portal text, p_correo text, p_tipo text, p_id text,
  p_empresa uuid, p_cuando timestamptz default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_portal text := lower(trim(coalesce(p_portal, '')));
  v_correo text := lower(trim(coalesce(p_correo, '')));
  v_id text := trim(coalesce(p_id, ''));
  v_cuenta uuid; v_usuario uuid; v_quien text; v_n int; v_cliente uuid; v_r jsonb; v_cambio uuid;
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

  -- El cliente de la ficha abierta, y una empresa de la cuenta.
  select f.party_id into v_cliente from public.conta_gestoria_ficha f
   where f.account_id = v_cuenta and f.crm = 'bitrix24' and f.tipo_ficha = p_tipo and f.id_externo = v_id
   order by (f.de_empresa = '') desc, f.de_empresa limit 1;
  if v_cliente is null then
    select g.party_id into v_cliente from public.conta_gestoria_cliente g
     where g.account_id = v_cuenta and g.crm = 'bitrix24' and g.tipo_ficha = p_tipo and g.id_externo = v_id;
  end if;
  if v_cliente is null then return jsonb_build_object('estado', 'sin_enlazar'); end if;
  if p_empresa is null or not exists (select 1 from public.company where id = p_empresa and account_id = v_cuenta) then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa empresa no es de esta cuenta.');
  end if;
  if to_regprocedure('public.conta_linea_deshacer(uuid,uuid,timestamptz)') is null then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Todavía no se puede deshacer desde aquí: hazlo en la ficha del cliente en Sumied.');
  end if;

  begin
    if p_cuando is null then
      return jsonb_build_object('estado', 'ok', 'operaciones', public.conta_linea_operaciones_hoy(p_empresa, v_cliente));
    end if;
    v_r := public.conta_linea_deshacer(p_empresa, v_cliente, p_cuando);
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.');
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, v_id, 'deshacer', jsonb_build_object('cuando', p_cuando, 'tipo', v_r->>'tipo', 'empresa', p_empresa),
          coalesce(v_r->>'frase', ''), v_usuario, v_quien)
  returning id into v_cambio;
  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'tipo', v_r->>'tipo', 'cambio', v_cambio, 'empresa', p_empresa, 'cliente', v_cliente,
    'bitrix', public._conta_bitrix_pestana_bitrix_de(v_cuenta, p_tipo, v_id));
end $$;

revoke all on function public.conta_bitrix_pestana_deshacer(text, text, text, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_deshacer(text, text, text, text, uuid, timestamptz) to service_role;

comment on function public.conta_bitrix_pestana_deshacer(text, text, text, text, uuid, timestamptz) is
  'GB (nº 13) · «Deshacer» en la pestaña de Bitrix24. Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación. Actúa como la persona: sin «cuando», lo hecho hoy con las líneas del cliente de la ficha abierta (conta_linea_operaciones_hoy, de Code 1); con «cuando», lo deshace (conta_linea_deshacer) y lo apunta.';
