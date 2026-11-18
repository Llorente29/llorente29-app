-- supabase/staging/sql/20261118_x07_asientos_a_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X07 (20261118T0745_x07_por_salir_asientos y
-- 20261118T0746_x07_asientos_por_salir), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra los
-- objetos: public.conta_erp10_por_salir(uuid,date) (cambia) y
-- public.conta_erp10_asientos_por_salir(uuid,date) (nueva).
--
-- Con dos empresas inventadas (cuentas A y B), creadas aquí, y los asientos validados
-- por el camino de verdad (journal_entry_validar):
--   0. La forma: la función nueva, con sus permisos y solo lee; por_salir, una sola firma.
--   1. Los asientos sin I.V.A. salen, con cada apunte: uno de banco (2 apuntes) y una
--      nómina a mano (3 apuntes); la recibida sigue saliendo como recibida.
--   2. Lo que lleva I.V.A. y no es factura (una anotación del libro de no sujetas) no sale,
--      con su frase; y no viene en los asientos que salen.
--   3. Lo salido no vuelve a salir (un asiento apuntado en una tanda).
--   4. Una empresa no ve lo de la otra.
--   5. La vuelta atrás, y lo de antes contra lo de después con la misma vara (regla 31):
--      con la por_salir del X05, cada partida sale igual (clase, sale e importe), salvo la
--      del libro de no sujetas, que antes se tomaba por recibida.
--
-- Sin datos reales (T11): nombres inventados, que se ven inventados.
--
-- sin usuario: los asientos se validan y se apuntan como el usuario a1 de la cuenta A
-- (request.jwt.claims), por las funciones de verdad. La anotación del libro de no sujetas
-- la pone la prueba por debajo (no hay pantalla que la haga hoy). La sección 4 mira las
-- tablas con «set local role authenticated» como el administrador de B.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X07: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare f constant text := 'public.conta_erp10_asientos_por_salir(uuid, date)';
begin
  if to_regprocedure(f) is null then raise exception 'PRUEBA X07 · 0: falta %.', f; end if;
  if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X07 · 0: anon puede ejecutar %.', f; end if;
  if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X07 · 0: authenticated no puede ejecutar %.', f; end if;
  if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X07 · 0: % no es security definer.', f; end if;
  if (select provolatile from pg_proc where oid = f::regprocedure) <> 's' then raise exception 'PRUEBA X07 · 0: % no es stable (solo lee).', f; end if;
  if (select count(*) from pg_proc where proname = 'conta_erp10_por_salir') <> 1 then
    raise exception 'PRUEBA X07 · 0: conta_erp10_por_salir tiene más de una firma (regla 2).';
  end if;
  raise notice 'PRUEBA X07 · 0 bien: la función nueva con sus permisos, solo lee; por_salir con una sola firma.';
end $$;

-- Las dos empresas inventadas, con una recibida, un banco, una nómina y uno con I.V.A. que no es factura
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid; x record; cu jsonb; t21 uuid; e uuid; k record;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X07 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X07 Dos, S.L.') returning id into d;
  perform set_config('x07.c', c::text, true);
  perform set_config('x07.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values ('62900000', '629', 'Otros servicios'), ('47200000', '472', 'IVA soportado'), ('41000012', '4100', 'Suministros Inventados X07'),
                                 ('57200001', '572', 'Banco inventado'), ('64000000', '640', 'Sueldos y salarios'), ('47600000', '476', 'Organismos de la Seguridad Social'),
                                 ('46500000', '465', 'Remuneraciones pendientes'), ('75900000', '759', 'Ingresos por servicios diversos')) v(codigo, plantilla, nombre) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
  end loop;
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

  -- La recibida (con su libro): sale como recibida, igual que antes.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
  values (a, c, y, 2, '2026-10-03', 'Recibida inventada X07-1', 'manual', 'X07-1', '2026-10-03') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
  values (a, c, e, 1, (cu ->> '62900000')::uuid, 100, 0, null, null, null, null, null, null),
         (a, c, e, 2, (cu ->> '47200000')::uuid, 21, 0, t21, 100, 'received', 'yes', 'X07-1', '2026-10-03'),
         (a, c, e, 3, (cu ->> '41000012')::uuid, 0, 121, null, null, null, null, null, null);
  perform public.journal_entry_validar(e);
  perform set_config('x07.recibida', e::text, true);

  -- Tres asientos sin libro: el pago de la recibida por el banco (2 apuntes), una nómina (3) y un ingreso a mano (2).
  for k in select * from (values
      ('banco', 4, '2026-10-10', 'Pago inventado X07-1', 'bank', '[["41000012", 121, 0], ["57200001", 0, 121]]'),
      ('nomina', 4, '2026-10-31', 'Nómina inventada de octubre', 'manual', '[["64000000", 1500, 0], ["47600000", 0, 300], ["46500000", 0, 1200]]'),
      ('sujeta', 4, '2026-10-15', 'Con I.V.A. y no es factura (inventado)', 'manual', '[["57200001", 50, 0], ["75900000", 0, 50]]')
    ) v(clave, serie, fecha, concepto, origen, lineas) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, c, y, k.serie, k.fecha::date, k.concepto, k.origen) returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
    select a, c, e, i, (cu ->> (l ->> 0))::uuid, (l ->> 1)::numeric, (l ->> 2)::numeric
      from jsonb_array_elements(k.lineas::jsonb) with ordinality as t(l, i);
    perform public.journal_entry_validar(e);
    perform set_config('x07.' || k.clave, e::text, true);
  end loop;
  -- La anotación del libro de no sujetas (como la pondría un libro de I.V.A.; hoy no hay pantalla que la haga).
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, issue_date, tax_base, source_type)
  values (a, c, current_setting('x07.sujeta')::uuid, 'not_subject', 'F1', '2026-10-15', 50, 'manual');
