-- ============================================================================
-- C04 · Prueba en staging-conta de las migraciones 0100–0130 (libro diario).
-- Todo dentro de una transacción que acaba en ROLLBACK: no queda nada.
--
--   1. FOTO DE ANTES (staging aún sin el C04): huella de fiscal_year,
--      fiscal_period_lock, supplier_invoice, channel_settlement,
--      licensed_settlement y treasury_account; lo que devuelven las funciones
--      de Ventas; y el vigía B59 (en un punto de guardado, sin dejar rastro).
--   2. Entran 0100 → 0130. FOTO DE DESPUÉS con la MISMA vara (las columnas de
--      antes): tiene que salir idéntica (regla 31).
--   3. Las reglas, como el administrador de A (rol authenticated, con su RLS):
--      validar pone número 1 y huella; descuadrado, IVA mal calculado, sin
--      local y apunte de IVA sin datos NO se validan; lo validado no se toca
--      ni se borra; el número sigue sin huecos y por serie; anular crea el
--      contraasiento validado y enlazado; la cadena se comprueba entera; el
--      Mayor y las sumas y saldos leen lo validado; el resultado por local
--      suma el total.
--   4. Lo traído: ejercicio «mixto» hasta el 30/09 y meses traídos cerrados.
--      Un asiento en septiembre no entra (propone el 01/10) y un mes traído no
--      se reabre.
--   5. Como el administrador de B: no ve nada de A, no valida ni anula lo de A.
--   6. Vuelta atrás: PARA con un asiento validado; sin datos, deshace las
--      cuatro; se vuelven a aplicar dos veces (idempotentes).
-- ============================================================================
begin;

-- ── 1 · Foto de antes ───────────────────────────────────────────────────────
\echo '>>> 1. Foto de antes (sin el C04)'
do $$ begin
  if to_regclass('public.journal_entry') is not null then
    raise exception 'PRUEBA C04 · 1: staging ya tiene journal_entry; la foto de antes no sería de antes.';
  end if;
end $$;

create temp table foto (que text primary key, antes text, despues text) on commit drop;
insert into foto (que, antes)
select 'fiscal_year', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.fiscal_year x
union all select 'fiscal_period_lock', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.fiscal_period_lock x
union all select 'supplier_invoice', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.supplier_invoice x
union all select 'channel_settlement', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.channel_settlement x
union all select 'licensed_settlement', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.licensed_settlement x
union all select 'treasury_account', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.treasury_account x;

create or replace function pg_temp.lecturas_ventas() returns table (que text, valor text) language plpgsql as $$
declare
  a uuid := 'c01a0000-0000-4000-8000-00000000000a';
  f record; r text;
begin
  for f in select * from (values
      ('channel_economics_dashboard', 'select public.channel_economics_dashboard($1, ''2026-01-01''::date, ''2026-12-31''::date, null, null, null)::text'),
      ('channel_pnl_by_brand',        'select public.channel_pnl_by_brand($1, ''2026-01-01''::date, ''2026-12-31''::date)::text'),
      ('licensed_economics_dashboard','select public.licensed_economics_dashboard($1, ''2026-01-01''::timestamptz, ''2027-01-01''::timestamptz, null)::text'),
      ('channel_trend_monthly',       'select public.channel_trend_monthly($1, null, null, null)::text'),
      ('margin_by_brand',             'select public.margin_by_brand($1, ''2026-01-01''::timestamptz, ''2027-01-01''::timestamptz, null)::text')) v(n, q) loop
    begin
      execute f.q into r using a;
    exception when others then r := 'ERROR ' || sqlstate || ' ' || sqlerrm;
    end;
    que := f.n; valor := md5(coalesce(r, '∅')); return next;
  end loop;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
insert into foto (que, antes) select 'ventas · ' || que, valor from pg_temp.lecturas_ventas();

