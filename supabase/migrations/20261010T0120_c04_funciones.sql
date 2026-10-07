-- ============================================================================
-- C04 · Libro diario — 3 · VALIDAR, ANULAR Y COMPROBAR LA CADENA
-- ----------------------------------------------------------------------------
--   · journal_entry_validar: comprueba las reglas que la base puede comprobar
--     (cuadra; fecha dentro del ejercicio, fuera de lo traído y de un mes
--     abierto; IVA con base, tipo, cuota y libro; retención con su modelo;
--     local o «común»), pone el número siguiente de su serie sin huecos y la
--     huella encadenada con el asiento validado anterior de la empresa.
--   · journal_entry_anular: el contraasiento (apuntes al revés), validado,
--     enlazado y con motivo; el original queda «anulado» con su número.
--   · journal_cadena_comprobar: recalcula las huellas y dice dónde se rompe.
--   · conta_primer_dia_abierto: la fecha que se propone cuando el mes está
--     cerrado (regla 4: nunca se cuela).
--   · conta_reabrir_mes: un mes traído no se reabre (copia de la del C00 con
--     esa guarda más).
--   · journal_entry_proponer / _descartar: la propuesta de Folvy entra una
--     vez por documento; descartada, no vuelve.
--   · conta_fijar_corte: la fecha de corte con el programa anterior, como dato.
--   · conta_pedidos_del_dia, conta_devoluciones_del_dia, conta_dias_por_asentar:
--     lo que leen los generadores, solo lectura.
-- Vuelta atrás: supabase/vuelta-atras/20261010T0120_c04_funciones.down.sql
-- ============================================================================

-- ── 0 · Lo que entra en la huella ───────────────────────────────────────────
-- Texto canónico del asiento y sus apuntes, en orden. Si cambia una coma de lo
-- validado, cambia la huella; la del siguiente ya no encadena.
create or replace function public.journal_entry_canonico(p_entry uuid)
returns text language sql stable security definer set search_path = public as $$
  select concat_ws('|',
           e.id, e.company_id, e.fiscal_year_id, e.series, e.number, e.entry_date, e.concept, e.source_type,
           coalesce(e.source_id::text, ''), coalesce(e.party_id::text, ''), coalesce(e.document_ref, ''),
           coalesce(e.document_date::text, ''), coalesce(e.external_program, ''), coalesce(e.external_series, ''),
           coalesce(e.external_number, ''), coalesce(e.reverses_entry_id::text, ''))
         || '#' ||
         coalesce((select string_agg(concat_ws(':',
                    l.position, a.code, l.debit, l.credit, coalesce(l.location_id::text, ''), l.is_common,
                    coalesce(l.brand_id::text, ''), coalesce(l.party_id::text, ''), coalesce(l.document_ref, ''),
                    coalesce(l.tax_rate_id::text, ''), coalesce(l.tax_base::text, ''), coalesce(l.vat_book, ''),
                    coalesce(l.vat_deductible, ''), l.tax_documents, coalesce(l.withholding_rate_id::text, ''),
                    coalesce(l.withholding_base::text, ''), coalesce(l.withholding_model, '')), ';' order by l.position)
                   from public.journal_line l join public.company_account a on a.id = l.company_account_id
                  where l.entry_id = e.id), '')
    from public.journal_entry e where e.id = p_entry
$$;
revoke all on function public.journal_entry_canonico(uuid) from public, anon;
grant execute on function public.journal_entry_canonico(uuid) to authenticated;

create or replace function public.journal_huella(p_prev text, p_canonico text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(coalesce(p_prev, '') || '>' || p_canonico, 'sha256'), 'hex')
$$;
comment on function public.journal_huella(text, text) is
  'C04. sha256(huella anterior > texto canónico). La primera de la empresa encadena con «» (vacío).';

-- ── 1 · El primer día abierto (regla 4) ─────────────────────────────────────
create or replace function public.conta_primer_dia_abierto(p_company uuid, p_fecha date)
returns date language sql stable set search_path = public as $$
  select min(d)::date
    from generate_series(p_fecha, p_fecha + 400, interval '1 day') d
   where not public.conta_mes_cerrado(p_company, d::date)
     and exists (select 1 from public.fiscal_year y
                  where y.company_id = p_company and y.status = 'open' and d::date between y.starts_on and y.ends_on
                    and (y.imported_until is null or d::date > y.imported_until))
