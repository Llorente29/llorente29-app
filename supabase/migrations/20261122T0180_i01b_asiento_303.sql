-- supabase/migrations/20261122T0180_i01b_asiento_303.sql
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
-- cambia: public.conta_impuesto_estado_vale · prueba: supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
-- cambia: public.bank_match_item · prueba: supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
-- cambia: public.bank_match · prueba: supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
--
-- I01b · 6 · EL ASIENTO DE LIQUIDACIÓN DEL 303 Y SU PAGO.
--
--   conta_impuesto_303_contabilizar(declaración)                 [la persona]
--     Con el 303 «Presentado»: el asiento de liquidación en General (serie 4),
--     origen la declaración (source_type vat_settlement, source_id = la
--     declaración), validado. 477 al debe por la [27] y 472 al haber por la
--     [45], repartidas por subcuenta según lo que movió cada una en el
--     periodo (lo que no cuadre con la casilla, a la que más movió); lo que se
--     compensa de antes ([78]) al haber de la 4700; y el resultado [71]: a
--     pagar, al haber de la 4750; a compensar o a devolver, al debe de la
--     4700. Después, «Contabilizado» (y «A compensar» si sale a compensar).
--     Fecha: el último día del periodo; si ese día no se puede apuntar
--     (traído de otro programa, mes o ejercicio cerrado), el primer día
--     abierto después, y se dice.
--     Un 303 con casillas que este asiento no sabe llevar ([68], [70], [77],
--     [108], [109], [112]) no se contabiliza solo: se dice cuáles.
--   conta_impuesto_cargos_posibles(declaración)                  [la persona]
--     Los movimientos del banco sin casar de la empresa por ese importe (cargo
--     si sale a pagar, abono si sale a devolver), desde el fin del periodo.
--   conta_impuesto_casar_cargo(declaración, movimiento)          [la persona]
--     Casa el cargo con la declaración por bank_casar (destino «cuenta», la
--     4750 o la 4700, sin tocar bank_casar), valida su asiento y apunta la
--     declaración en bank_match_item.tax_return_id. «Pagado» (o «Devuelto»).
--   Disparadores:
--     · bank_match deshecho → la declaración vuelve a «Contabilizado» (o a
--       «Presentado» si no lo estaba), sin su casado.
--     · el asiento de liquidación anulado → la declaración vuelve a
--       «Presentado» y se puede contabilizar otra vez.
--
-- CAMBIAR EN CALIENTE:
--   · conta_motivos_para_validar: la MISMA firma y el MISMO cuerpo que la
--     vigente (20261121T0140, comparada el 18/10 con pg_get_functiondef de
--     producción: md5 bac135c45a52d01bb5ec8318f241c960), con un cambio: la
--     regla «un apunte de IVA lleva base, tipo y libro registro» no se pide al
--     asiento de liquidación de un 303 de su misma empresa, ni a su
--     contraasiento (v_liquidacion). Solo cuando el origen es la declaración.
--   · conta_impuesto_estado_vale: la misma lista y, además, las vueltas atrás
--     de deshacer un pago o anular la liquidación (paid/refunded → booked o
--     filed; booked/offset → filed).
--   · bank_match_item: columna nueva tax_return_id y su CHECK amplía (uno de
--     los cinco destinos, no de cuatro).
--   · bank_match y journal_entry: un disparador nuevo cada una, con WHEN: solo
--     despierta al deshacer un casado o al anular un asiento de liquidación.
--
-- Vuelta atrás: supabase/vuelta-atras/20261122T0180_i01b_asiento_303.down.sql

-- ── 1 · Las vueltas atrás de una declaración ───────────────────────────────
create or replace function public.conta_impuesto_estado_vale(p_de text, p_a text)
returns boolean language sql immutable set search_path = public as $$
  select (p_de, p_a) in (
    ('pending', 'draft'), ('pending', 'not_required'),
    ('draft', 'reviewed'), ('draft', 'pending'), ('draft', 'not_required'), ('draft', 'filed'),
    ('reviewed', 'draft'), ('reviewed', 'filed'), ('reviewed', 'not_required'),
    ('filed', 'booked'), ('filed', 'paid'), ('filed', 'offset'), ('filed', 'refunded'),
    ('booked', 'paid'), ('booked', 'offset'), ('booked', 'refunded'),
    ('not_required', 'pending'),
    -- I01b (0180): deshacer el pago en Bancos, o anular el asiento de liquidación.
    ('paid', 'booked'), ('paid', 'filed'), ('refunded', 'booked'), ('refunded', 'filed'),
    ('booked', 'filed'), ('offset', 'filed'))
