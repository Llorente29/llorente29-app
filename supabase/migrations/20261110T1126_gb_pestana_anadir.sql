-- cambia: public.conta_bitrix_pestana_cambio · prueba: supabase/staging/sql/20261110_gb_pestana_anadir_prueba.sql
-- supabase/migrations/20261110T1126_gb_pestana_anadir.sql
--
-- GB · nº 17, G · «+ Añadir servicio o paquete» desde la pestaña «Sumied» de
-- Bitrix24 (maqueta «Trabajar desde Bitrix24»), con la función de siempre de la
-- ficha del G04 (conta_tarifa_servicio_anadir, 0930): un servicio (con su nivel,
-- si lo tiene) o un paquete, desde un mes, a precio de tarifa. VA DESPUÉS DE LA
-- 0950 (#581): amplía el CHECK que dejó ella.
--
--   1. Cambia en caliente (declarado arriba, con su prueba): el CHECK de las
--      acciones de conta_bitrix_pestana_cambio solo AMPLÍA («servicio»).
--   2. Añade conta_bitrix_pestana_anadir(portal, correo, tipo, ficha, empresa,
--      servicio, nivel, paquete, desde, ensayo): solo el servidor, DESPUÉS de
--      comprobar con Bitrix24 al usuario y la aplicación. Quién mira y el
--      cliente de la ficha, con la de Code 3 (_conta_portal_bitrix_quien);
--      actúa como la persona, y la del G04 comprueba que es administradora o
--      encargada y que la empresa tiene encendidos los cambios de tarifa. Con
--      ensayo, solo la frase («Se añadirá …»); sin él, lo añade y lo apunta con
--      lo que necesita la función para Bitrix24.
-- No toca nada del camino del pedido. No cambia ningún dato.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1126_gb_pestana_anadir.down.sql

alter table public.conta_bitrix_pestana_cambio drop constraint if exists conta_bitrix_pestana_cambio_accion_check;
alter table public.conta_bitrix_pestana_cambio add constraint conta_bitrix_pestana_cambio_accion_check
  check (accion in ('alta', 'baja', 'tarifa', 'deshacer', 'devuelto', 'suelto', 'servicio'));

create or replace function public.conta_bitrix_pestana_anadir(p_portal text, p_correo text, p_tipo text, p_id text, p_empresa uuid,
  p_servicio uuid, p_nivel uuid, p_paquete uuid, p_desde date, p_ensayo boolean default true)
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
    v_r := public.conta_tarifa_servicio_anadir(p_empresa, v_cliente, p_servicio, p_nivel, p_paquete, p_desde, null, coalesce(p_ensayo, true));
  exception
    when insufficient_privilege then
      return jsonb_build_object('estado', 'sin_permiso', 'frase', sqlerrm);
    when others then
      return jsonb_build_object('estado', 'no_se_pudo', 'frase', sqlerrm);
  end;
  if coalesce(p_ensayo, true) then return jsonb_build_object('estado', 'ok', 'ensayo', true, 'frase', v_r->>'frase'); end if;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, resultado_id, hecho_por, hecho_por_nombre)
  values (v_cuenta, v_cliente, p_tipo, trim(p_id), 'servicio',
          jsonb_build_object('servicio', p_servicio, 'nivel', p_nivel, 'paquete', p_paquete, 'desde', p_desde),
          coalesce(v_r->>'frase', ''), nullif(v_r->>'id', '')::uuid, (v_q->>'usuario')::uuid, v_q->>'quien')
  returning id into v_cambio;
  return jsonb_build_object('estado', 'ok', 'frase', v_r->>'frase', 'cambio', v_cambio, 'id', v_r->>'id', 'empresa', p_empresa, 'cliente', v_cliente,
    'bitrix', public._conta_bitrix_pestana_bitrix_de(v_cuenta, p_tipo, trim(p_id)));
end $$;
revoke all on function public.conta_bitrix_pestana_anadir(text, text, text, text, uuid, uuid, uuid, uuid, date, boolean) from public, anon, authenticated;
grant execute on function public.conta_bitrix_pestana_anadir(text, text, text, text, uuid, uuid, uuid, uuid, date, boolean) to service_role;

comment on function public.conta_bitrix_pestana_anadir(text, text, text, text, uuid, uuid, uuid, uuid, date, boolean) is
  'GB (nº 17, G) · «+ Añadir servicio o paquete» desde la pestaña de Bitrix24: conta_tarifa_servicio_anadir (G04), como la persona, con ensayo (solo la frase) o de verdad (y lo apunta). Solo el servidor, DESPUÉS de comprobar con Bitrix24 al usuario y la aplicación.';
