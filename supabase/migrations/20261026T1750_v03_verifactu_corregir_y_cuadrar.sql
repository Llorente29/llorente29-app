-- supabase/migrations/20261026T1750_v03_verifactu_corregir_y_cuadrar.sql
--
-- V03 · Verifactu · E3 · CORREGIR Y CUADRAR. SOLO AÑADE: dos tablas nuevas y
-- funciones nuevas. No cambia ninguna función de la E1, de la E2 ni de la V01,
-- y no toca datos al aplicarse.
--
--   1. «Me he equivocado en…» (tablero 27). Antes de hacer nada, la base dice
--      qué va a pasar (verifactu_previsto), con las mismas comprobaciones que
--      después:
--        · rectificar: la rectificativa de la V01 (conta_venta_corregir), que
--          al emitirse lleva su alta R4 a Hacienda. Aquí solo se dice antes;
--        · anular (verifactu_anular_factura): para una factura que NO tenía que
--          haberse emitido (un duplicado, una prueba). La factura queda
--          anulada, su asiento se deshace con un contrasiento del mismo día y
--          Hacienda recibe un registro de ANULACIÓN encadenado (RD 1007/2023,
--          art. 11; Orden HAC/1177/2024, anexo §3). Si Hacienda no la llegó a
--          tener (rechazada), la anulación lleva «sin registro previo»
--          (SinRegistroPrevio = S, Validaciones v1.2.2 §3.1.4). Con cobros, una
--          rectificativa, o el mes cerrado, no: se corrige con una
--          rectificativa («Anularla entera»);
--        · subsanar (verifactu_subsanar): un registro de alta NUEVO, con la
--          misma factura y Subsanacion = S (Servicios web v1.0.3 §9.1.2), para
--          lo que solo va a Hacienda y no cambia la factura del cliente: la
--          descripción de la operación, o volver a mandar una aceptada con un
--          aviso. Si la última la rechazó, con RechazoPrevio = S (como
--          verifactu_reenviar de la E2).
--   2. «Comprobar la cadena» (verifactu_comprobar_cadena, Ajustes › Verifactu):
--      recorre los registros de cada cadena (NIF y entorno) en su orden y mira
--      que cada huella sea el SHA-256 de lo que guarda, que cada uno siga al
--      anterior y que la cadena cuente lo mismo. Solo lee.
--   3. «Comprobar con Hacienda» (Ventas › Facturas › Más, y el panel de
--      despachos): se PIDE aquí (verifactu_cuadre_pedir) y lo hace la función
--      de envío (conta-verifactu), que consulta a la AEAT los registros del
--      mes (ConsultaFactuSistemaFacturacion, ConsultaLR.xsd, con su
--      paginación) y los guarda (verifactu_cuadre_pagina). Al acabar, la base
--      los cuadra con los de Sumied (_verifactu_cuadrar): los que cuadran, los
--      que faltan en Hacienda, los que solo tiene Hacienda (¿otro programa?),
--      los distintos y los que aún van de camino. En real lo despierta un cron
--      de cada minuto, solo donde está el cron_secret (producción).
--   4. Exportar para una inspección: lo hace la pantalla con lo que ya lee
--      (verifactu_registro, con su cuenta); aquí no hace falta nada.
--
-- Fuentes, en docs/conta/v03/E1_paso0_informe.md y docs/conta/v03/E3_parte.md.

-- ── 0 · Lo de una factura con Hacienda ─────────────────────────────────────
-- La última alta de una factura (la original o su última subsanación) y su
-- anulación, si la tiene.
create or replace function public._verifactu_ultima_alta(p_invoice uuid)
returns public.verifactu_registro language sql stable security definer set search_path = public as $$
  select * from public.verifactu_registro where invoice_id = p_invoice and tipo = 'alta' order by generado_at desc, id desc limit 1
$$;
revoke all on function public._verifactu_ultima_alta(uuid) from public, anon, authenticated;

create or replace function public._verifactu_anulacion_de(p_invoice uuid)
returns public.verifactu_registro language sql stable security definer set search_path = public as $$
  select * from public.verifactu_registro where invoice_id = p_invoice and tipo = 'anulacion' order by generado_at desc, id desc limit 1
$$;
revoke all on function public._verifactu_anulacion_de(uuid) from public, anon, authenticated;