end $$;

-- 1 y 2 · Lo que sale (administrador de A) ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x07.c')::uuid;
  ps jsonb; r jsonb; p jsonb;
begin
  perform public.conta_erp10_salida_poner(c, true, '0007', 8, '2026-10-01');
  ps := public.conta_erp10_por_salir(c, '2026-10-01');
  -- Lo de antes contra lo de después, con la misma vara (regla 31): se guarda para la sección 5.
  perform set_config('x07.despues', (select jsonb_object_agg(x ->> 'entry_id', jsonb_build_object('clase', x ->> 'clase', 'sale', x -> 'sale', 'importe', x -> 'importe'))
                                       from jsonb_array_elements(ps -> 'partidas') x)::text, true);
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x07.recibida');
  if p ->> 'clase' <> 'recibida' or not (p ->> 'sale')::boolean then raise exception 'PRUEBA X07 · 1: la recibida es %.', p; end if;
  select x into p from jsonb_array_elements(ps -> 'partidas') x where x ->> 'entry_id' = current_setting('x07.sujeta');
  if p ->> 'clase' <> 'asiento' or (p ->> 'sale')::boolean
     or p -> 'avisos' ->> 0 <> 'Lleva I.V.A. y no es una factura: métela a mano en ERP10 para que entre en su libro.' then
    raise exception 'PRUEBA X07 · 2: el del libro de no sujetas es %.', p;
  end if;

  r := public.conta_erp10_asientos_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'asientos') <> 2 then raise exception 'PRUEBA X07 · 1: vienen % asientos y son 2: %.', jsonb_array_length(r -> 'asientos'), r -> 'asientos'; end if;
  if exists (select 1 from jsonb_array_elements(r -> 'asientos') x where x ->> 'entryId' in (current_setting('x07.sujeta'), current_setting('x07.recibida'))) then
    raise exception 'PRUEBA X07 · 2: en los asientos viene la recibida o el de I.V.A.';
  end if;
  -- En orden de fecha: el banco (10/10) y la nómina (31/10), campo a campo.
  p := r -> 'asientos' -> 0;
  if p ->> 'entryId' <> current_setting('x07.banco') or p ->> 'fecha' <> '2026-10-10' or (p ->> 'serie')::int <> 4 or p ->> 'concepto' <> 'Pago inventado X07-1'
     or p -> 'lineas' <> '[{"cuenta": "41000012", "plantilla": "4100", "nombre": "Suministros Inventados X07", "concepto": null, "debe": 121.00, "haber": 0.00},
                           {"cuenta": "57200001", "plantilla": "572", "nombre": "Banco inventado", "concepto": null, "debe": 0.00, "haber": 121.00}]'::jsonb then
    raise exception 'PRUEBA X07 · 1: el banco viene como %.', p;
  end if;
  p := r -> 'asientos' -> 1;
  if p ->> 'entryId' <> current_setting('x07.nomina') or jsonb_array_length(p -> 'lineas') <> 3
     or (select sum((l ->> 'debe')::numeric) from jsonb_array_elements(p -> 'lineas') l) <> 1500
     or (select sum((l ->> 'haber')::numeric) from jsonb_array_elements(p -> 'lineas') l) <> 1500 then
    raise exception 'PRUEBA X07 · 1: la nómina viene como %.', p;
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'cuentas')) <> 5 then raise exception 'PRUEBA X07 · 1: las cuentas son %.', r -> 'cuentas'; end if;
  raise notice 'PRUEBA X07 · 1 y 2 bien: el banco (2 apuntes) y la nómina (3) salen, en orden y campo a campo; la recibida sigue de recibida; lo de I.V.A. que no es factura no sale, con su frase.';
