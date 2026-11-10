-- supabase/migrations/20261110T0055_g05_devuelto_pagar.sql
--
-- G05 · nº 68 y nº 71, punto 2 · UN RECIBO DEVUELTO, DESDE LA GESTORÍA:
-- «Enviarle el enlace para pagar» y «Que lo pasen de nuevo». Para la ficha del
-- recibo y para la pestaña de Bitrix24 de Code 4.
--
-- Lo que hace cada botón lo hace conta-cobro (correo y GoCardless); aquí, lo que
-- se puede hacer y su rastro:
--   1. conta_recibo_devuelto_opciones(recibo): de un administrador o un
--      encargado. Qué se puede hacer con ese devuelto y, si no, por qué:
--        · el enlace: devuelto o retrocedido, sin pagar ya en el portal y con
--          alguien del cliente que pueda pagar en su espacio («todo»);
--        · pasarlo de nuevo: solo un devuelto por el banco (GoCardless «failed»)
--          que aún no se ha contabilizado como cobrado, sin pagar ya en el
--          portal, con una conexión de PRUEBAS (el sandbox) y menos de tres
--          veces (lo que deja GoCardless).
--   2. _conta_recibo_devuelto_opciones(recibo): lo mismo sin mirar quién llama;
--      solo el servidor.
--   3. _conta_recibo_devuelto_hecho(recibo, que, gc_estado, detalle, quien):
--      solo el servidor, después de mandar el correo o de que GoCardless acepte
--      el reintento. Apunta el evento del recibo y, al pasarlo de nuevo, su
--      estado nuevo: en el recibo y en lo leído de GoCardless
--      (conta_gc_cobro), para que «seguir» no lo vuelva a dar por devuelto
--      antes de la lectura siguiente.
--   4. _conta_usuario_cobra(usuario, cuenta): solo el servidor. Si una persona
--      es administradora o encargada activa de la cuenta: para cuando llama el
--      servidor de la pestaña de Bitrix24 en su nombre.
-- No cambia ninguna función de antes. Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0055_g05_devuelto_pagar.down.sql