-- Lo que Sumied mandaría HOY en el alta de una factura (los mismos datos que
-- _verifactu_alta_de_factura de la E1), sin registrar nada. Con la
-- comprobación previa dentro: si falta algo, va en «faltas».
create or replace function public._verifactu_carga_de_factura(p_invoice uuid, p_descripcion text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_orig public.customer_invoice; v_emisor public.company; v_k jsonb; v_pais text; v_nif text; v_dest jsonb;
  v_tipo text; v_rect jsonb; v_desc text;
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  v_k := public.verifactu_comprobar(p_invoice);
  if not coalesce((v_k->>'va')::boolean, false) then return jsonb_build_object('va', false, 'faltas', '[]'::jsonb); end if;
  select * into v_emisor from public.company where id = v_f.company_id;
  v_pais := upper(coalesce(nullif(btrim(v_f.customer->>'pais'), ''), 'ES'));
  v_nif := upper(regexp_replace(coalesce(v_f.customer->>'nif', ''), '[\s.\-_/]', '', 'g'));
  v_dest := jsonb_build_array(case when v_pais = 'ES'
    then jsonb_build_object('nombre', btrim(v_f.customer->>'nombre'), 'nif', regexp_replace(v_nif, '^ES', ''))
    else jsonb_build_object('nombre', btrim(v_f.customer->>'nombre'), 'codigo_pais', v_pais,
      'id_type', case when public._verifactu_es_ue(v_pais) then '02' else '04' end, 'id', v_nif) end);
  if v_f.doc_type = 'rectificativa' then
    select * into v_orig from public.customer_invoice where id = v_f.corrects_id;
    v_tipo := 'R4';
    v_rect := jsonb_build_array(jsonb_build_object('nif', v_emisor.tax_id, 'num_serie', v_orig.number_text, 'fecha', v_orig.issue_date));
  else
    v_tipo := 'F1';
  end if;
  select left(string_agg(concept, ' · ' order by position), 500) into v_desc from public.customer_invoice_line where invoice_id = p_invoice;
  return jsonb_build_object('va', true, 'faltas', v_k->'faltas',
    'account_id', v_f.account_id, 'company_id', v_f.company_id, 'origen', 'factura', 'invoice_id', v_f.id,
    'nif_emisor', regexp_replace(upper(v_emisor.tax_id), '^ES', ''), 'nombre_emisor', coalesce(v_emisor.legal_name, v_emisor.trade_name),
    'num_serie', v_f.number_text, 'fecha_expedicion', v_f.issue_date, 'tipo_factura', v_tipo,
    'tipo_rectificativa', case when v_tipo like 'R%' then 'I' end, 'rectificadas', v_rect,
    'descripcion', left(coalesce(nullif(btrim(p_descripcion), ''), nullif(v_f.correction_reason, ''), v_desc, 'Factura ' || v_f.number_text), 500),
    'destinatarios', v_dest, 'desglose', v_k->'desglose', 'cuota_total', v_k->'cuota_total', 'importe_total', v_k->'importe_total');
end $$;
revoke all on function public._verifactu_carga_de_factura(uuid, text) from public, anon, authenticated;

-- Qué cambia entre lo que tiene Hacienda (la última alta) y lo que se mandaría
-- ahora: una lista de {campo, antes, despues}, en palabras.
create or replace function public._verifactu_cambios(p_alta public.verifactu_registro, p_carga jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(c order by orden), '[]'::jsonb) from (
    select 1 orden, jsonb_build_object('campo', 'descripcion', 'que', 'La descripción', 'antes', p_alta.descripcion, 'despues', p_carga->>'descripcion') c
     where p_alta.descripcion is distinct from p_carga->>'descripcion'
    union all
    select 2, jsonb_build_object('campo', 'destinatarios', 'que', 'El cliente', 'antes', p_alta.destinatarios->0->>'nombre', 'despues', p_carga->'destinatarios'->0->>'nombre')
     where p_alta.destinatarios is distinct from p_carga->'destinatarios'
    union all
    select 3, jsonb_build_object('campo', 'desglose', 'que', 'El desglose del IVA', 'antes', null, 'despues', null)
     where p_alta.desglose is distinct from p_carga->'desglose'
    union all
    select 4, jsonb_build_object('campo', 'importe_total', 'que', 'El total', 'antes', public._verifactu_importe(p_alta.importe_total), 'despues', public._verifactu_importe((p_carga->>'importe_total')::numeric))
     where round(p_alta.importe_total, 2) is distinct from round((p_carga->>'importe_total')::numeric, 2)
       or round(p_alta.cuota_total, 2) is distinct from round((p_carga->>'cuota_total')::numeric, 2)
  ) x
$$;
revoke all on function public._verifactu_cambios(public.verifactu_registro, jsonb) from public, anon, authenticated;

-- ── 1 · «Me he equivocado en…»: lo que va a pasar, antes de hacerlo ────────
-- Solo lee. Devuelve {accion, puede, frase, aviso, cambios, numero}. Las
-- funciones que lo hacen (verifactu_anular_factura, verifactu_subsanar) llaman
-- a esta misma y paran con su frase si no puede: lo que se dice antes es lo
-- que se comprueba después.
create or replace function public.verifactu_previsto(p_invoice uuid, p_accion text, p_cambios jsonb default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_e public.verifactu_empresa; v_a public.verifactu_registro; v_n public.verifactu_registro;
  v_carga jsonb; v_cambios jsonb; v_num text; v_motivo text; v_asiento int; v_mes text; v_rect text;
  r jsonb := jsonb_build_object('accion', p_accion);
begin
  select * into v_f from public.customer_invoice where id = p_invoice;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if p_accion not in ('rectificar', 'anular', 'subsanar') then raise exception 'Qué te has equivocado: rectificar, anular o subsanar.' using errcode = '22023'; end if;
  v_num := coalesce(v_f.number_text, 'factura');
  r := r || jsonb_build_object('numero', v_num, 'cambios', '[]'::jsonb, 'aviso', null);
  if v_f.status = 'borrador' then
    return r || jsonb_build_object('puede', false, 'frase', 'Es un borrador: no tiene número ni ha salido a Hacienda. Cámbialo directamente y guárdalo.');
  end if;
  if v_f.status = 'anulada' then
    return r || jsonb_build_object('puede', false, 'frase', 'La ' || v_num || ' ya está anulada: no se corrige más.');
  end if;
  select * into v_e from public.verifactu_empresa where company_id = v_f.company_id;
  v_a := public._verifactu_ultima_alta(p_invoice);
  v_n := public._verifactu_anulacion_de(p_invoice);
  v_mes := to_char(v_f.issue_date, 'MM/YYYY');

  -- La rectificativa (V01): la factura del cliente está mal.
  if p_accion = 'rectificar' then
    if v_f.doc_type = 'rectificativa' then
      select number_text into v_rect from public.customer_invoice where id = v_f.corrects_id;
      return r || jsonb_build_object('puede', false, 'frase', 'Una rectificativa no se corrige con otra: corrige la factura de origen' || coalesce(', la ' || v_rect, '') || '.');
    end if;
    if exists (select 1 from public.customer_invoice where corrects_id = p_invoice and status = 'borrador') then
      return r || jsonb_build_object('puede', true, 'frase', 'Ya hay una rectificativa de la ' || v_num || ' preparada, sin emitir: se abre esa.');
    end if;
    return r || jsonb_build_object('puede', true,
      'frase', 'Se prepara una rectificativa de la ' || v_num || ' (serie R), enlazada a ella. Al emitirla lleva su número, su PDF y su asiento'
        || case when v_a.id is not null then ', y Hacienda recibe su alta como rectificativa por diferencias (R4)' else '' end
        || '. La ' || v_num || ' no cambia ni se borra: tu cliente recibe la rectificativa.',
      'aviso', 'Es lo que toca si tu cliente tiene la factura y algo de ella está mal: importes, líneas o sus datos.');
  end if;

  -- La anulación: no tenía que haberse emitido.
  if p_accion = 'anular' then
    v_motivo := case
      when v_a.id is null then 'La ' || v_num || ' no tiene registro en Hacienda: si no tenía que haberla emitido, anúlala con una rectificativa («Anularla entera»).'
      when v_n.id is not null then 'La ' || v_num || ' ya tiene su registro de anulación en Hacienda.'
      when v_e.modo is distinct from v_a.entorno then 'Se registró en ' || v_a.entorno || ' y Verifactu está ahora en ' || coalesce(v_e.modo, 'apagado') || ': su anulación ya no se manda.'
      when v_f.doc_type = 'rectificativa' then 'Es una rectificativa: si sobra, se corrige su factura de origen con otra rectificativa.'
      when exists (select 1 from public.customer_invoice_payment where invoice_id = p_invoice) then 'La ' || v_num || ' tiene cobros: el cliente la ha pagado, así que existe. Se corrige con una rectificativa («Anularla entera»).'
      when exists (select 1 from public.customer_invoice where corrects_id = p_invoice and status <> 'borrador') then 'La ' || v_num || ' ya tiene una rectificativa emitida: se corrige con otra rectificativa, no se anula.'
      when exists (select 1 from public.customer_invoice where corrects_id = p_invoice and status = 'borrador') then 'La ' || v_num || ' tiene una rectificativa preparada sin emitir: bórrala o emítela antes.'
      when public.conta_mes_cerrado(v_f.company_id, v_f.issue_date) then 'El mes de ' || v_mes || ' está cerrado: la ' || v_num || ' ya cuenta en lo declarado. Se corrige con una rectificativa («Anularla entera»).'
      when v_f.entry_id is null then 'La ' || v_num || ' no tiene su asiento: no se puede deshacer. Avisa a soporte.'
      else null end;
    if v_motivo is not null then return r || jsonb_build_object('puede', false, 'frase', v_motivo); end if;
    select number into v_asiento from public.journal_entry where id = v_f.entry_id;
    return r || jsonb_build_object('puede', true,
      'frase', 'La ' || v_num || ' queda anulada: no cuenta en tus ventas ni en el IVA de ' || v_mes || ', su asiento'
        || coalesce(' nº ' || v_asiento::text, '') || ' se deshace con un contrasiento del mismo día, y Hacienda recibe un registro de anulación. Su número no se vuelve a usar.'
        || case v_a.estado
             when 'pendiente' then ' Todavía no había salido a Hacienda: le llegan las dos, el alta y la anulación, en el mismo envío.'
             when 'enviando' then ' Se está enviando ahora: la anulación sale en el envío siguiente.'
             when 'incorrecto' then case when exists (select 1 from public.verifactu_registro where invoice_id = p_invoice and tipo = 'alta' and estado in ('correcto', 'aceptado_con_errores'))
               then ' Hacienda rechazó su última subsanación, pero tiene la de antes: es esa la que se anula.'
               else ' Hacienda la rechazó, así que no la tiene: la anulación lo dice («sin registro previo»).' end
             else '' end,
      'aviso', 'Solo si no tenía que haberse emitido: un duplicado, una prueba, la que se hizo a otro cliente antes de mandársela. Si tu cliente la tiene, se corrige con una rectificativa.');
  end if;

  -- La subsanación: lo que solo va a Hacienda.
  v_motivo := case
    when v_a.id is null then 'La ' || v_num || ' no tiene registro en Hacienda: no hay nada que subsanar.'
    when v_n.id is not null then 'La ' || v_num || ' está anulada en Hacienda: no se subsana.'
    when v_e.modo is distinct from v_a.entorno then 'Se registró en ' || v_a.entorno || ' y Verifactu está ahora en ' || coalesce(v_e.modo, 'apagado') || ': ese registro ya no se subsana.'
    when v_a.estado = 'pendiente' then 'La ' || v_num || ' todavía no ha salido a Hacienda: espera a que conteste, y luego subsana si hace falta.'
    when v_a.estado = 'enviando' then 'La ' || v_num || ' se está enviando ahora: espera a que Hacienda conteste.'
    else null end;
  if v_motivo is not null then return r || jsonb_build_object('puede', false, 'frase', v_motivo); end if;
  v_carga := public._verifactu_carga_de_factura(p_invoice, p_cambios->>'descripcion');
  if not coalesce((v_carga->>'va')::boolean, false) then
    return r || jsonb_build_object('puede', false, 'frase', 'Verifactu no está encendido para esta empresa: no se subsana.');
  end if;
  if jsonb_array_length(v_carga->'faltas') > 0 then
    return r || jsonb_build_object('puede', false, 'frase', v_carga->'faltas'->0->>'frase', 'faltas', v_carga->'faltas');
  end if;
  v_cambios := public._verifactu_cambios(v_a, v_carga);
  r := r || jsonb_build_object('cambios', v_cambios);
  if jsonb_array_length(v_cambios) = 0 and v_a.estado = 'correcto' then
    return r || jsonb_build_object('puede', false,
      'frase', 'No hay nada que subsanar: lo que tiene Hacienda es lo que dice la ' || v_num || '. Si lo que está mal es la factura, es una rectificativa.');
  end if;
  return r || jsonb_build_object('puede', true,
    'frase', 'Hacienda recibe un registro nuevo de la ' || v_num || ' que sustituye al que tiene (una subsanación). La factura de tu cliente no cambia: ni su número, ni sus importes, ni su PDF.'
      || case v_a.estado
           when 'incorrecto' then ' Como la rechazó, el registro nuevo lo dice («rechazo previo»).'
           when 'aceptado_con_errores' then case when jsonb_array_length(v_cambios) = 0
             then ' Va igual que la otra vez: sirve si lo que avisó Hacienda' || coalesce(' (' || v_a.codigo_error::text || ')', '') || ' ya está arreglado fuera de Sumied.'
             else '' end
           else '' end);
end $$;
revoke all on function public.verifactu_previsto(uuid, text, jsonb) from public, anon;
grant execute on function public.verifactu_previsto(uuid, text, jsonb) to authenticated;
comment on function public.verifactu_previsto(uuid, text, jsonb) is
  'V03 E3 · «Me he equivocado en…» (tablero 27): qué va a pasar si se rectifica, se anula o se subsana una factura emitida, antes de hacerlo. Solo lee. {accion, puede, frase, aviso, cambios [{campo, que, antes, despues}], numero}. verifactu_anular_factura y verifactu_subsanar paran con esta misma frase.';

-- ── 2 · Anular: no tenía que haberse emitido ───────────────────────────────
-- El contrasiento del asiento de la factura, como journal_entry_anular (que no
-- deshace el de una factura viva: «se corrige desde la factura»), pero con la
-- MISMA fecha: el mes está abierto (lo comprueba verifactu_previsto) y así el
-- IVA de ese mes queda a cero, sin moverse a otro periodo.
create or replace function public._verifactu_contrasiento(p_entry uuid, p_motivo text, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_nuevo uuid; v_r jsonb;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'El asiento de la factura no está.' using errcode = 'P0002'; end if;
  if v_e.status <> 'validado' then raise exception 'El asiento de la factura no está validado (está %): no se puede deshacer.', v_e.status using errcode = '23514'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id,
                                    status, party_id, document_ref, document_date, reverses_entry_id, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.fiscal_year_id, v_e.series, v_e.entry_date,
          format('Anula %s nº %s: %s', case v_e.series when 1 then 'Ventas' when 2 then 'Compras' when 3 then 'Banco' when 9 then 'Nóminas' else 'General' end, v_e.number, btrim(p_motivo)),
          'reversal', v_e.id, 'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), p_quien)
  returning id into v_nuevo;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)
  select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
         location_id, is_common, brand_id, party_id, document_ref, document_date,
         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
    from public.journal_line where entry_id = v_e.id;
  v_r := public.journal_entry_validar(v_nuevo, p_quien);
  update public.journal_entry set status = 'anulado', voided_by_entry_id = v_nuevo, voided_at = now(), voided_by = auth.uid(),
         voided_by_name = p_quien, void_reason = btrim(p_motivo)
   where id = v_e.id;
  return jsonb_build_object('contraasiento', v_nuevo, 'numero', v_r->'numero', 'fecha', v_e.entry_date, 'anulado', v_e.id, 'numero_anulado', v_e.number);
end $$;
revoke all on function public._verifactu_contrasiento(uuid, text, text) from public, anon, authenticated;

create or replace function public.verifactu_anular_factura(p_invoice uuid, p_motivo text, p_confirmacion text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_a public.verifactu_registro; v_reg public.verifactu_registro; v_p jsonb; v_c jsonb; v_sin boolean;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  select * into v_f from public.customer_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  -- Como anular un asiento: solo un administrador.
  if not public.current_user_is_admin_of(v_f.account_id) then
    raise exception 'Solo un administrador de la cuenta anula una factura emitida.' using errcode = '42501';
  end if;
  v_p := public.verifactu_previsto(p_invoice, 'anular');
  if not coalesce((v_p->>'puede')::boolean, false) then raise exception '%', v_p->>'frase' using errcode = '23514'; end if;
  if p_motivo is null or length(btrim(p_motivo)) = 0 then raise exception 'Para anular la % hay que decir por qué.', v_f.number_text using errcode = '23514'; end if;
  if p_confirmacion is distinct from 'ANULAR' then
    raise exception 'Para anular la %, escribe ANULAR: no se puede deshacer.', v_f.number_text using errcode = '23514';
  end if;
  v_a := public._verifactu_ultima_alta(p_invoice);
  v_sin := v_a.estado = 'incorrecto' and not exists (select 1 from public.verifactu_registro where invoice_id = p_invoice and tipo = 'alta'
                                                       and estado in ('correcto', 'aceptado_con_errores'));
  v_c := public._verifactu_contrasiento(v_f.entry_id, 'factura ' || v_f.number_text || ' anulada (no tenía que emitirse): ' || btrim(p_motivo), v_quien);
  update public.customer_invoice set status = 'anulada' where id = p_invoice;
  -- El registro de anulación, encadenado tras el último de su NIF. Si Hacienda
  -- no tiene el alta (la rechazó y no se subsanó), «sin registro previo».
  v_reg := public._verifactu_registrar(jsonb_build_object(
    'account_id', v_a.account_id, 'company_id', v_a.company_id, 'entorno', v_a.entorno, 'tipo', 'anulacion', 'origen', v_a.origen,
    'invoice_id', v_a.invoice_id, 'alta_id', v_a.id, 'sin_registro_previo', v_sin,
    'nif_emisor', v_a.nif_emisor, 'nombre_emisor', v_a.nombre_emisor, 'num_serie', v_a.num_serie, 'fecha_expedicion', v_a.fecha_expedicion,
    'quien', v_quien));
  perform public._conta_venta_evento(p_invoice, 'anulada',
    'Anulada: no tenía que emitirse (' || btrim(p_motivo) || '). Su asiento nº ' || coalesce(v_c->>'numero_anulado', '?') || ' queda deshecho con el nº '
      || coalesce(v_c->>'numero', '?') || ', y Hacienda recibe su registro de anulación.',
    jsonb_build_object('registro', v_reg.id, 'contraasiento', v_c->>'contraasiento'), v_quien);
  return jsonb_build_object('numero', v_f.number_text, 'registro_id', v_reg.id, 'estado', v_reg.estado, 'sin_registro_previo', v_reg.sin_registro_previo,
    'contraasiento', v_c->>'contraasiento', 'numero_contraasiento', v_c->'numero', 'numero_anulado', v_c->'numero_anulado');
end $$;
revoke all on function public.verifactu_anular_factura(uuid, text, text, text) from public, anon;
grant execute on function public.verifactu_anular_factura(uuid, text, text, text) to authenticated;
comment on function public.verifactu_anular_factura(uuid, text, text, text) is
  'V03 E3 · «No tenía que haberla emitido»: la factura queda anulada, su asiento se deshace con un contrasiento del mismo día y Hacienda recibe su registro de anulación (encadenado; «sin registro previo» si la había rechazado). Solo un administrador, escribiendo ANULAR, con el motivo, y si verifactu_previsto dice que puede: sin cobros, sin rectificativa y con el mes abierto.';

-- ── 3 · Subsanar: lo que solo va a Hacienda ────────────────────────────────
create or replace function public.verifactu_subsanar(p_invoice uuid, p_descripcion text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_a public.verifactu_registro; v_p jsonb; v_carga jsonb; v_reg public.verifactu_registro;
  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor());
begin
  select * into v_f from public.customer_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta subsana facturas en Hacienda.' using errcode = '42501';
  end if;
  v_p := public.verifactu_previsto(p_invoice, 'subsanar', jsonb_build_object('descripcion', p_descripcion));
  if not coalesce((v_p->>'puede')::boolean, false) then raise exception '%', v_p->>'frase' using errcode = '23514'; end if;
  v_a := public._verifactu_ultima_alta(p_invoice);
  v_carga := public._verifactu_carga_de_factura(p_invoice, p_descripcion);
  v_reg := public._verifactu_registrar((v_carga - array['va', 'faltas']) || jsonb_build_object(
    'entorno', v_a.entorno, 'tipo', 'alta', 'subsanacion', true,
    'rechazo_previo', case when v_a.estado = 'incorrecto' then 'S' end,
    'fecha_operacion', v_a.fecha_operacion, 'quien', v_quien));
  perform public._conta_venta_evento(p_invoice, 'verifactu_subsanacion',
    'Subsanada en Hacienda: registro nuevo' || case when jsonb_array_length(v_p->'cambios') > 0
      then ' (cambia ' || (select string_agg(lower(c->>'que'), ', ') from jsonb_array_elements(v_p->'cambios') c) || ')' else ', igual que el anterior' end || '.',
    jsonb_build_object('registro', v_reg.id, 'anterior', v_a.id, 'cambios', v_p->'cambios'), v_quien);
  return jsonb_build_object('numero', v_f.number_text, 'registro_id', v_reg.id, 'estado', v_reg.estado, 'cambios', v_p->'cambios',
    'rechazo_previo', v_reg.rechazo_previo);
end $$;
revoke all on function public.verifactu_subsanar(uuid, text, text) from public, anon;
grant execute on function public.verifactu_subsanar(uuid, text, text) to authenticated;
comment on function public.verifactu_subsanar(uuid, text, text) is
  'V03 E3 · Subsanar: un registro de alta nuevo de la misma factura (Subsanacion S; RechazoPrevio S si la última se rechazó), encadenado y a la cola, con lo que solo va a Hacienda (la descripción, o volver a mandar una aceptada con un aviso). La factura del cliente no cambia. Para si verifactu_previsto dice que no puede (por ejemplo, si no cambia nada y Hacienda la tiene bien).';

-- ── 4 · «Comprobar la cadena» ───────────────────────────────────────────────
-- Recorre cada cadena de la empresa (su NIF, en pruebas y en real) en el orden
-- en que se generaron los registros. Solo lee. Por cada registro:
--   · lo que guarda es lo que entró en su huella (cadena_huella, recalculada
--     de sus campos con el formato oficial), y su huella es el SHA-256 de eso;
--   · sigue al anterior: su huella anterior es la del anterior, y su anterior
--     es ese (o es el primero, y solo el primero);
--   · su fecha y hora con huso es la de su generación, y va después del
--     anterior.
-- Y la cadena (verifactu_cadena) cuenta los mismos y termina en el mismo.
create or replace function public.verifactu_comprobar_cadena(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_co public.company; v_nif text; v_ent text; r public.verifactu_registro; v_prev public.verifactu_registro; v_cad public.verifactu_cadena;
  v_esperada text; v_problemas jsonb; v_n int; v_otras int; v_ns text; v_ns_prev text; v_out jsonb := '[]'::jsonb; v_mal int := 0; v_total int := 0;
  v_primera timestamptz; v_ultima timestamptz;
begin
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public.belongs_to_account(v_co.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  v_nif := regexp_replace(upper(coalesce(v_co.tax_id, '')), '^ES', '');
  foreach v_ent in array array['real', 'pruebas'] loop
    v_problemas := '[]'::jsonb; v_n := 0; v_otras := 0; v_prev := null; v_ns_prev := null; v_primera := null; v_ultima := null;
    for r in select * from public.verifactu_registro where nif_emisor = v_nif and entorno = v_ent order by generado_at, id loop
      v_n := v_n + 1;
      if r.company_id <> p_company then v_otras := v_otras + 1; end if;
      -- De otra empresa con el mismo NIF (otra cuenta): sin su número.
      v_ns := case when r.company_id = p_company then r.num_serie else 'una factura de otra empresa con este NIF' end;
      v_primera := coalesce(v_primera, r.generado_at); v_ultima := r.generado_at;
      v_esperada := case r.tipo
        when 'alta' then public._verifactu_cadena_alta(r.nif_emisor, r.num_serie, public._verifactu_fecha(r.fecha_expedicion), r.tipo_factura,
                           public._verifactu_importe(r.cuota_total), public._verifactu_importe(r.importe_total), r.huella_anterior, r.fecha_hora_huso)
        else public._verifactu_cadena_anulacion(r.nif_emisor, r.num_serie, public._verifactu_fecha(r.fecha_expedicion), r.huella_anterior, r.fecha_hora_huso) end;
      if r.cadena_huella is distinct from v_esperada then
        v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', r.id, 'num_serie', v_ns, 'tipo', r.tipo, 'que', 'tocado',
          'frase', 'Lo que guarda el registro de la ' || v_ns || ' no es lo que entró en su huella: se ha tocado después de generarlo.'));
      end if;
      if public._verifactu_sha256(r.cadena_huella) is distinct from r.huella then
        v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', r.id, 'num_serie', v_ns, 'tipo', r.tipo, 'que', 'huella',
          'frase', 'La huella del registro de la ' || v_ns || ' no es la de sus datos.'));
      end if;
      if v_prev.id is null then
        if not r.primer_registro or r.huella_anterior is not null then
          v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', r.id, 'num_serie', v_ns, 'tipo', r.tipo, 'que', 'falta_anterior',
            'frase', 'El primer registro que hay (' || v_ns || ') dice que tiene otro antes: falta el principio de la cadena.'));
        end if;
      elsif r.primer_registro or r.huella_anterior is distinct from v_prev.huella or r.anterior_id is distinct from v_prev.id then
        v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', r.id, 'num_serie', v_ns, 'tipo', r.tipo, 'que', 'no_sigue',
          'frase', 'El registro de la ' || v_ns || ' no sigue al de la ' || coalesce(v_ns_prev, '—') || ': falta uno entre los dos, o se ha tocado.'));
      end if;
      if r.fecha_hora_huso is distinct from public._verifactu_fecha_hora_huso(r.generado_at) or (v_prev.id is not null and r.generado_at <= v_prev.generado_at) then
        v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', r.id, 'num_serie', v_ns, 'tipo', r.tipo, 'que', 'hora',
          'frase', 'La hora del registro de la ' || v_ns || ' no es la de cuando se generó, o va antes que el anterior.'));
      end if;
      v_prev := r; v_ns_prev := v_ns;
    end loop;
    select * into v_cad from public.verifactu_cadena where nif_emisor = v_nif and entorno = v_ent;
    if v_cad.nif_emisor is not null or v_n > 0 then
      if coalesce(v_cad.registros, 0) <> v_n or v_cad.ultima_huella is distinct from v_prev.huella or v_cad.ultimo_registro_id is distinct from v_prev.id then
        v_problemas := v_problemas || jsonb_build_array(jsonb_build_object('registro', null, 'num_serie', null, 'tipo', null, 'que', 'cuenta',
          'frase', 'La cadena dice que tiene ' || coalesce(v_cad.registros, 0) || ' registros, y hay ' || v_n
            || case when v_cad.ultimo_registro_id is distinct from v_prev.id then ': no termina en el último que hay' else '' end || '.'));
      end if;
      v_mal := v_mal + jsonb_array_length(v_problemas); v_total := v_total + v_n;
      v_out := v_out || jsonb_build_array(jsonb_build_object('entorno', v_ent, 'nif', v_nif, 'registros', v_n, 'de_otras_empresas', v_otras,
        'desde', v_primera, 'hasta', v_ultima, 'ok', jsonb_array_length(v_problemas) = 0,
        'problemas', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_problemas) x limit 50) y),
        'problemas_total', jsonb_array_length(v_problemas)));
    end if;
  end loop;
  return jsonb_build_object('ok', v_mal = 0, 'registros', v_total, 'problemas', v_mal, 'cadenas', v_out, 'comprobada_at', now(),
    'frase', case
      when v_total = 0 then 'Todavía no hay ningún registro de Verifactu de ' || coalesce(v_co.trade_name, v_co.legal_name) || ': no hay cadena que comprobar.'
      when v_mal = 0 then 'La cadena está entera: ' || v_total || case when v_total = 1 then ' registro' else ' registros' end
        || ', cada uno con la huella de sus datos y detrás del anterior. No falta ninguno ni se ha tocado ninguno.'
      else 'La cadena tiene ' || v_mal || case when v_mal = 1 then ' problema' else ' problemas' end || ' en ' || v_total || ' registros: abajo, cuál y dónde.' end);
