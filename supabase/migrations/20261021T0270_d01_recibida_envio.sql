-- ============================================================================
-- D01 · Tarea 5 · Lo que el envío a Diez lee de una FACTURA RECIBIDA. AÑADE
-- una función nueva; va detrás de la 0260.
--
-- conta_recibida_envio(asiento): el asiento validado de una factura recibida
-- (source_type 'supplier_invoice'), sus líneas con el tipo y la base del IVA,
-- la factura (número y fecha), el proveedor (nombre y NIF de su ficha) y su
-- documento (kind 'factura_recibida'). Es para las recibidas lo que
-- conta_resumen_ventas es para las ventas: lo lee conta-diez-enviar CON EL JWT
-- de quien pulsa (si no es de su cuenta, no está), y enviarRecibidaADiez
-- (_shared/diezEnviar.ts) decide con ello.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0270_d01_recibida_envio.down.sql
-- ============================================================================

create or replace function public.conta_recibida_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_i public.supplier_invoice;
  v_s public.supplier;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.source_type <> 'supplier_invoice' then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  select * into v_i from public.supplier_invoice where id = v_e.source_id and account_id = v_e.account_id;
  if v_i.id is null then raise exception 'La factura de ese asiento no está.' using errcode = 'P0002'; end if;
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_s.legal_name), ''), v_s.name), 'nif', nullif(trim(v_s.tax_id), '')),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;
comment on function public.conta_recibida_envio(uuid) is
  'D01 · Lo que el envío a Diez (serie 2) lee de una factura recibida: asiento, líneas con tipo y base del IVA, factura, proveedor y su documento. Solo para los de la cuenta.';
revoke all on function public.conta_recibida_envio(uuid) from public, anon;
grant execute on function public.conta_recibida_envio(uuid) to authenticated;
