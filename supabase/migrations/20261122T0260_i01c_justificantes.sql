-- supabase/migrations/20261122T0260_i01c_justificantes.sql
-- cambia: public.tax_return_box · prueba: supabase/staging/sql/20261122_i01c_justificantes_prueba.sql
--
-- I01c · P1 · SUBIR JUSTIFICANTES DE HACIENDA. Julio tiene en PDF lo que la
-- gestoría presentó en 2026 (111 y 115 del 1T, 2T y 3T; 303 del 1T y 2T; 202
-- del 1P), y Sumied no tenía ninguno: el 19/10, 0 presentadas en producción.
-- El navegador lee cada PDF (lib/justificanteAeat.ts: modelo, ejercicio,
-- periodo, fecha, CSV, número de justificante, NIF y casillas) y la base
-- comprueba y apunta. Lo de la gestoría queda como presentado fuera, con sus
-- casillas, y el siguiente 303 sabe lo que arrastra ([110]).
--
--   tax_return_box.origin                    [amplía el CHECK] 'justificante':
--     la casilla la dice el justificante de Hacienda. Las de antes siguen
--     igual ('calculated', 'manual'): solo se añade un valor.
--   conta_impuesto_justificante_mirar(…)     [nueva, interna] comprueba UN
--     justificante leído contra la empresa y lo que ya hay: el NIF tiene que
--     ser el de la empresa; el modelo y el periodo, de los que se leen; la
--     fecha, después de acabar el periodo y no futura; el CSV, de 16; el
--     resultado, con su signo. Dice si es nuevo, si completa una que Sumied
--     calculó (y qué casillas difieren) o si ya estaba (el mismo CSV).
--   conta_impuesto_justificantes_repasar(empresa, lista)   [nueva, la persona]
--     la pantalla de repaso: cada uno mirado, y el que va dos veces en la
--     misma subida, dicho. No escribe nada.
--   conta_impuesto_justificante_apuntar(empresa, datos)    [nueva, la persona]
--     lo apunta: crea la declaración o completa la que había (nunca duplica:
--     uno por modelo, ejercicio y periodo), presentada fuera, con sus
--     casillas de origen «justificante» (o «manual» con su motivo, si el PDF
--     no se pudo leer y se escribieron a mano) y un evento con las
--     diferencias contra lo que Sumied había calculado. El PDF se guarda
--     después con conta_impuesto_justificante_guardar (la de la 0150), en la
--     carpeta de la declaración.
--
-- El plazo de un periodo cuyo año no tiene festivos cargados (2025 y antes):
-- el día de la regla, sin trasladar, y dicho en due_provisional. No se inventa.
-- No toca el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261122T0260_i01c_justificantes.down.sql

-- ── 1 · Una casilla puede venir del justificante ────────────────────────────
alter table public.tax_return_box drop constraint if exists tax_return_box_origin_check;
alter table public.tax_return_box add constraint tax_return_box_origin_check
  check (origin in ('calculated', 'manual', 'justificante'));

-- ── 2 · Mirar un justificante leído ────────────────────────────────────────
-- p_datos: {modelo, ejercicio, periodo, presentada ('aaaa-mm-ddThh:mm:ss',
-- hora de Madrid), csv, justificante, nif, casillas {caja: importe},
-- resultado (importe), devolucion (bool, solo 303 del 4T/12 negativo),
-- a_mano (bool), motivo (texto, si a_mano)}.
create or replace function public.conta_impuesto_justificante_mirar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c public.company; r public.tax_return;
  v_mod text := p_datos->>'modelo'; v_per text := upper(coalesce(p_datos->>'periodo', ''));
  v_ej int; v_cad text; v_fin smallint; v_fecha timestamptz; v_csv text := upper(regexp_replace(coalesce(p_datos->>'csv', ''), '\s', '', 'g'));
  v_nif text := upper(regexp_replace(coalesce(p_datos->>'nif', ''), '[^A-Za-z0-9]', '', 'g'));
  v_nif_emp text; v_res numeric; v_kind text; v_dif jsonb := '[]'; v_k text; v_v jsonb;
  v_base jsonb := jsonb_build_object('modelo', p_datos->>'modelo', 'ejercicio', p_datos->'ejercicio', 'periodo', p_datos->>'periodo');