$$;
comment on function public.conta_primer_dia_abierto(uuid, date) is
  'C04. El primer día, desde esa fecha, de un ejercicio abierto, fuera de lo traído y de un mes sin cerrar. NULL si no hay en 400 días.';

-- ── 2 · Validar ─────────────────────────────────────────────────────────────
create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_debe numeric; v_haber numeric; v_n int; v_numero int; v_seq bigint; v_prev text; v_hash text;
  v_mal text;
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

    -- Regla 5: IVA coherente. La cuota es el importe del apunte y = base × tipo, al
    -- céntimo, redondeando por factura: un resumen de n facturas admite medio
    -- céntimo por factura (floor(n/2) céntimos); una sola factura, ninguno.
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > floor(l.tax_documents / 2.0) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null
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
end $$;
revoke all on function public.journal_entry_validar(uuid, text) from public, anon;
grant execute on function public.journal_entry_validar(uuid, text) to authenticated;

-- ── 3 · Anular: contraasiento enlazado, con motivo ──────────────────────────
create or replace function public.journal_entry_anular(p_entry uuid, p_motivo text, p_fecha date default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_fecha date; v_y uuid; v_nuevo uuid; v_r jsonb; v_quien text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(v_e.account_id) then
    raise exception 'Solo un administrador de la cuenta anula asientos.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'Solo se anula un asiento validado (este está %).', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type = 'reversal' then
    raise exception 'Un contraasiento no se anula: si hace falta, se hace el asiento bueno.' using errcode = '23514';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para anular hay que decir por qué.' using errcode = '23514';
  end if;
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_fecha := coalesce(p_fecha, greatest(v_e.entry_date, current_date));
  if public.conta_mes_cerrado(v_e.company_id, v_fecha) then
    v_fecha := public.conta_primer_dia_abierto(v_e.company_id, v_fecha);
  end if;
  select id into v_y from public.fiscal_year
   where company_id = v_e.company_id and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio abierto para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id,
                                    status, party_id, document_ref, document_date, reverses_entry_id, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_y, v_e.series, v_fecha,
          format('Anula %s nº %s: %s', case v_e.series when 1 then 'Ventas' when 2 then 'Compras' when 3 then 'Banco' when 9 then 'Nóminas' else 'General' end, v_e.number, trim(p_motivo)), 'reversal', v_e.id,
          'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), v_quien)
  returning id into v_nuevo;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)
  select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
         location_id, is_common, brand_id, party_id, document_ref, document_date,
         tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
    from public.journal_line where entry_id = v_e.id;
  v_r := public.journal_entry_validar(v_nuevo, v_quien);

  update public.journal_entry set status = 'anulado', voided_by_entry_id = v_nuevo, voided_at = now(), voided_by = auth.uid(),
         voided_by_name = v_quien, void_reason = trim(p_motivo)
   where id = v_e.id;
  return jsonb_build_object('anulado', v_e.id, 'contraasiento', v_nuevo, 'serie', v_r->'serie', 'numero', v_r->'numero', 'fecha', v_fecha);
end $$;
revoke all on function public.journal_entry_anular(uuid, text, date, text) from public, anon;
grant execute on function public.journal_entry_anular(uuid, text, date, text) to authenticated;

