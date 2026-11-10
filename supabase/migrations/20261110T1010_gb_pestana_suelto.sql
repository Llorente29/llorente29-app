-- supabase/migrations/20261110T1010_gb_pestana_suelto.sql
--
-- GB · nº 17, B · «Facturar un trabajo» (un trabajo fuera de la cuota) desde la
-- pestaña «Sumied» de Bitrix24, con lo de Code 1 (0700: conta_trabajos_sueltos
-- y conta_trabajo_suelto_poner). Solo «Sumarlo al recibo»: «Cobrarlo aparte»
-- espera a la decisión de Julio. VA DESPUÉS DE LA 0950 (#581): apunta con su
-- acción «suelto».
--
-- Solo añade dos funciones, solo el servidor, DESPUÉS de comprobar con
-- Bitrix24 al usuario y la aplicación. Quién mira y el cliente de la ficha, con
-- la de Code 3 (_conta_portal_bitrix_quien); actúan como la persona, y las de
-- Code 1 comprueban que es administradora o encargada:
--   1. conta_bitrix_pestana_sueltos(portal, correo, tipo, ficha, empresa): los
--      servicios que se cobran «cada vez», con su precio, y los trabajos sueltos
--      del cliente de este mes en adelante; quien solo puede ver, «sin_permiso».
--   2. conta_bitrix_pestana_suelto_poner(portal, correo, tipo, ficha, empresa,
--      servicio, concepto, importe): lo suma al próximo recibo y lo apunta en lo
--      hecho desde la pestaña, con lo que necesita la función para Bitrix24.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1010_gb_pestana_suelto.down.sql

create or replace function public.conta_bitrix_pestana_sueltos(p_portal text, p_correo text, p_tipo text, p_id text, p_empresa uuid)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q->>'estado' <> 'ok' then return v_q; end if;
  if p_empresa is null or not exists (select 1 from public.company where id = p_empresa and account_id = (v_q->>'cuenta')::uuid) then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa empresa no es de esta cuenta.');
  end if;
  begin
    return jsonb_build_object('estado', 'ok') || public.conta_trabajos_sueltos(p_empresa, (v_q->>'cliente')::uuid);
  exception
    when insufficient_privilege then return jsonb_build_object('estado', 'sin_permiso');
    when others then return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;
end $$;

create or replace function public.conta_bitrix_pestana_suelto_poner(p_portal text, p_correo text, p_tipo text, p_id text, p_empresa uuid,
  p_servicio uuid, p_concepto text default null, p_importe numeric default null)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_r jsonb; v_cambio uuid; v_cuenta uuid; v_cliente uuid;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q->>'estado' <> 'ok' then return v_q; end if;
  v_cuenta := (v_q->>'cuenta')::uuid; v_cliente := (v_q->>'cliente')::uuid;
  if p_empresa is null or not exists (select 1 from public.company where id = p_empresa and account_id = v_cuenta) then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Esa empresa no es de esta cuenta.');
  end if;
  begin
    v_r := public.conta_trabajo_suelto_poner(p_empresa, v_cliente, p_servicio, p_concepto, p_importe);
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', 'Puedes ver, pero no cambiar lo que se cobra: pídeselo a un administrador o a un encargado de la cuenta.');
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, resultado_id, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, trim(p_id), 'suelto',
          jsonb_build_object('servicio', p_servicio, 'concepto', v_r->>'concepto', 'importe', v_r->'importe', 'mes', v_r->>'mes'),
          coalesce(v_r->>'frase', ''), nullif(v_r->>'id', '')::uuid, (v_q->>'usuario')::uuid, v_q->>'quien')
  returning id into v_cambio;
  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'cambio', v_cambio, 'id', v_r->>'id', 'empresa', p_empresa, 'cliente', v_cliente,
    'mes', v_r->>'mes', 'concepto', v_r->>'concepto', 'importe', v_r->'importe',
    'bitrix', public._conta_bitrix_pestana_bitrix_de(v_cuenta, p_tipo, trim(p_id)));
end $$;

revoke all on function public.conta_bitrix_pestana_sueltos(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_suelto_poner(text, text, text, text, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_sueltos(text, text, text, text, uuid) to service_role;
grant execute on function public.conta_bitrix_pestana_suelto_poner(text, text, text, text, uuid, uuid, text, numeric) to service_role;

comment on function public.conta_bitrix_pestana_sueltos(text, text, text, text, uuid) is
  'GB (nº 17) · Los servicios «cada vez» con su precio y los trabajos sueltos del cliente de la ficha abierta en Bitrix24 (conta_trabajos_sueltos, de Code 1), como la persona. Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación.';
comment on function public.conta_bitrix_pestana_suelto_poner(text, text, text, text, uuid, uuid, text, numeric) is
  'GB (nº 17) · «Facturar un trabajo» desde la pestaña de Bitrix24: lo suma al próximo recibo con conta_trabajo_suelto_poner (Code 1), como la persona, y lo apunta. Solo el servidor.';