end $$;
revoke all on function public.verifactu_comprobar_cadena(uuid) from public, anon;
grant execute on function public.verifactu_comprobar_cadena(uuid) to authenticated;
comment on function public.verifactu_comprobar_cadena(uuid) is
  'V03 E3 · «Comprobar la cadena» (Ajustes › Verifactu): recorre las cadenas de la empresa (su NIF, en real y en pruebas) y dice si falta algún registro o se ha tocado alguno: huella = SHA-256 de lo guardado, lo guardado = lo que sale de sus campos, cada uno detrás del anterior, y la cadena cuenta lo mismo. Solo lee.';

-- ── 5 · «Comprobar con Hacienda»: el cuadre de un mes ─────────────────────
create table if not exists public.verifactu_cuadre (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  company_id        uuid not null references public.company(id) on delete cascade,
  pedido_por_account uuid not null references public.accounts(id) on delete cascade,
  entorno           text not null check (entorno in ('pruebas', 'real')),
  nif_emisor        text not null check (nif_emisor ~ '^[0-9A-Z]{9}$'),
  nombre_emisor     text not null,
  ejercicio         integer not null check (ejercicio between 2024 and 2100),
  periodo           text not null check (periodo ~ '^(0[1-9]|1[0-2])$'),
  estado            text not null default 'pedido' check (estado in ('pedido', 'consultando', 'hecho', 'fallo')),
  pedido_at         timestamptz not null default now(),
  pedido_por_nombre text,
  empezado_at       timestamptz,
  terminado_at      timestamptz,
  paginas           integer not null default 0,
  error             text,
  resultado         jsonb
);
comment on table public.verifactu_cuadre is
  'V03 E3. «Comprobar con Hacienda»: una consulta a la AEAT de los registros de un mes de una empresa (su NIF y su entorno), y su cuadre con los de Sumied. La pide la pantalla (o el despacho de su asesoría); la hace conta-verifactu; el resultado lo calcula la base.';