-- ── 4 · Comprobar la cadena ─────────────────────────────────────────────────
create or replace function public.journal_cadena_comprobar(p_company uuid)
returns table (chain_seq bigint, entry_id uuid, series smallint, number integer, ok boolean, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_prev text := null; v_esperada text;
begin
  if not exists (select 1 from public.company c where c.id = p_company and public.belongs_to_account(c.account_id)) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  for r in select e.* from public.journal_entry e where e.company_id = p_company and e.chain_seq is not null order by e.chain_seq loop
    v_esperada := public.journal_huella(v_prev, public.journal_entry_canonico(r.id));
    chain_seq := r.chain_seq; entry_id := r.id; series := r.series; number := r.number;
    ok := r.prev_hash is not distinct from v_prev and r.hash = v_esperada;
    motivo := case when r.prev_hash is distinct from v_prev then 'no encadena con el anterior'
                   when r.hash <> v_esperada then 'su contenido no es el que se validó' end;
    return next;
    v_prev := r.hash;
  end loop;
end $$;
revoke all on function public.journal_cadena_comprobar(uuid) from public, anon;
grant execute on function public.journal_cadena_comprobar(uuid) to authenticated;

-- ── 5 · Un mes traído no se reabre ──────────────────────────────────────────
-- Copia LITERAL de la del C00 (20261003T0110) con una guarda más.
create or replace function public.conta_reabrir_mes(p_company uuid, p_mes date, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_mes date := date_trunc('month', p_mes)::date; v_ultimo date; v_id uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta puede reabrir meses' using errcode = '42501';
  end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Para reabrir un mes hay que decir por qué' using errcode = '23514';
  end if;
  select max(month) into v_ultimo from public.fiscal_period_lock where company_id = p_company and reopened_at is null;
  if v_ultimo is distinct from v_mes then
    raise exception 'Solo se puede reabrir el último mes cerrado: %', coalesce(to_char(v_ultimo, 'MM/YYYY'), 'no hay ninguno')
      using errcode = '23514';
  end if;
  -- C04: lo traído de otro programa no se reabre aquí; se corrige allí y se vuelve a traer.
  if exists (select 1 from public.fiscal_period_lock where company_id = p_company and month = v_mes and reopened_at is null and kind = 'migrated') then
    raise exception 'El mes % es traído de otro programa: no se reabre.', to_char(v_mes, 'MM/YYYY') using errcode = '23514';
  end if;
  update public.fiscal_period_lock
     set reopened_at = now(), reopened_by = auth.uid(), reopened_by_name = public.conta_nombre_actor(), reopen_reason = trim(p_motivo)
   where company_id = p_company and month = v_mes and reopened_at is null
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'mes', v_mes);
end $$;

-- ── 6 · El local de una cuenta del banco es de su cuenta (regla 9) ──────────
create or replace function public.treasury_account_local_de_la_cuenta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.location_id is not null and not exists (select 1 from public.locations l where l.id = new.location_id and l.account_id = new.account_id) then
    raise exception 'Ese local no es de esta cuenta.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.treasury_account_local_de_la_cuenta() from public, anon, authenticated;
drop trigger if exists trg_treasury_account_local on public.treasury_account;
create trigger trg_treasury_account_local before insert or update of location_id on public.treasury_account
  for each row execute function public.treasury_account_local_de_la_cuenta();

-- ── 7 · Proponer: la propuesta de Folvy entra como «propuesto», una vez ────
-- La calcula el núcleo (src/modules/conta/lib/asientosPropuestos.ts) y entra
-- aquí con sus apuntes, en una transacción. Un documento, un asiento vivo: si
-- ya hay uno, devuelve ese; si se descartó, no la vuelve a meter.
create or replace function public.journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone asientos.' using errcode = '42501';
  end if;
  if v_tipo = 'sales_day' then
    v_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo and d.source_key = v_clave) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), auth.uid())
      returning id into v_resumen;
    else
      update public.sales_day_summary set tickets_count = (p_summary->>'tickets_count')::int, total = (p_summary->>'total')::numeric,
             by_rate = coalesce(p_summary->'by_rate', '[]'), by_channel = coalesce(p_summary->'by_channel', '[]'), by_brand = coalesce(p_summary->'by_brand', '[]'),
             detail_hash = p_summary->>'detail_hash',
             sale_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
             base_calculated = coalesce((p_summary->>'base_calculated')::boolean, false), entry_id = null
       where id = v_resumen;
    end if;
    v_origen := v_resumen;
  elsif v_origen is not null then
    select id into v_existente from public.journal_entry
     where company_id = p_company and source_type = v_tipo and source_id = v_origen and status in ('propuesto', 'borrador', 'validado');
    if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
  end if;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, auth.uid(), coalesce(p_quien_nombre, 'Folvy'))
  returning id into v_id;

  for v_l in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = p_company and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common,
                                     brand_id, party_id, document_ref, tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents,
                                     withholding_rate_id, withholding_base, withholding_model)
    values (v_cuenta, p_company, v_id, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto',
            nullif(v_l->>'local_id', '')::uuid, coalesce((v_l->>'comun')::boolean, false), nullif(v_l->>'marca_id', '')::uuid,
            nullif(v_l->>'tercero_id', '')::uuid, v_l->>'documento',
            nullif(v_l->'iva'->>'tipo_id', '')::uuid, (v_l->'iva'->>'base')::numeric, v_l->'iva'->>'libro', v_l->'iva'->>'deducible',
            coalesce((v_l->'iva'->>'facturas')::int, 1),
            nullif(v_l->'retencion'->>'tipo_id', '')::uuid, (v_l->'retencion'->>'base')::numeric, v_l->'retencion'->>'modelo');
  end loop;
  if v_resumen is not null then update public.sales_day_summary set entry_id = v_id where id = v_resumen; end if;
  return jsonb_build_object('id', v_id, 'existente', false);
