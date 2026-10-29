-- supabase/staging/sql/20261028_s02_modelo_190_prueba.sql
--
-- SOLO STAGING. Prueba de 20261028T1950_s02_modelo_190, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia.
--
-- Por sus caminos (regla 10), como el administrador de A, en 2026. Lo que ya
-- hubiera en el año de A se mide antes y se compara la diferencia: la prueba
-- no supone que el año esté vacío.
--   1. Un proveedor con retención (su subcuenta enlazada a su ficha, con NIF
--      y código postal).
--   0. Lo de partida: el 190 de A antes de la prueba (su [03] y sus líneas).
--   1b. Un trabajador con su nómina de octubre (IRPF 350).
--   2. Cuatro asientos validados de verdad en el 4T: la nómina (1.000 de base,
--      350 retenidos, con las nóminas del 111), la factura del profesional
--      (500 de gasto, 75 retenidos), una nómina SIN retención (800 en la 640)
--      y una indemnización exenta (300 en la 641, clave L.05).
--   3. El 190: la [03] sube 425 y la [02], 2.600 (también la nómina sin
--      retención y la indemnización, en su línea L.05); la línea G del proveedor sube 75, con su NIF
--      y la provincia 08; la del trabajador (clave A), 350, si la cuenta tiene
--      una sola empresa; lo que queda «sin trabajador» no cambia.
--   4. Con el 111 del 4T calculado, el 4T del 190 casa con él.
--   5. «Ya lo presenté fuera» del 190 de 2025: CSV que no vale, no; con CSV,
--      presentado fuera y con candado (no se recalcula).
--   6. El fichero: lo pide el servicio; el administrador, no; con errores, no da datos.
--   7. La cuenta B no lee ni calcula lo de A.
--   8. La vuelta atrás, con lo comprobado de la prueba dentro: quita las
--      cuatro funciones y deja el CHECK con sus catorce claves; y otra vez delante.

begin;
do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 190: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/migrations/20261028T1950_s02_modelo_190.sql

create temp table prueba_190 (k text primary key, v jsonb) on commit drop;
grant all on prueba_190 to authenticated;

-- ── 1 · El proveedor (como el sistema: sin el rol de la app) ─────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  c41p uuid; v_sup text; v_emp uuid;
begin
  select id into c41p from public.company_account where company_id = emp and code = '41000002';
  if c41p is null then raise exception 'PRUEBA 190 · 1: falta la subcuenta 41000002 de la empresa A.'; end if;
  -- S02 (29/10): la 641 de A, para la indemnización exenta del paso 2 (si no la tiene; con el plan de su 640).
  if not exists (select 1 from public.company_account where company_id = emp and code like '641%') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select a, emp, ca.plan, '64100000', '641', 'Indemnizaciones', 'template', 'manual'
      from public.company_account ca where ca.company_id = emp and ca.code = '64000000';
  end if;
  -- El 190 en los modelos de A (si no estaba).
  if not exists (select 1 from public.tax_obligation where company_id = emp and form_code = '190' and valid_to is null and active) then
    insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, reason, why, valid_from)
    values (a, emp, '190', 'annual', true, 'added', 'Prueba S02', 'Prueba S02: el resumen anual de retenciones.', '2025-01-01');
  end if;
  -- La ficha del proveedor de la 41000002: la que ya tenga enlazada, o una nueva.
  select l.entity_id into v_sup from public.company_account_link l
   where l.company_id = emp and l.company_account_id = c41p and l.entity = 'supplier' and l.role = 'principal' order by l.created_at, l.id limit 1;
  if v_sup is null then
    insert into public.supplier (account_id, name, legal_name, tax_id, country_code, fiscal_postal_code)
    values (a, 'Prueba S02 asesor', 'Prueba S02 Asesor', '00000000T', 'ES', '08001') returning id::text into v_sup;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (a, emp, c41p, 'supplier', v_sup, 'principal', 'manual');
  else
    update public.supplier set tax_id = '00000000T', country_code = 'ES', fiscal_postal_code = '08001' where id::text = v_sup;
  end if;
  insert into prueba_190 values ('proveedor', to_jsonb(v_sup));
  insert into prueba_190 values ('una_empresa', to_jsonb((select count(*) = 1 from public.company where account_id = a)));
