-- supabase/migrations/20261026T0218_v03_verifactu_reenviar.sql
--
-- V03 · Entrega 2 · «CORREGIR Y REENVIAR» (tablero 27). SOLO AÑADE una
-- función: no cambia nada de lo que existe ni toca datos al aplicarse.
--
-- Cuando Hacienda rechaza el alta de una factura (estado «incorrecto»), la
-- factura que tiene el cliente es válida: lo que falla es el registro. Se
-- corrige con un registro NUEVO de subsanación (los registros no se editan),
-- con la misma factura (número y fecha), Subsanacion = S y RechazoPrevio = S:
-- «ha habido rechazo previo por la AEAT» (RechazoPrevioType del XSD; la X es
-- para un registro que no se envió nunca, y la 1161 pide la S con la
-- subsanación). Encadenado tras el último de su NIF, con su huella, y a la cola.
--
-- Si lo que faltaba es el porqué de una venta sin IVA (el caso del tablero
-- 27), se puede decir aquí: cambia verifactu_operacion y lo lleva al libro de
-- esa factura (las anotaciones exentas de su asiento: calificación, exención y
-- clave). Solo con su mes abierto (conta_mes_cerrado): cerrado, el porqué ya
-- está en lo declarado y se corrige con una rectificativa.
--
-- Antes de escribir nada, la misma comprobación que al emitir
-- (verifactu_comprobar): si aún falta algo, lo dice y no reenvía.

create or replace function public.verifactu_reenviar(p_invoice uuid, p_tipo_venta jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_e public.verifactu_empresa; v_prev public.verifactu_registro; v_k jsonb; v_reg public.verifactu_registro;
  v_cal text; v_ex text; v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  select * into v_f from public.customer_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta reenvía facturas a Hacienda.' using errcode = '42501';
  end if;
  select * into v_prev from public.verifactu_registro
   where invoice_id = p_invoice and account_id = v_f.account_id and tipo = 'alta' order by generado_at desc, id desc limit 1;
  if v_prev.id is null then raise exception 'La % no tiene registro en Hacienda: no hay nada que reenviar.', v_f.number_text using errcode = '23514'; end if;
  if v_prev.estado <> 'incorrecto' then
    raise exception 'La % no está rechazada por Hacienda (está %): no hay nada que reenviar.', v_f.number_text,
      case v_prev.estado when 'pendiente' then 'esperando a enviarse' when 'enviando' then 'enviándose' when 'correcto' then 'recibida'
                         when 'aceptado_con_errores' then 'recibida con un aviso' else v_prev.estado end using errcode = '23514';
  end if;
  select * into v_e from public.verifactu_empresa where company_id = v_f.company_id;
  if v_e.modo is distinct from v_prev.entorno then
    raise exception 'Se rechazó en %, y Verifactu está ahora en %: ese registro ya no se reenvía.', v_prev.entorno, coalesce(v_e.modo, 'apagado') using errcode = '23514';
  end if;

  -- El porqué de la venta sin IVA, si viene.
  if p_tipo_venta is not null then
    v_cal := nullif(p_tipo_venta->>'calificacion', ''); v_ex := nullif(p_tipo_venta->>'exenta', '');
    if coalesce(v_cal, '') not in ('', 'N1', 'N2') or coalesce(v_ex, '') not in ('', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6') or (v_cal is null) = (v_ex is null) then
      raise exception 'El tipo de venta sin IVA es una de dos: no sujeta (N1, N2) o exenta (E1 a E6).' using errcode = '22023';
    end if;
    if not exists (select 1 from public.customer_invoice_line l join public.tax_rate t on t.id = l.tax_rate_id
                    where l.invoice_id = p_invoice and t.treatment = 'exempt') then
      raise exception 'La % no tiene líneas sin IVA: no lleva porqué.', v_f.number_text using errcode = '23514';
    end if;
    if public.conta_mes_cerrado(v_f.company_id, v_f.issue_date) then
      raise exception 'El mes de % está cerrado: el porqué ya está en el libro y en lo declarado. Se corrige con una rectificativa.', to_char(v_f.issue_date, 'MM/YYYY') using errcode = '23514';
    end if;
    insert into public.verifactu_operacion (invoice_id, account_id, company_id, calificacion, exenta, clave_regimen, updated_by_name)
    values (p_invoice, v_f.account_id, v_f.company_id, v_cal, v_ex, case when v_ex = 'E2' then '02' else '01' end, v_quien)
    on conflict (invoice_id) do update set calificacion = excluded.calificacion, exenta = excluded.exenta, clave_regimen = excluded.clave_regimen,
           updated_at = now(), updated_by_name = excluded.updated_by_name;
    -- Y su libro: las anotaciones exentas del asiento de la factura.
    update public.vat_book_entry v set qualification = v_cal, exempt_cause = v_ex, operation_key = case when v_ex = 'E2' then '02' else '01' end, updated_at = now()
      from public.journal_line l join public.tax_rate t on t.id = l.tax_rate_id
     where v.entry_id = v_f.entry_id and v.account_id = v_f.account_id and l.id = v.line_id and t.treatment = 'exempt';
  end if;

  v_k := public.verifactu_comprobar(p_invoice);
  if not coalesce((v_k->>'va')::boolean, false) then
    raise exception 'Verifactu no está encendido para esta empresa: no se reenvía.' using errcode = '23514';
  end if;
  if jsonb_array_length(v_k->'faltas') > 0 then
    raise exception '%', (v_k->'faltas'->0->>'frase') using errcode = '23514', detail = (v_k->'faltas')::text, hint = 'verifactu';
  end if;

  v_reg := public._verifactu_registrar(jsonb_build_object(
    'account_id', v_prev.account_id, 'company_id', v_prev.company_id, 'entorno', v_prev.entorno, 'tipo', 'alta',
    'subsanacion', true, 'rechazo_previo', 'S', 'origen', v_prev.origen, 'invoice_id', v_prev.invoice_id,
    'nif_emisor', v_prev.nif_emisor, 'nombre_emisor', v_prev.nombre_emisor, 'num_serie', v_prev.num_serie, 'fecha_expedicion', v_prev.fecha_expedicion,
    'fecha_operacion', v_prev.fecha_operacion, 'tipo_factura', v_prev.tipo_factura, 'tipo_rectificativa', v_prev.tipo_rectificativa,
    'rectificadas', v_prev.rectificadas, 'descripcion', v_prev.descripcion, 'destinatarios', v_prev.destinatarios,
    'desglose', v_k->'desglose', 'cuota_total', v_k->'cuota_total', 'importe_total', v_k->'importe_total', 'quien', v_quien));
  perform public._conta_venta_evento(p_invoice, 'verifactu_reenvio',
    'Reenviada a Hacienda (subsanación del registro rechazado' || coalesce(' con el ' || v_prev.codigo_error, '') || ').', jsonb_build_object('registro', v_reg.id, 'rechazado', v_prev.id), v_quien);
  return jsonb_build_object('registro_id', v_reg.id, 'num_serie', v_reg.num_serie, 'estado', v_reg.estado);
end $$;
revoke all on function public.verifactu_reenviar(uuid, jsonb, text) from public, anon;
grant execute on function public.verifactu_reenviar(uuid, jsonb, text) to authenticated;
comment on function public.verifactu_reenviar(uuid, jsonb, text) is
  'V03 E2 · «Corregir y reenviar» (tablero 27): el alta rechazada de una factura se subsana con un registro nuevo (Subsanacion S, RechazoPrevio S), encadenado. Si viene tipo_venta, cambia el porqué de la venta sin IVA y su libro (con el mes abierto).';
