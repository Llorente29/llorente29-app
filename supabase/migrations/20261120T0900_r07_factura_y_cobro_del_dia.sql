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
--   1. journal_entry admite el origen «sales_day_payment» (el cobro del día): el CHECK solo amplía.
--   2. conta_tpv_factura_cuenta.desde (nueva columna): desde qué día va la forma nueva.
--   3. conta_dia_cobro (nueva): qué cobro va con qué factura. Sin claves ajenas a propósito: las borra
--      el disparador de abajo (una clave ajena borraría el enlace antes de que el disparador lo lea).
--   4. _conta_dia_partir (nueva): de las líneas de siempre, la factura y el cobro. Lado del cobro: lo que
--      no es 6, 7 ni 477 (caja, banco, la 430 de una plataforma…).
--   5. _conta_dia_concepto y _conta_dia_proponer (nuevas): propone por el embudo de siempre (_journal_entry_proponer) la factura
--      y, si la empresa tiene la cuenta y el día es de su «desde» en adelante, su cobro, y los une.
--   6. _conta_dia_cobro_junto (nueva) y su disparador en journal_entry: validar, anular o quitar uno de
--      los dos hace lo mismo con el otro.
--   7. Por trozos exactos (si un trozo no está una sola vez, PARA sin tocar nada; con respaldo):
--      _conta_tpv_propuesta, conta_tpv_dia_para_validar y conta_tpv_dia_validar (el TPV de fuera: sin la
--      cuenta no se propone, «Falta la cuenta de la factura del día»; al validar, los dos);
--      conta_proponer_dias (el cierre del día de Folvy: por _conta_dia_proponer);
--      conta_erp10_dias_tpv_por_salir («Clientes de contado» es la cuenta elegida, si la hay; y cada día
--      dice su cobro, «cobroId», para que salgan juntos).
--   8. conta_tpv_factura_de y conta_tpv_factura_guardar (nuevas): para la pantalla.
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

-- ── 2 y 3 · Desde cuándo, y el enlace ───────────────────────────────────────
alter table public.conta_tpv_factura_cuenta add column if not exists desde date not null default current_date;
comment on column public.conta_tpv_factura_cuenta.desde is 'R07: desde qué día va cada día de ventas en dos asientos (la factura del día y su cobro). Los de antes, como estaban.';

create table if not exists public.conta_dia_cobro (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null,
  company_id       uuid not null,
  factura_entry_id uuid not null unique,
  cobro_entry_id   uuid not null unique,
  created_at       timestamptz not null default now()
);
comment on table public.conta_dia_cobro is
  'R07: el cobro del día que va con cada factura del día. Se validan, se anulan y se quitan juntos (_conta_dia_cobro_junto). Sin claves ajenas a propósito: el enlace lo borra el disparador.';
alter table public.conta_dia_cobro enable row level security;
revoke all on public.conta_dia_cobro from public, anon, authenticated;
grant all on public.conta_dia_cobro to service_role;
grant select on public.conta_dia_cobro to authenticated;
drop policy if exists conta_dia_cobro_select on public.conta_dia_cobro;
create policy conta_dia_cobro_select on public.conta_dia_cobro for select using (account_id = any ((select public.current_user_account_ids())::uuid[]));