create index if not exists verifactu_cuadre_cola on public.verifactu_cuadre (entorno, pedido_at) where estado = 'pedido';
create index if not exists verifactu_cuadre_empresa on public.verifactu_cuadre (company_id, ejercicio, periodo, pedido_at desc);

create table if not exists public.verifactu_cuadre_hacienda (
  cuadre_id         uuid not null references public.verifactu_cuadre(id) on delete cascade,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  num_serie         text not null,
  fecha_expedicion  date not null,
  tipo_factura      text,
  cuota_total       numeric(14,2),
  importe_total     numeric(14,2),
  huella            text,
  estado            text not null check (estado in ('Correcto', 'AceptadoConErrores', 'Anulado')),
  codigo_error      integer,
  descripcion_error text,
  modificado_at     timestamptz,
  primary key (cuadre_id, num_serie, fecha_expedicion)
);
comment on table public.verifactu_cuadre_hacienda is
  'V03 E3. Lo que contestó la AEAT en una consulta (RespuestaConsultaLR.xsd): una fila por factura con su último estado (Correcto, AceptadoConErrores o Anulado), su huella y sus importes.';

alter table public.verifactu_cuadre enable row level security;
alter table public.verifactu_cuadre_hacienda enable row level security;
-- Se lee con funciones (la asesoría lee los de sus clientes, que no son de su cuenta).
revoke all on public.verifactu_cuadre, public.verifactu_cuadre_hacienda from anon, authenticated;

