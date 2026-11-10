-- cambia: public.conta_gestoria_diferencia · prueba: supabase/staging/sql/20261110_gb_bitrix_choques_prueba.sql
-- supabase/migrations/20261110T0050_gb_bitrix_choques.sql
--
-- GB · nº 13, punto 2 · Un choque con Bitrix24 va a «Pendiente de revisar» de
-- Sumied, no solo a lo apuntado de la pestaña.
--
-- Cuando la pestaña va a escribir en la ficha de Bitrix24 (la «Cuota mensual»,
-- «Trabajadores» o «Estado del cobro») y alguien lo ha cambiado allí a mano,
-- no se pisa nunca. Desde hoy, además, sale como diferencia del cliente:
--   1. conta_gestoria_diferencia: un tipo nuevo, «bitrix_cambiado». El CHECK
--      solo AMPLÍA (los 20 de producción, medidos el 10/11 a las 00:30Z, y el
--      nuevo). La lectura de cada noche no lo renueva (no es de sus tipos): se
--      quita con «Ya lo he revisado» o cuando la pestaña vuelve a escribir ese
--      campo sin choque.
--   2. conta_bitrix_pestana_choque(cambio, empresa, choques, escritos): solo el
--      servidor (conta-bitrix-pestana), después de escribir en Bitrix24.
--      · Cada choque: una diferencia del cliente de la ficha (una por campo:
--        si ya había una sin revisar de ese campo, se pone al día).
--      · Cada campo escrito sin choque: la suya, si la había, deja de estar.
--      Va con la última lectura del CRM de la cuenta (la diferencia la pide);
--      sin ninguna, no apunta nada y lo dice.
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261110T0050_gb_bitrix_choques.down.sql

alter table public.conta_gestoria_diferencia drop constraint if exists conta_gestoria_diferencia_tipo_check;
alter table public.conta_gestoria_diferencia add constraint conta_gestoria_diferencia_tipo_check check (tipo = any (array[
  'crm_sin_cobro', 'gocardless_sin_ficha', 'emisor_distinto', 'nif_repetido_en_crm', 'correo_repetido_en_crm', 'nif_distinto',
  'suscripcion_sin_convertir', 'totales_distintos', 'mandato_por_firmar', 'falla_a_menudo', 'abono_en_otra_cuenta',
  'fichas_repetidas', 'nif_no_valido', 'ficha_no_guardada', 'contacto_solo_negociacion', 'contacto_empresa_con_datos',
  'ya_no_es_cliente_en_crm', 'falta_codigo_cliente', 'cliente_no_de_acuerdo', 'falta_cuenta_stripe',
  'bitrix_cambiado']));

create or replace function public.conta_bitrix_pestana_choque(p_cambio uuid, p_empresa uuid, p_choques jsonb, p_escritos text[])
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_c public.conta_bitrix_pestana_cambio; v_lectura uuid; v_x jsonb; v_id uuid; v_porque text; v_n int := 0; v_quitadas int := 0;
begin
  select * into v_c from public.conta_bitrix_pestana_cambio where id = p_cambio;
  if v_c.id is null then return jsonb_build_object('apuntadas', 0, 'porque', 'Ese cambio no existe.'); end if;
  if p_empresa is null or not exists (select 1 from public.company where id = p_empresa and account_id = v_c.account_id) then
    return jsonb_build_object('apuntadas', 0, 'porque', 'Esa empresa no es de la cuenta.');
  end if;

  -- Lo escrito sin choque: su diferencia, si la había, ya no está.
  update public.conta_gestoria_diferencia set vigente = false
   where account_id = v_c.account_id and party_id = v_c.party_id and tipo = 'bitrix_cambiado' and vigente
     and datos->>'campo' = any (coalesce(p_escritos, '{}'::text[]));
  get diagnostics v_quitadas = row_count;

  if coalesce(jsonb_array_length(p_choques), 0) = 0 then return jsonb_build_object('apuntadas', 0, 'quitadas', v_quitadas); end if;
  select l.id into v_lectura from public.conta_gestoria_lectura l
   where l.account_id = v_c.account_id and l.origen = 'crm' order by l.empezada_at desc limit 1;
  if v_lectura is null then
    return jsonb_build_object('apuntadas', 0, 'quitadas', v_quitadas, 'porque', 'La cuenta no ha leído nunca su CRM: no hay dónde apuntarlo.');
  end if;

  for v_x in select * from jsonb_array_elements(p_choques) loop
    if coalesce(v_x->>'campo', '') = '' then continue; end if;
    v_porque := format('En Bitrix24 alguien ha cambiado «%s» a «%s»; Sumied dice «%s». No se ha pisado: mira cuál vale.',
      v_x->>'campo', coalesce(nullif(v_x->>'en_bitrix', ''), 'vacío'), v_x->>'sumied');
    select id into v_id from public.conta_gestoria_diferencia
     where account_id = v_c.account_id and party_id = v_c.party_id and tipo = 'bitrix_cambiado' and vigente and datos->>'campo' = v_x->>'campo'
     order by created_at desc limit 1;
    if v_id is null then
      insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, party_id, bitrix_id, crm, tipo_ficha, id_externo,
        tipo, porque_codigo, porque, datos)
      values (v_c.account_id, v_lectura, p_empresa, v_c.party_id, v_c.id_externo, 'bitrix24', v_c.tipo_ficha, v_c.id_externo,
        'bitrix_cambiado', 'bitrix_cambiado', v_porque,
        jsonb_build_object('campo', v_x->>'campo', 'en_bitrix', v_x->>'en_bitrix', 'sumied', v_x->>'sumied', 'cambio', p_cambio));
    else
      update public.conta_gestoria_diferencia set porque = v_porque, company_id = p_empresa,
        datos = jsonb_build_object('campo', v_x->>'campo', 'en_bitrix', v_x->>'en_bitrix', 'sumied', v_x->>'sumied', 'cambio', p_cambio)
       where id = v_id;
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('apuntadas', v_n, 'quitadas', v_quitadas);
end $$;

revoke all on function public.conta_bitrix_pestana_choque(uuid, uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_choque(uuid, uuid, jsonb, text[]) to service_role;

comment on function public.conta_bitrix_pestana_choque(uuid, uuid, jsonb, text[]) is
  'GB (nº 13) · Un choque con Bitrix24 al guardar desde la pestaña (un dato cambiado allí a mano, que no se pisa) va a «Pendiente de revisar» del cliente (tipo bitrix_cambiado, una por campo); un campo escrito sin choque quita la suya. Solo el servidor (conta-bitrix-pestana).';