-- El vigía B59 escribe avisos: se mide dentro de un subbloque que lo deshace.
create temp table vigia (cuando text primary key, n integer) on commit drop;
do $$ declare v int; begin
  -- En un subbloque que acaba en excepción: lo que escriba el vigía se deshace.
  begin
    v := public.liquidacion_atrasada_watchdog();
    raise exception using errcode = 'P0001', message = 'deshacer:' || v;
  exception when raise_exception then
    if sqlerrm like 'deshacer:%' then insert into vigia values ('antes', split_part(sqlerrm, ':', 2)::int); else raise; end if;
  end;
end $$;

-- ── 2 · Entra el C04 y foto de después ─────────────────────────────────────
\echo '>>> 2. Entran 0100 → 0130'
\ir ../../migrations/20261010T0100_c04_libro.sql
\ir ../../migrations/20261010T0110_c04_enlaces.sql
\ir ../../migrations/20261010T0120_c04_funciones.sql
\ir ../../migrations/20261010T0130_c04_lectura.sql

update foto set despues = x.h from (
  select 'fiscal_year' que, md5(coalesce(string_agg((to_jsonb(x) - array['origin', 'origin_program', 'imported_until'])::text, '|' order by x.id), '')) h from public.fiscal_year x
  union all select 'fiscal_period_lock', md5(coalesce(string_agg((to_jsonb(x) - array['kind'])::text, '|' order by x.id), '')) from public.fiscal_period_lock x
  union all select 'supplier_invoice', md5(coalesce(string_agg((to_jsonb(x) - array['journal_entry_id', 'payment_entry_id', 'withholding_rate_id', 'withholding_amount'])::text, '|' order by x.id), '')) from public.supplier_invoice x
  union all select 'channel_settlement', md5(coalesce(string_agg((to_jsonb(x) - array['journal_entry_id'])::text, '|' order by x.id), '')) from public.channel_settlement x
  union all select 'licensed_settlement', md5(coalesce(string_agg((to_jsonb(x) - array['journal_entry_id'])::text, '|' order by x.id), '')) from public.licensed_settlement x
  union all select 'treasury_account', md5(coalesce(string_agg((to_jsonb(x) - array['location_id'])::text, '|' order by x.id), '')) from public.treasury_account x
) x where foto.que = x.que;
update foto set despues = v.valor from pg_temp.lecturas_ventas() v where foto.que = 'ventas · ' || v.que;
do $$ declare v int; begin
  begin
    v := public.liquidacion_atrasada_watchdog();
    raise exception using errcode = 'P0001', message = 'deshacer:' || v;
  exception when raise_exception then
    if sqlerrm like 'deshacer:%' then insert into vigia values ('despues', split_part(sqlerrm, ':', 2)::int); else raise; end if;
  end;
end $$;

do $$
declare r record; v_mal int := 0; v_a int; v_d int;
begin
  for r in select * from foto order by que loop
    raise notice '% · antes % · después % · %', rpad(r.que, 40), r.antes, r.despues, case when r.antes = r.despues then 'igual' else 'DISTINTO' end;
    if r.antes is distinct from r.despues then v_mal := v_mal + 1; end if;
  end loop;
  select n into v_a from vigia where cuando = 'antes';
  select n into v_d from vigia where cuando = 'despues';
  raise notice '% · antes % · después % · %', rpad('vigía B59 (avisos que encolaría)', 40), v_a, v_d, case when v_a = v_d then 'igual' else 'DISTINTO' end;
  if v_mal > 0 or v_a is distinct from v_d then raise exception 'PRUEBA C04 · 2: antes ≠ después.'; end if;
  raise notice 'PRUEBA C04 · 2 en verde: % huellas y el vigía, iguales antes y después.', (select count(*) from foto);
end $$;

