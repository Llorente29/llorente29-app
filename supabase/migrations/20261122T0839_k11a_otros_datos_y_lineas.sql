-- supabase/migrations/20261122T0839_k11a_otros_datos_y_lineas.sql
--
-- K11a · La base de la ficha de la recibida copiada de ERP10 (Julio, 22/11; diseno_ficha_factura_definitivo.md).
-- Lo que la maqueta pide y no tenía dónde guardarse, menos las fechas contable y fiscal (van en el K11f) y los
-- varios pagos (K10c). SOLO AÑADE: no escribe en ninguna fila que exista.
--
--   1. Dos catálogos globales, sin account_id (como vat_rate), con los códigos de la AEAT:
--      · conta_tipo_factura: F1…F6, R1…R5 y LC;
--      · conta_clave_regimen: las claves de régimen especial de las recibidas (01…09, 12, 13, 14, 18, 19),
--        con las descripciones de ERP10.
--   2. «Otros datos» de la factura, en supplier_invoice, columnas que admiten nulos. Vacío = lo de siempre:
--      · invoice_type (tipo de factura) y regime_key (clave de régimen): vacíos, los que da
--        conta_recibida_por_defecto (F1 y 01, o lo que diga la factura: R4 si es un abono, 09 si su tipo de
--        operación es intracomunitario, 12 si su retención es del 115, la del arrendamiento);
--      · exclude_from_vat_return («No incluir en declaración de IVA»), deduction_rectification
--        («Rectificación de deducciones») y exclude_from_347 («No incluir en modelo 347»): vacíos = no;
--      · vat_deductible_pct («% IVA deducible»): de 0 a 100; vacío = 100.
--   3. Los datos de cada línea de gasto: su concepto, su marca y su plataforma, en
--      supplier_invoice_expense_dato (por factura y posición, como supplier_invoice_expense). Tabla aparte y no
--      columnas de supplier_invoice_expense porque conta_recibida_guardar borra y vuelve a poner sus líneas al
--      cambiar el reparto, y se perderían; esa función no se toca (es del X26).
--   4. La plataforma en la línea del asiento: journal_line.channel_id (el canal: Glovo, Uber Eats…), como el
--      local y la marca. La escribe la propuesta (la 0840 cambia _journal_entry_proponer).
--   5. conta_recibida_otros_datos(p_invoice, p_cambios, p_quien_nombre): guarda lo de los puntos 2 y 3, con las
--      mismas puertas que conta_recibida_cabecera (de tu cuenta; ni anulada ni descartada ni contabilizada), deja
--      su rastro en supplier_invoice_change y quita el asiento propuesto si lo cambiado le afecta.
--
-- sin hueco: el fichero no retira nada al aplicarse. Solo conta_recibida_otros_datos, al cambiar lo que afecta al
-- asiento, quita el asiento PROPUESTO (nunca uno validado) de esa recibida, como conta_recibida_guardar (0790) y
-- conta_recibida_cabecera (2150): se vuelve a proponer al abrirla o validarla, sin número en la serie.
-- Nada en el camino del pedido: ningún pedido escribe recibidas.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0839_k11a_otros_datos_y_lineas.down.sql (después de la de la 0840).

-- 1 · Los catálogos.
create table if not exists public.conta_tipo_factura (
  code text primary key,
  nombre text not null,
  orden smallint not null default 0
);
comment on table public.conta_tipo_factura is 'K11a · Tipos de factura de la AEAT (SII): F1…F6, R1…R5 y LC. Catálogo global, sin cuenta.';
alter table public.conta_tipo_factura enable row level security;
revoke all on table public.conta_tipo_factura from public, anon, authenticated;
grant select on table public.conta_tipo_factura to authenticated;
drop policy if exists conta_tipo_factura_leer on public.conta_tipo_factura;
create policy conta_tipo_factura_leer on public.conta_tipo_factura for select to authenticated using (true);
insert into public.conta_tipo_factura (code, nombre, orden) values
  ('F1', 'Factura (art. 6, 7.2 y 7.3 RD 1619/2012)', 1),
  ('F2', 'Factura simplificada y facturas sin identificación del destinatario (art. 6.1.d RD 1619/2012)', 2),
  ('F3', 'Factura emitida en sustitución de facturas simplificadas facturadas y declaradas', 3),
  ('F4', 'Asiento resumen de facturas', 4),
  ('F5', 'Importaciones (DUA)', 5),
  ('F6', 'Justificantes contables', 6),
  ('R1', 'Factura rectificativa (error fundado en derecho y art. 80 Uno, Dos y Seis LIVA)', 7),
  ('R2', 'Factura rectificativa (art. 80.3 LIVA)', 8),
  ('R3', 'Factura rectificativa (art. 80.4 LIVA)', 9),
  ('R4', 'Factura rectificativa (resto)', 10),
  ('R5', 'Factura rectificativa en facturas simplificadas', 11),
  ('LC', 'Aduanas · liquidación complementaria', 12)