-- ¿Puede quien llama mirar Verifactu de esa empresa? Su cuenta, o la asesoría
-- que la lleva desde su despacho (P01: conta_despacho_clientes).
create or replace function public._verifactu_puede_cuadrar(p_company uuid, p_desde_account uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.company c where c.id = p_company
                  and ((public.belongs_to_account(c.account_id) and public.current_user_is_admin_or_manager_of(c.account_id))
                       or (p_desde_account is not null and public.belongs_to_account(p_desde_account)
                           and public.current_user_is_admin_or_manager_of(p_desde_account)
                           and c.id in (select public.conta_despacho_clientes(p_desde_account)))))
$$;
revoke all on function public._verifactu_puede_cuadrar(uuid, uuid) from public, anon, authenticated;

create or replace function public.verifactu_cuadre_pedir(p_company uuid, p_mes date, p_desde_account uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_co public.company; v_e public.verifactu_empresa; v_c public.verifactu_cuadre; v_mes date := date_trunc('month', p_mes)::date;
begin
  if p_mes is null then raise exception 'Dime de qué mes.' using errcode = '22023'; end if;
  select * into v_co from public.company where id = p_company;
  if v_co.id is null or not public._verifactu_puede_cuadrar(p_company, p_desde_account) then
    raise exception 'Esa empresa no está, o no la puedes comprobar.' using errcode = '42501';
  end if;
  select * into v_e from public.verifactu_empresa where company_id = p_company;
  if v_e.company_id is null or v_e.modo = 'apagado' then
    raise exception 'Verifactu está apagado en %: no hay nada que comprobar con Hacienda.', coalesce(v_co.trade_name, v_co.legal_name) using errcode = '23514';
  end if;
  if v_mes > date_trunc('month', now() at time zone 'Europe/Madrid')::date then
    raise exception 'Ese mes aún no ha llegado.' using errcode = '23514';
  end if;
  if v_mes < date '2024-10-01' then raise exception 'Verifactu empieza en octubre de 2024: no hay nada antes.' using errcode = '23514'; end if;
  -- Si ya hay uno de ese mes esperando, ese mismo (no se pregunta dos veces).
  select * into v_c from public.verifactu_cuadre where company_id = p_company and entorno = v_e.modo and estado in ('pedido', 'consultando')
     and ejercicio = extract(year from v_mes)::int and periodo = to_char(v_mes, 'MM') order by pedido_at desc limit 1;
  if v_c.id is not null then
    return jsonb_build_object('id', v_c.id, 'ya_estaba', true, 'entorno', v_c.entorno, 'estado', v_c.estado);
  end if;
  insert into public.verifactu_cuadre (account_id, company_id, pedido_por_account, entorno, nif_emisor, nombre_emisor, ejercicio, periodo, pedido_por_nombre)
  values (v_co.account_id, v_co.id, coalesce(p_desde_account, v_co.account_id), v_e.modo, regexp_replace(upper(v_co.tax_id), '^ES', ''),
          coalesce(v_co.legal_name, v_co.trade_name), extract(year from v_mes)::int, to_char(v_mes, 'MM'), coalesce(p_quien_nombre, public.conta_nombre_actor()))
  returning * into v_c;
  return jsonb_build_object('id', v_c.id, 'ya_estaba', false, 'entorno', v_c.entorno, 'estado', v_c.estado);
end $$;
revoke all on function public.verifactu_cuadre_pedir(uuid, date, uuid, text) from public, anon;
grant execute on function public.verifactu_cuadre_pedir(uuid, date, uuid, text) to authenticated;
comment on function public.verifactu_cuadre_pedir(uuid, date, uuid, text) is
  'V03 E3 · «Comprobar con Hacienda»: pide la consulta de los registros de un mes de la empresa (su cuenta, o la asesoría que la lleva: p_desde_account). Si ya hay una de ese mes esperando, devuelve esa. La hace conta-verifactu.';

-- El último cuadre de un mes (o uno concreto), con su resultado.
create or replace function public.verifactu_cuadre_ver(p_company uuid, p_mes date default null, p_cuadre uuid default null, p_desde_account uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c public.verifactu_cuadre; v_mes date := date_trunc('month', p_mes)::date;
begin
  if not public._verifactu_puede_cuadrar(p_company, p_desde_account) then
    raise exception 'Esa empresa no está, o no la puedes comprobar.' using errcode = '42501';
  end if;
  select * into v_c from public.verifactu_cuadre
   where company_id = p_company and (p_cuadre is null or id = p_cuadre)
     and (v_mes is null or (ejercicio = extract(year from v_mes)::int and periodo = to_char(v_mes, 'MM')))
   order by pedido_at desc limit 1;
  if v_c.id is null then return null; end if;
  return jsonb_build_object('id', v_c.id, 'entorno', v_c.entorno, 'ejercicio', v_c.ejercicio, 'periodo', v_c.periodo, 'estado', v_c.estado,
    'pedido_at', v_c.pedido_at, 'pedido_por', v_c.pedido_por_nombre, 'empezado_at', v_c.empezado_at, 'terminado_at', v_c.terminado_at,
    'paginas', v_c.paginas, 'error', v_c.error, 'resultado', v_c.resultado);
end $$;
revoke all on function public.verifactu_cuadre_ver(uuid, date, uuid, uuid) from public, anon;
grant execute on function public.verifactu_cuadre_ver(uuid, date, uuid, uuid) to authenticated;

-- Las empresas con Verifactu encendido que una asesoría lleva (para elegir en el despacho).
create or replace function public.verifactu_despacho_empresas(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_account is null or not public.belongs_to_account(p_account) then raise exception 'No eres de esta cuenta.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('company_id', c.id, 'nombre', coalesce(c.trade_name, c.legal_name), 'nif', c.tax_id, 'modo', e.modo)
                                    order by coalesce(c.trade_name, c.legal_name)), '[]'::jsonb)
            from public.company c join public.verifactu_empresa e on e.company_id = c.id
           where e.modo <> 'apagado' and c.id in (select public.conta_despacho_clientes(p_account)));
