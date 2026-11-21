-- supabase/migrations/20261120T0900_r07_factura_y_cobro_del_dia.sql
--
-- R07 · 2 · El día en dos asientos: la factura del día y su cobro (encargo R07; respuesta R07 · 1, 19/11).
--
-- Desde el día en que la empresa elige la cuenta de «La factura del día va a» («Clientes de contado»),
-- cada día de ventas va en DOS asientos, el mismo día y unidos:
--   1. la factura del día: «Clientes de contado» al debe, contra las ventas y el IVA (su libro de IVA, una
--      sola vez, aquí; con el rango de tickets en el TPV de fuera);
--   2. el cobro del día: cada forma de pago (o el canal) a su cuenta, contra «Clientes de contado», que
--      queda a cero.
-- Los días ya validados NO se rehacen (respuesta R07 · 1, punto 1: ya están en ERP10 por Diez).
--
-- Lo que solo añade (el enlace, la columna «desde», partir y proponer el día, y lo de la pantalla) va
-- antes, en la 0810. Esta cambia:
--   1. journal_entry admite el origen «sales_day_payment» (el cobro del día): el CHECK solo amplía.
--   2. _conta_dia_cobro_junto (nueva) y su disparador en journal_entry: validar, anular o quitar uno de
--      los dos hace lo mismo con el otro.
--   3. Por trozos exactos (si un trozo no está una sola vez, PARA sin tocar nada; con respaldo):
--      _conta_tpv_propuesta, conta_tpv_dia_para_validar y conta_tpv_dia_validar (el TPV de fuera: sin la
--      cuenta no se propone, «Falta la cuenta de la factura del día»; al validar, los dos);
--      conta_proponer_dias (el cierre del día de Folvy: por _conta_dia_proponer);
--      conta_erp10_dias_tpv_por_salir («Clientes de contado» es la cuenta elegida, si la hay; y cada día
--      dice su cobro, «cobroId», para que salgan juntos).
-- No retira asientos al aplicarse.
-- sin hueco: el fichero no retira nada al aplicarse. El «delete from journal_entry» del disparador quita
-- el cobro sin validar cuando se descarta o se quita su factura sin validar (y al revés).
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- cambia: public._conta_tpv_propuesta · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- cambia: public.conta_tpv_dia_para_validar · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- cambia: public.conta_tpv_dia_validar · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- cambia: public.conta_proponer_dias · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- cambia: public.conta_erp10_dias_tpv_por_salir · prueba: supabase/staging/sql/20261120_r07_factura_y_cobro_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261120T0900_r07_factura_y_cobro_del_dia.down.sql

set local lock_timeout = '5s';

-- ── 1 · El origen del cobro del día ─────────────────────────────────────────
do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.journal_entry'::regclass and conname = 'journal_entry_source_type_check')) not like '%sales_day_payment%' then
    alter table public.journal_entry drop constraint journal_entry_source_type_check;
    alter table public.journal_entry add constraint journal_entry_source_type_check check (source_type = any (array['sales_day', 'sales_adjustment', 'supplier_invoice',
      'supplier_payment', 'channel_settlement', 'licensed_settlement', 'payroll', 'bank', 'vat_settlement', 'manual', 'template', 'reversal', 'opening', 'closing',
      'migrated', 'purchase_accrual', 'purchase_accrual_reversal', 'customer_invoice', 'customer_payment', 'sales_day_payment']));
  end if;
end $$;