-- ── 4 · Partir el día ───────────────────────────────────────────────────────
create or replace function public._conta_dia_partir(p_lineas jsonb, p_contado text)
returns jsonb language plpgsql immutable set search_path = public as $f$
declare v_l jsonb; v_neto numeric := 0; v_fact jsonb := '[]'; v_cob jsonb := '[]'; v_base jsonb;
begin
  if p_contado is null or p_lineas is null then return null; end if;
  for v_l in select * from jsonb_array_elements(p_lineas) loop
    if coalesce(v_l->>'cuenta', '') ~ '^(6|7|477)' then
      v_fact := v_fact || v_l;
    else
      v_cob := v_cob || v_l;
      v_neto := v_neto + coalesce((v_l->>'debe')::numeric, 0) - coalesce((v_l->>'haber')::numeric, 0);
      if v_base is null then v_base := v_l - array['cuenta', 'debe', 'haber', 'concepto', 'forma', 'canal', 'iva', 'tercero_id']; end if;
    end if;
  end loop;
  if jsonb_array_length(v_cob) = 0 then return null; end if;
  -- La factura: «Clientes de contado» por lo que se cobra, en lugar de cada forma de pago.
  v_fact := jsonb_build_array(coalesce(v_base, '{}') || jsonb_build_object('cuenta', p_contado, 'debe', greatest(v_neto, 0), 'haber', greatest(-v_neto, 0),
                                                                      'concepto', 'La factura del día · Clientes de contado')) || v_fact;
  -- El cobro: cada forma de pago, contra «Clientes de contado», que queda a cero.
  v_cob := v_cob || jsonb_build_array(coalesce(v_base, '{}') || jsonb_build_object('cuenta', p_contado, 'debe', greatest(-v_neto, 0), 'haber', greatest(v_neto, 0),
                                                                      'concepto', 'El cobro del día · Clientes de contado'));
  return jsonb_build_object('factura', v_fact, 'cobro', v_cob);
end $f$;
comment on function public._conta_dia_partir(jsonb, text) is
  'R07: de las líneas de un día de ventas, la factura del día (Clientes de contado por lo cobrado, contra ventas e IVA) y su cobro (lo cobrado contra Clientes de contado). null si no hay nada que cobrar.';
revoke all on function public._conta_dia_partir(jsonb, text) from public, anon, authenticated;

-- ── 6 · Los dos, juntos ─────────────────────────────────────────────────────
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

-- ── 5 · Proponer por el embudo de siempre ───────────────────────────────────
-- El concepto: «Ventas del día · Alcalá» pasa a «Factura del día · Alcalá» y «Cobro del día · Alcalá».
create or replace function public._conta_dia_concepto(p_que text, p_concepto text)
returns text language sql immutable set search_path = public as $f$
  select case when coalesce(p_concepto, '') ~ '^Ventas del día' then regexp_replace(p_concepto, '^Ventas del día', p_que)
              else p_que || coalesce(' · ' || nullif(p_concepto, ''), '') end
$f$;
revoke all on function public._conta_dia_concepto(text, text) from public, anon, authenticated;

