-- ============================================================================
-- C05 · Libros y balances — 5 · EL VALIDADOR DEJA PASAR EL CIERRE Y LA APERTURA
-- cambia: public.journal_entry_validar · prueba: supabase/staging/sql/20261014_c05_prueba_libros.sql
-- ----------------------------------------------------------------------------
-- Respuesta 3 de Julio. La regla 5 del C04 exige que todo apunte en 472/477
-- lleve base, tipo y libro registro, y en 4751 su retención. El asiento de
-- cierre deja esas cuentas a cero y la apertura las repone: sin esto, una
-- empresa con saldo en 4751 o 477 a fin de año no puede cerrar el ejercicio
-- (lo cazó la prueba de staging, run 37852688279).
--
-- Cambia SOLO eso: las dos condiciones de IVA y retención no se aplican a un
-- asiento closing u opening ENLAZADO en fiscal_year_closing a su ejercicio y
-- con la marca del generador de cierre. Un closing suelto o manual sigue
-- pasando la regla (probado en staging). Todo lo demás, igual: cuadre, fecha,
-- ejercicio abierto, mes cerrado, la cuota = base × tipo cuando hay tipo, y el
-- local o «común». Misma firma: reemplaza, no sobrecarga (regla 2).
-- vat_settlement NO entra: va en el encargo de Impuestos, con su prueba.
-- Fuera del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261014T0140_c05_validar_cierre.down.sql
-- (el texto del C04 tal cual).
-- ============================================================================

create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    v_cierre := v_e.source_type in ('closing', 'opening')
      and coalesce(v_e.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
      and exists (
        select 1 from public.fiscal_year_closing c
         where c.company_id = v_e.company_id
           and ((v_e.source_type = 'closing' and c.fiscal_year_id = v_e.fiscal_year_id
                 and v_e.id in (c.regularization_entry_id, c.closing_entry_id))
             or (v_e.source_type = 'opening' and c.opening_entry_id = v_e.id
                 and exists (select 1 from public.fiscal_year a
                              where a.id = c.fiscal_year_id and a.ends_on + 1 = v_y.starts_on))));

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
end $$;
revoke all on function public.journal_entry_validar(uuid, text) from public, anon;
grant execute on function public.journal_entry_validar(uuid, text) to authenticated;
