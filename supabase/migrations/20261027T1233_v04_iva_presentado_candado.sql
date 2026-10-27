-- supabase/migrations/20261027T1233_v04_iva_presentado_candado.sql
--
-- cambia: public._journal_entry_proponer · prueba: supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql
-- cambia: public.vat_book_entry · prueba: supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql
--
-- V04 · Respuesta 5 · EL CANDADO DEL IVA (PR 1 de 2).
-- La regla de Julio: «Una vez presentado el modelo de un periodo, está
-- totalmente prohibido contabilizar o modificar su IVA. Una factura
-- contabilizada después de presentar el trimestre nunca entra en el trimestre
-- cerrado: va al periodo abierto.»
--
-- Presentado = un 303 de la empresa (trimestral o mensual) en «filed»,
-- «booked», «paid», «offset» o «refunded»: los mismos que Impuestos cuenta como
-- hechos (conta_impuesto_trimestre, v_hechos).
--
--   1. conta_iva_presentado(empresa, fecha): el 303 presentado que cubre esa
--      fecha, o null. Es el ÚNICO sitio que lo decide (el PR 2, «Reabrir para
--      corregir», lo abrirá aquí). Y el mensaje, en lenguaje de oficina:
--      «El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar.
--      Esta factura va al 4T.»
--   2. En la base, no solo en la pantalla. Con el periodo presentado, para:
--      · validar un asiento con IVA fechado en él, anular uno validado, o
--        cambiar o mover a él uno sin validar (journal_entry);
--      · crear o cambiar un apunte de IVA (472, 477 o con libro) de un asiento
--        fechado en él (journal_line);
--      · crear, cambiar o borrar una anotación del libro de IVA de ese periodo,
--        y poner en él un «deducida en» (vat_book_entry). Lo que no toca el
--        303 (el número, el nombre o el NIF de la contraparte, la retención)
--        sí se puede completar: no es su IVA.
--   3. La recibida que llega tarde va al periodo abierto, sin preguntar:
--      _journal_entry_proponer la asienta en el primer día abierto y sin
--      presentar (la fecha de la factura no se toca) y lo dice en el porqué:
--      «El 3T ya está presentado. Esta factura se deduce en el 4T.» Su libro
--      la registra ese día (D07, 0850: el día que entró o, si es después, el
--      del asiento), así que el 303 la deduce en el periodo abierto.
--      Una expedida (o un día de ventas) no se mueve de periodo: para.
--
-- No entran en el candado, y se dice (Julio decide si alguno debe entrar):
--   · los traídos de Diez («migrated»): son el libro con el que se presentó;
--     en producción, los únicos asientos de IVA creados después de presentar
--     (1T 1108 y 2T 748, medido el 27/10);
--   · el asiento de liquidación del propio 303 («vat_settlement» de esa
--     declaración), que nace al contabilizarla, ya presentada;
--   · la apertura y el cierre del ejercicio;
--   · borrar un asiento SIN validar: nunca llegó al libro. Validado no se
--     borra nunca (journal_entry_inalterable).
--
-- Medido en producción (solo lectura, 27/10): 0 asientos de Sumied con IVA
-- fechados en un periodo presentado, 0 anotaciones del libro cambiadas después
-- de presentar y 0 «deducida en». Hoy el candado no para nada de lo que hay.

select public._respaldar_funcion('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)', '20261027T1233_v04_iva_presentado_candado');

-- ── 1 · ¿Está presentado el IVA de esta fecha? ─────────────────────────────
create or replace function public.conta_iva_presentado(p_company uuid, p_fecha date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'ejercicio', r.fiscal_year, 'periodo', r.period, 'cadencia', r.cadence,
                            'desde', f.desde, 'hasta', f.hasta,
                            'presentado', coalesce(r.filed_at, r.updated_at), 'secuencia', r.sequence)
    from public.tax_return r
   cross join lateral public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) f
   where p_fecha is not null and r.company_id = p_company and r.form_code = '303'
     and r.fiscal_year = extract(year from p_fecha)::int
     and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$'
     and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
     and p_fecha between f.desde and f.hasta
   order by r.sequence, r.filed_at nulls last
   limit 1
