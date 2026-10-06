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
                    coalesce(l.vat_deductible, ''), coalesce(l.withholding_rate_id::text, ''),
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

    -- Regla 5: IVA coherente. La cuota es el importe del apunte y = base × tipo, al céntimo.
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null and round(l.tax_base * t.rate / 100, 2) <> (l.debit + l.credit)
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
          format('Anula el %s/%s: %s', v_e.series, v_e.number, trim(p_motivo)), 'reversal', v_e.id,
          'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), v_quien)
  returning id into v_nuevo;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                   location_id, is_common, brand_id, party_id, document_ref, document_date,
                                   tax_rate_id, tax_base, vat_book, vat_deductible, withholding_rate_id, withholding_base, withholding_model)
  select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
         location_id, is_common, brand_id, party_id, document_ref, document_date,
         tax_rate_id, tax_base, vat_book, vat_deductible, withholding_rate_id, withholding_base, withholding_model
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
