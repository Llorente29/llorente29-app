-- Vuelta atrás de 20261019T0160_diez_numeracion.sql.
--
-- Deja journal_entry_validar y conta_diez_importar como estaban (20261014T0140
-- y 20261019T0150, copiados tal cual), quita conta_diez_historico_traido y la
-- columna history_imported_at. Lo traído se queda: no se borra libro. Si ya se
-- marcó un histórico como traído, esa fecha se pierde.

create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_debe numeric; v_haber numeric; v_n int; v_numero int; v_seq bigint; v_prev text; v_hash text;
  v_mal text; v_cierre boolean;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida asientos.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then
    raise exception 'El asiento ya está %.', v_e.status using errcode = '23514';
  end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then raise exception 'Un asiento lleva al menos dos apuntes.' using errcode = '23514'; end if;
  if v_debe <> v_haber then
    raise exception 'No cuadra: Debe % y Haber %, diferencia %.', v_debe, v_haber, v_debe - v_haber using errcode = '23514';
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    raise exception 'La fecha % no es del ejercicio %.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code using errcode = '23514';
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      raise exception 'El ejercicio % está cerrado.', v_y.code using errcode = '23514';
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      raise exception 'Hasta el % el ejercicio % es traído de %: la fecha abierta más cercana es el %.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY') using errcode = '23514';
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      raise exception 'El mes de % está cerrado: la fecha abierta más cercana es el %.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna') using errcode = '23514';
    end if;

    -- C05 (respuesta 3): un asiento de cierre o de apertura deja a cero (o
    -- repone) las cuentas de IVA y de retenciones; no es una factura ni entra
    -- en el libro registro. Solo él se libra de las dos reglas de IVA y
    -- retención, y solo si lo hizo el generador de cierre: origen closing u
    -- opening, ENLAZADO en fiscal_year_closing a su ejercicio (la apertura, al
    -- cierre del ejercicio anterior) y con la marca del generador en reasons.
    -- Un closing suelto, o hecho a mano, sigue pasando la regla de IVA.
    -- El contraasiento de uno de esos asientos (reabrir el ejercicio los anula)
    -- también: lleva los mismos apuntes al revés. La condición se mira sobre el
    -- asiento ORIGINAL, que en ese momento sigue enlazado.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- Regla 5: IVA coherente. La cuota es el importe del apunte y = base × tipo, al
    -- céntimo, redondeando por factura: un resumen de n facturas admite medio
    -- céntimo por factura (floor(n/2) céntimos); una sola factura, ninguno.
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > floor(l.tax_documents / 2.0) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then raise exception 'No se valida: %.', v_mal using errcode = '23514'; end if;
  end if;

  -- Regla 2: número siguiente de su serie en el ejercicio, sin huecos. Huella encadenada.
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e.company_id, 0));
  select coalesce(max(number), 0) + 1 into v_numero from public.journal_entry
   where company_id = v_e.company_id and fiscal_year_id = v_e.fiscal_year_id and series = v_e.series and number is not null;
  select chain_seq, hash into v_seq, v_prev from public.journal_entry
   where company_id = v_e.company_id and chain_seq is not null order by chain_seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;

  update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = auth.uid(),
         validated_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()), chain_seq = v_seq, prev_hash = v_prev,
         hash = 'pendiente'
   where id = p_entry;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(p_entry));
  -- La huella se escribe en la misma transacción: el disparador deja pasar este
  -- cambio porque el asiento acaba de validarse (journal_entry_inalterable, 0100).
  perform set_config('folvy.journal_huella', p_entry::text, true);
  update public.journal_entry set hash = v_hash where id = p_entry;
  perform set_config('folvy.journal_huella', '', true);
  return jsonb_build_object('id', p_entry, 'serie', v_e.series, 'numero', v_numero, 'huella', v_hash);
end $function$;