end $$;
revoke all on function public.journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text) from public, anon;
grant execute on function public.journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text) to authenticated;

-- Descartar una propuesta: se borra y queda escrito por qué (no se vuelve a proponer).
create or replace function public.journal_entry_descartar(p_entry uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry; v_clave text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta descarta propuestas.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then raise exception 'Solo se descarta una propuesta o un borrador; lo validado se anula.' using errcode = '23514'; end if;
  if p_motivo is null or length(trim(p_motivo)) = 0 then raise exception 'Para descartar hay que decir por qué.' using errcode = '23514'; end if;
  if v_e.source_type = 'sales_day' then
    select s.location_id || ':' || s.sales_day into v_clave from public.sales_day_summary s where s.id = v_e.source_id;
  else
    v_clave := v_e.source_id::text;
  end if;
  if v_clave is not null then
    insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
    values (v_e.account_id, v_e.company_id, v_e.source_type, v_clave, trim(p_motivo), auth.uid(), coalesce(p_quien_nombre, public.conta_nombre_actor()))
    on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;
  end if;
  delete from public.journal_entry where id = p_entry;
  return jsonb_build_object('descartado', p_entry, 'clave', v_clave);
end $$;
revoke all on function public.journal_entry_descartar(uuid, text, text) from public, anon;
grant execute on function public.journal_entry_descartar(uuid, text, text) to authenticated;

-- ── 8 · La fecha de corte con el programa anterior: un dato que se fija ────
-- Ejercicios enteros antes del corte → traídos; el que lo contiene → mixto
-- hasta esa fecha; los posteriores → de Folvy. Los meses traídos se cierran
-- como traídos. Cambiable mientras no haya asientos traídos (lo guarda el
-- disparador fiscal_year_corte_cambiable).
create or replace function public.conta_fijar_corte(p_company uuid, p_hasta date, p_programa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_n int := 0; r record; m date;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.current_user_is_admin_of(v_cuenta) then
    raise exception 'Solo un administrador de la cuenta fija la fecha de corte.' using errcode = '42501';
  end if;
  if p_programa is null or length(trim(p_programa)) = 0 then raise exception 'Hay que decir de qué programa se trae.' using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entry where company_id = p_company and source_type = 'migrated') then
    raise exception 'Ya hay asientos traídos: la fecha de corte no se cambia.' using errcode = '23514';
  end if;
  -- Lo que dejó un corte anterior se quita (solo los cierres de mes «traídos»).
  delete from public.fiscal_period_lock where company_id = p_company and kind = 'migrated';
  for r in select * from public.fiscal_year where company_id = p_company order by starts_on loop
    update public.fiscal_year set
      origin = case when p_hasta is null or p_hasta < r.starts_on then 'folvy' when p_hasta >= r.ends_on then 'migrated' else 'mixed' end,
      origin_program = case when p_hasta is null or p_hasta < r.starts_on then null else trim(p_programa) end,
      imported_until = case when p_hasta is null or p_hasta < r.starts_on or p_hasta >= r.ends_on then null else p_hasta end
     where id = r.id;
    if p_hasta is not null and p_hasta >= r.starts_on then
      for m in select generate_series(date_trunc('month', r.starts_on), date_trunc('month', least(p_hasta, r.ends_on)), interval '1 month')::date loop
        -- Solo los meses enteros traídos se cierran (el del corte, si no acaba ese día, sigue abierto desde el día siguiente).
        if (m + interval '1 month' - interval '1 day')::date <= p_hasta
           and not exists (select 1 from public.fiscal_period_lock l where l.company_id = p_company and l.month = m and l.reopened_at is null) then
          insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by, locked_by_name)
          values (v_cuenta, p_company, r.id, m, 'migrated', auth.uid(), public.conta_nombre_actor());
          v_n := v_n + 1;
        end if;
      end loop;
    end if;
  end loop;
  return jsonb_build_object('hasta', p_hasta, 'programa', p_programa, 'meses_cerrados', v_n);