-- ── 3 · Las reglas, como el administrador de A ──────────────────────────────
\echo '>>> 3. Reglas del libro (administrador de A)'
savepoint sin_datos;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  loc2  constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  v_y uuid; v_iva21 uuid; c629 uuid; c472 uuid; c572 uuid; c700 uuid; c477 uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; v_r jsonb; v_n int; v_txt text;

begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into v_iva21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select id into c629 from public.company_account where company_id = emp and code = '62900000';
  select id into c472 from public.company_account where company_id = emp and code = '47200021';
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c700 from public.company_account where company_id = emp and code = '70000000';
  select id into c477 from public.company_account where company_id = emp and code = '47700021';
  if v_y is null or c629 is null or c472 is null or c572 is null or c700 is null or c477 is null then
    raise exception 'PRUEBA C04 · 3: faltan el ejercicio 2026 o cuentas de la empresa de A en staging.';
  end if;

  -- 3a. Un asiento bien hecho se valida: número 1 de su serie y huella.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 2, '2026-10-05', 'Factura de prueba · otros servicios', 'manual') returning id into e1;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, tax_rate_id, tax_base, vat_book, vat_deductible)
  values (a, emp, e1, 1, c629, 100, 0, loc, null, null, null, null),
         (a, emp, e1, 2, c472, 21, 0, loc, v_iva21, 100, 'received', 'yes'),
         (a, emp, e1, 3, c572, 0, 121, loc, null, null, null, null);
  v_r := public.journal_entry_validar(e1);
  if (v_r->>'numero')::int <> 1 or length(v_r->>'huella') <> 64 then raise exception 'PRUEBA C04 · 3a: % ', v_r; end if;
  perform set_config('c04.e1', e1::text, false);

  -- 3b. Descuadrado: no se valida y dice cuánto.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-05', 'Descuadrado', 'manual') returning id into e2;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e2, 1, c629, 100, 0, loc), (a, emp, e2, 2, c572, 0, 90, loc);
  begin
    perform public.journal_entry_validar(e2);
    raise exception 'PRUEBA C04 · 3b: validó un asiento descuadrado.';
  exception when check_violation then
    if sqlerrm not like 'No cuadra: Debe 100.00 y Haber 90.00, diferencia 10.00.' then raise exception 'PRUEBA C04 · 3b: mensaje «%».', sqlerrm; end if;
  end;

  -- 3c. IVA mal calculado (20 en vez de 21): no se valida.
  update public.journal_line set credit = 100 where entry_id = e2 and position = 2;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, tax_rate_id, tax_base, vat_book, vat_deductible)
  values (a, emp, e2, 3, c472, 20, 0, loc, v_iva21, 100, 'received', 'yes'),
         (a, emp, e2, 4, c572, 0, 20, loc, null, null, null, null);
  begin
    perform public.journal_entry_validar(e2);
    raise exception 'PRUEBA C04 · 3c: validó una cuota que no es base × tipo.';
  exception when check_violation then
    if sqlerrm not like '%la cuota 20.00 no es la base 100.00 × 21.00 % = 21.00%' then raise exception 'PRUEBA C04 · 3c: mensaje «%».', sqlerrm; end if;
  end;

  -- 3d. Apunte de IVA sin datos, y un apunte sin local ni «común».
  update public.journal_line set debit = 21, tax_rate_id = null, tax_base = null, vat_book = null, vat_deductible = null where entry_id = e2 and position = 3;
  update public.journal_line set credit = 21, location_id = null where entry_id = e2 and position = 4;
  begin
    perform public.journal_entry_validar(e2);
    raise exception 'PRUEBA C04 · 3d: validó sin datos de IVA ni local.';
  exception when check_violation then
    if sqlerrm not like '%apunte 3 (47200021): un apunte de IVA lleva base, tipo y libro registro; apunte 4 (57200001): falta el local (o marcarlo como común)%' then
      raise exception 'PRUEBA C04 · 3d: mensaje «%».', sqlerrm;
    end if;
  end;
  -- Con «común» y los datos de IVA, sí.
  update public.journal_line set tax_rate_id = v_iva21, tax_base = 100, vat_book = 'received', vat_deductible = 'yes' where entry_id = e2 and position = 3;
  update public.journal_line set is_common = true where entry_id = e2 and position = 4;
  v_r := public.journal_entry_validar(e2);
  if (v_r->>'numero')::int <> 1 then raise exception 'PRUEBA C04 · 3d: la serie 4 empieza en 1, no en %.', v_r->>'numero'; end if;

  -- 3e. Lo validado no se toca ni se borra; sus apuntes tampoco.
  begin update public.journal_entry set concept = 'otro' where id = e1; raise exception 'PRUEBA C04 · 3e: cambió un validado.';
  exception when insufficient_privilege then null; end;
  begin delete from public.journal_entry where id = e1;
    if found then raise exception 'PRUEBA C04 · 3e: borró un validado.'; end if;
  exception when insufficient_privilege then null; end;
  begin update public.journal_line set debit = 101 where entry_id = e1 and position = 1; raise exception 'PRUEBA C04 · 3e: cambió un apunte validado.';
  exception when insufficient_privilege then null; end;
  begin insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
        values (a, emp, e1, 9, c629, 1, 0, loc); raise exception 'PRUEBA C04 · 3e: añadió un apunte a un validado.';
  exception when insufficient_privilege then null; end;
  -- Ni siquiera saltándose la pantalla: un borrador no se inserta ya validado.
  begin insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, number, entry_date, concept, source_type, status, validated_at, hash, chain_seq)
        values (a, emp, v_y, 2, 99, '2026-10-05', 'Colado', 'manual', 'validado', now(), 'x', 99); raise exception 'PRUEBA C04 · 3e: insertó un validado a pelo.';
  exception when insufficient_privilege or check_violation then null; end;

  -- 3f. Siguiente de la serie 2: número 2, sin huecos.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 1, '2026-10-06', 'Ventas del día · Norte Centro', 'sales_day') returning id into e3;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, tax_rate_id, tax_base, vat_book)
  values (a, emp, e3, 1, c572, 121, 0, loc, null, null, null),
         (a, emp, e3, 2, c700, 0, 100, loc, null, null, null),
         (a, emp, e3, 3, c477, 0, 21, loc, v_iva21, 100, 'issued');
  perform public.journal_entry_validar(e3);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 2, '2026-10-07', 'Segunda factura', 'manual') returning id into e4;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  values (a, emp, e4, 1, c629, 50, 0, loc2), (a, emp, e4, 2, c572, 0, 50, loc2);
  v_r := public.journal_entry_validar(e4);
  if (v_r->>'numero')::int <> 2 then raise exception 'PRUEBA C04 · 3f: la serie 2 sigue en %, no en 2.', v_r->>'numero'; end if;

  -- 3g. Anular el 2/1: contraasiento validado (2/3), enlazado; el original, anulado con su número.
  v_r := public.journal_entry_anular(e1, 'Factura duplicada en la prueba', '2026-10-08');
  if (v_r->>'numero')::int <> 3 then raise exception 'PRUEBA C04 · 3g: el contraasiento es el 2/%, no el 2/3.', v_r->>'numero'; end if;
  if (select status from public.journal_entry where id = e1) <> 'anulado'
     or (select number from public.journal_entry where id = e1) <> 1
     or (select reverses_entry_id from public.journal_entry where id = (v_r->>'contraasiento')::uuid) <> e1 then
    raise exception 'PRUEBA C04 · 3g: la anulación no quedó enlazada.';
  end if;
  begin perform public.journal_entry_anular(e1, 'otra vez'); raise exception 'PRUEBA C04 · 3g: anuló dos veces.';
  exception when check_violation then null; end;

  -- 3h. La cadena, entera: cinco asientos validados, todos encadenan.
  select count(*) into v_n from public.journal_cadena_comprobar(emp) where ok;
  if v_n <> 5 or exists (select 1 from public.journal_cadena_comprobar(emp) where not ok) then
    raise exception 'PRUEBA C04 · 3h: la cadena no está entera (% bien).', v_n;
  end if;

  -- 3i. Mayor y sumas y saldos: la 62900000 suma 100 + 100 + 50 al Debe y 100 al Haber (el contraasiento).
  select string_agg(format('%s %s/%s', code, debe, haber), ' ') into v_txt from public.conta_sumas_saldos(emp, '2026-10-01', '2026-10-31') where code = '62900000';
  if v_txt <> '62900000 250.00/100.00' then raise exception 'PRUEBA C04 · 3i: sumas y saldos de la 629 dan «%».', v_txt; end if;
  if (select count(*) from public.journal_ledger where company_id = emp) <> 15 then
    raise exception 'PRUEBA C04 · 3i: el Mayor tiene % apuntes, no 15.', (select count(*) from public.journal_ledger where company_id = emp);
  end if;

  -- 3j. Resultado por local: la suma de las filas es el resultado total (100 de ventas − 150 de gastos).
  select sum(resultado) into v_n from public.conta_resultado_por_local(emp, '2026-10-01', '2026-10-31');
  if v_n <> -50 then raise exception 'PRUEBA C04 · 3j: el resultado por local suma %, no −50.', v_n; end if;
  raise notice 'PRUEBA C04 · 3 en verde: valida, numera sin huecos, frena descuadre, IVA, local; anula; cadena, Mayor y resultado cuadran.';
