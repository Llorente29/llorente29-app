-- supabase/migrations/20261121T2150_k10b_cabecera_recibida.sql
--
-- K10b · La cabecera de la recibida, como ERP10 (auditoría de la recibida frente a ERP10; Julio, 21/11):
-- el tipo de operación por factura, el trimestre en que se deduce, el concepto del asiento y las
-- observaciones. La marca ya tenía su sitio (supplier_invoice.brand_id, D01).
--
-- Columnas nuevas en supplier_invoice, que admiten nulos y nacen vacías (no se toca ninguna fila):
--   · vat_operation: el tipo de operación de ESTA factura, cuando se cambia en ella. Vacío = el de su
--     ficha, que es lo que la base y la propuesta han usado siempre (país, NIF-IVA, VIES y régimen del
--     proveedor: conta_proveedor_iva_clase). Por eso las que ya existen no se rellenan: vacías dicen
--     exactamente lo que decían (regla 31), sin escribir en las recibidas de producción, que tienen diez
--     disparadores al cambiar (casar, pasar sola, pagos…). Los valores, los de ERP10.
--   · deduct_from: el primer día del trimestre en que se deduce, si se elige uno que no es el suyo.
--     Vacío = el de siempre: su fecha, o el primer día abierto si su trimestre tiene el 303 presentado
--     (conta_recibida_fecha). El trimestre lo sigue mandando la fecha del asiento (Julio, 21/11): la
--     propuesta pone el asiento en este día (o en su fecha, si es más tarde); la factura no cambia.
--   · entry_concept: el concepto del asiento escrito a mano. Vacío = el propuesto.
-- Las observaciones van en supplier_invoice.notes, que ya existía (texto libre, no va al asiento).
--
-- conta_recibida_cabecera(p_invoice, p_cambios, p_quien_nombre): guarda esas casillas y la marca, con
-- las mismas puertas que conta_recibida_guardar (de tu cuenta; ni anulada ni descartada ni
-- contabilizada), deja su rastro en supplier_invoice_change y quita el asiento propuesto si lo cambiado le
-- afecta. Nunca deja un trimestre presentado ni anterior al de la factura (Julio, 27/10: el IVA
-- presentado no se toca).
--
-- La regla 11 que lee el tipo de operación de la factura va aparte, en la 2151 (cambia): esta solo AÑADE,
-- y así va de verdad a staging desde la rama (W05) y la e2e ve sus columnas.
--
-- sin hueco: el fichero no retira nada al aplicarse. Solo conta_recibida_cabecera, al cambiar lo que afecta al asiento, quita
-- el asiento PROPUESTO (nunca uno validado) de esa recibida, como conta_recibida_guardar (0790): se vuelve a proponer al
-- abrirla o validarla, y un asiento propuesto no tiene número en la serie.
-- Nada en el camino del pedido: ningún pedido escribe recibidas.
-- Vuelta atrás: supabase/vuelta-atras/20261121T2150_k10b_cabecera_recibida.down.sql (después de la de la 2151)

alter table public.supplier_invoice add column if not exists vat_operation text
  constraint supplier_invoice_vat_operation_check check (vat_operation in ('interior', 'isp_interior', 'intra_bienes', 'intra_servicios', 'fuera_ue', 'exenta'));
alter table public.supplier_invoice add column if not exists deduct_from date;
alter table public.supplier_invoice add column if not exists entry_concept text;
comment on column public.supplier_invoice.vat_operation is
  'K10b · El tipo de operación de esta factura, si se cambió en ella (como ERP10): interior, isp_interior, intra_bienes, intra_servicios, fuera_ue o exenta. Nulo = el de su ficha (conta_proveedor_iva_clase).';
comment on column public.supplier_invoice.deduct_from is
  'K10b · El primer día del trimestre en que se deduce, si se eligió uno distinto del suyo. Nulo = su fecha, o el primer día abierto (conta_recibida_fecha). Nunca uno presentado.';
comment on column public.supplier_invoice.entry_concept is
  'K10b · El concepto del asiento, escrito a mano. Nulo = el propuesto.';

-- La clase de IVA de un tipo de operación: la que entiende la regla 11 (y conta_proveedor_iva_clase).
create or replace function public.conta_operacion_clase(p_operacion text)
returns text language sql immutable set search_path = public as $$
  select case p_operacion
    when 'interior' then 'nacional'
    when 'isp_interior' then 'isp_nacional'
    when 'intra_bienes' then 'intracomunitaria'
    when 'intra_servicios' then 'intracomunitaria'
    when 'fuera_ue' then 'isp_extranjero'
    when 'exenta' then 'exenta'
    else null end
