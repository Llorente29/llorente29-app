-- supabase/migrations/20261109T1500_g05_t4_parar_recibo.sql
-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261109_g05_t4_prueba.sql
--
-- G05 · Tarea 4 · PARAR UN RECIBO DESDE EL PORTAL (Julio, nº 46; lo llama
-- Code 3 desde el portal del cliente).
-- CAMBIA (declarado arriba) el CHECK de conta_gestoria_diferencia.tipo: solo
-- AMPLÍA, con «cliente_no_de_acuerdo». Y AÑADE dos funciones:
--   1. conta_recibo_parar(recibo, motivo, quien): el cliente dice que no está
--      de acuerdo. El recibo, que aún no se ha enviado, sale del cobro: lleva
--      en «parado» «El cliente no está de acuerdo: «motivo»» (así no se puede
--      aprobar, y «Revisar el cobro» lo enseña en «No entran en este cobro»);
--      su incidencia queda en «Pendiente de revisar» de la ficha del cliente, y
--      su historial lo apunta. Pararlo otra vez cambia el motivo (no duplica).
--      La llama el portal desde su servidor (service_role, después de
--      comprobar que el recibo es de ese cliente) o una persona de la gestoría.
--   2. conta_recibo_reanudar(recibo): la gestoría lo deshace («Volver a
--      cobrar»): fuera la marca, la incidencia deja de estar vigente, vuelve a
--      «por revisar» y su historial lo apunta.
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1500_g05_t4_parar_recibo.down.sql

alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm', 'falta_codigo_cliente', 'cliente_no_de_acuerdo']));

/** El principio de la marca en «parado» de un recibo que el cliente ha parado. */
create or replace function public._conta_recibo_marca_cliente()
returns text language sql immutable as $$ select 'El cliente no está de acuerdo'::text $$;

create or replace function public.conta_recibo_parar(p_recibo uuid, p_motivo text, p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_recibo; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_marca text; v_nombre text; v_lectura uuid;
  v_quien text; v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null or not (v_servidor or public.belongs_to_account(v_r.account_id)) then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if not (v_servidor or public.current_user_is_admin_or_manager_of(v_r.account_id)) then
    raise exception 'Un recibo lo para su cliente desde el portal, o la gestoría.' using errcode = '42501';
  end if;
  if v_motivo is null then raise exception 'Di por qué no estás de acuerdo.' using errcode = '22023'; end if;
  if length(v_motivo) > 500 then raise exception 'El motivo, de 500 letras como mucho.' using errcode = '22023'; end if;
  if v_r.estado <> 'preparado' then
    raise exception 'Este recibo ya se ha enviado al banco: ya no se puede parar desde aquí. Habla con tu gestoría.' using errcode = '23514';
  end if;
  v_quien := coalesce(nullif(btrim(coalesce(p_quien, '')), ''), case when v_servidor then 'El cliente, desde el portal' else public.conta_nombre_actor() end);
  v_marca := format('%s: «%s»', public._conta_recibo_marca_cliente(), v_motivo);
  update public.conta_recibo
     set parado = array_append(array(select x from unnest(parado) x where x not like public._conta_recibo_marca_cliente() || '%'), v_marca),
         decision = case when decision = 'aprobado' then 'pendiente' else decision end, updated_at = now()
   where id = p_recibo;
  -- Su incidencia, una sola: la de antes deja de estar vigente y entra la de ahora.
  update public.conta_gestoria_diferencia set vigente = false
   where company_id = v_r.company_id and tipo = 'cliente_no_de_acuerdo' and vigente and datos->>'recibo' = p_recibo::text;
  select id into v_lectura from public.conta_gestoria_lectura where account_id = v_r.account_id and (company_id = v_r.company_id or company_id is null)
   order by empezada_at desc limit 1;
  if v_lectura is null then raise exception 'Esta empresa aún no tiene ninguna lectura de clientes: no hay dónde apuntar la incidencia.' using errcode = '23514'; end if;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, tipo, porque_codigo, porque, datos)
  values (v_r.account_id, v_lectura, v_r.company_id, v_r.party_id, 'cliente_no_de_acuerdo', 'parado_por_el_cliente',
          format('El cliente no está de acuerdo con el recibo de %s (%s): «%s». No se cobra hasta que lo revises; «Volver a cobrar» en «Revisar el cobro» lo deshace.',
                 v_r.mes, public._conta_gestoria_euros(coalesce(v_r.cobrar_cent, v_r.total_cent) / 100.0), v_motivo),
          jsonb_build_object('recibo', p_recibo, 'mes', v_r.mes, 'motivo', v_motivo, 'quien', v_quien));
  perform public._conta_cobro_evento(p_recibo, 'parado_cliente', format('Parado: el cliente no está de acuerdo («%s»).', v_motivo), jsonb_build_object('motivo', v_motivo), v_quien);
  select name into v_nombre from public.party where id = v_r.party_id;
  return jsonb_build_object('id', p_recibo, 'parado', true,
    'frase', format('Parado el recibo de %s de %s: no se cobra hasta que la gestoría lo revise.', public._conta_gestoria_euros(coalesce(v_r.cobrar_cent, v_r.total_cent) / 100.0), v_r.mes));