-- ── 2 · Los dos, juntos ─────────────────────────────────────────────────────
create or replace function public._conta_dia_cobro_junto()
returns trigger language plpgsql security definer set search_path = public as $f$
declare v_otro uuid; v_o public.journal_entry;
begin
  select case when c.factura_entry_id = old.id then c.cobro_entry_id else c.factura_entry_id end into v_otro
    from public.conta_dia_cobro c where old.id in (c.factura_entry_id, c.cobro_entry_id);
  if v_otro is null then return null; end if;
  select * into v_o from public.journal_entry where id = v_otro;
  if tg_op = 'DELETE' then
    delete from public.conta_dia_cobro where old.id in (factura_entry_id, cobro_entry_id);
    -- Descartar el cobro descarta el día: si no, el cierre de la hora siguiente volvería a proponer los dos.
    if old.source_type = 'sales_day_payment' and v_o.status in ('propuesto', 'borrador') and v_o.source_type = 'sales_day'
       and exists (select 1 from public.journal_dismissal d where d.company_id = old.company_id and d.source_type = 'sales_day_payment' and d.source_key = old.source_id::text) then
      insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
      select v_o.account_id, v_o.company_id, 'sales_day', s.location_id || ':' || s.sales_day || coalesce(':' || s.unit_key, ''), d.reason, d.created_by, d.created_by_name
        from public.sales_day_summary s, public.journal_dismissal d
       where s.id = v_o.source_id and d.company_id = old.company_id and d.source_type = 'sales_day_payment' and d.source_key = old.source_id::text
      on conflict (company_id, source_type, source_key) do update set reason = excluded.reason;
    end if;
    if v_o.status in ('propuesto', 'borrador') then delete from public.journal_entry where id = v_otro; end if;
    return null;
  end if;
  if new.status = 'validado' and old.status in ('propuesto', 'borrador') and v_o.status in ('propuesto', 'borrador') then
    perform public._journal_entry_validar(v_otro, coalesce(new.validated_by_name, public.conta_nombre_actor()));
  elsif new.status = 'anulado' and old.status = 'validado' and v_o.status = 'validado' then
    perform public.journal_entry_anular(v_otro, 'Va con el asiento ' || old.series || '/' || old.number || ', que se ha anulado: ' || coalesce(new.void_reason, ''),
                                        current_date, coalesce(new.voided_by_name, public.conta_nombre_actor()));
  end if;
  return null;
end $f$;
revoke all on function public._conta_dia_cobro_junto() from public, anon, authenticated;
drop trigger if exists trg_journal_entry_dia_cobro_junto on public.journal_entry;
create trigger trg_journal_entry_dia_cobro_junto after update of status or delete on public.journal_entry
  for each row execute function public._conta_dia_cobro_junto();

-- ── 3 · Por trozos exactos ──────────────────────────────────────────────────
do $g$
begin
  if to_regprocedure('public._respaldar_funcion(text,text)') is null then raise exception 'R07 · 0900: falta _respaldar_funcion.'; end if;
end $g$;
select public._respaldar_funcion('public._conta_tpv_propuesta(uuid)', '20261120T0900_r07_factura_y_cobro_del_dia') where strpos(pg_get_functiondef('public._conta_tpv_propuesta(uuid)'::regprocedure), 'R07 · la factura del día y su cobro') = 0;
select public._respaldar_funcion('public.conta_tpv_dia_para_validar(uuid)', '20261120T0900_r07_factura_y_cobro_del_dia') where strpos(pg_get_functiondef('public.conta_tpv_dia_para_validar(uuid)'::regprocedure), 'R07 · la factura del día y su cobro') = 0;
select public._respaldar_funcion('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)', '20261120T0900_r07_factura_y_cobro_del_dia') where strpos(pg_get_functiondef('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)'::regprocedure), 'R07 · la factura del día y su cobro') = 0;
select public._respaldar_funcion('public.conta_proponer_dias(uuid,timestamptz,text)', '20261120T0900_r07_factura_y_cobro_del_dia') where strpos(pg_get_functiondef('public.conta_proponer_dias(uuid,timestamptz,text)'::regprocedure), 'R07 · la factura del día y su cobro') = 0;
select public._respaldar_funcion('public.conta_erp10_dias_tpv_por_salir(uuid,date)', '20261120T0900_r07_factura_y_cobro_del_dia') where strpos(pg_get_functiondef('public.conta_erp10_dias_tpv_por_salir(uuid,date)'::regprocedure), 'R07 · la cuenta de la factura del día') = 0;

do $do$
declare v_def text; k int; v text; n text;
begin
  v_def := pg_get_functiondef('public._conta_tpv_propuesta(uuid)'::regprocedure);
  if strpos(v_def, 'R07 · la factura del día y su cobro') = 0 then
    v := $v$  v_rango text;