$$;
comment on function public.conta_operacion_clase(text) is
  'K10b · La clase de IVA (la de conta_proveedor_iva_clase, y «exenta») de un tipo de operación de la factura; null si no tiene.';

create or replace function public.conta_operacion_nombre(p_operacion text)
returns text language sql immutable set search_path = public as $$
  select case p_operacion
    when 'interior' then 'Operaciones interiores'
    when 'isp_interior' then 'Inversión del sujeto pasivo'
    when 'intra_bienes' then 'Adquisición intracomunitaria de bienes'
    when 'intra_servicios' then 'Adquisición intracomunitaria de servicios'
    when 'fuera_ue' then 'Fuera de la UE (inversión del sujeto pasivo)'
    when 'exenta' then 'Exenta o no sujeta'
    else p_operacion end
$$;

-- Guardar la cabecera: el tipo de operación, el trimestre, el concepto, las observaciones y la marca.
create or replace function public.conta_recibida_cabecera(p_invoice uuid, p_cambios jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_c jsonb := coalesce(p_cambios, '{}'::jsonb);
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_claves constant text[] := array['operacion', 'deduce_en', 'concepto', 'observaciones', 'marca'];
  v_raras text[];
  v_cambios jsonb := '[]'::jsonb;
  v_textos text[] := '{}';
  v_al_asiento boolean := false;
  v_quitados int := 0;
  v_txt text; v_dia date; v_uuid uuid; v_p jsonb; v_abierto date; v_suyo date;
  v_op text; v_deduce date; v_concepto text; v_notas text; v_marca uuid;
begin
  if jsonb_typeof(v_c) <> 'object' then
    raise exception 'Los cambios no se entienden: tiene que ser un objeto con lo que cambia.' using errcode = '22023';
  end if;
  select array_agg(k order by k) into v_raras from jsonb_object_keys(v_c) k where not (k = any (v_claves));
  if v_raras is not null then
    raise exception 'No sé guardar: %. Lo que sé guardar aquí: %.', array_to_string(v_raras, ', '), array_to_string(v_claves, ', ') using errcode = '22023';
  end if;
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'
                and e.source_id = v_f.id and e.status = 'validado') then
    raise exception 'Ya está contabilizada: para cambiarla, anula su asiento.' using errcode = '22023';
  end if;
  v_op := v_f.vat_operation; v_deduce := v_f.deduct_from; v_concepto := v_f.entry_concept; v_notas := v_f.notes; v_marca := v_f.brand_id;

  -- El tipo de operación («» o null: el de su ficha).
  if v_c ? 'operacion' then
    v_txt := nullif(trim(v_c ->> 'operacion'), '');
    if v_txt is not null and public.conta_operacion_clase(v_txt) is null then
      raise exception 'No conozco el tipo de operación «%».', v_txt using errcode = '22023';
    end if;
    if v_txt is distinct from v_f.vat_operation then
      v_op := v_txt; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'operacion', 'antes', v_f.vat_operation, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Tipo de operación: %s', coalesce(public.conta_operacion_nombre(v_txt), 'el de su ficha')));
    end if;
  end if;

  -- El trimestre en que se deduce (su primer día; «» o null: el suyo).
  if v_c ? 'deduce_en' then
    v_dia := nullif(v_c ->> 'deduce_en', '')::date;
    if v_dia is not null then
      if v_f.invoice_date is null then raise exception 'Sin la fecha de la factura no se elige el trimestre.' using errcode = '22023'; end if;
      v_dia := date_trunc('quarter', v_dia)::date;
      v_suyo := date_trunc('quarter', v_f.invoice_date)::date;
      if v_dia < v_suyo then
        raise exception 'No se deduce antes de su fecha: la factura es del %, y el % es anterior.', to_char(v_f.invoice_date, 'DD/MM/YYYY'),
          public.conta_iva_periodo_frase('', extract(quarter from v_dia)::int || 'T', extract(year from v_dia)::int) using errcode = '22023';
      end if;
      v_p := public.conta_iva_presentado(v_f.company_id, v_dia);
      if v_p is not null then
        raise exception 'El IVA % ya está presentado: no se deduce ahí. El IVA presentado no se toca.',
          public.conta_iva_periodo_frase('de', v_p->>'periodo', (v_p->>'ejercicio')::int) using errcode = '23514';
      end if;
      v_abierto := public.conta_primer_dia_iva_abierto(v_f.company_id, v_dia);
      if v_abierto is null or v_abierto >= (v_dia + interval '3 months')::date then
        raise exception 'El trimestre del % no está abierto: elige uno abierto.', to_char(v_dia, 'DD/MM/YYYY') using errcode = '23514';
      end if;
      if v_dia = v_suyo then v_dia := null; end if;   -- el suyo: lo de siempre
    end if;
    if v_dia is distinct from v_f.deduct_from then
      v_deduce := v_dia; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'deduce_en', 'antes', v_f.deduct_from, 'ahora', v_dia);
      v_textos := array_append(v_textos, format('Se deduce en: %s', case when v_dia is null then 'el suyo'
        else extract(quarter from v_dia)::int || 'T de ' || extract(year from v_dia)::int end));
    end if;
  end if;

  -- El concepto del asiento («» o null: el propuesto).
  if v_c ? 'concepto' then
    v_txt := nullif(trim(v_c ->> 'concepto'), '');
    if length(v_txt) > 200 then raise exception 'El concepto del asiento, como mucho 200 letras.' using errcode = '22023'; end if;
    if v_txt is distinct from v_f.entry_concept then
      v_concepto := v_txt; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'concepto', 'antes', v_f.entry_concept, 'ahora', v_txt);
      v_textos := array_append(v_textos, case when v_txt is null then 'Concepto: el propuesto' else format('Concepto: «%s»', v_txt) end);
    end if;
  end if;

  -- Las observaciones: no van al asiento.
  if v_c ? 'observaciones' then
    v_txt := nullif(trim(v_c ->> 'observaciones'), '');
    if length(v_txt) > 2000 then raise exception 'Las observaciones, como mucho 2.000 letras.' using errcode = '22023'; end if;
    if v_txt is distinct from v_f.notes then
      v_notas := v_txt;
      v_cambios := v_cambios || jsonb_build_object('campo', 'observaciones', 'antes', v_f.notes, 'ahora', v_txt);
      v_textos := array_append(v_textos, case when v_txt is null then 'Sin observaciones' else 'Observaciones' end);
    end if;
  end if;

  -- La marca: una de la cuenta, activa (null: sin marca).
  if v_c ? 'marca' then
    v_uuid := nullif(v_c ->> 'marca', '')::uuid;
    if v_uuid is not null and not exists (select 1 from public.brand b where b.id = v_uuid and b.account_id = v_f.account_id) then
      raise exception 'Esa marca no es de esta cuenta.' using errcode = '42501';
    end if;
    if v_uuid is distinct from v_f.brand_id then
      v_marca := v_uuid; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'marca', 'antes', v_f.brand_id, 'ahora', v_uuid);
      v_textos := array_append(v_textos, format('Marca: %s', coalesce((select b.name from public.brand b where b.id = v_uuid), 'sin marca')));
    end if;
  end if;

  if jsonb_array_length(v_cambios) = 0 then
    return jsonb_build_object('guardado', '[]'::jsonb, 'texto', 'No había nada que guardar: todo estaba como está.', 'asiento_quitado', false);
  end if;
  update public.supplier_invoice
     set vat_operation = v_op, deduct_from = v_deduce, entry_concept = v_concepto, notes = v_notas, brand_id = v_marca, updated_at = now()
   where id = v_f.id;
  if v_al_asiento then
    delete from public.journal_entry e
     where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
    get diagnostics v_quitados = row_count;
  end if;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', v_cambios);
  return jsonb_build_object(
    'guardado', (select jsonb_agg(x->>'campo') from jsonb_array_elements(v_cambios) x),
    'texto', 'Guardado: ' || array_to_string(v_textos, ', ') || '.'
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez con lo nuevo.' else '' end,
    'asiento_quitado', v_quitados > 0);
end $$;
comment on function public.conta_recibida_cabecera(uuid, jsonb, text) is
  'K10b · Guarda la cabecera de una recibida sin contabilizar: el tipo de operación, el trimestre en que se deduce (nunca uno presentado), el concepto del asiento, las observaciones y la marca. Deja su rastro en supplier_invoice_change.';
revoke all on function public.conta_recibida_cabecera(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_recibida_cabecera(uuid, jsonb, text) to authenticated;