$$;

-- ── 2 · El cargo del banco, con su declaración ─────────────────────────────
alter table public.bank_match_item add column if not exists tax_return_id uuid references public.tax_return(id) on delete restrict;
alter table public.bank_match_item drop constraint if exists bank_match_item_uno;
alter table public.bank_match_item add constraint bank_match_item_uno
  check (num_nonnulls(supplier_invoice_id, channel_settlement_id, other_movement_id, party_id, tax_return_id) >= 1);
create index if not exists bank_match_item_impuesto on public.bank_match_item (tax_return_id) where tax_return_id is not null;
comment on column public.bank_match_item.tax_return_id is
  'I01b. La declaración que paga (o cobra) este movimiento. Deshacer el casado la devuelve a «Contabilizado».';

-- ── 3 · La validación acepta la liquidación del 303 ─────────────────────────
create or replace function public.conta_motivos_para_validar(p_entry uuid)
returns table (orden int, codigo text, motivo text)
language plpgsql
stable
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
  v_local boolean; v_liquidacion boolean;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null then return; end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then
    orden := 1; codigo := 'pocos_apuntes'; motivo := 'Un asiento lleva al menos dos apuntes.'; return next;
  end if;
  if v_debe <> v_haber then
    orden := 2; codigo := 'no_cuadra';
    motivo := format('No cuadra: Debe %s y Haber %s, diferencia %s.', v_debe, v_haber, v_debe - v_haber); return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    orden := 3; codigo := 'fuera_del_ejercicio';
    motivo := format('La fecha %s no es del ejercicio %s.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code); return next;
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      orden := 4; codigo := 'ejercicio_cerrado'; motivo := format('El ejercicio %s está cerrado.', v_y.code); return next;
    end if;
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      orden := 5; codigo := 'falta_historico';
      motivo := format('Primero hay que traer el histórico de %s de %s.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code); return next;
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      orden := 6; codigo := 'traido';
      motivo := format('Hasta el %s el ejercicio %s es traído de %s: la fecha abierta más cercana es el %s.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY')); return next;
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      orden := 7; codigo := 'mes_cerrado';
      motivo := format('El mes de %s está cerrado: la fecha abierta más cercana es el %s.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna')); return next;
    end if;

    -- C05 (respuesta 3), copiado de la vigente: un asiento de cierre o de
    -- apertura del generador de cierre (o su contraasiento) se libra de las
    -- reglas de IVA y retención.
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

    -- I01b (0180): el asiento de liquidación de un 303 (o su contraasiento)
    -- salda la 477 y la 472 del periodo: sus apuntes no llevan tipo ni libro
    -- registro. Solo si su origen es una declaración 303 de su misma empresa.
    v_liquidacion := exists (
      select 1 from public.journal_entry o
        join public.tax_return t on t.id = o.source_id and t.company_id = o.company_id and t.account_id = o.account_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.company_id = v_e.company_id
         and o.source_type = 'vat_settlement'
         and t.form_code = '303');

    -- S01 (0140): el local solo se pide si el eje «local» de la empresa está encendido
    -- (conta_eje_analitico; sin fila = apagado). Lo demás, como estaba.
    v_local := exists (select 1 from public.conta_eje_analitico x
                        where x.company_id = v_e.company_id and x.account_id = v_e.account_id and x.eje = 'local' and x.activo);

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre and not v_liquidacion
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when v_local and not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar. Copiado
  -- de tg_journal_entry_envio_por_aclarar, que desde aquí lo lee de esta función.
  if v_e.source_type = 'sales_day' then
    select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
      into v_aclarar, v_lista
      from public.sales_day_summary d
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
      join public.sale s on s.id = c.id and s.account_id = d.account_id
     where d.entry_id = v_e.id and d.account_id = v_e.account_id and c.clase = 'por_aclarar';
    if v_aclarar > 0 then
      orden := 9; codigo := 'envio_por_aclarar';
      motivo := format('No se valida: %s con envío por aclarar: %s. Se resuelve con la liquidación de esa semana.',
        v_aclarar || case when v_aclarar = 1 then ' pedido' else ' pedidos' end, v_lista); return next;
    end if;
  end if;