end $$;

-- ── 0 · Lo de partida, con la ficha del proveedor y sin el trabajador ni los asientos ──
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; d uuid;
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '190' and fiscal_year = 2026 and status not in ('pending', 'draft', 'reviewed')) then
    raise exception 'PRUEBA 190 · 0: el 190 de 2026 de A ya está presentado en staging. Revisa la prueba.';
  end if;
  c := public.conta_impuesto_190_calcular(emp, 2026);
  d := (c->>'declaracion')::uuid;
  insert into prueba_190 values ('antes', jsonb_build_object(
    'c03', coalesce((c#>>'{casillas,03}')::numeric, 0),
    'g', coalesce((select (l.frozen->>'retenciones')::numeric from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'clave' = 'G'
                    and l.frozen->>'proveedor' = (select v #>> '{}' from prueba_190 where k = 'proveedor')), 0),
    'sin', coalesce((select (l.frozen->>'retenciones')::numeric from public.tax_return_line l where l.tax_return_id = d and (l.frozen->>'sin_trabajador')::boolean and l.frozen->>'clave' = 'A'), 0),
    'sin_integra', coalesce((select (l.frozen->>'integra')::numeric from public.tax_return_line l where l.tax_return_id = d and (l.frozen->>'sin_trabajador')::boolean and l.frozen->>'clave' = 'A'), 0),
    'c02', coalesce((c#>>'{casillas,02}')::numeric, 0),
    'l05', coalesce((select (l.frozen->>'integra')::numeric from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'clave' = 'L' and l.frozen->>'subclave' = '05'), 0)));
end $$;

reset role;

-- ── 1b · El trabajador y su nómina de octubre: 1.000 de bruto, 350 de IRPF y 63,50 de cotizaciones ──
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_emp uuid;
begin
  insert into public.employees (account_id, name, dni, birth_date) values (a, 'Prueba S02 Trabajador', '00000001R', '1990-01-01') returning id into v_emp;
  insert into public.payroll_cost (account_id, employee_id, period_year, period_month, status, gross, irpf, employee_ss, source)
  values (a, v_emp, 2026, 10, 'definitiva', 1000, 350, 63.50, 'manual');
  insert into prueba_190 values ('trabajador', to_jsonb(v_emp));
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 2 · Los asientos, validados de verdad ──────────────────────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; c640 uuid; c641 uuid; c465 uuid; c4751 uuid; c623 uuid; c41p uuid; e uuid; w_trab uuid; w_prof uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into c640 from public.company_account where company_id = emp and code = '64000000';
  select id into c465 from public.company_account where company_id = emp and code = '46500000';
  select id into c4751 from public.company_account where company_id = emp and code = '47510000';
  select id into c623 from public.company_account where company_id = emp and code = '62300000';
  select id into c41p from public.company_account where company_id = emp and code = '41000002';
  -- La nómina va con las del 111 por el tipo «administradores» (la regla de la 0330); en el 190, sin trabajador en la línea.
  select id into w_trab from public.withholding_rate where is_system and code = 'administradores' and valid_to is null;
  select id into w_prof from public.withholding_rate where is_system and code = 'profesional' and valid_to is null;
  if v_y is null or c640 is null or c465 is null or c4751 is null or c623 is null or c41p is null or w_trab is null or w_prof is null then
    raise exception 'PRUEBA 190 · 2: faltan el ejercicio 2026, cuentas de la empresa A o los tipos de retención.';
  end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-10-31', 'Prueba S02 · nómina de octubre', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c640, 1000, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 350, loc, w_trab, 1000, '111'), (a, emp, e, 3, c465, 0, 650, loc, null, null, null);
  perform public.journal_entry_validar(e);
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 2, '2026-10-06', 'Prueba S02 · profesional', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c623, 500, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 75, loc, w_prof, 500, '111'), (a, emp, e, 3, c41p, 0, 425, loc, null, null, null);
  perform public.journal_entry_validar(e);
  -- S02 (29/10): una nómina SIN retención (800 en la 640, sin la 4751): también va en el 190.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-11-30', 'Prueba S02 · nómina sin retención', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c640, 800, 0, loc, null, null, null), (a, emp, e, 2, c465, 0, 800, loc, null, null, null);
  perform public.journal_entry_validar(e);
  -- S02 (29/10): una indemnización exenta (300 en la 641): clave L, subclave 05.
  select id into c641 from public.company_account where company_id = emp and code like '641%' order by code limit 1;
  if c641 is null then raise exception 'PRUEBA 190 · 2: la empresa A no tiene ninguna subcuenta de la 641.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 4, '2026-12-15', 'Prueba S02 · indemnización exenta', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c641, 300, 0, loc, null, null, null), (a, emp, e, 2, c465, 0, 300, loc, null, null, null);
  perform public.journal_entry_validar(e);
end $$;

-- ── 3 · El 190 con los asientos ────────────────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  s0 jsonb := (select v from prueba_190 where k = 'antes');
  sup text := (select v #>> '{}' from prueba_190 where k = 'proveedor');
  trab text := (select v #>> '{}' from prueba_190 where k = 'trabajador');
  una boolean := (select (v #>> '{}')::boolean from prueba_190 where k = 'una_empresa');
  c jsonb; d uuid; g jsonb; t jsonb; sin numeric; esperado numeric;
begin
  c := public.conta_impuesto_190_calcular(emp, 2026);
  d := (c->>'declaracion')::uuid;
  insert into prueba_190 values ('d190', to_jsonb(d));
  if (c#>>'{casillas,03}')::numeric - (s0->>'c03')::numeric <> 425 then
    raise exception 'PRUEBA 190 · 3: la [03] no sube 425 (antes %, ahora %).', s0->>'c03', c#>>'{casillas,03}';
  end if;
  select l.frozen into g from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'clave' = 'G' and l.frozen->>'proveedor' = sup;
  if g is null or (g->>'retenciones')::numeric - (s0->>'g')::numeric <> 75 or g->>'nif' <> '00000000T' or g->>'provincia' <> '08' or g->>'subclave' <> '01' then
    raise exception 'PRUEBA 190 · 3: la línea G del proveedor no es la esperada (%).', g;
  end if;
  select coalesce((select (l.frozen->>'retenciones')::numeric from public.tax_return_line l where l.tax_return_id = d and (l.frozen->>'sin_trabajador')::boolean and l.frozen->>'clave' = 'A'), 0) into sin;
  -- La [02]: 1.000 de la nómina con retención, 500 del profesional, 800 de la nómina sin retención y 300 de la indemnización.
  if (c#>>'{casillas,02}')::numeric - (s0->>'c02')::numeric <> 2600 then
    raise exception 'PRUEBA 190 · 3: la [02] no sube 2.600 (antes %, ahora %): falta la nómina sin retención o la indemnización.', s0->>'c02', c#>>'{casillas,02}';
  end if;
  -- La indemnización, en su línea L.05 (sin trabajador: del diario no se sabe de quién es).
  if coalesce((select (l.frozen->>'integra')::numeric from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'clave' = 'L' and l.frozen->>'subclave' = '05'
                and (l.frozen->>'sin_trabajador')::boolean), 0) - (s0->>'l05')::numeric <> 300 then
    raise exception 'PRUEBA 190 · 3: la indemnización no va en la línea L.05.';
  end if;
  -- Lo pagado sin trabajador: la nómina sin retención (800) y, con varias empresas, también la de 1.000.
  -- (El esperado va en una variable: dentro de un IF, PL/pgSQL corta la condición en el primer THEN.)
  esperado := case when una then 800 else 1800 end;
  if (select coalesce((select (l.frozen->>'integra')::numeric from public.tax_return_line l where l.tax_return_id = d and (l.frozen->>'sin_trabajador')::boolean and l.frozen->>'clave' = 'A'), 0))
     - (s0->>'sin_integra')::numeric <> esperado then
    raise exception 'PRUEBA 190 · 3: lo pagado «sin trabajador» no sube lo esperado (una empresa: %).', una;
  end if;
  if una then
    select l.frozen into t from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'clave' = 'A' and l.frozen->>'perceptor' = trab;
    if t is null or (t->>'retenciones')::numeric <> 350 or (t->>'anio_nacimiento')::int <> 1990 or t->>'nif' <> '00000001R' or (t->>'gastos')::numeric <> 63.50 then
      raise exception 'PRUEBA 190 · 3: la línea A del trabajador no es la esperada (%).', t;
    end if;
    if sin <> (s0->>'sin')::numeric then
      raise exception 'PRUEBA 190 · 3: lo «sin trabajador» cambia (antes %, ahora %), y la nómina tiene su trabajador.', s0->>'sin', sin;
    end if;
    -- Sin domicilio del trabajador en Sumied, el 190 dice que le falta la provincia (y no se da por revisado).
    if not exists (select 1 from public.tax_return_check where tax_return_id = d and check_key = 'payees_190_province' and result = 'error' and title like '%trabajador%') then
      raise exception 'PRUEBA 190 · 3: no dice que al trabajador le falta la provincia.';
    end if;
  else
    if sin - (s0->>'sin')::numeric <> 350 then
      raise exception 'PRUEBA 190 · 3: con varias empresas en la cuenta, la nómina va «sin trabajador» (antes %, ahora %).', s0->>'sin', sin;
    end if;
  end if;
  if (select count(*) from public.tax_return_check where tax_return_id = d) <> 5 then
    raise exception 'PRUEBA 190 · 3: lo comprobado no son las cinco comprobaciones.';
  end if;
  begin perform public.conta_impuesto_revisar(d); raise exception 'PRUEBA 190 · 3: se dio por revisado con errores.';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA 190 · 3: la [03] sube 425 y la [02], 2.600 (con la nómina sin retención y la indemnización, 300 en su línea L.05); el proveedor con su NIF y la provincia 08, el trabajador (una empresa: %) y no se revisa con errores.', una;
end $$;

-- ── 4 · Con el 111 del 4T calculado, el 4T del 190 casa con él ─────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; d uuid; p jsonb;
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '111' and fiscal_year = 2026 and period = '4T' and status not in ('pending', 'draft', 'reviewed')) then
    raise notice 'PRUEBA 190 · 4: el 111 del 4T de A ya está presentado en staging: no se recalcula y se salta.';
    return;
  end if;
  perform public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '111');
  d := (public.conta_impuesto_190_calcular(emp, 2026)->>'declaracion')::uuid;
  select x into p from public.tax_return_check k, jsonb_array_elements(k.detail->'periodos') x
   where k.tax_return_id = d and k.check_key = 'sum_111_vs_190' and x->>'periodo' = '4T';
  if p is null or p->>'declaracion' is null or abs((p->>'retenido_111')::numeric - (p->>'retenido_diario')::numeric) >= 0.005 then
    raise exception 'PRUEBA 190 · 4: el 4T del 190 no casa con su 111 (%).', p;
  end if;
  raise notice 'PRUEBA 190 · 4: el 4T casa con el 111 (% € retenidos).', p->>'retenido_111';
end $$;

-- ── 5 · «Ya lo presenté fuera» (el de 2025) y el candado ──────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r jsonb;
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '190' and fiscal_year = 2025 and status not in ('pending', 'draft', 'reviewed')) then
    raise notice 'PRUEBA 190 · 5: el 190 de 2025 de A ya estaba presentado en staging: se prueba solo el candado.';
  else
    begin perform public.conta_impuesto_informativa_fuera(emp, '190', 2025, 'corto', '2026-01-20', null); raise exception 'PRUEBA 190 · 5: aceptó un CSV que no vale.';
    exception when invalid_parameter_value then null; end;
    begin perform public.conta_impuesto_informativa_fuera(emp, '190', 2025, 'ABCD1234EFGH5678', '2025-12-01', null); raise exception 'PRUEBA 190 · 5: aceptó una fecha de antes de acabar el año.';
    exception when invalid_parameter_value then null; end;
    r := public.conta_impuesto_informativa_fuera(emp, '190', 2025, 'ABCD1234EFGH5678', '2026-01-20', '1900000000001');
    if r->>'mensaje' not like 'Apuntado: el 190 de 2025 presentado fuera el 20/01/2026%' then raise exception 'PRUEBA 190 · 5: el mensaje no dice lo apuntado (%).', r->>'mensaje'; end if;
    if not exists (select 1 from public.tax_return where id = (r->>'declaracion')::uuid and status = 'filed' and filed_via = 'outside' and aeat_csv = 'ABCD1234EFGH5678') then
      raise exception 'PRUEBA 190 · 5: no queda presentado fuera con su CSV.';
    end if;
  end if;
  begin perform public.conta_impuesto_190_calcular(emp, 2025); raise exception 'PRUEBA 190 · 5: recalculó un 190 presentado.';
  exception when invalid_parameter_value then null; end;
  begin perform public.conta_impuesto_informativa_fuera(emp, '303', 2025, 'ABCD1234EFGH5678', '2026-01-20', null); raise exception 'PRUEBA 190 · 5: apuntó un 303 como anual.';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA 190 · 5: «ya lo presenté fuera» con CSV y fecha, y después no se recalcula.';
end $$;

-- ── 6 · El fichero: solo el servicio, y con errores no da datos ────────────
do $$
declare d uuid := (select v #>> '{}' from prueba_190 where k = 'd190')::uuid;
begin
  begin perform public.conta_impuesto_190_fichero(d, null); raise exception 'PRUEBA 190 · 6: el administrador llama a la función del fichero.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare d uuid := (select v #>> '{}' from prueba_190 where k = 'd190')::uuid;
begin
  begin perform public.conta_impuesto_190_fichero(d, null); raise exception 'PRUEBA 190 · 6: con errores, dio los datos del fichero.';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA 190 · 6: el fichero lo pide el servicio, y con errores no se prepara.';
end $$;

-- ── 7 · La cuenta B ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.conta_impuesto_anual('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026); raise exception 'PRUEBA 190 · 7: B lee los modelos del año de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_190_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026); raise exception 'PRUEBA 190 · 7: B calcula el 190 de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_informativa_fuera('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '190', 2025, 'ABCD1234EFGH5678', '2026-01-20', null); raise exception 'PRUEBA 190 · 7: B apunta lo de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA 190 · 7: la cuenta B no lee, no calcula y no apunta lo de A.';
end $$;
reset role;

-- La tira del año de A: el 190 con su declaración.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare t jsonb := public.conta_impuesto_anual('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026);
begin
  if not exists (select 1 from jsonb_array_elements(t->'modelos') m where m->>'modelo' = '190' and m->'declaracion'->>'id' is not null and m->>'periodo' = '0A') then
    raise exception 'PRUEBA 190 · 7: la tira del año no trae el 190 con su declaración (%).', t->'modelos';
  end if;
end $$;
reset role;

-- ── 8 · La vuelta atrás, con datos, y otra vez delante ─────────────────────
do $$ begin
  if not exists (select 1 from public.tax_return_check where check_key in ('payees_190_nif', 'payees_190_province', 'payroll_190')) then
    raise exception 'PRUEBA 190 · 8: no hay comprobaciones nuevas con que probar la vuelta atrás.';
  end if;
end $$;
\i supabase/vuelta-atras/20261028T1950_s02_modelo_190.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_190_calcular(uuid,int)') is not null
     or to_regprocedure('public.conta_impuesto_anual(uuid,int)') is not null
     or to_regprocedure('public.conta_impuesto_informativa_fuera(uuid,text,int,text,date,text)') is not null
     or to_regprocedure('public.conta_impuesto_190_fichero(uuid,uuid)') is not null then
    raise exception 'PRUEBA 190 · 8: la vuelta atrás deja alguna función.';
  end if;
  begin
    insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title)
    select id, account_id, company_id, 'payroll_190', 'ok', 'x' from public.tax_return limit 1;
    raise exception 'PRUEBA 190 · 8: el CHECK de antes deja entrar una clave nueva.';
  exception when check_violation then null;
  end;
end $$;
\i supabase/migrations/20261028T1950_s02_modelo_190.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_190_calcular(uuid,int)') is null then raise exception 'PRUEBA 190 · 8: otra vez delante, falta el cálculo.'; end if;
  raise notice 'PRUEBA 190 · 8: la vuelta atrás quita las cuatro funciones y deja el CHECK de antes; y otra vez delante.';
end $$;

rollback;