end $$;
revoke all on function public.verifactu_despacho_empresas(uuid) from public, anon;
grant execute on function public.verifactu_despacho_empresas(uuid) to authenticated;

-- Solo la función de envío (clave de servicio): tomar uno pedido.
create or replace function public.verifactu_cuadre_tomar(p_entorno text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.verifactu_cuadre;
begin
  select * into v_c from public.verifactu_cuadre where entorno = p_entorno and estado = 'pedido' order by pedido_at limit 1 for update skip locked;
  if v_c.id is null then return null; end if;
  update public.verifactu_cuadre set estado = 'consultando', empezado_at = now(), paginas = 0, error = null where id = v_c.id;
  delete from public.verifactu_cuadre_hacienda where cuadre_id = v_c.id;
  return jsonb_build_object('cuadre_id', v_c.id, 'entorno', v_c.entorno, 'company_id', v_c.company_id, 'nif_emisor', v_c.nif_emisor,
    'nombre_emisor', v_c.nombre_emisor, 'ejercicio', v_c.ejercicio, 'periodo', v_c.periodo);
end $$;
revoke all on function public.verifactu_cuadre_tomar(text) from public, anon, authenticated;

-- Una página de lo que contestó Hacienda. Con p_final, se cuadra.
--   p_registros: [{num_serie, fecha (AAAA-MM-DD), tipo_factura, cuota_total, importe_total, huella,
--                  estado (Correcto|AceptadoConErrores|Anulado), codigo, descripcion, modificado}]
create or replace function public.verifactu_cuadre_pagina(p_cuadre uuid, p_registros jsonb, p_final boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.verifactu_cuadre; v_x jsonb; v_n int := 0; v_res jsonb;
begin
  select * into v_c from public.verifactu_cuadre where id = p_cuadre for update;
  if v_c.id is null then raise exception 'Ese cuadre no está.' using errcode = 'P0002'; end if;
  if v_c.estado <> 'consultando' then raise exception 'Ese cuadre no se está consultando (está %).', v_c.estado using errcode = '23514'; end if;
  for v_x in select * from jsonb_array_elements(coalesce(p_registros, '[]'::jsonb)) loop
    insert into public.verifactu_cuadre_hacienda (cuadre_id, account_id, num_serie, fecha_expedicion, tipo_factura, cuota_total, importe_total, huella,
      estado, codigo_error, descripcion_error, modificado_at)
    values (p_cuadre, v_c.account_id, v_x->>'num_serie', (v_x->>'fecha')::date, nullif(v_x->>'tipo_factura', ''), nullif(v_x->>'cuota_total', '')::numeric,
      nullif(v_x->>'importe_total', '')::numeric, nullif(upper(v_x->>'huella'), ''), v_x->>'estado', nullif(v_x->>'codigo', '')::int,
      left(nullif(v_x->>'descripcion', ''), 500), nullif(v_x->>'modificado', '')::timestamptz)
    on conflict (cuadre_id, num_serie, fecha_expedicion) do update set tipo_factura = excluded.tipo_factura, cuota_total = excluded.cuota_total,
      importe_total = excluded.importe_total, huella = excluded.huella, estado = excluded.estado, codigo_error = excluded.codigo_error,
      descripcion_error = excluded.descripcion_error, modificado_at = excluded.modificado_at;
    v_n := v_n + 1;
  end loop;
  update public.verifactu_cuadre set paginas = paginas + 1 where id = p_cuadre;
  if p_final then
    v_res := public._verifactu_cuadrar(p_cuadre);
    update public.verifactu_cuadre set estado = 'hecho', terminado_at = now(), resultado = v_res where id = p_cuadre;
  end if;
  return jsonb_build_object('cuadre_id', p_cuadre, 'registros', v_n, 'final', p_final);
end $$;
revoke all on function public.verifactu_cuadre_pagina(uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.verifactu_cuadre_fallo(p_cuadre uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.verifactu_cuadre set estado = 'fallo', terminado_at = now(), error = left(p_error, 2000) where id = p_cuadre and estado in ('pedido', 'consultando');
  return jsonb_build_object('cuadre_id', p_cuadre, 'fallo', true);
end $$;
revoke all on function public.verifactu_cuadre_fallo(uuid, text) from public, anon, authenticated;

-- El certificado de la empresa para UNA consulta en real, con las mismas
-- condiciones que verifactu_cert_abrir (2341) para un envío.
create or replace function public.verifactu_cert_abrir_cuadre(p_cuadre uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c public.verifactu_cuadre; v_emp public.verifactu_empresa; v_a public.verifactu_autorizacion; c public.tax_certificate; v_material text; v_motivo text;
begin
  select * into v_c from public.verifactu_cuadre where id = p_cuadre;
  if v_c.id is null then return jsonb_build_object('ok', false, 'mensaje', 'Ese cuadre no está.'); end if;
  select * into v_emp from public.verifactu_empresa where company_id = v_c.company_id;
  select * into v_a from public.verifactu_autorizacion where company_id = v_c.company_id and retirada_at is null;
  select * into c from public.tax_certificate where id = v_a.certificate_id;
  v_motivo := case
    when v_c.entorno <> 'real' then 'Solo se abre el certificado de la empresa para consultar en real.'
    when v_emp.via is distinct from 'certificado' then 'La empresa envía por la vía de colaborador social, que todavía no está abierta.'
    when v_a.id is null then 'La empresa no ha autorizado usar su certificado para Verifactu (o lo ha retirado).'
    when c.id is null or c.status = 'removed' then 'El certificado autorizado se ha quitado: autoriza uno nuevo.'
    when c.valid_to <= now() then 'El certificado autorizado ha caducado: sube uno nuevo y autorízalo.'
    when c.storage <> 'vault' then 'El certificado está en el almacén con clave externa (KMS), que todavía no está preparado.'
    else null end;
  if v_motivo is not null then return jsonb_build_object('ok', false, 'mensaje', v_motivo); end if;
  select decrypted_secret into v_material from vault.decrypted_secrets where id = c.vault_secret_id;
  if v_material is null then return jsonb_build_object('ok', false, 'mensaje', 'El certificado no está en el almacén: vuelve a subirlo.'); end if;
  return jsonb_build_object('ok', true, 'material', v_material, 'autorizacion_id', v_a.id);
end $$;
revoke all on function public.verifactu_cert_abrir_cuadre(uuid) from public, anon, authenticated;
comment on function public.verifactu_cert_abrir_cuadre(uuid) is
  'V03 E3. Solo la clave de servicio (conta-verifactu): abre el certificado de la empresa para UNA consulta de «Comprobar con Hacienda» en real, con las mismas condiciones que verifactu_cert_abrir para un envío. Para nada más.';

-- El cuadre: lo que Hacienda debería tener según Sumied (por cada factura de
-- ese NIF, entorno y mes, su último registro aceptado: alta → Correcto o
-- AceptadoConErrores; anulación → Anulado) contra lo que contestó.
create or replace function public._verifactu_cuadrar(p_cuadre uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_c public.verifactu_cuadre; v_desde date; v_hasta date; v_res jsonb;
begin
  select * into v_c from public.verifactu_cuadre where id = p_cuadre;
  v_desde := make_date(v_c.ejercicio, v_c.periodo::int, 1);
  v_hasta := (v_desde + interval '1 month')::date - 1;
  with sumied as (
    select r.num_serie, r.fecha_expedicion,
           (array_agg(r.id order by r.generado_at desc, r.id desc) filter (where r.estado in ('correcto', 'aceptado_con_errores')))[1] as aceptado_id,
           bool_or(r.estado in ('pendiente', 'enviando')) as en_camino,
           bool_and(r.estado = 'incorrecto') as solo_rechazos,
           (array_agg(r.invoice_id order by r.generado_at desc))[1] as invoice_id
      from public.verifactu_registro r
     where r.nif_emisor = v_c.nif_emisor and r.entorno = v_c.entorno and r.fecha_expedicion between v_desde and v_hasta
     group by r.num_serie, r.fecha_expedicion
  ), esperado as (
    select s.*, a.tipo, a.huella, a.importe_total, a.tipo_factura,
           case when a.id is null then null when a.tipo = 'anulacion' then 'Anulado' when a.estado = 'aceptado_con_errores' then 'AceptadoConErrores' else 'Correcto' end as estado_esperado,
           (select number_text from public.customer_invoice where id = s.invoice_id) as numero
      from sumied s left join public.verifactu_registro a on a.id = s.aceptado_id
  ), hacienda as (
    select * from public.verifactu_cuadre_hacienda where cuadre_id = p_cuadre
  ), junto as (
    select coalesce(e.num_serie, h.num_serie) num_serie, coalesce(e.fecha_expedicion, h.fecha_expedicion) fecha, e.invoice_id,
           e.estado_esperado, e.en_camino, e.solo_rechazos, e.huella huella_sumied, e.importe_total importe_sumied, e.aceptado_id,
           h.estado estado_hacienda, h.huella huella_hacienda, h.importe_total importe_hacienda, h.codigo_error, h.descripcion_error,
           case
             when h.num_serie is null and e.estado_esperado is null and e.en_camino then 'en_camino'
             when h.num_serie is null and e.estado_esperado is null and e.solo_rechazos then 'rechazada'
             when h.num_serie is null and e.estado_esperado is not null then 'falta_en_hacienda'
             when e.num_serie is null then 'solo_en_hacienda'
             when e.aceptado_id is null then 'distinta'
             when h.estado = e.estado_esperado and h.huella is not distinct from e.huella
                  and (h.estado = 'Anulado' or round(h.importe_total, 2) is not distinct from round(e.importe_total, 2)) then
               case when e.en_camino then 'cuadra_y_va_otro' else 'cuadra' end
             else 'distinta' end as como
      from esperado e full join hacienda h on h.num_serie = e.num_serie and h.fecha_expedicion = e.fecha_expedicion
  )
  select jsonb_build_object(
    'hacienda', (select count(*) from hacienda),
    'cuadran', (select count(*) from junto where como in ('cuadra', 'cuadra_y_va_otro')),
    'en_camino', (select count(*) from junto where como in ('en_camino', 'cuadra_y_va_otro')),
    'rechazadas', (select count(*) from junto where como = 'rechazada'),
    'falta_en_hacienda', (select coalesce(jsonb_agg(jsonb_build_object('num_serie', num_serie, 'fecha', fecha, 'invoice_id', invoice_id, 'esperado', estado_esperado) order by fecha, num_serie), '[]'::jsonb) from junto where como = 'falta_en_hacienda'),
    'solo_en_hacienda', (select coalesce(jsonb_agg(jsonb_build_object('num_serie', num_serie, 'fecha', fecha, 'estado', estado_hacienda, 'importe', importe_hacienda) order by fecha, num_serie), '[]'::jsonb) from junto where como = 'solo_en_hacienda'),
    'distintas', (select coalesce(jsonb_agg(jsonb_build_object('num_serie', num_serie, 'fecha', fecha, 'invoice_id', invoice_id,
                    'que', case when estado_esperado is null then 'sumied_no_la_dio_por_buena'
                                when estado_hacienda is distinct from estado_esperado then 'estado'
                                when huella_hacienda is distinct from huella_sumied then 'huella' else 'importe' end,
                    'sumied', jsonb_build_object('estado', estado_esperado, 'importe', importe_sumied, 'huella', huella_sumied),
                    'hacienda', jsonb_build_object('estado', estado_hacienda, 'importe', importe_hacienda, 'huella', huella_hacienda,
                                                   'codigo', codigo_error, 'descripcion', descripcion_error)) order by fecha, num_serie), '[]'::jsonb) from junto where como = 'distinta')
  ) into v_res;
  return v_res || jsonb_build_object('ok', jsonb_array_length(v_res->'falta_en_hacienda') = 0 and jsonb_array_length(v_res->'solo_en_hacienda') = 0
                                              and jsonb_array_length(v_res->'distintas') = 0,
                                     'mes', to_char(v_desde, 'YYYY-MM'), 'cuadrado_at', now());
end $$;
revoke all on function public._verifactu_cuadrar(uuid) from public, anon, authenticated;

-- En real, un cron de cada minuto despierta a conta-verifactu si hay un cuadre
-- pedido (el de envío, verifactu_despertar, solo mira los registros). Solo
-- donde está el cron_secret (producción); en staging se lanza a mano.
create or replace function public.verifactu_despertar_cuadre()
returns void language plpgsql security definer set search_path = public as $$
declare v_secreto text;
begin
  if not exists (select 1 from public.verifactu_cuadre where entorno = 'real' and estado = 'pedido') then return; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'cron_secret';
  if v_secreto is null then
    raise exception 'Falta cron_secret en el Vault: no se puede despertar a conta-verifactu.' using errcode = '55000';
  end if;
  perform net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/conta-verifactu',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
    body := '{"accion":"cuadre"}'::jsonb, timeout_milliseconds := 150000);
end $$;
revoke all on function public.verifactu_despertar_cuadre() from public, anon, authenticated;
comment on function public.verifactu_despertar_cuadre() is
  'V03 E3 · Cada minuto (cron verifactu-cuadre, solo en producción): si hay un «Comprobar con Hacienda» de real pedido, llama a conta-verifactu con accion cuadre. Si falta el secreto, falla (cron lo apunta), no calla.';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from vault.secrets where name = 'cron_secret') then
    if exists (select 1 from cron.job where jobname = 'verifactu-cuadre') then perform cron.unschedule('verifactu-cuadre'); end if;
    perform cron.schedule('verifactu-cuadre', '* * * * *', $cron$select public.verifactu_despertar_cuadre()$cron$);
  end if;
end $$;