$$;
revoke all on function public.conta_iva_presentado(uuid, date) from public, anon, authenticated;
comment on function public.conta_iva_presentado(uuid, date) is
  'V04 · candado del IVA (1233). El 303 presentado (filed, booked, paid, offset o refunded) que cubre esa fecha, o null. El único sitio que decide si el IVA de un día está cerrado: lo usan los disparadores de journal_entry, journal_line y vat_book_entry, y _journal_entry_proponer.';

-- El nombre del periodo: «3T de 2026», «septiembre de 2026».
create or replace function public.conta_iva_periodo_nombre(p_periodo text, p_ejercicio int, p_con_anio boolean default true)
returns text language sql immutable set search_path = public as $$
  select case when p_periodo ~ '^[1-4]T$' then p_periodo
              else (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[p_periodo::int] end
         || case when p_con_anio then ' de ' || p_ejercicio else '' end
$$;

-- El periodo en una frase: p_prep 'de' («del 3T de 2026», «de septiembre de
-- 2026»), 'a' («al 4T», «a octubre»), 'en' («en el 4T», «en octubre») o 'el'
-- («El 3T», «Septiembre»).
create or replace function public.conta_iva_periodo_frase(p_prep text, p_periodo text, p_ejercicio int, p_con_anio boolean default true)
returns text language sql immutable set search_path = public as $$
  select case when p_periodo ~ '^[1-4]T$'
              then case p_prep when 'de' then 'del ' when 'a' then 'al ' when 'en' then 'en el ' else 'El ' end
                   || public.conta_iva_periodo_nombre(p_periodo, p_ejercicio, p_con_anio)
              when p_prep = 'el' then initcap(public.conta_iva_periodo_nombre(p_periodo, p_ejercicio, p_con_anio))
              else p_prep || ' ' || public.conta_iva_periodo_nombre(p_periodo, p_ejercicio, p_con_anio) end
$$;

-- El periodo (con la cadencia del 303 presentado) en el que cae una fecha.
create or replace function public.conta_iva_periodo_de(p_cadencia text, p_fecha date)
returns text language sql immutable set search_path = public as $$
  select case when p_cadencia = 'monthly' then to_char(p_fecha, 'MM')
              else ((extract(month from p_fecha)::int - 1) / 3 + 1)::text || 'T' end
$$;

-- El primer día, desde p_fecha, con el mes abierto (conta_primer_dia_abierto)
-- y el IVA sin presentar. Null si no hay ninguno en el ejercicio abierto.
create or replace function public.conta_primer_dia_iva_abierto(p_company uuid, p_fecha date)
returns date language plpgsql stable security definer set search_path = public as $$
declare v_d date := p_fecha; v_p jsonb; i int := 0;
begin
  loop
    v_d := public.conta_primer_dia_abierto(p_company, v_d);
    if v_d is null then return null; end if;
    v_p := public.conta_iva_presentado(p_company, v_d);
    if v_p is null then return v_d; end if;
    v_d := (v_p->>'hasta')::date + 1;
    i := i + 1;
    if i > 24 then return null; end if;
  end loop;
end $$;
revoke all on function public.conta_primer_dia_iva_abierto(uuid, date) from public, anon, authenticated;

-- El mensaje: «El IVA del 3T de 2026 ya está presentado (20/10). No se puede
-- cambiar. Esta factura va al 4T.» p_que: 'factura' (lo que llega tarde) o
-- 'corregir' (lo que ya estaba dentro).
create or replace function public.conta_iva_presentado_mensaje(p_company uuid, p_presentado jsonb, p_que text default 'factura')
returns text language plpgsql stable security definer set search_path = public as $$
declare v_sig date; v_texto text;
begin
  v_texto := format('El IVA %s ya está presentado (%s). No se puede cambiar.',
                    public.conta_iva_periodo_frase('de', p_presentado->>'periodo', (p_presentado->>'ejercicio')::int),
                    to_char(((p_presentado->>'presentado')::timestamptz at time zone 'Europe/Madrid')::date, 'DD/MM'));
  v_sig := public.conta_primer_dia_iva_abierto(p_company, (p_presentado->>'hasta')::date + 1);
  if v_sig is null then
    return v_texto || ' No hay un periodo abierto donde llevarlo.';
  end if;
  return v_texto || case when p_que = 'corregir' then ' Lo que haya que corregir va ' else ' Esta factura va ' end
         || public.conta_iva_periodo_frase('a', public.conta_iva_periodo_de(p_presentado->>'cadencia', v_sig), extract(year from v_sig)::int,
                                           extract(year from v_sig)::int <> (p_presentado->>'ejercicio')::int) || '.';
end $$;
revoke all on function public.conta_iva_presentado_mensaje(uuid, jsonb, text) from public, anon, authenticated;

-- Lo que no entra en el candado (ver la cabecera).
create or replace function public._conta_iva_exento(p_tipo text, p_origen uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tipo in ('migrated', 'opening', 'closing')
      or (p_tipo = 'vat_settlement' and exists (select 1 from public.tax_return r where r.id = p_origen and r.company_id = p_company))
$$;
revoke all on function public._conta_iva_exento(text, uuid, uuid) from public, anon, authenticated;

-- ¿Tiene IVA este asiento? Un apunte con libro, o en una 472 o una 477.
create or replace function public._conta_iva_asiento_con_iva(p_entry uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                  where l.entry_id = p_entry and (l.vat_book is not null or a.code like '472%' or a.code like '477%'))
$$;
revoke all on function public._conta_iva_asiento_con_iva(uuid) from public, anon, authenticated;

-- El día del 303 en que cae una anotación del libro (lo mismo que
-- conta_impuesto_303_desde_libro): una recibida, su «deducida en» o el día que
-- se registró; una expedida, el de la operación o el de la factura.
create or replace function public._conta_iva_dia_del_libro(p_book text, p_ded_year smallint, p_ded_period text,
                                                             p_received date, p_issue date, p_operation date)
returns date language sql immutable set search_path = public as $$
  select case when p_book in ('received', 'investment') and p_ded_period is not null
              then (public.conta_impuesto_periodo_fechas(p_ded_year, p_ded_period)).desde
              when p_book in ('received', 'investment') then coalesce(p_received, p_issue)
              else coalesce(p_operation, p_issue) end
$$;

-- ── 2 · El candado en la base ──────────────────────────────────────────────
-- El asiento: validar, anular, o cambiar/mover uno sin validar.
create or replace function public._conta_iva_candado_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dia date; v_p jsonb;
begin
  -- La huella de un validado y lo que ya está anulado: lo guarda journal_entry_inalterable.
  if old.status in ('validado', 'anulado') and new.status = old.status then return new; end if;
  if public._conta_iva_exento(new.source_type, new.source_id, new.company_id) then return new; end if;
  if not public._conta_iva_asiento_con_iva(new.id) then return new; end if;
  -- Anular uno validado le quita su IVA al periodo en que estaba.
  v_dia := case when new.status = 'anulado' then old.entry_date else new.entry_date end;
  v_p := public.conta_iva_presentado(new.company_id, v_dia);
  if v_p is null then return new; end if;
  raise exception '%', public.conta_iva_presentado_mensaje(new.company_id, v_p,
                         case when new.status = 'anulado' then 'corregir' else 'factura' end)
    using errcode = '23514', hint = 'iva_presentado';
end $$;
revoke all on function public._conta_iva_candado_asiento() from public, anon, authenticated;
create trigger trg_journal_entry_0_iva_presentado before update on public.journal_entry
  for each row execute function public._conta_iva_candado_asiento();

-- El apunte: crear o cambiar un apunte de IVA de un asiento de ese periodo.
create or replace function public._conta_iva_candado_apunte()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e record; v_p jsonb;
begin
  select e.company_id, e.entry_date, e.source_type, e.source_id into v_e from public.journal_entry e where e.id = new.entry_id;
  if not found or public._conta_iva_exento(v_e.source_type, v_e.source_id, v_e.company_id) then return new; end if;
  if not (new.vat_book is not null
          or exists (select 1 from public.company_account a where a.id = new.company_account_id and (a.code like '472%' or a.code like '477%'))
          or (tg_op = 'UPDATE' and (old.vat_book is not null
              or exists (select 1 from public.company_account a where a.id = old.company_account_id and (a.code like '472%' or a.code like '477%'))))) then
    return new;
  end if;
  v_p := public.conta_iva_presentado(v_e.company_id, v_e.entry_date);
  if v_p is null then return new; end if;
  raise exception '%', public.conta_iva_presentado_mensaje(v_e.company_id, v_p, 'factura') using errcode = '23514', hint = 'iva_presentado';
end $$;
revoke all on function public._conta_iva_candado_apunte() from public, anon, authenticated;
create trigger trg_journal_line_0_iva_presentado before insert or update on public.journal_line
  for each row execute function public._conta_iva_candado_apunte();

-- El libro: crear, cambiar o borrar una anotación del periodo, o poner en él
-- un «deducida en». Lo que no toca el 303 se puede completar.
create or replace function public._conta_iva_candado_libro()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_no_es_iva constant text[] := array['number', 'number_to', 'series', 'received_number', 'counterpart_tax_id', 'counterpart_id_type',
                                       'counterpart_name', 'corrects_ref', 'withholding_rate', 'withholding_amount',
                                       'activity_code', 'activity_type', 'activity_iae', 'updated_at', 'updated_by_name'];
  v_p jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') and not public._conta_iva_exento(old.source_type, old.source_id, old.company_id) then
    if tg_op = 'DELETE' or (to_jsonb(new) - v_no_es_iva) is distinct from (to_jsonb(old) - v_no_es_iva) then
      v_p := public.conta_iva_presentado(old.company_id,
               public._conta_iva_dia_del_libro(old.book, old.deduction_year, old.deduction_period, old.received_date, old.issue_date, old.operation_date));
      if v_p is not null then
        raise exception '%', public.conta_iva_presentado_mensaje(old.company_id, v_p, 'corregir') using errcode = '23514', hint = 'iva_presentado';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - v_no_es_iva) is not distinct from (to_jsonb(old) - v_no_es_iva) then return new; end if;
  if public._conta_iva_exento(new.source_type, new.source_id, new.company_id) then return new; end if;
  v_p := public.conta_iva_presentado(new.company_id,
           public._conta_iva_dia_del_libro(new.book, new.deduction_year, new.deduction_period, new.received_date, new.issue_date, new.operation_date));
  if v_p is null then return new; end if;
  raise exception '%', public.conta_iva_presentado_mensaje(new.company_id, v_p, 'factura') using errcode = '23514', hint = 'iva_presentado';
end $$;
revoke all on function public._conta_iva_candado_libro() from public, anon, authenticated;
create trigger trg_vat_book_entry_0_iva_presentado before insert or update or delete on public.vat_book_entry
  for each row execute function public._conta_iva_candado_libro();

-- ── 3 · La recibida que llega tarde va al periodo abierto ──────────────────
-- Devuelve la propuesta tal cual o, si es una recibida de un periodo
-- presentado, con la fecha del primer día abierto, el aviso y su razón.
create or replace function public._conta_iva_ajustar_propuesta(p_company uuid, p_entry jsonb, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_fecha date := (p_entry->>'fecha')::date; v_p jsonb; v_desde date; v_nueva date; v_aviso text;
begin
  if public._conta_iva_exento(p_entry->>'source_type', nullif(p_entry->>'source_id', '')::uuid, p_company) then return p_entry; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p_lines, '[]')) l
                  where nullif(l->'iva'->>'libro', '') is not null or l->>'cuenta' like '472%' or l->>'cuenta' like '477%') then
    return p_entry;
  end if;
  v_p := public.conta_iva_presentado(p_company, v_fecha);
  if v_p is null then return p_entry; end if;
  -- Solo se mueve una recibida: una expedida (o las ventas de un día) es del
  -- periodo en que se expidió, y ése ya está presentado.
  if exists (select 1 from jsonb_array_elements(p_lines) l where l->'iva'->>'libro' = 'issued')
     or not exists (select 1 from jsonb_array_elements(p_lines) l where l->'iva'->>'libro' in ('received', 'investment')) then
    raise exception '%', public.conta_iva_presentado_mensaje(p_company, v_p, 'corregir') using errcode = '23514', hint = 'iva_presentado';
  end if;
  -- Una factura de proveedor, además, no antes del día en que entró: su libro
  -- la registra ese día o el del asiento si es después (D07, 0850), y así el
  -- asiento y su IVA caen en el mismo periodo.
  v_desde := greatest((v_p->>'hasta')::date + 1,
                      (select si.created_at::date from public.supplier_invoice si
                        where p_entry->>'source_type' = 'supplier_invoice' and si.id = nullif(p_entry->>'source_id', '')::uuid));
  v_nueva := public.conta_primer_dia_iva_abierto(p_company, v_desde);
  if v_nueva is null then
    raise exception '%', public.conta_iva_presentado_mensaje(p_company, v_p, 'factura') using errcode = '23514', hint = 'iva_presentado';
  end if;
  v_aviso := format('%s ya está presentado. Esta factura se deduce %s.',
                    public.conta_iva_periodo_frase('el', v_p->>'periodo', (v_p->>'ejercicio')::int, false),
                    public.conta_iva_periodo_frase('en', public.conta_iva_periodo_de(v_p->>'cadencia', v_nueva), extract(year from v_nueva)::int,
                                                   extract(year from v_nueva)::int <> (v_p->>'ejercicio')::int));
  return p_entry || jsonb_build_object('fecha', v_nueva, 'aviso', v_aviso,
                                       'razones', coalesce(p_entry->'razones', '[]'::jsonb) || jsonb_build_array(v_aviso));
