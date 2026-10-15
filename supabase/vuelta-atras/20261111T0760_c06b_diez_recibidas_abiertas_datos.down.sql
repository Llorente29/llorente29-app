-- supabase/vuelta-atras/20261111T0760_c06b_diez_recibidas_abiertas_datos.down.sql
--
-- Vuelta atrás de 20261111T0760: la autorización de EMPRESA de Foodint en C0008
-- vuelve a no incluir las recibidas (incluye_recibidas = false) y su motivo, al
-- de antes. `desde` no se toca.
--
-- PARA, sin cambiar nada, si con ella ya se ha enviado alguna recibida a Diez:
-- cerrarla no la saca de Diez, y Folvy tiene que seguir sabiendo por qué está
-- allí. Cuenta como recibida enviada un envío (external_send) de la empresa a
-- la conexión C0008:
--   · de una factura recibida (journal_entry.source_type 'supplier_invoice') o
--     del contraasiento de una (el asiento que anula lo es), como la decide
--     conta-diez-enviar;
--   · que está en Diez (enviado o enlazado) o que llegó a intentar escribir
--     (pendiente con algún intento y su huella);
--   · que no cubre la autorización de un asiento que también abra las
--     recibidas (hoy no hay ninguna).
-- No se mira desde cuándo: antes de la 0760 ninguna autorización abría las
-- recibidas en C0008, así que cualquiera que esté allí entró con ella.
--
-- Si para: mirar en Libros › Con Diez qué recibidas están en Diez y decidir
-- con Julio. Cerrarlas igualmente es un UPDATE a mano, no esta vuelta atrás.
do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_nota    constant text := ' · 15/10: Julio abre también las recibidas (incluye_recibidas).';
  n int;
begin
  if not exists (select 1 from public.conta_diez_autorizo
                  where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008' and incluye_recibidas) then
    raise notice 'Vuelta atrás de la 0760: la empresa no tiene abiertas las recibidas en C0008. No se toca nada.';
    return;
  end if;

  select count(*) into n
    from public.external_send s
    join public.account_connector c on c.id = s.account_connector_id
    join public.journal_entry je on je.id = s.entry_id
    left join public.journal_entry anulado on anulado.id = je.reverses_entry_id
   where s.account_id = v_cuenta and s.company_id = v_empresa
     and c.account_id = v_cuenta and c.company_id = v_empresa and upper(c.config->>'nombre_bd') = 'C0008'
     and (je.source_type = 'supplier_invoice' or anulado.source_type = 'supplier_invoice')
     and (s.status in ('enviado', 'enlazado') or (s.status = 'pendiente' and s.attempts > 0 and s.payload_hash <> 'sin-enviar'))
     and not exists (select 1 from public.conta_diez_autorizo a
                      where a.account_id = v_cuenta and a.company_id = v_empresa and a.alcance = 'asiento' and upper(a.nombre_bd) = 'C0008'
                        and a.incluye_recibidas and a.entry_id in (s.entry_id, je.reverses_entry_id));
  if n > 0 then
    raise exception 'Vuelta atrás de la 0760: con ella ya se han enviado (o intentado escribir) % recibidas en C0008. No se cierra nada.', n;
  end if;

  update public.conta_diez_autorizo
     set incluye_recibidas = false, motivo = replace(motivo, v_nota, '')
   where account_id = v_cuenta and company_id = v_empresa and alcance = 'empresa' and upper(nombre_bd) = 'C0008' and incluye_recibidas;
  get diagnostics n = row_count;
  raise notice 'Vuelta atrás de la 0760: % autorización de empresa vuelve a ser solo de ventas.', n;
end $$;