end $$;
reset role;

-- ── 4 · Lo traído: ejercicio mixto, meses cerrados como traídos ────────────
\echo '>>> 4. Ejercicio traído hasta el 30/09'
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_y uuid; m date;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  update public.fiscal_year set origin = 'mixed', origin_program = 'diez', imported_until = '2026-09-30' where id = v_y;
  for m in select generate_series('2026-01-01'::date, '2026-09-01'::date, interval '1 month')::date loop
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name)
    values ('c01a0000-0000-4000-8000-00000000000a', emp, v_y, m, 'migrated', 'Prueba C04');
  end loop;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; e uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-09-15', 'En septiembre', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  select a, emp, e, 1, id, 10, 0, loc from public.company_account where company_id = emp and code = '62900000';
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id)
  select a, emp, e, 2, id, 0, 10, loc from public.company_account where company_id = emp and code = '57200001';
  begin
    perform public.journal_entry_validar(e);
    raise exception 'PRUEBA C04 · 4: entró un asiento en un mes traído.';
  exception when check_violation then
    if sqlerrm not like 'Hasta el 30/09/2026 el ejercicio 2026 es traído de diez: la fecha abierta más cercana es el 01/10/2026.' then
      raise exception 'PRUEBA C04 · 4: mensaje «%».', sqlerrm;
    end if;
  end;
  if public.conta_primer_dia_abierto(emp, '2026-09-15') <> '2026-10-01' then raise exception 'PRUEBA C04 · 4: el primer día abierto no es el 01/10.'; end if;
  begin
    perform public.conta_reabrir_mes(emp, '2026-09-01', 'Quiero tocar septiembre');
    raise exception 'PRUEBA C04 · 4: reabrió un mes traído.';
  exception when check_violation then
    if sqlerrm not like 'El mes 09/2026 es traído de otro programa: no se reabre.' then raise exception 'PRUEBA C04 · 4: mensaje «%».', sqlerrm; end if;
  end;
  raise notice 'PRUEBA C04 · 4 en verde: nada se cuela en lo traído, se propone el 01/10 y un mes traído no se reabre.';