end $$;
revoke all on function public.conta_fijar_corte(uuid, date, text) from public, anon;
grant execute on function public.conta_fijar_corte(uuid, date, text) to authenticated;

-- ── 9 · Lo que leen los generadores: pedidos y devoluciones de un día ──────
-- Solo lectura, con la RLS de quien llama (security invoker): no toma ningún
-- cierre sobre `sale` ni sobre las liquidaciones.
create or replace function public.conta_json_seguro(p text)
returns jsonb language plpgsql immutable as $$
begin
  return p::jsonb;
exception when others then
  return null;
end $$;

create or replace function public.conta_pedidos_del_dia(p_company uuid, p_location uuid, p_dia date)
returns table (id uuid, codigo text, canal_id uuid, marca_id uuid, propia boolean, estado text, total numeric, base numeric, cuota numeric, tipos numeric[])
language sql stable security invoker set search_path = public as $$
  select s.id, coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.channel_id, s.brand_id,
         coalesce(b.ownership_type, 'own') = 'own', s.status, s.total, s.taxable_base, s.tax,
         coalesce((select array_agg(distinct (it->>'tax_rate')::numeric)
                     from jsonb_array_elements(case when jsonb_typeof(public.conta_json_seguro(s.raw_tab)->'items') = 'array'
                                                    then public.conta_json_seguro(s.raw_tab)->'items' else '[]'::jsonb end) it
                    where it->>'tax_rate' ~ '^[0-9]+(\.[0-9]+)?$'), '{}')
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.location_id = p_location and s.is_active
     and s.sold_at >= (p_dia::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_dia + 1)::timestamp at time zone 'Europe/Madrid')
     and s.status in ('closed', 'cancelled', 'open')
$$;
comment on function public.conta_pedidos_del_dia(uuid, uuid, date) is
  'C04. Los pedidos de un día (hora de Madrid) y un local, con si la marca es propia, la base y la cuota que traigan, y los tipos de sus líneas (HubRise). Solo lectura.';
revoke all on function public.conta_pedidos_del_dia(uuid, uuid, date) from public, anon;
grant execute on function public.conta_pedidos_del_dia(uuid, uuid, date) to authenticated;

create or replace function public.conta_devoluciones_del_dia(p_company uuid, p_location uuid, p_dia date)
returns table (pedido_id uuid, codigo text, canal_id uuid, marca_id uuid, propia boolean, importe numeric)
language sql stable security invoker set search_path = public as $$
  select o.sale_id, o.platform_order_code, o.channel_id, o.brand_id, coalesce(b.ownership_type, 'own') = 'own', abs(o.incidents_refund)
    from public.channel_settlement_order o
    join public.company c on c.id = p_company and c.account_id = o.account_id
    left join public.channel_settlement cs on cs.id = o.settlement_id
    left join public.brand b on b.id = o.brand_id
   where o.location_id = p_location and coalesce(o.incidents_refund, 0) <> 0
     and coalesce(cs.settlement_date, o.order_date) = p_dia
$$;
comment on function public.conta_devoluciones_del_dia(uuid, uuid, date) is
  'C04. Lo que la plataforma devolvió a clientes y comunica en la liquidación de ese día, pedido a pedido (entra en el resumen de ese día, art. 80.Dos LIVA).';
revoke all on function public.conta_devoluciones_del_dia(uuid, uuid, date) from public, anon;
grant execute on function public.conta_devoluciones_del_dia(uuid, uuid, date) to authenticated;

-- Los días y locales con ventas de marcas propias sin su asiento (ni descartado).
create or replace function public.conta_dias_por_asentar(p_company uuid, p_desde date, p_hasta date)
returns table (location_id uuid, dia date, pedidos bigint)
language sql stable security invoker set search_path = public as $$
  select s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, count(*)
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own' and s.location_id is not null
     and s.sold_at >= (p_desde::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
     and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                      where d.company_id = p_company and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                        and e.status in ('propuesto', 'borrador', 'validado'))
     and not exists (select 1 from public.journal_dismissal x
                      where x.company_id = p_company and x.source_type = 'sales_day'
                        and x.source_key = s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date)
   group by 1, 2
   order by 2, 1
$$;
revoke all on function public.conta_dias_por_asentar(uuid, date, date) from public, anon;
grant execute on function public.conta_dias_por_asentar(uuid, date, date) to authenticated;
