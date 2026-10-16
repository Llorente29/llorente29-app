-- supabase/vuelta-atras/20261117T0100_m01_motivos_para_validar.down.sql
--
-- Vuelta atrás de 20261117T0100_m01_motivos_para_validar, en orden inverso:
--   4. tg_journal_entry_envio_por_aclarar vuelve a la de C (20261116T0100_c06b_promociones_envios), copiada tal cual;
--   3. journal_entry_validar vuelve a la vigente (20261113T0100_c06b_centimo_iva), copiada tal cual;
--   2 y 1. fuera conta_esperan y conta_motivos_para_validar (ya nadie las llama).
-- Las dos que vuelven no cambian de firma: create or replace, sin sobrecarga.

-- 4 ----------------------------------------------------------------------------------
create or replace function public.tg_journal_entry_envio_por_aclarar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_n int; v_lista text;
begin
  select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
    into v_n, v_lista
    from public.sales_day_summary d
    cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
    join public.sale s on s.id = c.id and s.account_id = d.account_id
   where d.entry_id = new.id and d.account_id = new.account_id and c.clase = 'por_aclarar';
  if v_n > 0 then
    raise exception 'No se valida: % con envío por aclarar: %. Se resuelve con la liquidación de esa semana.',
      v_n || case when v_n = 1 then ' pedido' else ' pedidos' end, v_lista using errcode = '23514';
  end if;
  return new;
end $$;
comment on function public.tg_journal_entry_envio_por_aclarar() is
  'C06b (16/10): un asiento de ventas del día con un envío por aclarar (no se sabe si es del restaurante) no pasa a validado.';

-- 3 ----------------------------------------------------------------------------------
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
    -- C04b (12/10): en un ejercicio con parte traída, Folvy numera DETRÁS del
    -- último número traído en cada serie (el número es max + 1, abajo). Para
    -- eso el histórico tiene que estar dentro antes de validar nada: si no,
    -- el primero de Folvy cogería el 1 y chocaría con el 1 del programa.
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      raise exception 'Primero hay que traer el histórico de % de %.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code using errcode = '23514';
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
    -- céntimo por factura (floor(n/2) céntimos), y cualquier apunte, un céntimo
    -- de redondeo (C06b, Julio, 15/10: un ticket de 20,40 € con el IVA dentro da
    -- base 18,55 y cuota 1,85, y 18,55 × 10 % = 1,86; no hay reparto que cuadre).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
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

-- 2 y 1 ------------------------------------------------------------------------------
drop function public.conta_esperan(uuid, date, date);
drop function public.conta_motivos_para_validar(uuid);