end $$;
reset role;

-- ── 5 · Cuenta B: no ve ni toca nada de A ──────────────────────────────────
\echo '>>> 5. Administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e1 uuid := current_setting('c04.e1')::uuid;
begin
  if exists (select 1 from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.journal_line where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.journal_ledger where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA C04 · 5: B ve asientos de A.';
  end if;
  begin perform public.journal_entry_anular(e1, 'B intenta'); raise exception 'PRUEBA C04 · 5: B anuló un asiento de A.';
  exception when insufficient_privilege or check_violation then null; end;
  begin perform public.journal_cadena_comprobar('3b34403a-a7d6-4a48-a8d7-737e8cababdc'); raise exception 'PRUEBA C04 · 5: B comprobó la cadena de A.';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.conta_sumas_saldos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-01-01', '2026-12-31')) <> 0 then
    raise exception 'PRUEBA C04 · 5: B lee las sumas y saldos de A.';
  end if;
  raise notice 'PRUEBA C04 · 5 en verde: B no ve, no anula ni comprueba nada de A.';
end $$;
reset role;

-- ── 6 · Vuelta atrás ────────────────────────────────────────────────────────
\echo '>>> 6a. Con asientos validados, la vuelta atrás PARA'
savepoint antes_de_la_vuelta;
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261010T0130_c04_lectura.down.sql
\ir ../../vuelta-atras/20261010T0120_c04_funciones.down.sql
\set fallo_la_vuelta :ERROR
rollback to savepoint antes_de_la_vuelta;
\set ON_ERROR_STOP 1
\if :fallo_la_vuelta
\echo 'PRUEBA C04 · 6a ok: la vuelta atrás se para (hay asientos validados).'
\else
do $$ begin raise exception 'PRUEBA C04 · 6a: la vuelta atrás quitó las funciones con asientos validados.'; end $$;
\endif

\echo '>>> 6b. Sin datos, deshace las cuatro'
rollback to savepoint sin_datos;
\ir ../../vuelta-atras/20261010T0130_c04_lectura.down.sql
\ir ../../vuelta-atras/20261010T0120_c04_funciones.down.sql
\ir ../../vuelta-atras/20261010T0110_c04_enlaces.down.sql
\ir ../../vuelta-atras/20261010T0100_c04_libro.down.sql
do $$ begin
  if to_regclass('public.journal_entry') is not null or to_regprocedure('public.journal_entry_validar(uuid,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name = 'journal_entry_id')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fiscal_year' and column_name = 'origin') then
    raise exception 'PRUEBA C04 · 6b: la vuelta atrás dejó algo.';
  end if;
  if (select prosrc from pg_proc where proname = 'conta_reabrir_mes') like '%traído de otro programa%' then
    raise exception 'PRUEBA C04 · 6b: conta_reabrir_mes no volvió a la del C00.';
  end if;
  raise notice 'PRUEBA C04 · 6b en verde: no queda nada del C04.';
end $$;

\echo '>>> 6c. Se vuelven a aplicar, dos veces'
\ir ../../migrations/20261010T0100_c04_libro.sql
\ir ../../migrations/20261010T0110_c04_enlaces.sql
\ir ../../migrations/20261010T0120_c04_funciones.sql
\ir ../../migrations/20261010T0130_c04_lectura.sql
\ir ../../migrations/20261010T0100_c04_libro.sql
\ir ../../migrations/20261010T0110_c04_enlaces.sql
\ir ../../migrations/20261010T0120_c04_funciones.sql
\ir ../../migrations/20261010T0130_c04_lectura.sql
do $$ begin
  if (select count(*) from pg_constraint where conname = 'fiscal_year_traido_coherente') <> 1
     or (select count(*) from pg_trigger where tgname = 'trg_journal_entry_inalterable') <> 1 then
    raise exception 'PRUEBA C04 · 6c: aplicar dos veces duplica algo.';
  end if;
  raise notice 'PRUEBA C04 · 6c en verde: idempotentes.';
end $$;

\echo '>>> Prueba del C04 en verde. ROLLBACK: no queda nada.'
rollback;