begin
  select * into c from public.company where id = p_company;
  if c.id is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  -- El NIF, lo primero: si no es de esta empresa, no se mira nada más.
  v_nif_emp := upper(regexp_replace(coalesce(c.tax_id, ''), '[^A-Za-z0-9]', '', 'g'));
  v_nif_emp := case when v_nif_emp ~ '^ES[A-Z0-9]{9}$' then substr(v_nif_emp, 3) else v_nif_emp end;
  v_nif := case when v_nif ~ '^ES[A-Z0-9]{9}$' then substr(v_nif, 3) else v_nif end;
  if v_nif_emp = '' then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'La empresa no tiene su NIF en Ajustes: sin él no se puede comprobar de quién es el justificante.');
  end if;
  -- Escrito a mano sin NIF (el PDF no se pudo leer): lo afirma quien lo escribe, con su motivo.
  if v_nif <> v_nif_emp and not (coalesce((p_datos->>'a_mano')::boolean, false) and v_nif = '') then
    return v_base || jsonb_build_object('estado', 'error', 'motivo',
      'Es de otro NIF (' || coalesce(nullif(v_nif, ''), 'sin NIF') || '), no del de ' || coalesce(c.legal_name, 'esta empresa') || ' (' || v_nif_emp || '): no se guarda.');
  end if;
  if v_mod is null or v_mod not in ('303', '111', '115', '202') then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Sumied lee el 303, el 111, el 115 y el 202, y este es el ' || coalesce(v_mod, '(sin modelo)') || '.');
  end if;
  begin v_ej := (p_datos->>'ejercicio')::int; exception when others then v_ej := null; end;
  if v_ej is null or v_ej < 2000 or v_ej > extract(year from now())::int then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'El ejercicio «' || coalesce(p_datos->>'ejercicio', '') || '» no es un año que pueda estar presentado.');
  end if;
  v_cad := case when v_per ~ '^[1-4]T$' and v_mod <> '202' then 'quarterly'
                when v_per ~ '^(0[1-9]|1[0-2])$' and v_mod <> '202' then 'monthly'
                when v_per ~ '^[1-3]P$' and v_mod = '202' then 'instalments_202' end;
  if v_cad is null then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'El periodo «' || v_per || '» no es de un ' || v_mod || '.');
  end if;
  v_fin := public.conta_impuesto_fin_periodo(v_cad, v_per);
  begin v_fecha := ((p_datos->>'presentada')::timestamp) at time zone 'Europe/Madrid'; exception when others then v_fecha := null; end;
  if v_fecha is null then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Falta la fecha de presentación.');
  end if;
  if v_fecha > now() + interval '1 day' then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'La fecha de presentación es futura: no puede estar presentado.');
  end if;
  if (v_fecha at time zone 'Europe/Madrid')::date < (make_date(v_ej, v_fin, 1) + interval '1 month')::date then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Está presentado antes de acabar el periodo: no casa.');
  end if;
  if v_csv !~ '^[A-Z0-9]{16}$' then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'El CSV no tiene la forma de los de Hacienda (16 letras y números).');
  end if;
  begin v_res := (p_datos->>'resultado')::numeric; exception when others then v_res := null; end;
  if v_res is null then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Falta el resultado: escríbelo.');
  end if;
  v_kind := case when v_res > 0 then 'to_pay' when v_res = 0 then 'zero'
                 when v_mod = '303' and coalesce((p_datos->>'devolucion')::boolean, false) then 'to_refund'
                 when v_mod = '303' then 'to_offset' end;
  if v_kind is null then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Un ' || v_mod || ' no sale negativo: el resultado leído no casa.');
  end if;
  if v_kind = 'to_refund' and v_per not in ('4T', '12') then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'La devolución se pide en el último periodo del año; antes, sale a compensar.');
  end if;
  if coalesce(jsonb_typeof(p_datos->'casillas'), '') <> 'object' or p_datos->'casillas' = '{}'::jsonb then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Faltan las casillas.');
  end if;
  for v_k, v_v in select * from jsonb_each(p_datos->'casillas') loop
    if v_k !~ '^[0-9]{2,3}$' or jsonb_typeof(v_v) <> 'number' then
      return v_base || jsonb_build_object('estado', 'error', 'motivo', 'La casilla «' || v_k || '» no se ha leído bien.');
    end if;
  end loop;
  if coalesce((p_datos->>'a_mano')::boolean, false) and btrim(coalesce(p_datos->>'motivo', '')) = '' then
    return v_base || jsonb_build_object('estado', 'error', 'motivo', 'Escritas a mano, las casillas llevan el motivo.');
  end if;

  select * into r from public.tax_return
   where company_id = p_company and form_code = v_mod and fiscal_year = v_ej and period = v_per and sequence = 1;
  -- Ya presentada: con el mismo CSV, ya estaba; con otro, no se pisa.
  if r.id is not null and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded') then
    if r.aeat_csv = v_csv then
      return v_base || jsonb_build_object('estado', 'ya_estaba', 'declaracion', r.id, 'cuenta', r.account_id, 'resultado', r.result_kind, 'importe', r.amount,
        'presentada', r.filed_at, 'falta_pdf', r.receipt_document_path is null,
        'motivo', case when r.receipt_document_path is null then 'Ya estaba apuntado; se guarda el PDF.' else 'Ya estaba apuntado, con su PDF.' end);
    end if;
    return v_base || jsonb_build_object('estado', 'error', 'declaracion', r.id, 'motivo',
      'Ya hay un ' || v_mod || ' del ' || v_per || '/' || v_ej || ' presentado con otro CSV. Si este es una complementaria o una sustitutiva, todavía no se apunta aquí.');
  end if;
  -- Lo que Sumied tenía (calculado o escrito a mano) contra lo que dice el justificante.
  if r.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('casilla', x.box, 'sumied', x.antes, 'presentado', x.ahora) order by length(x.box), x.box), '[]') into v_dif
      from (select coalesce(b.box, j.k) box, b.value antes, (j.v)::numeric ahora
              from (select box, value from public.tax_return_box where tax_return_id = r.id and value is not null) b
              full join (select k, v from jsonb_each_text(p_datos->'casillas') e(k, v)) j on j.k = b.box) x
     where x.antes is not null and x.antes is distinct from x.ahora and not (x.ahora is null and x.antes = 0);
  end if;
  return v_base || jsonb_build_object(
    'estado', case when r.id is null then 'nuevo' else 'completa' end,
    'declaracion', r.id, 'cuenta', c.account_id, 'cadencia', v_cad,
    'resultado', v_kind, 'importe', abs(v_res), 'presentada', v_fecha,
    'calculada', r.id is not null and exists (select 1 from public.tax_return_box where tax_return_id = r.id),
    'diferencias', v_dif,
    'motivo', case when r.id is null then null
                   when jsonb_array_length(v_dif) = 0 and exists (select 1 from public.tax_return_box where tax_return_id = r.id)
                     then 'Sumied lo había calculado igual, casilla a casilla.'
                   when jsonb_array_length(v_dif) > 0 then 'Sumied lo había calculado y ' || jsonb_array_length(v_dif) ||
                     case when jsonb_array_length(v_dif) = 1 then ' casilla no coincide.' else ' casillas no coinciden.' end
              end);