end $function$;

-- ── 4 · Importes en palabras de oficina ─────────────────────────────────────
create or replace function public.conta_impuesto_euros(p numeric)
returns text language sql immutable set search_path = public as $$
  select translate(to_char(p, 'FM999G999G990D00'), ',.', '.,') || ' €'
$$;

-- ── 5 · Contabilizar ────────────────────────────────────────────────────────
create or replace function public.conta_impuesto_303_contabilizar(p_return uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tax_return; v_desde date; v_hasta date; v_fecha date; v_aviso_fecha text;
  v27 numeric; v45 numeric; v71 numeric; v78 numeric; v_raras text;
  v_lineas jsonb := '[]'::jsonb; v_res jsonb; v_entry uuid; v_val jsonb; v_cta text; v_cta_mayor text; v_suma numeric; v_mov numeric;
  v_4700 text; v_4750 text; v_estado text; v_concepto text; v_nombre text := public.conta_impuesto_quien(); x record;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(r.account_id) then
    raise exception 'El asiento de liquidación lo hace un administrador o un encargado de la empresa.' using errcode = '42501';
  end if;
  if r.form_code <> '303' then raise exception 'Solo se contabiliza solo el 303 de momento.' using errcode = '22023'; end if;

  -- Ya contabilizada: se dice cuál.
  if r.liquidation_entry_id is not null then
    select format('Ya estaba contabilizado: asiento %s/%s del %s.', e.series, coalesce(e.number::text, '—'), to_char(e.entry_date, 'DD/MM/YYYY'))
      into v_concepto from public.journal_entry e where e.id = r.liquidation_entry_id and e.status in ('propuesto', 'borrador', 'validado');
    if v_concepto is not null then
      return jsonb_build_object('ok', true, 'asiento', r.liquidation_entry_id, 'existente', true, 'mensaje', v_concepto);
    end if;
  end if;
  if r.status not in ('filed', 'paid', 'refunded') then
    raise exception 'Esta declaración está «%»: se contabiliza cuando está presentada.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;

  select desde, hasta into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period);
  select coalesce(max(value) filter (where box = '27'), 0), coalesce(max(value) filter (where box = '45'), 0),
         coalesce(max(value) filter (where box = '71'), 0), coalesce(max(value) filter (where box = '78'), 0),
         string_agg('[' || box || ']', ', ' order by box) filter (where box in ('68', '70', '77', '108', '109', '112') and coalesce(value, 0) <> 0)
    into v27, v45, v71, v78, v_raras
    from public.tax_return_box where tax_return_id = r.id;
  if v_raras is not null then
    raise exception 'Este 303 lleva % y el asiento de liquidación todavía no sabe llevarlas: hazlo a mano en el diario, con origen esta declaración.', v_raras
      using errcode = '22023';
  end if;
  if abs((v27 - v45 - v78) - v71) >= 0.005 then
    raise exception 'Las casillas no cuadran: [27] % − [45] % − [78] % no da el resultado [71] %.',
      public.conta_impuesto_euros(v27), public.conta_impuesto_euros(v45), public.conta_impuesto_euros(v78), public.conta_impuesto_euros(v71)
      using errcode = '22023';
  end if;

  -- Sin nada que saldar: «Contabilizado» sin asiento, y se dice.
  if v27 = 0 and v45 = 0 and v78 = 0 then
    if r.status = 'filed' then
      update public.tax_return set status = 'booked', updated_at = now() where id = r.id;
    end if;
    insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message)
    values (r.id, r.account_id, r.company_id, auth.uid(), v_nombre, 'note', 'Sin IVA que saldar: no hace falta asiento de liquidación.');
    return jsonb_build_object('ok', true, 'asiento', null, 'mensaje', 'Contabilizado. Este 303 no tiene IVA que saldar: no hace falta asiento.');
  end if;

  -- La fecha: el último día del periodo, o el primer día abierto después.
  v_fecha := v_hasta;
  if exists (select 1 from public.fiscal_year y where y.company_id = r.company_id and v_hasta between y.starts_on and y.ends_on
               and (y.status <> 'open' or (y.imported_until is not null and v_hasta <= y.imported_until)))
     or public.conta_mes_cerrado(r.company_id, v_hasta) then
    v_fecha := public.conta_primer_dia_abierto(r.company_id, v_hasta + 1);
    if v_fecha is null then
      raise exception 'No hay ningún día abierto después del % para apuntar la liquidación.', to_char(v_hasta, 'DD/MM/YYYY') using errcode = '23514';
    end if;
    v_aviso_fecha := format(' Con fecha %s: el %s no se puede apuntar (traído o cerrado).', to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_hasta, 'DD/MM/YYYY'));
  end if;

  -- 477 (al debe) y 472 (al haber), por subcuenta. Lo que movió cada una en el
  -- periodo (como la comprobación ledger_477_472 del cálculo), y la diferencia
  -- con la casilla, a la que más movió (o a la primera, si no movió ninguna).
  for x in select k.raiz, k.casilla, k.lado from (values ('477', v27, 'debe'), ('472', v45, 'haber')) k(raiz, casilla, lado) loop
    v_suma := 0; v_cta_mayor := null;
    for v_cta, v_mov in
      select ca.code, sum(case when x.raiz = '477' then jl.credit - jl.debit else jl.debit - jl.credit end)
        from public.journal_line jl
        join public.journal_entry je on je.id = jl.entry_id
        join public.company_account ca on ca.id = jl.company_account_id
       where je.account_id = r.account_id and je.company_id = r.company_id and je.status in ('validado', 'anulado')
         and je.source_type not in ('vat_settlement', 'opening', 'closing') and je.entry_date between v_desde and v_hasta
         and ca.template_code like x.raiz || '%'
       group by ca.code
      having sum(jl.credit - jl.debit) <> 0
       order by abs(sum(jl.credit - jl.debit)) desc, ca.code
    loop
      v_cta_mayor := coalesce(v_cta_mayor, v_cta);
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'importe', v_mov, 'raiz', x.raiz));
      v_suma := v_suma + v_mov;
    end loop;
    if v_cta_mayor is null then
      select min(code) into v_cta_mayor from public.company_account where company_id = r.company_id and template_code = x.raiz;
      if v_cta_mayor is null then
        raise exception 'La cuenta % no está en el plan de la empresa.', x.raiz using errcode = '23514';
      end if;
    end if;
    if abs(x.casilla - v_suma) >= 0.005 then
      v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', v_cta_mayor, 'importe', x.casilla - v_suma, 'raiz', x.raiz));
    end if;
  end loop;

  select min(code) into v_4700 from public.company_account where company_id = r.company_id and template_code = '4700';
  select min(code) into v_4750 from public.company_account where company_id = r.company_id and template_code = '4750';
  if (v78 <> 0 or v71 < 0) and v_4700 is null then raise exception 'La cuenta 4700 no está en el plan de la empresa.' using errcode = '23514'; end if;
  if v71 > 0 and v_4750 is null then raise exception 'La cuenta 4750 no está en el plan de la empresa.' using errcode = '23514'; end if;

  v_concepto := 'Liquidación del IVA ' || case r.period when '1T' then 'del 1.er trimestre' when '2T' then 'del 2.º trimestre'
                  when '3T' then 'del 3.er trimestre' when '4T' then 'del 4.º trimestre' else 'de ' || r.period end
                || ' de ' || r.fiscal_year || ' (modelo 303)';

  -- Las líneas: juntas las de la misma cuenta, y del lado que toca.
  v_res := (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cuenta', c.cuenta,
             'debe', case when c.raiz = '477' then greatest(c.importe, 0) else greatest(-c.importe, 0) end,
             'haber', case when c.raiz = '477' then greatest(-c.importe, 0) else greatest(c.importe, 0) end,
             'concepto', v_concepto, 'comun', true) order by c.raiz desc, c.cuenta), '[]'::jsonb)
      from (select l->>'cuenta' cuenta, l->>'raiz' raiz, sum((l->>'importe')::numeric) importe
              from jsonb_array_elements(v_lineas) l group by 1, 2 having sum((l->>'importe')::numeric) <> 0) c);
  if v78 <> 0 then
    v_res := v_res || jsonb_build_array(jsonb_build_object('cuenta', v_4700, 'debe', 0, 'haber', v78, 'concepto', 'Compensado de periodos anteriores', 'comun', true));
  end if;
  if v71 > 0 then
    v_res := v_res || jsonb_build_array(jsonb_build_object('cuenta', v_4750, 'debe', 0, 'haber', v71, 'concepto', v_concepto, 'comun', true));
  elsif v71 < 0 then
    v_res := v_res || jsonb_build_array(jsonb_build_object('cuenta', v_4700, 'debe', -v71, 'haber', 0, 'concepto', v_concepto, 'comun', true));
  end if;

  v_res := public._journal_entry_proponer(r.company_id,
    jsonb_build_object('fecha', v_fecha, 'series', 4, 'concepto', v_concepto, 'source_type', 'vat_settlement', 'source_id', r.id,
                       'confianza', 'seguro', 'porque', 'Sale de las casillas del 303 presentado.',
                       'razones', jsonb_build_array(jsonb_build_object('decision', 'liquidacion-303', 'declaracion', r.id,
                                   'casillas', jsonb_build_object('27', v27, '45', v45, '78', v78, '71', v71))),
                       'documento', r.aeat_receipt_number),
    v_res, null, v_nombre, auth.uid());
  if coalesce((v_res->>'descartada')::boolean, false) then
    raise exception 'El asiento de liquidación de esta declaración se descartó en el diario.' using errcode = '23514';
  end if;
  v_entry := (v_res->>'id')::uuid;
  if exists (select 1 from public.journal_entry where id = v_entry and status in ('propuesto', 'borrador')) then
    v_val := public.journal_entry_validar(v_entry, v_nombre);
  else
    select jsonb_build_object('serie', series, 'numero', number) into v_val from public.journal_entry where id = v_entry;
  end if;

  v_estado := case when r.status = 'filed' and r.result_kind = 'to_offset' then 'offset'
                   when r.status = 'filed' then 'booked' else r.status end;
  if v_estado = 'offset' then
    update public.tax_return set status = 'booked', liquidation_entry_id = v_entry, updated_at = now() where id = r.id;
  end if;
  update public.tax_return set status = v_estado, liquidation_entry_id = v_entry, updated_at = now() where id = r.id;

  v_concepto := format('Contabilizado: asiento %s/%s del %s, 477 contra 472%s.', v_val->>'serie', v_val->>'numero', to_char(v_fecha, 'DD/MM/YYYY'),
                  case when v71 > 0 then ' y ' || public.conta_impuesto_euros(v71) || ' a la 4750'
                       when v71 < 0 then ' y ' || public.conta_impuesto_euros(-v71) || ' a la 4700'
                       else '' end) || coalesce(v_aviso_fecha, '');
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_nombre, 'note', v_concepto, jsonb_build_object('asiento', v_entry, 'fecha', v_fecha));
  return jsonb_build_object('ok', true, 'asiento', v_entry, 'serie', v_val->'serie', 'numero', v_val->'numero', 'fecha', v_fecha, 'mensaje', v_concepto);
