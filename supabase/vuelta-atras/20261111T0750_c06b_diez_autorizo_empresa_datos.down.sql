-- supabase/vuelta-atras/20261111T0750_c06b_diez_autorizo_empresa_datos.down.sql
--
-- Vuelta atrás de 20261111T0750: quita la autorización de EMPRESA de Foodint
-- en C0008. La del asiento 1801 (alcance 'asiento') no se toca.
--
-- PARA, sin quitar nada, si con ella ya se ha enviado algo a Diez. Quitarla no
-- saca nada de Diez, y Folvy tiene que seguir sabiendo por qué está allí. Cuenta
-- como «enviado con ella» un envío (external_send) de la empresa a la conexión
-- C0008:
--   · tocado desde que se puso la autorización (creado, enviado o actualizado
--     después de su created_at);
--   · que no cubre la autorización de un asiento: ni su asiento ni, si es un
--     contraasiento, el asiento que anula (reverses_entry_id);
--   · que está en Diez (enviado o enlazado) o que llegó a intentar escribir
--     (pendiente con algún intento y su huella: puede estar en Diez sin que
--     Folvy lo sepa).
-- Un envío parado antes de escribir (sin intento) no cuenta: no ha salido nada.
--
-- Si para: mirar en Libros › Con Diez qué asientos de octubre están en Diez,
-- y decidir con Julio. Quitar la autorización igualmente es un DELETE a mano,
-- no esta vuelta atrás.
do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_desde_cuando timestamptz;
  n int;
begin
  select created_at into v_desde_cuando from public.conta_diez_autorizo
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008';
  if not found then
    raise notice 'Vuelta atrás de la 0750: no hay autorización de empresa en C0008. No se toca nada.';
    return;
  end if;

  select count(*) into n
    from public.external_send s
    join public.account_connector c on c.id = s.account_connector_id
    left join public.journal_entry je on je.id = s.entry_id
   where s.account_id = v_cuenta and s.company_id = v_empresa
     and c.account_id = v_cuenta and c.company_id = v_empresa and upper(c.config->>'nombre_bd') = 'C0008'
     and greatest(s.created_at, coalesce(s.sent_at, s.created_at), coalesce(s.updated_at, s.created_at)) >= v_desde_cuando
     and (s.status in ('enviado', 'enlazado') or (s.status = 'pendiente' and s.attempts > 0 and s.payload_hash <> 'sin-enviar'))
     and not exists (select 1 from public.conta_diez_autorizo a
                      where a.account_id = v_cuenta and a.company_id = v_empresa and a.alcance = 'asiento' and upper(a.nombre_bd) = 'C0008'
                        and a.entry_id in (s.entry_id, je.reverses_entry_id));
  if n > 0 then
    raise exception 'Vuelta atrás de la 0750: con la autorización de empresa ya se han enviado (o intentado escribir) % asientos en C0008. No se quita nada.', n;
  end if;

  delete from public.conta_diez_autorizo
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008';
  get diagnostics n = row_count;
  raise notice 'Vuelta atrás de la 0750: % autorización de empresa quitada.', n;
end $$;
