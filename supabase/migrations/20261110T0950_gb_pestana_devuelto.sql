-- cambia: public.conta_bitrix_pestana_cambio · prueba: supabase/staging/sql/20261110_gb_pestana_devuelto_prueba.sql
-- supabase/migrations/20261110T0950_gb_pestana_devuelto.sql
--
-- GB · nº 17, A · El recibo devuelto en la pestaña «Sumied» de Bitrix24:
-- «Enviarle el enlace para pagar» y «Que lo pasen de nuevo», con lo de Code 1
-- (0055: _conta_recibo_devuelto_opciones, y conta-cobro, que manda el correo o
-- pide el reintento a GoCardless en nombre de la persona). VA DESPUÉS DE LA
-- 0070 (#570): el CHECK de las acciones parte de la suya.
--
--   1. conta_bitrix_pestana_cambio: las acciones «devuelto» y «suelto» (el
--      CHECK solo AMPLÍA: alta, baja, tarifa, deshacer, y las dos nuevas; la de
--      «suelto» es para el trabajo suelto, que va en el PR siguiente).
--   2. conta_bitrix_pestana_devueltos(portal, correo, tipo, ficha): solo el
--      servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación.
--      Quién mira y el cliente de la ficha, con la de Code 3
--      (_conta_portal_bitrix_quien); sus recibos devueltos o retrocedidos (los
--      últimos cinco), con lo que se puede hacer con cada uno y por qué no
--      (_conta_recibo_devuelto_opciones), y si la persona puede hacerlo
--      (administradora o encargada, _conta_usuario_cobra).
--   3. conta_bitrix_pestana_devuelto_hecho(portal, correo, tipo, ficha, recibo,
--      que, frase): solo el servidor, DESPUÉS de que conta-cobro lo haya hecho.
--      Lo apunta en lo hecho desde la pestaña y devuelve lo que necesita la
--      función para poner al día la ficha de Bitrix24 sin pisar nada.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0950_gb_pestana_devuelto.down.sql

alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa', 'deshacer', 'devuelto', 'suelto'));

create or replace function public.conta_bitrix_pestana_devueltos(p_portal text, p_correo text, p_tipo text, p_id text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_cuenta uuid; v_cliente uuid; v_usuario uuid;
begin
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q->>'estado' <> 'ok' then return v_q; end if;
  v_cuenta := (v_q->>'cuenta')::uuid; v_cliente := (v_q->>'cliente')::uuid; v_usuario := (v_q->>'usuario')::uuid;
  return jsonb_build_object('estado', 'ok', 'usuario', v_usuario, 'cliente', v_cliente,
    'puede', public._conta_usuario_cobra(v_usuario, v_cuenta),
    'devueltos', coalesce((select jsonb_agg(public._conta_recibo_devuelto_opciones(r.id) order by r.mes desc, r.id)
        from (select id, mes from public.conta_recibo
               where account_id = v_cuenta and party_id = v_cliente and estado in ('devuelto', 'retrocedido')
               order by mes desc, id limit 5) r), '[]'::jsonb));
end $$;

create or replace function public.conta_bitrix_pestana_devuelto_hecho(p_portal text, p_correo text, p_tipo text, p_id text,
  p_recibo uuid, p_que text, p_frase text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v_q jsonb; v_r public.conta_recibo; v_cambio uuid;
begin
  if p_que is null or p_que not in ('enlace', 'pasar') then return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Eso no se apunta aquí.'); end if;
  v_q := public._conta_portal_bitrix_quien(p_portal, p_correo, p_tipo, p_id);
  if v_q->>'estado' <> 'ok' then return v_q; end if;
  select * into v_r from public.conta_recibo where id = p_recibo;
  if v_r.id is null or v_r.account_id <> (v_q->>'cuenta')::uuid or v_r.party_id <> (v_q->>'cliente')::uuid then
    return jsonb_build_object('estado', 'no_se_pudo', 'frase', 'Ese recibo no es de este cliente.');
  end if;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, hecho_por, hecho_por_nombre)
  values (v_r.account_id, v_r.party_id, p_tipo, trim(p_id), 'devuelto', jsonb_build_object('recibo', p_recibo, 'que', p_que, 'mes', v_r.mes),
          coalesce(p_frase, ''), (v_q->>'usuario')::uuid, v_q->>'quien')
  returning id into v_cambio;
  return jsonb_build_object('estado', 'ok', 'cambio', v_cambio, 'empresa', v_r.company_id, 'cliente', v_r.party_id, 'mes', v_r.mes,
    'bitrix', public._conta_bitrix_pestana_bitrix_de(v_r.account_id, p_tipo, trim(p_id)));
end $$;

revoke all on function public.conta_bitrix_pestana_devueltos(text, text, text, text) from public, anon, authenticated;
revoke all on function public.conta_bitrix_pestana_devuelto_hecho(text, text, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_devueltos(text, text, text, text) to service_role;
grant execute on function public.conta_bitrix_pestana_devuelto_hecho(text, text, text, text, uuid, text, text) to service_role;

comment on function public.conta_bitrix_pestana_devueltos(text, text, text, text) is
  'GB (nº 17) · Los recibos devueltos del cliente de la ficha abierta en Bitrix24, con lo que se puede hacer con cada uno (_conta_recibo_devuelto_opciones, de Code 1) y si la persona puede (administradora o encargada). Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación.';
comment on function public.conta_bitrix_pestana_devuelto_hecho(text, text, text, text, uuid, text, text) is
  'GB (nº 17) · Apunta en lo hecho desde la pestaña de Bitrix24 un «enviarle el enlace» o «pasarlo de nuevo» que ya hizo conta-cobro, y devuelve lo que necesita la función para poner al día la ficha de Bitrix24. Solo el servidor.';