end $$;
revoke all on function public._conta_iva_ajustar_propuesta(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ── 4 · Para las pantallas: los periodos presentados de un ejercicio ───────
-- El candado de cada mes y cada trimestre en el diario, el libro de IVA e
-- Impuestos. Solo lo ve quien es de la cuenta de la empresa.
create or replace function public.conta_iva_presentados(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not (v_cuenta = any ((select public.current_user_account_ids())::uuid[])) then
    raise exception 'No puedes ver esta empresa.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('periodo', r.period, 'ejercicio', r.fiscal_year, 'desde', f.desde, 'hasta', f.hasta,
                                        'presentado', coalesce(r.filed_at, r.updated_at), 'declaracion', r.id,
                                        'nombre', public.conta_iva_periodo_nombre(r.period, r.fiscal_year),
                                        'siguiente', public.conta_iva_periodo_nombre(
                                            public.conta_iva_periodo_de(r.cadence, coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1)),
                                            extract(year from coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1))::int,
                                            extract(year from coalesce(public.conta_primer_dia_iva_abierto(p_company, f.hasta + 1), f.hasta + 1))::int <> r.fiscal_year))
                     order by f.desde)
      from public.tax_return r
     cross join lateral public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) f
     where r.company_id = p_company and r.form_code = '303' and r.fiscal_year = p_year and r.sequence = 1
       and r.period ~ '^([1-4]T|0[1-9]|1[0-2])$'
       and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')), '[]'::jsonb);