$v$;
    n := $n$  v_rango text; v_contado text; v_partido jsonb;
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public._conta_tpv_propuesta(uuid) no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$  if cardinality(v_faltan) > 0 then
$v$;
    n := $n$  -- R07 · la factura del día y su cobro: la factura lleva «Clientes de contado» (la cuenta de «La factura del día va a»).
  select a.code into v_contado from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
   where f.company_id = v_d.company_id and f.account_id = v_d.account_id and a.status is distinct from 'cerrada';
  if v_contado is null then v_faltan := v_faltan || 'Falta la cuenta de la factura del día.'::text; end if;
  if cardinality(v_faltan) > 0 then
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public._conta_tpv_propuesta(uuid) no es la medida (su trozo 2 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$  select count(*) filter (where cliente_nif is not null), count(*) filter (where total < 0), coalesce(round(sum(total) filter (where total < 0) * 100), 0)
$v$;
    n := $n$  v_partido := public._conta_dia_partir(v_lineas, v_contado);
  select count(*) filter (where cliente_nif is not null), count(*) filter (where total < 0), coalesce(round(sum(total) filter (where total < 0) * 100), 0)
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public._conta_tpv_propuesta(uuid) no es la medida (su trozo 3 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$      'series', 1, 'fecha', v_d.dia, 'concepto', 'Ventas del día · TPV ' || v_programa,
$v$;
    n := $n$      'series', 1, 'fecha', v_d.dia, 'concepto', 'Factura del día · TPV ' || v_programa || ' · tickets ' || v_rango,
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public._conta_tpv_propuesta(uuid) no es la medida (su trozo 4 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$    'lineas', v_lineas);
$v$;
    n := $n$    'lineas', v_partido->'factura',
    'cobro', jsonb_build_object(
      'entrada', jsonb_build_object('series', 1, 'fecha', v_d.dia, 'concepto', 'Cobro del día · TPV ' || v_programa,
        'source_type', 'sales_day_payment', 'source_id', v_d.id, 'confianza', 'seguro',
        'porque', 'Lo cobrado el día, por forma de pago, contra «Clientes de contado»: la deja a cero.', 'razones', '[]'::jsonb, 'party_id', null,
        'documento', v_d.primer_numero || case when v_d.primer_numero = v_d.ultimo_numero then '' else '-' || v_d.ultimo_numero end),
      'lineas', v_partido->'cobro'));
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public._conta_tpv_propuesta(uuid) no es la medida (su trozo 5 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.conta_tpv_dia_para_validar(uuid)'::regprocedure);
  if strpos(v_def, 'R07 · la factura del día y su cobro') = 0 then
    v := $v$    'concepto', v_p->'entrada'->>'concepto', 'lineas', v_lineas);
$v$;
    n := $n$    'concepto', v_p->'entrada'->>'concepto', 'lineas', v_lineas,
    -- R07 · la factura del día y su cobro: el cobro, con el nombre de cada cuenta.
    'cobro', jsonb_build_object('concepto', v_p->'cobro'->'entrada'->>'concepto',
      'lineas', (select jsonb_agg(l || jsonb_build_object('nombre', (select a.name from public.company_account a where a.company_id = v_d.company_id and a.code = l->>'cuenta')) order by o)
                   from jsonb_array_elements(v_p->'cobro'->'lineas') with ordinality as z(l, o))));
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_tpv_dia_para_validar(uuid) no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)'::regprocedure);
  if strpos(v_def, 'R07 · la factura del día y su cobro') = 0 then
    v := $v$  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_prefijo text; v_obj record;