create or replace function public._conta_dia_proponer(p_company uuid, p_prop jsonb, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_contado text; v_desde date; v_partido jsonb; v_r jsonb; v_c jsonb; v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  select a.code, f.desde into v_contado, v_desde from public.conta_tpv_factura_cuenta f
    join public.company_account a on a.id = f.company_account_id and a.company_id = f.company_id
   where f.company_id = p_company and f.account_id = v_cuenta and a.status is distinct from 'cerrada';
  if v_contado is not null and (p_prop->'entrada'->>'fecha')::date >= v_desde then
    v_partido := public._conta_dia_partir(p_prop->'lineas', v_contado);
  end if;
  if v_partido is null then
    return public._journal_entry_proponer(p_company, p_prop->'entrada', p_prop->'lineas', p_prop->'resumen', p_quien, null);
  end if;
  v_r := public._journal_entry_proponer(p_company,
           jsonb_set(p_prop->'entrada', '{concepto}', to_jsonb(public._conta_dia_concepto('Factura del día', p_prop->'entrada'->>'concepto'))),
           v_partido->'factura', p_prop->'resumen', p_quien, null);
  -- El cobro, solo con una factura nueva (una de antes, ya propuesta de un asiento, se queda como está).
  if not coalesce((v_r->>'existente')::boolean, false) and not coalesce((v_r->>'descartada')::boolean, false) and v_r->>'id' is not null then
    v_c := public._journal_entry_proponer(p_company,
             jsonb_build_object('series', p_prop->'entrada'->'series', 'fecha', p_prop->'entrada'->'fecha',
               'concepto', public._conta_dia_concepto('Cobro del día', p_prop->'entrada'->>'concepto'), 'source_type', 'sales_day_payment', 'source_id', v_r->>'id',
               'confianza', coalesce(p_prop->'entrada'->>'confianza', 'seguro'), 'porque', 'Lo cobrado el día contra «Clientes de contado»: la deja a cero.',
               'razones', '[]'::jsonb, 'party_id', null, 'documento', p_prop->'entrada'->'documento'),
             v_partido->'cobro', '{}'::jsonb, p_quien, null);
    insert into public.conta_dia_cobro (account_id, company_id, factura_entry_id, cobro_entry_id)
    values (v_cuenta, p_company, (v_r->>'id')::uuid, (v_c->>'id')::uuid) on conflict do nothing;
  end if;
  return v_r;
end $f$;
comment on function public._conta_dia_proponer(uuid, jsonb, text) is
  'R07: propone un día de ventas por el embudo de siempre; con la cuenta de la factura del día y desde su «desde», en dos asientos unidos (la factura y su cobro).';
revoke all on function public._conta_dia_proponer(uuid, jsonb, text) from public, anon, authenticated;

-- ── 7 · Por trozos exactos ──────────────────────────────────────────────────
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

-- ── 8 · Para la pantalla ────────────────────────────────────────────────────
create or replace function public.conta_tpv_factura_de(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $f$
declare v_acc uuid; v jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select jsonb_build_object('cuenta', a.code, 'nombre', coalesce(a.plain_name, a.name), 'desde', f.desde,
           'mes', coalesce((select sum(l.debit) from public.journal_line l join public.journal_entry e on e.id = l.entry_id
                             where l.company_account_id = a.id and e.status = 'validado' and e.source_type = 'sales_day'
                               and e.entry_date >= date_trunc('month', current_date)::date), 0))
    into v from public.conta_tpv_factura_cuenta f join public.company_account a on a.id = f.company_account_id
   where f.company_id = p_company and f.account_id = v_acc;
  return jsonb_build_object('factura', v,
    -- Lo que propone Sumied si no hay ninguna: una 430 que ya se llame «contado».
    'propuesta', (select jsonb_build_object('cuenta', a.code, 'nombre', coalesce(a.plain_name, a.name)) from public.company_account a
                   where a.company_id = p_company and a.account_id = v_acc and a.code like '430%' and length(a.code) >= 8
                     and (a.name ilike '%contado%' or a.plain_name ilike '%contado%') and a.status is distinct from 'cerrada'
                   order by a.code limit 1));
end $f$;
revoke all on function public.conta_tpv_factura_de(uuid) from public, anon;
grant execute on function public.conta_tpv_factura_de(uuid) to authenticated;

create or replace function public.conta_tpv_factura_guardar(p_company uuid, p_cuenta text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v_acc uuid; v_a public.company_account; v_desde date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then raise exception 'Solo un administrador o un encargado de la cuenta elige la cuenta de la factura del día.' using errcode = '42501'; end if;
  select * into v_a from public.company_account where company_id = p_company and account_id = v_acc and code = p_cuenta and status is distinct from 'cerrada';
  if v_a.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', p_cuenta using errcode = '23514'; end if;
  if length(v_a.code) < 8 then raise exception 'La % es una cuenta de grupo: elige una subcuenta.', v_a.code using errcode = '23514'; end if;
  insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name)
  values (v_acc, p_company, v_a.id, coalesce(p_quien_nombre, public.conta_nombre_actor()))
  on conflict (company_id) do update set company_account_id = excluded.company_account_id, created_by_name = excluded.created_by_name
  returning desde into v_desde;
  return jsonb_build_object('cuenta', v_a.code, 'nombre', coalesce(v_a.plain_name, v_a.name), 'desde', v_desde,
    'texto', format('La factura del día va a la %s · %s. Desde el %s, cada día va en dos asientos: la factura del día y su cobro.',
                    v_a.code, coalesce(v_a.plain_name, v_a.name), to_char(v_desde, 'DD/MM/YYYY')));
end $f$;
revoke all on function public.conta_tpv_factura_guardar(uuid, text, text) from public, anon;
grant execute on function public.conta_tpv_factura_guardar(uuid, text, text) to authenticated;