create or replace function public.conta_diez_importar(p_company uuid, p_run uuid, p_asientos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cuenta uuid; a jsonb; l jsonb; v_y public.fiscal_year; v_e public.journal_entry;
  v_clave text; v_serie int; v_numero int; v_fecha date; v_ej text; v_huella text;
  v_id uuid; v_ca uuid; v_faltan text[]; v_debe numeric; v_haber numeric; v_n int;
  v_seq bigint; v_prev text; v_hash text; v_concepto text;
  n_traidos int := 0; n_estaban int := 0; distintos jsonb := '[]'::jsonb; rechazos jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.import_run r where r.id = p_run and r.company_id = p_company and r.status = 'en_curso'
                 and r.kind in ('historico', 'al_dia')) then
    raise exception 'Esa lectura no es de esta empresa, no trae asientos o ya terminó.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_asientos) <> 'array' then raise exception 'Falta la lista de asientos.' using errcode = '22023'; end if;

  for a in select * from jsonb_array_elements(p_asientos) loop
    v_ej := a ->> 'ejercicio'; v_serie := (a ->> 'serie')::int; v_numero := (a ->> 'numero')::int;
    v_fecha := (a ->> 'fecha')::date; v_huella := a ->> 'huella';
    v_clave := format('%s/%s/%s', v_ej, v_serie, v_numero);
    begin
      -- Ya traído: igual o distinto, nunca dos veces.
      select * into v_e from public.journal_entry
       where company_id = p_company and external_program = 'diez' and external_year = v_ej
         and external_series = v_serie::text and external_number = v_numero::text;
      if v_e.id is not null then
        if v_e.external_hash = v_huella then n_estaban := n_estaban + 1;
        else distintos := distintos || jsonb_build_object('clave', v_clave, 'id', v_e.id); end if;
        continue;
      end if;

      if v_serie not in (1, 2, 3, 4, 9) then raise exception 'la serie % no es de Folvy', v_serie using errcode = '22023'; end if;
      select * into v_y from public.fiscal_year where company_id = p_company and code = v_ej;
      if v_y.id is null then raise exception 'el ejercicio % no existe en Folvy', v_ej using errcode = '22023'; end if;
      if v_y.origin = 'folvy' then raise exception 'el ejercicio % es de Folvy, no traído', v_ej using errcode = '22023'; end if;
      if v_fecha not between v_y.starts_on and v_y.ends_on then
        raise exception 'la fecha % no es del ejercicio %', v_fecha, v_ej using errcode = '22023';
      end if;
      if v_y.imported_until is not null and v_fecha > v_y.imported_until then
        raise exception 'el % es posterior al corte de lo traído (%)', v_fecha, v_y.imported_until using errcode = '22023';
      end if;
      if v_y.status <> 'open' then
        raise exception 'el ejercicio % está cerrado: se trae antes de cerrarlo', v_ej using errcode = '22023';
      end if;
      if exists (select 1 from public.journal_entry where company_id = p_company and fiscal_year_id = v_y.id
                  and series = v_serie and number = v_numero) then
        raise exception 'el número %/% de % ya lo tiene un asiento de Folvy', v_serie, v_numero, v_ej using errcode = '23505';
      end if;
      select array_agg(distinct x ->> 'cuenta') into v_faltan from jsonb_array_elements(a -> 'lineas') x
       where not exists (select 1 from public.company_account c where c.company_id = p_company and c.code = x ->> 'cuenta');
      if v_faltan is not null then
        raise exception 'faltan en el plan las subcuentas %', array_to_string(v_faltan, ', ') using errcode = '22023';
      end if;

      v_concepto := coalesce(nullif(trim(a ->> 'concepto'), ''), format('Asiento %s/%s traído de Diez', v_serie, v_numero));
      insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                        reasons, external_program, external_year, external_series, external_number, external_hash,
                                        import_run_id, created_by_name)
      values (v_cuenta, p_company, v_y.id, v_serie, v_fecha, v_concepto, 'migrated', 'borrador',
              jsonb_build_array(jsonb_build_object('decision', 'traido-de-diez',
                'porque', format('Asiento %s de Diez (tipo %s)', v_clave, coalesce(a ->> 'tipoAsiento', '—')))),
              'diez', v_ej, v_serie::text, v_numero::text, v_huella, p_run, 'Diez (traído)')
      returning id into v_id;

      for l in select * from jsonb_array_elements(a -> 'lineas') loop
        select id into v_ca from public.company_account where company_id = p_company and code = l ->> 'cuenta';
        insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                         external_counterpart, external_voucher, external_negative_side)
        values (v_cuenta, p_company, v_id, (l ->> 'posicion')::smallint, v_ca, (l ->> 'debe')::numeric / 100, (l ->> 'haber')::numeric / 100,
                nullif(l ->> 'concepto', ''), nullif(l ->> 'contrapartida', ''), nullif(l ->> 'justificante', ''), l ->> 'negativoEnDiez');
      end loop;

      -- Regla 1, otra vez en la base: dos líneas al menos, y cuadra al céntimo.
      select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber from public.journal_line where entry_id = v_id;
      if v_n < 2 then raise exception 'tiene % línea(s)', v_n using errcode = '23514'; end if;
      if v_debe <> v_haber then raise exception 'no cuadra: debe % y haber %', v_debe, v_haber using errcode = '23514'; end if;

      -- Validado con el número de Diez y encadenado, como journal_entry_validar.
      perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || p_company, 0));
      select chain_seq, hash into v_seq, v_prev from public.journal_entry
       where company_id = p_company and chain_seq is not null order by chain_seq desc limit 1;
      v_seq := coalesce(v_seq, 0) + 1;
      update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = null,
             validated_by_name = 'Diez (traído)', chain_seq = v_seq, prev_hash = v_prev, hash = 'pendiente'
       where id = v_id;
      v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(v_id));
      perform set_config('folvy.journal_huella', v_id::text, true);
      update public.journal_entry set hash = v_hash where id = v_id;
      perform set_config('folvy.journal_huella', '', true);

      -- Cómo estaba en Diez al leerlo: lo que compara el día a día.
      insert into public.external_entry_snapshot (account_id, company_id, program, ext_year, ext_series, ext_number, entry_date, lines,
                                                  total_debit, total_credit, hash, import_run_id)
      values (v_cuenta, p_company, 'diez', v_ej, v_serie::text, v_numero, v_fecha, a -> 'lineas', v_debe, v_haber, v_huella, p_run)
      on conflict (company_id, program, ext_year, ext_series, ext_number)
      do update set entry_date = excluded.entry_date, lines = excluded.lines, total_debit = excluded.total_debit,
                    total_credit = excluded.total_credit, hash = excluded.hash, import_run_id = excluded.import_run_id, read_at = now();
      n_traidos := n_traidos + 1;
    exception when others then
      rechazos := rechazos || jsonb_build_object('clave', v_clave, 'motivo', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('traidos', n_traidos, 'yaEstaban', n_estaban, 'distintos', distintos, 'rechazados', rechazos);
end $$;

drop function if exists public.conta_diez_historico_traido(uuid, text);
alter table public.fiscal_year drop column if exists history_imported_at;
