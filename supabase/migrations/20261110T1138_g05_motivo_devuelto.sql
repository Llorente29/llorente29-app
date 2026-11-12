-- supabase/migrations/20261110T1138_g05_motivo_devuelto.sql
-- cambia: public.conta_cobro_seguir · prueba: supabase/staging/sql/20261110_g05_motivo_devuelto_prueba.sql
--
-- G05 · nº 77, punto 2 · EL MOTIVO DEL DEVUELTO, GUARDADO EN EL RECIBO, para que
-- lo enseñe el portal del cliente (Code 3) y la ficha: «Sin saldo en la cuenta».
--
--   1. conta_gc_cobro.causa y conta_gc_cobro.motivo_es: el código del motivo que
--      da GoCardless (details.cause) y el motivo en palabras de oficina. Los
--      rellena la lectura (conta-gocardless-leer/motivo.ts). Admiten nulos.
--   2. conta_recibo.motivo_devolucion: el motivo del devuelto o el retrocedido,
--      en palabras de oficina. Admite nulos.
--   3. conta_cobro_seguir, la misma firma y lo mismo de antes, y además: cuando un
--      recibo queda devuelto o retrocedido, guarda su motivo; y a un devuelto que
--      aún no lo tiene se lo pone en cuanto la lectura lo trae. Con su respaldo.
-- Nada en el camino del pedido. No toca datos: los motivos llegan con la lectura.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1138_g05_motivo_devuelto.down.sql

alter table public.conta_gc_cobro add column if not exists causa text;
alter table public.conta_gc_cobro add column if not exists motivo_es text;
comment on column public.conta_gc_cobro.causa is 'G05 · El código del motivo de GoCardless (details.cause), si lo dio.';
comment on column public.conta_gc_cobro.motivo_es is 'G05 · El motivo en palabras de oficina («Sin saldo en la cuenta»).';
alter table public.conta_recibo add column if not exists motivo_devolucion text;
comment on column public.conta_recibo.motivo_devolucion is 'G05 · Por qué se devolvió o se reclamó, en palabras de oficina: lo enseñan el portal y la ficha.';

select public._respaldar_funcion('public.conta_cobro_seguir(uuid)', '20261110T1138_g05_motivo_devuelto');

create or replace function public.conta_cobro_seguir(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x record; v_nuevo text; v_facturadas int := 0; v_deshechos int := 0; v_cambios int := 0; v_fallos int := 0; v_msg text;
begin
  -- Después de cada lectura (que renueva las diferencias), los clientes sin código vuelven a «Pendiente de revisar».
  perform public._conta_cobro_codigos(p_company);
  for v_x in
    select r.id, r.estado, r.gc_estado, r.invoice_id, r.asiento_cobro, r.asiento_devolucion, b.estado as gc, b.fecha,
           r.motivo_devolucion, b.motivo_es as motivo_gc
      from public.conta_recibo r join public.conta_gc_cobro b on b.company_id = r.company_id and b.gc_id = r.gc_cobro_id
     where r.company_id = p_company and r.gc_cobro_id is not null
  loop
    if v_x.gc is distinct from v_x.gc_estado then
      v_nuevo := public._conta_cobro_estado(v_x.gc, v_x.invoice_id is not null);
      update public.conta_recibo set gc_estado = v_x.gc, estado = v_nuevo,
        confirmado_el = case when v_x.gc in ('confirmed', 'paid_out') then coalesce(confirmado_el, v_x.fecha) else confirmado_el end, updated_at = now()
       where id = v_x.id;
      perform public._conta_cobro_evento(v_x.id, v_nuevo, case v_nuevo
        when 'en_el_banco' then 'Cobro en el banco del cliente.'
        when 'cobrado' then 'Cobro confirmado.'
        when 'devuelto' then case when v_x.asiento_cobro is null then 'Devuelto sin fondos: pasa a «Te deben» y no tiene factura.' else 'Devuelto.' end
        when 'retrocedido' then 'Retrocedido: el cliente lo reclamó a su banco.'
        when 'cancelado' then 'Cancelado en GoCardless: no se ha cobrado.'
        else 'Enviado.' end, jsonb_build_object('gocardless', v_x.gc), null);
      v_cambios := v_cambios + 1;
    end if;
    -- nº 77 · El motivo del devuelto o el retrocedido, en el recibo (en cuanto la lectura lo trae).
    if v_x.gc in ('failed', 'charged_back', 'customer_approval_denied') and v_x.motivo_gc is not null
       and v_x.motivo_devolucion is distinct from v_x.motivo_gc then
      update public.conta_recibo set motivo_devolucion = v_x.motivo_gc, updated_at = now() where id = v_x.id;
    end if;
    begin
      if v_x.gc in ('confirmed', 'paid_out') and v_x.invoice_id is null then
        perform public._conta_cobro_facturar(v_x.id);
        v_facturadas := v_facturadas + 1;
      elsif v_x.gc in ('failed', 'charged_back') and v_x.asiento_cobro is not null and v_x.asiento_devolucion is null then
        perform public._conta_cobro_devolver(v_x.id);
        v_deshechos := v_deshechos + 1;
      end if;
    exception when others then
      get stacked diagnostics v_msg = message_text;
      v_fallos := v_fallos + 1;
      perform public._conta_cobro_evento(v_x.id, 'fallo', 'No se ha podido terminar: ' || v_msg, null, null);
    end;
  end loop;
  return jsonb_build_object('cambios', v_cambios, 'facturadas', v_facturadas, 'deshechos', v_deshechos, 'fallos', v_fallos);
end $$;
