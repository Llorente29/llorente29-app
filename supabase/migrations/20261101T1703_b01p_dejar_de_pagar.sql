-- supabase/migrations/20261101T1703_b01p_dejar_de_pagar.sql
-- cambia: public.revolut_conexion · prueba: supabase/staging/sql/20261101_b01p_dejar_de_pagar_prueba.sql
--
-- B01 Revolut · PR 2c-1 · «DEJAR DE PAGAR» y a qué se fue a Revolut. Solo añade.
--
--   1. revolut_conexion.oauth_para: a qué se fue a la página de autorizar de
--      Revolut (conectar, activar los pagos o dejar de pagar). La vuelta lo
--      sabe, y la pantalla también si la persona cancela allí.
--   2. conta_pago_dejar (decisión de Julio, 01/11): primero, en Sumied y al
--      instante, nadie puede pagar (se quitan los permisos de pago), se cancela
--      lo que esperaba la segunda aprobación o estaba listo para mandar, y la
--      conexión queda sin PAY. Después, la función vuelve a autorizar en
--      Revolut con READ y WRITE, para que el token deje de tener PAY. Si la
--      persona cancela en Revolut, en Sumied ya está quitado. Lo usan también
--      «Desconectar» y un permiso retirado desde Revolut: sin conexión no se
--      paga.
--
-- No está en el camino del pedido. revolut_conexion tiene una fila por empresa
-- conectada: el cierre del alter dura nada, y si no lo coge en 5 s, para.

set local lock_timeout = '5s';
alter table public.revolut_conexion add column if not exists oauth_para text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'revolut_conexion_oauth_para_check') then
    alter table public.revolut_conexion add constraint revolut_conexion_oauth_para_check
      check (oauth_para is null or oauth_para in ('conectar', 'activar_pagos', 'dejar_de_pagar'));
  end if;
end $$;
comment on column public.revolut_conexion.oauth_para is
  'B01 Revolut · 2c-1 · A qué se fue la última vez a la página de autorizar de Revolut: conectar, activar_pagos o dejar_de_pagar. La vuelta y la pantalla lo leen.';

create or replace function public.conta_pago_dejar(p_company uuid, p_quien uuid, p_quien_nombre text, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), 'Sumied'); v_motivo text := coalesce(nullif(trim(p_motivo), ''), 'Se han dejado de usar los pagos con Revolut');
        v_permisos int; v_lotes int := 0; v_l record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pago_permiso:' || p_company::text, 0));
  update public.conta_pago_permiso set revoked_at = now(), revoked_by_name = v_quien || ' (' || v_motivo || ')'
   where company_id = p_company and revoked_at is null;
  get diagnostics v_permisos = row_count;
  for v_l in select id, account_id from public.conta_pago_lote where company_id = p_company and estado in ('esperando_segunda', 'listo') for update loop
    update public.conta_pago_lote set estado = 'cancelado', cancelado_at = now(), cancelado_por_nombre = v_quien, cancelado_porque = v_motivo where id = v_l.id;
    update public.conta_pago_salida set estado = 'cancelada', estado_porque = v_motivo, estado_at = now() where lote_id = v_l.id and estado in ('esperando_segunda', 'lista');
    update public.conta_pago_reto set descartado_at = now() where lote_id = v_l.id and used_at is null and descartado_at is null;
    perform public._conta_pago_evento(v_l.account_id, v_l.id, null, v_quien, format('No sale: %s.', v_motivo));
    v_lotes := v_lotes + 1;
  end loop;
  update public.revolut_conexion set permisos = 'READ,WRITE'
   where company_id = p_company and 'PAY' = any (string_to_array(replace(coalesce(permisos, ''), ' ', ','), ','));
  return jsonb_build_object('permisos', v_permisos, 'lotes', v_lotes,
    'frase', format('Ya no se puede pagar con Revolut desde Sumied.%s%s',
      case when v_permisos = 0 then '' when v_permisos = 1 then ' Quitado el permiso de pagar a 1 persona.' else format(' Quitado el permiso de pagar a %s personas.', v_permisos) end,
      case when v_lotes = 0 then '' when v_lotes = 1 then ' 1 pago que esperaba no saldrá.' else format(' %s pagos que esperaban no saldrán.', v_lotes) end));
end $$;
revoke all on function public.conta_pago_dejar(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_dejar(uuid, uuid, text, text) to service_role;
comment on function public.conta_pago_dejar(uuid, uuid, text, text) is
  'B01 Revolut · 2c-1 · Dejar de pagar, en Sumied y al instante: sin permisos de pago, sin lo que esperaba (cancelado) y la conexión sin PAY. Lo que ya salió al banco sigue su camino.';