end $$;
comment on function public.conta_impuesto_justificante_mirar(uuid, jsonb) is
  'I01c (0260). Interna: comprueba un justificante de Hacienda leído contra la empresa (NIF, modelo, periodo, fecha, CSV, resultado) y lo que ya hay. No escribe nada.';

-- ── 3 · La pantalla de repaso ──────────────────────────────────────────────
create or replace function public.conta_impuesto_justificantes_repasar(p_company uuid, p_lista jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '[]'; v_vistos text[] := '{}'; v_clave text; e jsonb; m jsonb; i int := 0;
begin
  if not exists (select 1 from public.company where id = p_company) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, sube justificantes.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lista) <> 'array' then raise exception 'La lista de justificantes no ha llegado.' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_lista) loop
    m := public.conta_impuesto_justificante_mirar(p_company, e);
    v_clave := coalesce(e->>'modelo', '') || '·' || coalesce(e->>'ejercicio', '') || '·' || upper(coalesce(e->>'periodo', ''));
    if m->>'estado' <> 'error' and v_clave = any (v_vistos) then
      m := m || jsonb_build_object('estado', 'error', 'motivo', 'Va dos veces en esta subida: se apunta el primero.');
    end if;
    v_vistos := v_vistos || v_clave;
    v_out := v_out || jsonb_build_array(m || jsonb_build_object('i', i));
    i := i + 1;
  end loop;
  return v_out;