end $$;
comment on function public.conta_impuesto_303_contabilizar(uuid) is
  'I01b. El asiento de liquidación del 303 presentado (477 contra 472, el resultado a 4750 o 4700, lo compensado de antes a 4700), validado, y la declaración a «Contabilizado». Un 303 con casillas raras o sin día abierto no se contabiliza y se dice por qué.';

-- ── 6 · Qué cargos del banco pueden ser el pago ─────────────────────────────
create or replace function public.conta_impuesto_cargos_posibles(p_return uuid)
returns table (movimiento uuid, fecha date, importe numeric, concepto text, cuenta text)
language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; v_hasta date;
begin
  select * into r from public.tax_return where id = p_return;
  if r.id is null or not public.current_user_is_admin_or_manager_of(r.account_id) then
    raise exception 'Esa declaración no es de tu cuenta.' using errcode = '42501';
  end if;
  if coalesce(r.result_kind, '') not in ('to_pay', 'to_refund') or coalesce(r.amount, 0) = 0 then return; end if;
  select hasta into v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period);
  return query
    select m.id, m.op_date, m.amount, nullif(m.clean_concept, ''), t.name
      from public.bank_movement m join public.treasury_account t on t.id = m.treasury_account_id
     where m.account_id = r.account_id and m.company_id = r.company_id and m.status = 'pendiente' and not m.before_cutover
       and m.amount = case when r.result_kind = 'to_pay' then -r.amount else r.amount end
       and m.op_date > v_hasta
       and not exists (select 1 from public.bank_match b where b.movement_id = m.id and b.status = 'vivo')
     order by abs(m.op_date - coalesce(r.due_date_direct_debit, r.due_date)), m.op_date;
