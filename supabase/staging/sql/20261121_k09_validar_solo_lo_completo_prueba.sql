-- supabase/staging/sql/20261121_k09_validar_solo_lo_completo_prueba.sql
--
-- SOLO STAGING. Prueba del K09 (20261121T0945_k09_validar_solo_lo_completo), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con
-- ROLLBACK: staging no cambia. Nombra el objeto que cambia:
-- public.conta_motivos_para_validar (un trozo añadido); y los nuevos:
-- public.conta_recibida_motivos, public.conta_recibida_repetida,
-- public.conta_recibida_no_es_la_misma, public._conta_numero_clave y
-- public.supplier_invoice_no_es_la_misma.
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Las
-- recibidas y sus asientos son inventados, dentro de la transacción (T11).
--
--   0. La 0945 está delante; el número, igual se escriba como se escriba.
--   1. Por el camino de validar (journal_entry_validar), una recibida completa
--      se valida; un asiento a mano, también, como antes.
--   2. Sin cada dato, para, con su frase: el proveedor, el número, la fecha, la
--      base con su tipo, la cuenta de gasto, que base + cuotas − retención sea
--      el total.
--   3. Una repetida (mismo proveedor, «k09 1» = «K09-001», que la S01q no ve), para y dice cuál es
--      la otra; con «No es la misma» escrita, pasa y deja rastro en su historial.
--   4. Deshacer: la vuelta atrás devuelve conta_motivos_para_validar como
--      estaba (md5) y la repetida vuelve a validarse sin preguntar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K09: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Lo de antes.
create temp table _k09 (clave text primary key, valor text) on commit drop;
grant select, insert, update on _k09 to authenticated;
do $$ begin
  if to_regprocedure('public.conta_recibida_motivos(uuid,uuid)') is null then
    raise exception 'PRUEBA K09 · 0: falta la 0945 delante (la pone el ensayo de staging).';
  end if;
  if public._conta_numero_clave('FV26-018817') <> public._conta_numero_clave('fv26 18817')
     or public._conta_numero_clave('F-0012/26') <> public._conta_numero_clave('F1226')
     or public._conta_numero_clave('K09-001') <> public._conta_numero_clave('k09 1') then
    raise exception 'PRUEBA K09 · 0: el mismo número escrito de otra forma no sale igual';
  end if;
  raise notice '0 · la 0945 delante; «FV26-018817» = «fv26 18817», «F-0012/26» = «F1226», «K09-001» = «k09 1».';
end $$;

-- Lo inventado: recibidas del Proveedor de Prueba Ficha Uno (su 40000071) y cada una con su asiento 600/400 por 121.
-- n: numero, fecha, con proveedor, con desglose, total, cuenta del debe.
create temp table _k09f on commit drop as
select ('c0e90000-0000-4000-8000-0000000000' || x.k)::uuid as id, x.que, x.numero, x.fecha::date as fecha, x.prov, x.desglose, x.total::numeric as total, x.debe,
       case when x.k = 'b2' then 200 else 100 end::numeric as base, case when x.k = 'b2' then 42 else 21 end::numeric as cuota
  from (values
    ('a1', 'completa',        'K09-001',  '2026-10-20', true,  true,  121, '60000000'),
    ('b1', 'sin proveedor',   'K09-B',  '2026-10-20', false, true,  121, '60000000'),
    ('c1', 'sin número',      null,     '2026-10-20', true,  true,  121, '60000000'),
    ('d1', 'sin fecha',       'K09-D',  null,         true,  true,  121, '60000000'),
    ('e1', 'sin base',        'K09-E',  '2026-10-20', true,  false, 121, '60000000'),
    ('f1', 'sin gasto',       'K09-F',  '2026-10-20', true,  true,  121, '43000081'),
    ('a2', 'no suma',         'K09-G',  '2026-10-20', true,  true,  150, '60000000'),
    -- La repetida, con otro total y con ceros de menos: las reglas de siempre (tg_supplier_invoice_no_repetida, mismo total;
    -- la S01q, tg_journal_entry_factura_una_vez, mismo número con cualquier separador) no la ven.
    ('b2', 'repetida',        'k09 1',  '2026-10-21', true,  true,  242, '60000000')) x(k, que, numero, fecha, prov, desglose, total, debe);
insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                     tax_base_total, tax_total, grand_total, needs_review, created_by_name)
select f.id, 'c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3',
       case when f.prov then 'c0e40000-0000-4000-8000-0000000000a1'::uuid end, 'invoice', f.numero, f.fecha, 'aprobada', 'manual', f.base, f.cuota, f.total, false, 'prueba K09'
  from _k09f f;
insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
select 'c0e20000-0000-4000-8000-0000000000e0', f.id, 21, f.base, f.cuota from _k09f f where f.desglose;
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid; f record;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-10-20' between starts_on and ends_on;
  for f in select * from _k09f loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, document_ref)
    values (a, emp, v_y, 2, '2026-10-20', 'Prueba K09 · ' || f.que, 'supplier_invoice', f.id, f.numero) returning id into v_e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
    select a, emp, v_e, x.p, c.id, x.d, x.h
      from (values (1, f.debe, 121, 0), (2, '40000071', 0, 121)) x(p, code, d, h)
      join public.company_account c on c.company_id = emp and c.code = x.code;
    insert into _k09 values ('asiento ' || f.que, v_e::text);
  end loop;
  -- Y un asiento a mano, que no es de ninguna factura: se valida como antes.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-20', 'Prueba K09 · a mano', 'manual') returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
  select a, emp, v_e, x.p, c.id, x.d, x.h from (values (1, '60000000', 10, 0), (2, '40000071', 0, 10)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  insert into _k09 values ('asiento a mano', v_e::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 y 2 · Por el camino de validar.
do $$
declare x record; v_e uuid;
begin
  for x in select * from (values
      ('completa', null), ('a mano', null),
      ('sin proveedor', 'Falta el proveedor.'), ('sin número', 'Falta el número de la factura.'), ('sin fecha', 'Falta la fecha de la factura.'),
      ('sin base', 'Falta la base con su tipo de IVA.'), ('sin gasto', 'Falta la cuenta de gasto.'),
      ('no suma', 'No cuadra: base + cuotas − retención es')) t(que, frase) loop
    v_e := (select valor::uuid from _k09 where clave = 'asiento ' || x.que);
    begin
      perform public.journal_entry_validar(v_e, 'Prueba K09');
      if x.frase is not null then raise exception 'PRUEBA K09 · 2 (%): se ha validado', x.que; end if;
      if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K09 · 1 (%): no ha quedado validado', x.que; end if;
      raise notice '1 · %: validada.', x.que;
    exception when others then
      if sqlerrm like 'PRUEBA K09%' then raise; end if;
      if x.frase is null or sqlstate <> '23514' or sqlerrm not like x.frase || '%' then raise exception 'PRUEBA K09 · 2 (%): % «%»', x.que, sqlstate, sqlerrm; end if;
      raise notice '2 · %: %', x.que, sqlerrm;
    end;
  end loop;
end $$;

-- 3 · La repetida: para, dice cuál; con «No es la misma», pasa y deja rastro.
do $$
declare v_e uuid := (select valor::uuid from _k09 where clave = 'asiento repetida'); r jsonb; v_n int;
begin
  r := public.conta_recibida_repetida('c0e90000-0000-4000-8000-0000000000b2');
  if r is null or (r->>'id')::uuid <> 'c0e90000-0000-4000-8000-0000000000a1' then raise exception 'PRUEBA K09 · 3: la repetida no dice cuál es la otra (%)', r; end if;
  begin
    perform public.journal_entry_validar(v_e, 'Prueba K09');
    raise exception 'PRUEBA K09 · 3: se ha validado la repetida';
  exception when others then
    if sqlerrm like 'PRUEBA K09%' then raise; end if;
    if sqlstate <> '23514' or sqlerrm not like 'Ya está la K09-001 de %, asiento 2/%' then raise exception 'PRUEBA K09 · 3: % «%»', sqlstate, sqlerrm; end if;
    raise notice '3 · la repetida: %', sqlerrm;
  end;
  r := public.conta_recibida_no_es_la_misma('c0e90000-0000-4000-8000-0000000000b2', 'c0e90000-0000-4000-8000-0000000000a1', 'Es de otro ejercicio: el proveedor repite número cada año', 'Prueba K09');
  perform public.journal_entry_validar(v_e, 'Prueba K09');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K09 · 3: con «No es la misma» no se ha validado'; end if;
  select count(*) into v_n from public.supplier_invoice_change c
   where c.supplier_invoice_id = 'c0e90000-0000-4000-8000-0000000000b2' and c.what = 'no_es_la_misma' and c.by_name = 'Prueba K09'
     and c.cambios -> 0 ->> 'motivo' = 'Es de otro ejercicio: el proveedor repite número cada año';
  if v_n <> 1 then raise exception 'PRUEBA K09 · 3: «No es la misma» no ha dejado rastro en su historial (%)', v_n; end if;
  if (select not_duplicate_confirmed_by_name from public.supplier_invoice where id = 'c0e90000-0000-4000-8000-0000000000b2') is distinct from 'Prueba K09' then
    raise exception 'PRUEBA K09 · 3: «No es la misma» no ha marcado la confirmación de siempre (la que deja pasar la S01q)';
  end if;
  raise notice '3 · con «No es la misma»: %; validada, y en su historial.', r->>'texto';
  begin
    perform public.conta_recibida_no_es_la_misma('c0e90000-0000-4000-8000-0000000000b2', 'c0e90000-0000-4000-8000-0000000000a1', '  ', 'Prueba K09');
    raise exception 'PRUEBA K09 · 3: «No es la misma» sin motivo';
  exception when sqlstate '22023' then raise notice '3 · sin motivo: %', sqlerrm;
  end;
end $$;
reset role;

-- 4 · Deshacer: la vuelta atrás devuelve conta_motivos_para_validar como estaba.
\i supabase/vuelta-atras/20261121T0945_k09_validar_solo_lo_completo.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'K09') > 0 then
    raise exception 'PRUEBA K09 · 4: la vuelta atrás no devuelve conta_motivos_para_validar como estaba';
  end if;
  if to_regprocedure('public.conta_recibida_motivos(uuid,uuid)') is not null then raise exception 'PRUEBA K09 · 4: la vuelta atrás no quita conta_recibida_motivos'; end if;
  if to_regclass('public.supplier_invoice_no_es_la_misma') is null then raise exception 'PRUEBA K09 · 4: la vuelta atrás ha quitado el historial de «No es la misma»'; end if;
  raise notice '4 · la vuelta atrás devuelve conta_motivos_para_validar como estaba y deja el historial de «No es la misma».';
end $$;

rollback;