end $$;
comment on function public.conta_impuesto_justificantes_repasar(uuid, jsonb) is
  'I01c (0260). La pantalla de repaso de «Subir justificantes»: cada justificante leído, mirado (nuevo, completa lo calculado con sus diferencias, ya estaba o por qué no). No escribe nada.';

-- ── 4 · Apuntar uno ────────────────────────────────────────────────────────
create or replace function public.conta_impuesto_justificante_apuntar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m jsonb; c public.company; r public.tax_return; v_id uuid; v_nombre text := public.conta_impuesto_quien();
  v_mod text := p_datos->>'modelo'; v_per text := upper(p_datos->>'periodo'); v_ej int := (p_datos->>'ejercicio')::int;
  v_cad text; v_pl record; v_due date; v_dd date; v_prov text; v_regla record; v_mes date;
  v_mano boolean := coalesce((p_datos->>'a_mano')::boolean, false); v_motivo text := btrim(coalesce(p_datos->>'motivo', ''));
  v_caja_res text := case p_datos->>'modelo' when '303' then '71' when '111' then '30' when '115' then '05' end;
  v_casillas jsonb := p_datos->'casillas'; v_antes text;
begin
  if not public.conta_impuesto_puede_gestionar(p_company) then
    raise exception 'Solo un administrador o un encargado de la empresa, o su asesoría con su consentimiento, sube justificantes.' using errcode = '42501';
  end if;
  m := public.conta_impuesto_justificante_mirar(p_company, p_datos);
  if m->>'estado' = 'error' then raise exception '%', m->>'motivo' using errcode = '22023'; end if;
  if m->>'estado' = 'ya_estaba' then
    return m || jsonb_build_object('ok', true, 'mensaje', m->>'motivo');
  end if;
  select * into c from public.company where id = p_company;
  v_cad := m->>'cadencia';
  -- La [71] (o la del resultado) escrita a mano si el PDF no la traía.
  if v_caja_res is not null and not (v_casillas ? v_caja_res) then
    v_casillas := v_casillas || jsonb_build_object(v_caja_res, (p_datos->>'resultado')::numeric);
  end if;

  if m->>'estado' = 'nuevo' then
    select * into v_pl from public.conta_impuesto_plazo_si_hay(v_mod, v_cad, v_ej, v_per);
    v_due := v_pl.presentacion; v_dd := v_pl.domiciliacion; v_prov := v_pl.provisional;
    if v_due is null then
      -- Sin los festivos de ese año: el día de la regla, sin trasladar, y dicho.
      select * into v_regla from public.tax_form_deadline d
       where d.form_code = v_mod and d.cadence = v_cad and d.period in (v_per, '*') order by (d.period = v_per) desc limit 1;
      if v_regla.form_code is null then
        raise exception 'No tengo la regla del plazo del % (%): no se inventa.', v_mod, v_per using errcode = 'P0002';
      end if;
      v_mes := (make_date(v_ej, public.conta_impuesto_fin_periodo(v_cad, v_per), 1) + make_interval(months => v_regla.months_after))::date;
      v_due := case when v_regla.day is null then (v_mes + interval '1 month - 1 day')::date
                    else make_date(extract(year from v_mes)::int, extract(month from v_mes)::int, v_regla.day) end;
      v_prov := 'Sin los festivos de ' || extract(year from v_due)::int || ': el día de la regla, sin trasladar si caía en festivo.';
    end if;
    -- Nace presentada (de «pendiente» no se pasa a «presentada»: el registro lo dice como alta).
    insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period, due_date, due_date_direct_debit, due_provisional,
                                   status, result_kind, amount, filed_at, filed_by, filed_by_name, filed_via, aeat_csv, aeat_receipt_number, outside_csv_pasted_at)
    values (c.account_id, p_company,
            (select o.id from public.tax_obligation o where o.company_id = p_company and o.form_code = v_mod and o.valid_to is null),
            v_mod, v_ej, v_cad, v_per, v_due, v_dd, v_prov,
            'filed', m->>'resultado', (m->>'importe')::numeric, (m->>'presentada')::timestamptz, auth.uid(), v_nombre, 'outside',
            upper(regexp_replace(p_datos->>'csv', '\s', '', 'g')), nullif(btrim(coalesce(p_datos->>'justificante', '')), ''), now())
    returning * into r;
    v_antes := null;
  else
    select * into r from public.tax_return where id = (m->>'declaracion')::uuid for update;
    v_antes := r.status;
    -- Una pendiente pasa por borrador: los cambios de estado que valen (conta_impuesto_estado_vale).
    if r.status = 'pending' then update public.tax_return set status = 'draft' where id = r.id; end if;
  end if;

  -- Las casillas: las del justificante, y ninguna más (lo calculado que no está en él, fuera; queda en el evento).
  delete from public.tax_return_box where tax_return_id = r.id;
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason, source)
  select r.id, r.account_id, p_company, k, round(v::numeric, 2),
         case when v_mano or (k = v_caja_res and not (p_datos->'casillas' ? k)) then 'manual' else 'justificante' end,
         case when v_mano then 'Escrita a mano del justificante: ' || v_motivo
              when k = v_caja_res and not (p_datos->'casillas' ? k) then 'El resultado, escrito a mano: el PDF no lo traía. ' || nullif(v_motivo, '') end,
         jsonb_build_object('justificante', p_datos->>'justificante')
    from jsonb_each_text(v_casillas) e(k, v);

  update public.tax_return
     set status = 'filed', result_kind = m->>'resultado', amount = (m->>'importe')::numeric,
         filed_at = (m->>'presentada')::timestamptz, filed_by = auth.uid(), filed_by_name = v_nombre, filed_via = 'outside',
         aeat_csv = upper(regexp_replace(p_datos->>'csv', '\s', '', 'g')), aeat_receipt_number = nullif(btrim(coalesce(p_datos->>'justificante', '')), ''),
         outside_csv_pasted_at = now(), updated_at = now()
   where id = r.id and v_antes is not null;
  -- El cambio de estado lo apunta su disparador; aquí, de dónde sale y las diferencias.
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, p_company, auth.uid(), v_nombre, 'note',
          'Presentado fuera de Sumied: ' || case when v_mano then 'casillas escritas a mano del justificante' else 'subido el justificante' end
            || coalesce(' nº ' || nullif(btrim(coalesce(p_datos->>'justificante', '')), ''), '') || '.',
          jsonb_build_object('origen', case when v_mano then 'justificante_a_mano' else 'justificante' end, 'antes', v_antes,
                             'csv_cola', right(upper(p_datos->>'csv'), 4), 'diferencias', coalesce(m->'diferencias', '[]'),
                             'casillas', (select count(*) from jsonb_object_keys(v_casillas))));
  return m || jsonb_build_object('ok', true, 'declaracion', r.id, 'cuenta', r.account_id,
    'mensaje', 'Apuntado el ' || v_mod || ' del ' || v_per || '/' || v_ej || ' como presentado fuera, con ' ||
               (select count(*) from jsonb_object_keys(v_casillas)) || ' casillas' ||
               case when jsonb_array_length(coalesce(m->'diferencias', '[]')) > 0
                    then ' (' || jsonb_array_length(m->'diferencias') || ' distintas de lo calculado)' else '' end || '.');
end $$;
comment on function public.conta_impuesto_justificante_apuntar(uuid, jsonb) is
  'I01c (0260). Apunta un justificante de Hacienda como declaración presentada fuera: la crea o completa la que había (nunca duplica), con sus casillas de origen justificante y las diferencias con lo calculado en el evento.';

revoke all on function public.conta_impuesto_justificante_mirar(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.conta_impuesto_justificantes_repasar(uuid, jsonb), public.conta_impuesto_justificante_apuntar(uuid, jsonb) from public, anon;
grant execute on function public.conta_impuesto_justificante_mirar(uuid, jsonb) to service_role;
grant execute on function public.conta_impuesto_justificantes_repasar(uuid, jsonb), public.conta_impuesto_justificante_apuntar(uuid, jsonb)
  to authenticated, service_role;