end $$;

-- ── 7 · Casar el cargo con la declaración ──────────────────────────────────
create or replace function public.conta_impuesto_casar_cargo(p_return uuid, p_movement uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tax_return; m public.bank_movement; v_cta text; v_casado jsonb; v_match uuid; v_entry uuid; v_aviso text; v_estado text;
  v_esperado numeric; v_nombre text := public.conta_impuesto_quien();
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(r.account_id) then
    raise exception 'El pago lo casa un administrador o un encargado de la empresa.' using errcode = '42501';
  end if;
  if r.status not in ('filed', 'booked') then
    raise exception 'Esta declaración está «%»: el pago se casa cuando está presentada.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if coalesce(r.result_kind, '') not in ('to_pay', 'to_refund') or coalesce(r.amount, 0) = 0 then
    raise exception 'Este 303 no sale a pagar ni a devolver: no hay cargo que casar.' using errcode = '22023';
  end if;
  select * into m from public.bank_movement where id = p_movement;
  if m.id is null or m.company_id <> r.company_id or m.account_id <> r.account_id then
    raise exception 'Ese movimiento no es de la empresa de la declaración.' using errcode = '42501';
  end if;
  -- (El IF de PL/pgSQL corta en el primer THEN: el CASE, fuera.)
  v_esperado := case when r.result_kind = 'to_pay' then -r.amount else r.amount end;
  if m.amount <> v_esperado then
    raise exception 'El movimiento es de % y la declaración, de % %.', public.conta_impuesto_euros(m.amount), public.conta_impuesto_euros(r.amount),
      case when r.result_kind = 'to_pay' then 'a pagar' else 'a devolver' end using errcode = '22023';
  end if;
  select min(code) into v_cta from public.company_account where company_id = r.company_id
     and template_code = case when r.result_kind = 'to_pay' then '4750' else '4700' end;
  if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', case when r.result_kind = 'to_pay' then '4750' else '4700' end using errcode = '23514'; end if;

  v_casado := public.bank_casar(m.id,
    jsonb_build_object('tipo', 'cuenta', 'concepto', 'Pago del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year,
                       'lineas', jsonb_build_array(jsonb_build_object('cuenta', v_cta, 'importe', r.amount,
                                                   'concepto', 'Pago del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year))),
    'seguro', 'Es el ' || case when r.result_kind = 'to_pay' then 'cargo' else 'abono' end || ' del ' || r.form_code || ' ' || r.period || '/' || r.fiscal_year || ' por su importe.',
    jsonb_build_array(jsonb_build_object('decision', 'pago-impuesto', 'declaracion', r.id)), 'persona', null);
  v_match := (v_casado->>'match')::uuid; v_entry := (v_casado->>'asiento')::uuid;
  insert into public.bank_match_item (account_id, match_id, tax_return_id, amount, marked_by_bank)
  values (r.account_id, v_match, r.id, m.amount, true);

  -- El asiento del pago, validado: lo ha confirmado la persona. Si no se puede, queda propuesto y se dice.
  if exists (select 1 from public.journal_entry where id = v_entry and status in ('propuesto', 'borrador')) then
    begin
      perform public.journal_entry_validar(v_entry, v_nombre);
    exception when others then
      v_aviso := ' Su asiento queda propuesto: ' || sqlerrm;
    end;
  end if;

  v_estado := case when r.result_kind = 'to_pay' then 'paid' else 'refunded' end;
  update public.tax_return set status = v_estado, bank_match_id = v_match, payment_entry_id = v_entry, updated_at = now() where id = r.id;
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_nombre, 'note',
          format('%s con el movimiento del %s por %s.%s', case when v_estado = 'paid' then 'Pagado' else 'Devuelto' end,
                 to_char(m.op_date, 'DD/MM/YYYY'), public.conta_impuesto_euros(abs(m.amount)), coalesce(v_aviso, '')),
          jsonb_build_object('casado', v_match, 'asiento', v_entry, 'movimiento', m.id));
  return jsonb_build_object('ok', true, 'casado', v_match, 'asiento', v_entry,
    'mensaje', format('%s: casado con el movimiento del %s por %s.%s', case when v_estado = 'paid' then 'Pagado' else 'Devuelto' end,
                      to_char(m.op_date, 'DD/MM/YYYY'), public.conta_impuesto_euros(abs(m.amount)), coalesce(v_aviso, '')));
end $$;

-- ── 8 · Deshacer el casado devuelve la declaración ─────────────────────────
create or replace function public.tg_bank_match_deshecho_impuesto()
returns trigger language plpgsql security definer set search_path = public as $$
declare i record;
begin
  for i in select it.tax_return_id from public.bank_match_item it where it.match_id = new.id and it.tax_return_id is not null loop
    update public.tax_return
       set status = case when liquidation_entry_id is not null then 'booked' else 'filed' end,
           bank_match_id = null, payment_entry_id = null, updated_at = now()
     where id = i.tax_return_id and status in ('paid', 'refunded') and bank_match_id = new.id;
    insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message)
    select t.id, t.account_id, t.company_id, auth.uid(), public.conta_impuesto_quien(), 'note',
           'Se deshizo el casado del pago en Bancos: ' || coalesce(new.undo_reason, 'sin motivo') || '.'
      from public.tax_return t where t.id = i.tax_return_id;
  end loop;
  return new;
end $$;
drop trigger if exists bank_match_deshecho_impuesto on public.bank_match;
create trigger bank_match_deshecho_impuesto after update of status on public.bank_match
  for each row when (new.status = 'deshecho' and old.status = 'vivo')
  execute function public.tg_bank_match_deshecho_impuesto();

-- ── 9 · Anular la liquidación devuelve la declaración ──────────────────────
create or replace function public.tg_journal_entry_liquidacion_anulada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  select t.id, t.account_id, t.company_id, auth.uid(), public.conta_impuesto_quien(), 'note',
         'Se anuló el asiento de liquidación' || coalesce(' ' || new.series || '/' || new.number, '') || ': ' || coalesce(new.void_reason, 'sin motivo') ||
         case when t.status in ('booked', 'offset') then '. Vuelve a «Presentado».' else '.' end,
         jsonb_build_object('asiento', new.id)
    from public.tax_return t where t.liquidation_entry_id = new.id;
  update public.tax_return
     set status = case when status in ('booked', 'offset') then 'filed' else status end, liquidation_entry_id = null, updated_at = now()
   where liquidation_entry_id = new.id;
  return new;
end $$;
drop trigger if exists journal_entry_liquidacion_anulada on public.journal_entry;
create trigger journal_entry_liquidacion_anulada after update of status on public.journal_entry
  for each row when (new.source_type = 'vat_settlement' and new.status = 'anulado' and old.status = 'validado')
  execute function public.tg_journal_entry_liquidacion_anulada();

-- ── Quién llama ─────────────────────────────────────────────────────────────
revoke all on function public.conta_impuesto_303_contabilizar(uuid), public.conta_impuesto_cargos_posibles(uuid),
                       public.conta_impuesto_casar_cargo(uuid, uuid), public.tg_bank_match_deshecho_impuesto(),
                       public.tg_journal_entry_liquidacion_anulada() from public, anon;
grant execute on function public.conta_impuesto_303_contabilizar(uuid), public.conta_impuesto_cargos_posibles(uuid),
                          public.conta_impuesto_casar_cargo(uuid, uuid) to authenticated;
grant execute on function public.conta_impuesto_euros(numeric) to authenticated, service_role;