end $$;
revoke all on function public.conta_iva_presentados(uuid, int) from public, anon;
grant execute on function public.conta_iva_presentados(uuid, int) to authenticated;
comment on function public.conta_iva_presentados(uuid, int) is
  'V04 · candado del IVA (1233). Los periodos con el 303 presentado de un ejercicio (desde, hasta, cuándo, y a qué periodo va lo que llegue tarde). Para el candado de las pantallas; quien manda es la base (conta_iva_presentado).';

-- ── 5 · _journal_entry_proponer (misma firma), con su respaldo arriba ──────
create or replace function public._journal_entry_proponer(p_company uuid, p_entry jsonb, p_lines jsonb, p_summary jsonb, p_quien_nombre text, p_quien uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_fecha date := (p_entry->>'fecha')::date; v_tipo text := p_entry->>'source_type';
  v_origen uuid := nullif(p_entry->>'source_id', '')::uuid; v_clave text; v_y uuid; v_id uuid; v_l jsonb; v_pos int := 0;
  v_cta uuid; v_resumen uuid; v_existente uuid;
  v_unidad text := nullif(p_summary->>'unit_key', ''); v_dia_clave text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then
    raise exception 'La empresa % no existe.', p_company using errcode = '23514';
  end if;
  if v_tipo = 'sales_day' then
    v_dia_clave := (p_summary->>'location_id') || ':' || (p_summary->>'sales_day');
    v_clave := v_dia_clave || coalesce(':' || v_unidad, '');
    -- El botón y el cierre del día pueden llegar a la vez al mismo día: el
    -- cerrojo es del día y el local, también con unidades (C04b R5), para que
    -- un asiento del día entero y uno de una unidad no se crucen.
    perform pg_advisory_xact_lock(hashtextextended('sales_day:' || p_company::text || ':' || v_dia_clave, 0));
    -- C04b R5: con la regla por plataforma, el día entero ya no se propone.
    -- Lo dice (regla 8) en vez de dejar un asiento al lado de los de cada
    -- plataforma: así el front de antes no puede duplicar.
    if v_unidad is null and exists (select 1 from public.conta_ventas_canal v where v.company_id = p_company) then
      raise exception 'Las ventas se asientan ahora por plataforma, local y día, y las propone el cierre del día cada hora. Recarga la página.' using errcode = '23514';
    end if;
  else
    v_clave := v_origen::text;
  end if;
  if v_clave is not null and exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = v_tipo
                                        and d.source_key in (v_clave, coalesce(v_dia_clave, v_clave))) then
    return jsonb_build_object('descartada', true);
  end if;

  if v_tipo = 'sales_day' then
    -- Un día ya asentado entero (a la antigua) no se vuelve a asentar por unidades.
    if v_unidad is not null then
      select s.entry_id into v_existente from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id
       where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
         and s.unit_key is null and e.status in ('propuesto', 'borrador', 'validado');
      if v_existente is not null then return jsonb_build_object('id', v_existente, 'existente', true); end if;
    end if;
    select s.id, s.entry_id into v_resumen, v_existente from public.sales_day_summary s
     where s.company_id = p_company and s.location_id = (p_summary->>'location_id')::uuid and s.sales_day = (p_summary->>'sales_day')::date
       and s.unit_key is not distinct from v_unidad;
    if v_existente is not null and exists (select 1 from public.journal_entry e where e.id = v_existente and e.status in ('propuesto', 'borrador', 'validado')) then
      return jsonb_build_object('id', v_existente, 'existente', true);
    end if;
    if v_resumen is null then
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, unit_key, channel_id, brand_id, tickets_count, total, by_rate, by_channel, by_brand,
                                            first_invoice, last_invoice, detail_hash, sale_ids, base_calculated, created_by)
      values (v_cuenta, p_company, (p_summary->>'location_id')::uuid, (p_summary->>'sales_day')::date,
              v_unidad, nullif(p_summary->>'channel_id', '')::uuid, nullif(p_summary->>'brand_id', '')::uuid, (p_summary->>'tickets_count')::int,
              (p_summary->>'total')::numeric, coalesce(p_summary->'by_rate', '[]'), coalesce(p_summary->'by_channel', '[]'), coalesce(p_summary->'by_brand', '[]'),
              p_summary->>'first_invoice', p_summary->>'last_invoice', p_summary->>'detail_hash',
              coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(p_summary->'sale_ids') x), '{}'),
              coalesce((p_summary->>'base_calculated')::boolean, false), p_quien)
      returning id into v_resumen;
    else
      -- Un resumen sin asiento vivo (el del 09/10 de Carabanchel, de antes del
      -- cierre del día) se rehace entero con el día de ahora: no se duplica.
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

  -- V04 · candado del IVA (1233): una recibida que llega a un periodo cuyo IVA
  -- ya está presentado se asienta en el primer día abierto, sin preguntar; una
  -- expedida no se mueve: para. La fecha de la factura no se toca.
  p_entry := public._conta_iva_ajustar_propuesta(p_company, p_entry, p_lines);
  v_fecha := (p_entry->>'fecha')::date;

  select id into v_y from public.fiscal_year where company_id = p_company and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cuenta, p_company, v_y, (p_entry->>'series')::smallint, v_fecha, p_entry->>'concepto', v_tipo, v_origen, 'propuesto',
          p_entry->>'confianza', p_entry->>'porque', coalesce(p_entry->'razones', '[]'), nullif(p_entry->>'party_id', '')::uuid,
          p_entry->>'documento', nullif(p_entry->>'fecha_documento', '')::date, p_quien, coalesce(p_quien_nombre, 'Folvy'))
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
  return jsonb_strip_nulls(jsonb_build_object('id', v_id, 'existente', false, 'aviso', p_entry->>'aviso'));
end $$;
revoke all on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;
comment on function public._journal_entry_proponer(uuid, jsonb, jsonb, jsonb, text, uuid) is
  'Propone un asiento (el cuerpo de journal_entry_proponer y del cierre del día). V04 (1233): una recibida de un periodo con el IVA presentado se asienta en el primer día abierto y lo avisa (aviso); una expedida para.';