create or replace function public._conta_recibo_devuelto_opciones(p_recibo uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_cliente text; v_pagado boolean; v_veces int; v_personas jsonb;
  v_enlace text; v_pasar text;
begin
  select * into v_r from public.conta_recibo where id = p_recibo;
  if v_r.id is null then return null; end if;
  select name into v_cliente from public.party where id = v_r.party_id;
  v_pagado := public._conta_portal_devuelto_pagado(v_r.id);
  -- Las veces que se ha vuelto a pasar: desde la gestoría y desde el portal del cliente.
  select (select count(*) from public.conta_recibo_evento where recibo_id = v_r.id and tipo = 'pasado_de_nuevo')
       + (select count(*) from public.conta_portal_operacion where recibo_id = v_r.id and tipo = 'reintentar' and estado = 'hecha') into v_veces;
  select coalesce(jsonb_agg(jsonb_build_object('acceso_id', a.id, 'para', lower(a.correo), 'nombre', a.nombre) order by a.nombre, a.correo), '[]'::jsonb) into v_personas
    from public.conta_portal_acceso a
   where a.account_id = v_r.account_id and a.party_id = v_r.party_id and a.revocado_at is null and a.permiso = 'todo';

  v_enlace := case
    when v_r.estado not in ('devuelto', 'retrocedido') then 'Este recibo no está devuelto.'
    when v_pagado then 'Ya lo ha pagado desde su espacio.'
    when jsonb_array_length(v_personas) = 0 then 'Nadie de este cliente puede pagar en su espacio: invítalo primero.'
  end;
  v_pasar := case
    when v_r.estado = 'retrocedido' then 'Lo reclamó el cliente a su banco: no se vuelve a pasar. Mándale el enlace para pagar.'
    when v_r.estado <> 'devuelto' then 'Este recibo no está devuelto.'
    when v_pagado then 'Ya lo ha pagado desde su espacio.'
    when v_r.gc_estado is distinct from 'failed' or v_r.gc_cobro_id is null then 'Solo se vuelve a pasar un recibo que devolvió el banco.'
    when v_r.asiento_cobro is not null then 'Ya estaba contabilizado como cobrado: mándale el enlace para pagar.'
    when v_r.entorno is distinct from 'pruebas' then 'Por ahora solo se vuelve a pasar con una conexión de pruebas de GoCardless (el sandbox). Con la cuenta real no se cobra nada.'
    when v_veces >= 3 then 'Ya se ha pasado de nuevo tres veces: GoCardless no deja más. Mándale el enlace para pagar.'
  end;
  return jsonb_build_object(
    'recibo_id', v_r.id, 'empresa_id', v_r.company_id, 'cliente_id', v_r.party_id, 'cliente', v_cliente, 'mes', v_r.mes,
    'importe_cent', coalesce(v_r.cobrar_cent, v_r.total_cent), 'estado', v_r.estado, 'gc_estado', v_r.gc_estado,
    'gc_cobro_id', v_r.gc_cobro_id, 'entorno', v_r.entorno, 'pagado_en_el_portal', v_pagado, 'veces_pasado', v_veces,
    'personas', v_personas,
    'enlace', jsonb_build_object('puede', v_enlace is null, 'porque', v_enlace),
    'pasar', jsonb_build_object('puede', v_pasar is null, 'porque', v_pasar));
end $$;
revoke all on function public._conta_recibo_devuelto_opciones(uuid) from public, anon, authenticated;
grant execute on function public._conta_recibo_devuelto_opciones(uuid) to service_role;

create or replace function public.conta_recibo_devuelto_opciones(p_recibo uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.conta_recibo where id = p_recibo;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado de la cuenta lo puede hacer.' using errcode = '42501'; end if;
  return public._conta_recibo_devuelto_opciones(p_recibo);
end $$;
revoke all on function public.conta_recibo_devuelto_opciones(uuid) from public, anon;
grant execute on function public.conta_recibo_devuelto_opciones(uuid) to authenticated, service_role;

create or replace function public._conta_recibo_devuelto_hecho(p_recibo uuid, p_que text, p_gc_estado text, p_detalle jsonb, p_quien text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_r public.conta_recibo; v_nuevo text; v_texto text;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if p_que = 'enlace' then
    v_texto := 'Enviado el enlace para pagar' || coalesce(' a ' || nullif(p_detalle->>'a', ''), '') || '.';
    perform public._conta_cobro_evento(v_r.id, 'enlace_para_pagar', v_texto, p_detalle, p_quien);
    return jsonb_build_object('frase', v_texto, 'estado', v_r.estado);
  elsif p_que = 'pasado' then
    if v_r.estado <> 'devuelto' or v_r.gc_estado is distinct from 'failed' then
      raise exception 'Ese recibo ya no está devuelto: no se apunta.' using errcode = '23514';
    end if;
    v_nuevo := public._conta_cobro_estado(coalesce(p_gc_estado, 'pending_submission'), v_r.invoice_id is not null);
    update public.conta_recibo set gc_estado = coalesce(p_gc_estado, 'pending_submission'), estado = v_nuevo, updated_at = now() where id = v_r.id;
    update public.conta_gc_cobro set estado = coalesce(p_gc_estado, 'pending_submission') where company_id = v_r.company_id and gc_id = v_r.gc_cobro_id;
    v_texto := 'Pasado de nuevo en GoCardless' || coalesce(', para el ' || to_char((p_detalle->>'cargo_el')::date, 'DD/MM/YYYY'), '') || '.';
    perform public._conta_cobro_evento(v_r.id, 'pasado_de_nuevo', v_texto, p_detalle, p_quien);
    return jsonb_build_object('frase', v_texto, 'estado', v_nuevo);
  end if;
  raise exception 'Eso no se apunta aquí.' using errcode = '22023';
end $$;
revoke all on function public._conta_recibo_devuelto_hecho(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public._conta_recibo_devuelto_hecho(uuid, text, text, jsonb, text) to service_role;

create or replace function public._conta_usuario_cobra(p_usuario uuid, p_account uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_profiles me
                  where me.user_id = p_usuario and me.account_id = p_account
                    and me.role = any (array['admin', 'manager']) and me.active = true)
$$;
revoke all on function public._conta_usuario_cobra(uuid, uuid) from public, anon, authenticated;
grant execute on function public._conta_usuario_cobra(uuid, uuid) to service_role;

comment on function public.conta_recibo_devuelto_opciones(uuid) is
  'G05 · nº 71 · Lo que se puede hacer con un recibo devuelto (enviarle el enlace para pagar, pasarlo de nuevo) y, si no, por qué. De un administrador o un encargado.';