$v$;
    n := $n$  v_quien text := coalesce(p_quien_nombre, public.conta_nombre_actor()); v_prefijo text; v_obj record; v_cobro uuid := gen_random_uuid(); v_vc jsonb;
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text) no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$  -- 5 · El día, contabilizado: ya no se sustituye subiéndolo otra vez.
$v$;
    n := $n$  -- R07 · la factura del día y su cobro: el cobro, el mismo día, unido a su factura (se validan, se deshacen y se ven juntos).
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                    confidence, reason, reasons, party_id, document_ref, document_date, created_by, created_by_name)
  values (v_cobro, v_d.account_id, v_d.company_id, v_y, 1, v_fecha, v_p->'cobro'->'entrada'->>'concepto', 'sales_day_payment', p_entry, 'propuesto',
          'seguro', v_p->'cobro'->'entrada'->>'porque', '[]'::jsonb, null, v_p->'cobro'->'entrada'->>'documento', v_d.dia, auth.uid(), v_quien);
  v_pos := 0;
  for v_l in select * from jsonb_array_elements(v_p->'cobro'->'lineas') loop
    v_pos := v_pos + 1;
    select id into v_cta from public.company_account where company_id = v_d.company_id and code = v_l->>'cuenta';
    if v_cta is null then raise exception 'La cuenta % no está en el plan de la empresa.', v_l->>'cuenta' using errcode = '23514'; end if;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, location_id, is_common)
    values (v_d.account_id, v_d.company_id, v_cobro, v_pos, v_cta, coalesce((v_l->>'debe')::numeric, 0), coalesce((v_l->>'haber')::numeric, 0), v_l->>'concepto', null, true);
  end loop;
  insert into public.conta_dia_cobro (account_id, company_id, factura_entry_id, cobro_entry_id) values (v_d.account_id, v_d.company_id, p_entry, v_cobro);
  v_vc := public.journal_entry_validar(v_cobro, v_quien);

  -- 5 · El día, contabilizado: ya no se sustituye subiéndolo otra vez.
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text) no es la medida (su trozo 2 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$  return jsonb_build_object('id', p_entry, 'dia', v_d.dia, 'serie', v_v->'serie', 'numero', v_v->'numero',
$v$;
    n := $n$  return jsonb_build_object('id', p_entry, 'dia', v_d.dia, 'serie', v_v->'serie', 'numero', v_v->'numero', 'cobro_id', v_cobro, 'cobro_numero', v_vc->'numero',
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text) no es la medida (su trozo 3 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$    'texto', format('Ventas del %s (TPV · %s): validadas con su PDF y el asiento nº %s · %s factura%s, %s, %s.',
      to_char(v_d.dia, 'DD/MM/YYYY'), case v_d.programa when 'revo' then 'Revo' else v_d.programa end, v_v->>'numero',
$v$;
    n := $n$    'texto', format('Ventas del %s (TPV · %s): la factura del día es el asiento nº %s y su cobro el nº %s · %s factura%s, %s, %s.',
      to_char(v_d.dia, 'DD/MM/YYYY'), case v_d.programa when 'revo' then 'Revo' else v_d.programa end, v_v->>'numero', v_vc->>'numero',
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text) no es la medida (su trozo 4 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.conta_proponer_dias(uuid,timestamptz,text)'::regprocedure);
  if strpos(v_def, 'R07 · la factura del día y su cobro') = 0 then
    v := $v$v_r := public._journal_entry_proponer(p_company, v_p->'entrada', v_p->'lineas', v_p->'resumen', p_quien, null);$v$;
    n := $n$v_r := public._conta_dia_proponer(p_company, v_p, p_quien);  -- R07 · la factura del día y su cobro$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_proponer_dias(uuid,timestamptz,text) no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$v_r := public._journal_entry_proponer(p_company, v_u->'propuesta'->'entrada', v_u->'propuesta'->'lineas', v_u->'propuesta'->'resumen', p_quien, null);$v$;
    n := $n$v_r := public._conta_dia_proponer(p_company, v_u->'propuesta', p_quien);  -- R07 · la factura del día y su cobro$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_proponer_dias(uuid,timestamptz,text) no es la medida (su trozo 2 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.conta_erp10_dias_tpv_por_salir(uuid,date)'::regprocedure);
  if strpos(v_def, 'R07 · la cuenta de la factura del día') = 0 then
    v := $v$     where a.company_id = v_c.id and a.account_id = v_c.account_id and a.code like '430%'
       and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada'
$v$;
    n := $n$     where a.company_id = v_c.id and a.account_id = v_c.account_id and a.status is distinct from 'cerrada'
       -- R07 · la cuenta de la factura del día, la elegida; si no hay, las 430 que dicen «contado», como hasta ahora.
       and case when exists (select 1 from public.conta_tpv_factura_cuenta f where f.company_id = v_c.id and f.account_id = v_c.account_id)
                then exists (select 1 from public.conta_tpv_factura_cuenta f where f.company_id = v_c.id and f.account_id = v_c.account_id and f.company_account_id = a.id)
                else a.code like '430%' and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') end
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_erp10_dias_tpv_por_salir(uuid,date) no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$        'contadores', r.contadores, 'unidad', f.unit_key, 'resumenes', f.resumenes,
$v$;
    n := $n$        'contadores', r.contadores, 'unidad', f.unit_key, 'resumenes', f.resumenes,
        'cobroId', (select k.cobro_entry_id from public.conta_dia_cobro k where k.factura_entry_id = e.id and k.company_id = v_c.id),
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R07 · 0900: public.conta_erp10_dias_tpv_por_salir(uuid,date) no es la medida (su trozo 2 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    execute v_def;
  end if;
end $do$;