on conflict (code) do nothing;

create table if not exists public.conta_clave_regimen (
  code text primary key,
  nombre text not null,
  orden smallint not null default 0
);
comment on table public.conta_clave_regimen is 'K11a · Claves de régimen especial de las facturas recibidas (AEAT, SII), con las descripciones de ERP10. Catálogo global, sin cuenta.';
alter table public.conta_clave_regimen enable row level security;
revoke all on table public.conta_clave_regimen from public, anon, authenticated;
grant select on table public.conta_clave_regimen to authenticated;
drop policy if exists conta_clave_regimen_leer on public.conta_clave_regimen;
create policy conta_clave_regimen_leer on public.conta_clave_regimen for select to authenticated using (true);
insert into public.conta_clave_regimen (code, nombre, orden) values
  ('01', 'Operación de régimen general', 1),
  ('02', 'Operaciones por las que los empresarios satisfacen compensaciones en las adquisiciones a personas acogidas al R.E.A.G.P.', 2),
  ('03', 'Operaciones a las que se aplique el régimen especial de bienes usados, objetos de arte, antigüedades y objetos de colección', 3),
  ('04', 'Régimen especial del oro de inversión', 4),
  ('05', 'Régimen especial de las agencias de viajes', 5),
  ('06', 'Régimen especial grupo de entidades en IVA (Nivel Avanzado)', 6),
  ('07', 'Régimen especial del criterio de Caja', 7),
  ('08', 'Operaciones sujetas al IPSI/IGIC (Impuesto sobre la producción, los servicios y la importación / impuesto general indirecto Canario)', 8),
  ('09', 'Adquisiciones intracomunitarias de bienes y prestaciones de servicios', 9),
  ('12', 'Operaciones de arrendamiento de local de negocio', 12),
  ('13', 'Factura correspondiente a una importación (informada sin asociar un DUA)', 13),
  ('14', 'Primer semestre de 2017 y otras facturas anteriores a la inclusión en el SII', 14),
  ('18', 'Operaciones de actividades incluidas en el Régimen Especial de Recargo de Equivalencia (RERE)', 18),
  ('19', 'Operaciones de actividades incluidas en el Régimen Especial de Agricultura, Ganadería y Pesca (REAGYP)', 19)
on conflict (code) do nothing;

-- 2 · «Otros datos» de la factura.
alter table public.supplier_invoice add column if not exists invoice_type text references public.conta_tipo_factura(code);
alter table public.supplier_invoice add column if not exists regime_key text references public.conta_clave_regimen(code);
alter table public.supplier_invoice add column if not exists exclude_from_vat_return boolean;
alter table public.supplier_invoice add column if not exists deduction_rectification boolean;
alter table public.supplier_invoice add column if not exists exclude_from_347 boolean;
alter table public.supplier_invoice add column if not exists vat_deductible_pct numeric(5,2)
  constraint supplier_invoice_vat_deductible_pct_check check (vat_deductible_pct between 0 and 100);
comment on column public.supplier_invoice.invoice_type is 'K11a · Tipo de factura (conta_tipo_factura), si se eligió en esta factura. Nulo = conta_recibida_por_defecto.';
comment on column public.supplier_invoice.regime_key is 'K11a · Clave de régimen especial (conta_clave_regimen), si se eligió en esta factura. Nulo = conta_recibida_por_defecto.';
comment on column public.supplier_invoice.exclude_from_vat_return is 'K11a · «No incluir en declaración de IVA» (Otros datos de ERP10). Nulo = no.';
comment on column public.supplier_invoice.deduction_rectification is 'K11a · «Rectificación de deducciones» (Otros datos de ERP10). Nulo = no.';
comment on column public.supplier_invoice.exclude_from_347 is 'K11a · «No incluir en modelo 347» (Otros datos de ERP10). Nulo = no.';
comment on column public.supplier_invoice.vat_deductible_pct is 'K11a · % de IVA deducible, de 0 a 100 (el coche al 50 %). Nulo = 100. La propuesta lleva lo no deducible a la cuenta de gasto de su línea.';