end $$;
revoke all on function public.conta_recibo_parar(uuid, text, text) from public, anon;
grant execute on function public.conta_recibo_parar(uuid, text, text) to authenticated, service_role;
comment on function public.conta_recibo_parar(uuid, text, text) is
  'G05 · nº 46 · El cliente para un recibo aún sin enviar («No estoy de acuerdo»): sale del cobro (marca en parado), su incidencia en «Pendiente de revisar» y su historial. Desde el portal (service_role) o la gestoría. Lo deshace conta_recibo_reanudar.';

create or replace function public.conta_recibo_reanudar(p_recibo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.conta_recibo; v_quien text := public.conta_nombre_actor(); v_nombre text;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null or not public.belongs_to_account(v_r.account_id) then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_r.account_id) then raise exception 'Solo un administrador o un encargado decide el cobro.' using errcode = '42501'; end if;
  if not exists (select 1 from unnest(v_r.parado) x where x like public._conta_recibo_marca_cliente() || '%') then
    raise exception 'Este recibo no lo ha parado su cliente.' using errcode = '23514';
  end if;
  if v_r.estado <> 'preparado' then raise exception 'Ese recibo ya se ha enviado: no se puede cambiar.' using errcode = '23514'; end if;
  update public.conta_recibo set parado = array(select x from unnest(parado) x where x not like public._conta_recibo_marca_cliente() || '%'),
         decision = 'pendiente', decidido_por_name = v_quien, decidido_at = now(), updated_at = now()
   where id = p_recibo;
  update public.conta_gestoria_diferencia set vigente = false
   where company_id = v_r.company_id and tipo = 'cliente_no_de_acuerdo' and vigente and datos->>'recibo' = p_recibo::text;
  perform public._conta_cobro_evento(p_recibo, 'reanudado', 'Revisado: vuelve al cobro, por revisar.', null, v_quien);
  select name into v_nombre from public.party where id = v_r.party_id;
  return jsonb_build_object('id', p_recibo, 'frase', format('%s vuelve al cobro de %s, por revisar: apruébalo cuando lo tengas claro.', coalesce(v_nombre, 'El recibo'), v_r.mes));
end $$;
revoke all on function public.conta_recibo_reanudar(uuid) from public, anon;
grant execute on function public.conta_recibo_reanudar(uuid) to authenticated;
comment on function public.conta_recibo_reanudar(uuid) is
  'G05 · nº 46 · La gestoría deshace lo que paró el cliente («Volver a cobrar»): fuera la marca, la incidencia deja de estar vigente y vuelve a por revisar.';