end $$;

-- 3 · Lo salido no vuelve a salir ------------------------------------------------------------------------
do $$
declare c constant uuid := current_setting('x07.c')::uuid; r jsonb;
begin
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "asientos.xlsx", "filas": 2, "huella": "h"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x07.banco'), 'clase', 'asiento', 'huella', 'h1')));
  if (select asientos from public.conta_erp10_salida_lote where company_id = c) <> 1 then raise exception 'PRUEBA X07 · 3: el lote no cuenta el asiento.'; end if;
  r := public.conta_erp10_asientos_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'asientos') <> 1 or r -> 'asientos' -> 0 ->> 'entryId' <> current_setting('x07.nomina') then
    raise exception 'PRUEBA X07 · 3: después de salir el banco vienen %.', r -> 'asientos';
  end if;
  if r -> 'yaSalidas' ->> '57200001' <> '57200001' then raise exception 'PRUEBA X07 · 3: el banco no está en ya salidas: %.', r -> 'yaSalidas'; end if;
  raise notice 'PRUEBA X07 · 3 bien: el asiento salido no vuelve y sus cuentas quedan salidas.';
end $$;

-- 4 · Una empresa no ve lo de la otra (administrador de B) ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_asientos_por_salir(current_setting('x07.c')::uuid, '2026-10-01');
        raise exception 'PRUEBA X07 · 4: B leyó los asientos de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X07 · 4: B en A dice «%».', v_msg; end if;
  perform public.conta_erp10_salida_poner(current_setting('x07.d')::uuid, true, '0008', 8, '2026-10-01');
  r := public.conta_erp10_asientos_por_salir(current_setting('x07.d')::uuid, '2026-10-01');
  if jsonb_array_length(r -> 'asientos') <> 0 or jsonb_array_length(r -> 'cuentas') <> 0 then raise exception 'PRUEBA X07 · 4: la empresa de B ve %.', r; end if;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_salida_partida where company_id = current_setting('x07.c')::uuid) then
    raise exception 'PRUEBA X07 · 4: el administrador de B ve lo que salió de la empresa de A.';
  end if;
  raise notice 'PRUEBA X07 · 4 bien: B no lee los asientos ni lo salido de A, y la suya sale vacía.';
end $$;
reset role;

-- 5 · La vuelta atrás, y antes contra después con la misma vara ------------------------------------------
select set_config('request.jwt.claims', '', true);
\i supabase/vuelta-atras/20261118T0746_x07_asientos_por_salir.down.sql
\i supabase/vuelta-atras/20261118T0745_x07_por_salir_asientos.down.sql
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x07.c')::uuid;
  despues constant jsonb := current_setting('x07.despues')::jsonb;
  antes jsonb; v_distintas text[];
begin
  if to_regprocedure('public.conta_erp10_asientos_por_salir(uuid, date)') is not null then raise exception 'PRUEBA X07 · 5: la vuelta atrás dejó la función nueva.'; end if;
  -- Con la por_salir del X05, sin el lote de la sección 3 (para medir lo mismo): todo en ROLLBACK.
  delete from public.conta_erp10_subcuenta_salida where company_id = c;
  delete from public.conta_erp10_salida_partida where company_id = c;
  delete from public.conta_erp10_salida_lote where company_id = c;
  select jsonb_object_agg(x ->> 'entry_id', jsonb_build_object('clase', x ->> 'clase', 'sale', x -> 'sale', 'importe', x -> 'importe'))
    into antes from jsonb_array_elements(public.conta_erp10_por_salir(c, '2026-10-01') -> 'partidas') x;
  select coalesce(array_agg(k order by k), '{}') into v_distintas
    from (select k from jsonb_object_keys(antes || despues) k where antes -> k is distinct from despues -> k) t;
  -- Lo único distinto: la del libro de no sujetas (antes, «recibida» por descarte).
  if v_distintas <> array[current_setting('x07.sujeta')] then
    raise exception 'PRUEBA X07 · 5: antes y después cambian % (antes %, después %).', v_distintas, antes, despues;
  end if;
  if antes -> current_setting('x07.sujeta') ->> 'clase' <> 'recibida' then raise exception 'PRUEBA X07 · 5: antes, la de no sujetas era %.', antes -> current_setting('x07.sujeta'); end if;
  raise notice 'PRUEBA X07 · 5 bien: vuelta atrás limpia; antes y después, las % partidas iguales en clase, «sale» e importe salvo la del libro de no sujetas.', (select count(*) from jsonb_object_keys(despues));
  raise notice 'PRUEBA X07: 6 de 6 bien (0 a 5).';
end $$;

rollback;