-- Lo que da la factura si no se eligió: F1 y 01, o lo que diga ella (R4 si es un abono; 09 si su tipo de
-- operación es intracomunitario; 12 si su retención es del 115, la del arrendamiento de local).
create or replace function public.conta_recibida_por_defecto(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tipo_factura', case when i.doc_kind = 'credit_note' then 'R4' else 'F1' end,
    'clave_regimen', case
      when i.vat_operation in ('intra_bienes', 'intra_servicios') then '09'
      when exists (select 1 from public.withholding_rate w where w.id = i.withholding_rate_id and w.filed_in = '115') then '12'
      else '01' end)
    from public.supplier_invoice i
   where i.id = p_invoice and public.belongs_to_account(i.account_id)
$$;
comment on function public.conta_recibida_por_defecto(uuid) is
  'K11a · El tipo de factura y la clave de régimen que da una recibida si no se eligieron en ella: F1 (R4 si es un abono) y 01 (09 si su tipo de operación es intracomunitario, 12 si su retención es del 115).';
revoke all on function public.conta_recibida_por_defecto(uuid) from public, anon;
grant execute on function public.conta_recibida_por_defecto(uuid) to authenticated;

-- 3 · Los datos de cada línea de gasto.
create table if not exists public.supplier_invoice_expense_dato (
  account_id uuid not null references public.accounts(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  position int not null check (position >= 0),
  concept text check (length(concept) <= 200),
  brand_id uuid references public.brand(id) on delete set null,
  channel_id uuid references public.sales_channel(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (supplier_invoice_id, position)
);
comment on table public.supplier_invoice_expense_dato is
  'K11a · El concepto, la marca y la plataforma de cada línea de gasto de una recibida, por su posición (la de supplier_invoice_expense). Aparte porque conta_recibida_guardar borra y vuelve a poner las líneas del reparto.';
alter table public.supplier_invoice_expense_dato enable row level security;
revoke all on table public.supplier_invoice_expense_dato from public, anon, authenticated;
grant select on table public.supplier_invoice_expense_dato to authenticated;
drop policy if exists supplier_invoice_expense_dato_leer on public.supplier_invoice_expense_dato;
create policy supplier_invoice_expense_dato_leer on public.supplier_invoice_expense_dato for select to authenticated
  using (public.belongs_to_account(account_id));

-- 4 · La plataforma en la línea del asiento.
alter table public.journal_line add column if not exists channel_id uuid references public.sales_channel(id) on delete set null;
comment on column public.journal_line.channel_id is 'K11a · La plataforma (el canal) del apunte, como el local y la marca: la analítica por plataforma.';

-- 5 · Guardar «Otros datos» y los datos de las líneas.
create or replace function public.conta_recibida_otros_datos(p_invoice uuid, p_cambios jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_c jsonb := coalesce(p_cambios, '{}'::jsonb);
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_claves constant text[] := array['tipo_factura', 'clave_regimen', 'no_iva', 'rectificacion', 'no_347', 'iva_deducible', 'lineas'];
  v_raras text[];
  v_cambios jsonb := '[]'::jsonb;
  v_textos text[] := '{}';
  v_al_asiento boolean := false;
  v_quitados int := 0;
  v_txt text; v_bool boolean; v_num numeric; v_l jsonb; v_pos int; v_uuid uuid; v_antes jsonb; v_ahora jsonb;
  v_tipo text; v_clave text; v_no_iva boolean; v_rect boolean; v_no_347 boolean; v_pct numeric;
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
  v_tipo := v_f.invoice_type; v_clave := v_f.regime_key; v_no_iva := v_f.exclude_from_vat_return;
  v_rect := v_f.deduction_rectification; v_no_347 := v_f.exclude_from_347; v_pct := v_f.vat_deductible_pct;

  if v_c ? 'tipo_factura' then
    v_txt := nullif(upper(trim(v_c ->> 'tipo_factura')), '');
    if v_txt is not null and not exists (select 1 from public.conta_tipo_factura t where t.code = v_txt) then
      raise exception 'No conozco el tipo de factura «%».', v_txt using errcode = '22023';
    end if;
    if v_txt is distinct from v_f.invoice_type then
      v_tipo := v_txt;
      v_cambios := v_cambios || jsonb_build_object('campo', 'tipo_factura', 'antes', v_f.invoice_type, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Tipo de factura: %s', coalesce(v_txt, 'el de siempre')));
    end if;
  end if;
  if v_c ? 'clave_regimen' then
    v_txt := nullif(trim(v_c ->> 'clave_regimen'), '');
    if v_txt is not null and not exists (select 1 from public.conta_clave_regimen r where r.code = v_txt) then
      raise exception 'No conozco la clave de régimen «%».', v_txt using errcode = '22023';
    end if;
    if v_txt is distinct from v_f.regime_key then
      v_clave := v_txt;
      v_cambios := v_cambios || jsonb_build_object('campo', 'clave_regimen', 'antes', v_f.regime_key, 'ahora', v_txt);
      v_textos := array_append(v_textos, format('Clave de régimen: %s', coalesce(v_txt, 'la de siempre')));
    end if;
  end if;
  if v_c ? 'no_iva' then
    v_bool := coalesce((v_c ->> 'no_iva')::boolean, false);
    if v_bool is distinct from coalesce(v_f.exclude_from_vat_return, false) then
      v_no_iva := v_bool;
      v_cambios := v_cambios || jsonb_build_object('campo', 'no_iva', 'antes', v_f.exclude_from_vat_return, 'ahora', v_bool);
      v_textos := array_append(v_textos, case when v_bool then 'No incluir en declaración de IVA' else 'Se incluye en la declaración de IVA' end);
    end if;
  end if;
  if v_c ? 'rectificacion' then
    v_bool := coalesce((v_c ->> 'rectificacion')::boolean, false);
    if v_bool is distinct from coalesce(v_f.deduction_rectification, false) then
      v_rect := v_bool;
      v_cambios := v_cambios || jsonb_build_object('campo', 'rectificacion', 'antes', v_f.deduction_rectification, 'ahora', v_bool);
      v_textos := array_append(v_textos, case when v_bool then 'Rectificación de deducciones' else 'Sin rectificación de deducciones' end);
    end if;
  end if;
  if v_c ? 'no_347' then
    v_bool := coalesce((v_c ->> 'no_347')::boolean, false);
    if v_bool is distinct from coalesce(v_f.exclude_from_347, false) then
      v_no_347 := v_bool;
      v_cambios := v_cambios || jsonb_build_object('campo', 'no_347', 'antes', v_f.exclude_from_347, 'ahora', v_bool);
      v_textos := array_append(v_textos, case when v_bool then 'No incluir en modelo 347' else 'Se incluye en el modelo 347' end);
    end if;
  end if;
  if v_c ? 'iva_deducible' then
    v_num := nullif(v_c ->> 'iva_deducible', '')::numeric;
    if v_num is not null and (v_num < 0 or v_num > 100) then
      raise exception 'El %% de IVA deducible va de 0 a 100 (es %).', v_num using errcode = '22023';
    end if;
    if v_num = 100 then v_num := null; end if;   -- 100 es lo de siempre
    if v_num is distinct from v_f.vat_deductible_pct then
      v_pct := v_num; v_al_asiento := true;
      v_cambios := v_cambios || jsonb_build_object('campo', 'iva_deducible', 'antes', v_f.vat_deductible_pct, 'ahora', v_num);
      v_textos := array_append(v_textos, format('IVA deducible: %s %%', coalesce(rtrim(to_char(v_num, 'FM990.99'), '.'), '100')));
    end if;
  end if;

  -- Las líneas: [{posicion, concepto, marca, plataforma}], solo las que se nombran.
  if v_c ? 'lineas' then
    if jsonb_typeof(v_c -> 'lineas') <> 'array' then raise exception 'Las líneas van en una lista.' using errcode = '22023'; end if;
    for v_l in select x from jsonb_array_elements(v_c -> 'lineas') x loop
      v_pos := (v_l ->> 'posicion')::int;
      if v_pos is null or v_pos < 0 then raise exception 'Cada línea lleva su posición (desde 0).' using errcode = '22023'; end if;
      v_uuid := nullif(v_l ->> 'marca', '')::uuid;
      if v_uuid is not null and not exists (select 1 from public.brand b where b.id = v_uuid and b.account_id = v_f.account_id) then
        raise exception 'Esa marca no es de esta cuenta.' using errcode = '42501';
      end if;
      v_uuid := nullif(v_l ->> 'plataforma', '')::uuid;
      if v_uuid is not null and not exists (select 1 from public.sales_channel c where c.id = v_uuid and c.account_id = v_f.account_id) then
        raise exception 'Esa plataforma no es de esta cuenta.' using errcode = '42501';
      end if;
      if length(v_l ->> 'concepto') > 200 then raise exception 'El concepto de una línea, como mucho 200 letras.' using errcode = '22023'; end if;
      select jsonb_build_object('concepto', d.concept, 'marca', d.brand_id, 'plataforma', d.channel_id) into v_antes
        from public.supplier_invoice_expense_dato d where d.supplier_invoice_id = v_f.id and d.position = v_pos;
      v_ahora := jsonb_build_object('concepto', nullif(trim(v_l ->> 'concepto'), ''), 'marca', nullif(v_l ->> 'marca', '')::uuid, 'plataforma', nullif(v_l ->> 'plataforma', '')::uuid);
      if v_ahora is distinct from coalesce(v_antes, jsonb_build_object('concepto', null, 'marca', null, 'plataforma', null)) then
        insert into public.supplier_invoice_expense_dato (account_id, supplier_invoice_id, position, concept, brand_id, channel_id, updated_at)
        values (v_f.account_id, v_f.id, v_pos, v_ahora ->> 'concepto', (v_ahora ->> 'marca')::uuid, (v_ahora ->> 'plataforma')::uuid, now())
        on conflict (supplier_invoice_id, position) do update
          set concept = excluded.concept, brand_id = excluded.brand_id, channel_id = excluded.channel_id, updated_at = now();
        v_al_asiento := true;
        v_cambios := v_cambios || jsonb_build_object('campo', 'linea', 'posicion', v_pos, 'antes', v_antes, 'ahora', v_ahora);
        v_textos := array_append(v_textos, format('Línea %s: %s', v_pos + 1, concat_ws(', ',
          case when v_ahora ->> 'concepto' is not null then format('«%s»', v_ahora ->> 'concepto') end,
          (select b.name from public.brand b where b.id = (v_ahora ->> 'marca')::uuid),
          (select c.name from public.sales_channel c where c.id = (v_ahora ->> 'plataforma')::uuid))));
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_cambios) = 0 then
    return jsonb_build_object('guardado', '[]'::jsonb, 'texto', 'No había nada que guardar: todo estaba como está.', 'asiento_quitado', false);
  end if;
  update public.supplier_invoice
     set invoice_type = v_tipo, regime_key = v_clave, exclude_from_vat_return = v_no_iva, deduction_rectification = v_rect,
         exclude_from_347 = v_no_347, vat_deductible_pct = v_pct, updated_at = now()
   where id = v_f.id;
  if v_al_asiento then
    delete from public.journal_entry e
     where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status in ('propuesto', 'borrador');
    get diagnostics v_quitados = row_count;
  end if;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'guardar', v_cambios);
  return jsonb_build_object(
    'guardado', (select jsonb_agg(distinct x->>'campo') from jsonb_array_elements(v_cambios) x),
    'texto', 'Guardado: ' || array_to_string(v_textos, ', ') || '.'
             || case when v_quitados > 0 then ' Su asiento propuesto se ha quitado para proponerlo otra vez con lo nuevo.' else '' end,
    'asiento_quitado', v_quitados > 0);
end $$;
comment on function public.conta_recibida_otros_datos(uuid, jsonb, text) is
  'K11a · Guarda «Otros datos» de una recibida sin contabilizar (tipo de factura, clave de régimen, no incluir en IVA, rectificación de deducciones, no incluir en 347, % de IVA deducible) y el concepto, la marca y la plataforma de sus líneas de gasto. Deja su rastro en supplier_invoice_change.';
revoke all on function public.conta_recibida_otros_datos(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_recibida_otros_datos(uuid, jsonb, text) to authenticated;
