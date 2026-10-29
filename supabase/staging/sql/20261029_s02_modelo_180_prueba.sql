-- supabase/staging/sql/20261029_s02_modelo_180_prueba.sql
--
-- SOLO STAGING. Prueba de 20261029T0845_s02_modelo_180, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia.
--
-- Por sus caminos (regla 10), como el administrador de A, en 2026. Lo que ya
-- hubiera en el año de A se mide antes y se compara la diferencia: la prueba
-- no supone que el año esté vacío.
--   1. Un arrendador (la subcuenta 41000002 enlazada a su ficha, con NIF y
--      código postal), el 180 en los modelos de A y su 621 si no la tiene.
--   0. Lo de partida: el 180 de A antes de la prueba (sus casillas y la línea
--      del arrendador).
--   2. Un asiento de alquiler validado de verdad en el 4T: 1.000 en la 621,
--      190 retenidos en la 4751 (tipo «alquiler», modelo 115) y 810 al
--      arrendador.
--   3. El 180: la [03] sube 190 y la [02], 1.000; la línea del arrendador,
--      con su NIF, la provincia 08 y el 19 %; sin inmueble, «lease_180» da
--      error y no se da por revisado.
--   3b. El inmueble: sin referencia catastral en la situación 1, no; bien, se
--      guarda y lo dice; recalculado, la línea lo lleva.
--   4. Con el 115 del 4T calculado, el 4T del 180 casa con él.
--   5. El fichero: lo pide el servicio; el administrador, no. Con algo sin
--      resolver no da datos; si no queda nada, da el arrendador con su inmueble.
--   6. La cuenta B no calcula el 180 de A ni le pone un inmueble.
--   7. La vuelta atrás, con lo comprobado y el inmueble de la prueba dentro:
--      quita las tres funciones y la tabla, y deja el CHECK con sus diecisiete
--      claves; y otra vez delante.

begin;
do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 180: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/migrations/20261029T0845_s02_modelo_180.sql

create temp table prueba_180 (k text primary key, v jsonb) on commit drop;
grant all on prueba_180 to authenticated;

-- ── 1 · El arrendador (como el sistema: sin el rol de la app) ───────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  c41p uuid; v_sup text;
begin
  select id into c41p from public.company_account where company_id = emp and code = '41000002';
  if c41p is null then raise exception 'PRUEBA 180 · 1: falta la subcuenta 41000002 de la empresa A.'; end if;
  if not exists (select 1 from public.tax_obligation where company_id = emp and form_code = '180' and valid_to is null and active) then
    insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, reason, why, valid_from)
    values (a, emp, '180', 'annual', true, 'added', 'Prueba S02', 'Prueba S02: el resumen anual de retenciones del alquiler.', '2025-01-01');
  end if;
  -- La 621 de A, para el alquiler del paso 2 (si no la tiene; con el plan de su 640).
  if not exists (select 1 from public.company_account where company_id = emp and code like '621%') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select a, emp, ca.plan, '62100000', '621', 'Arrendamientos y cánones', 'template', 'manual'
      from public.company_account ca where ca.company_id = emp and ca.code = '64000000';
  end if;
  -- La ficha del proveedor de la 41000002: la que ya tenga enlazada, o una nueva.
  select l.entity_id into v_sup from public.company_account_link l
   where l.company_id = emp and l.company_account_id = c41p and l.entity = 'supplier' and l.role = 'principal' order by l.created_at, l.id limit 1;
  if v_sup is null then
    insert into public.supplier (account_id, name, legal_name, tax_id, country_code, fiscal_postal_code)
    values (a, 'Prueba S02 arrendador', 'Prueba S02 Arrendador', '00000000T', 'ES', '08001') returning id::text into v_sup;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (a, emp, c41p, 'supplier', v_sup, 'principal', 'manual');
  else
    update public.supplier set tax_id = '00000000T', country_code = 'ES', fiscal_postal_code = '08001' where id::text = v_sup;
  end if;
  -- Sin inmueble de partida: lo pone el paso 3b.
  delete from public.company_lease where company_id = emp and supplier_id::text = v_sup;
  insert into prueba_180 values ('proveedor', to_jsonb(v_sup));
end $$;

-- ── 0 · Lo de partida ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; d uuid; sup text := (select v #>> '{}' from prueba_180 where k = 'proveedor');
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '180' and fiscal_year = 2026 and status not in ('pending', 'draft', 'reviewed')) then
    raise exception 'PRUEBA 180 · 0: el 180 de 2026 de A ya está presentado en staging. Revisa la prueba.';
  end if;
  c := public.conta_impuesto_180_calcular(emp, 2026);
  d := (c->>'declaracion')::uuid;
  insert into prueba_180 values ('antes', jsonb_build_object(
    'c02', coalesce((c#>>'{casillas,02}')::numeric, 0),
    'c03', coalesce((c#>>'{casillas,03}')::numeric, 0),
    'base', coalesce((select (l.frozen->>'base')::numeric from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'proveedor' = sup), 0),
    'ret', coalesce((select (l.frozen->>'retenciones')::numeric from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'proveedor' = sup), 0)));
end $$;

-- ── 2 · El alquiler de octubre, validado de verdad ─────────────────────────
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; c621 uuid; c4751 uuid; c41p uuid; w uuid; e uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into c621 from public.company_account where company_id = emp and code like '621%' order by code limit 1;
  select id into c4751 from public.company_account where company_id = emp and code = '47510000';
  select id into c41p from public.company_account where company_id = emp and code = '41000002';
  select id into w from public.withholding_rate where is_system and code = 'alquiler' and valid_to is null;
  if v_y is null or c621 is null or c4751 is null or c41p is null or w is null then
    raise exception 'PRUEBA 180 · 2: faltan el ejercicio 2026, cuentas de la empresa A o el tipo de retención del alquiler.';
  end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
  values (a, emp, v_y, 2, '2026-10-05', 'Prueba S02 · alquiler de octubre', 'manual') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, withholding_rate_id, withholding_base, withholding_model)
  values (a, emp, e, 1, c621, 1000, 0, loc, null, null, null), (a, emp, e, 2, c4751, 0, 190, loc, w, 1000, '115'), (a, emp, e, 3, c41p, 0, 810, loc, null, null, null);
  perform public.journal_entry_validar(e);
end $$;

-- ── 3 · El 180 ─────────────────────────────────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  s0 jsonb := (select v from prueba_180 where k = 'antes');
  sup text := (select v #>> '{}' from prueba_180 where k = 'proveedor');
  c jsonb; d uuid; g jsonb;
begin
  c := public.conta_impuesto_180_calcular(emp, 2026);
  d := (c->>'declaracion')::uuid;
  insert into prueba_180 values ('d180', to_jsonb(d));
  if (c#>>'{casillas,03}')::numeric - (s0->>'c03')::numeric <> 190 then
    raise exception 'PRUEBA 180 · 3: la [03] no sube 190 (antes %, ahora %).', s0->>'c03', c#>>'{casillas,03}';
  end if;
  if (c#>>'{casillas,02}')::numeric - (s0->>'c02')::numeric <> 1000 then
    raise exception 'PRUEBA 180 · 3: la [02] no sube 1.000 (antes %, ahora %).', s0->>'c02', c#>>'{casillas,02}';
  end if;
  select l.frozen into g from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'proveedor' = sup;
  if g is null or (g->>'retenciones')::numeric - (s0->>'ret')::numeric <> 190 or (g->>'base')::numeric - (s0->>'base')::numeric <> 1000
     or g->>'nif' <> '00000000T' or g->>'provincia' <> '08' or (g->>'porcentaje')::numeric <> 19 or jsonb_typeof(g->'inmueble') <> 'null' then
    raise exception 'PRUEBA 180 · 3: la línea del arrendador no es la esperada (%).', g;
  end if;
  if not exists (select 1 from public.tax_return_check where tax_return_id = d and check_key = 'lease_180' and result = 'error') then
    raise exception 'PRUEBA 180 · 3: sin inmueble, no dice que falta.';
  end if;
  if (select count(*) from public.tax_return_check where tax_return_id = d) <> 5 then
    raise exception 'PRUEBA 180 · 3: lo comprobado no son las cinco comprobaciones.';
  end if;
  begin perform public.conta_impuesto_revisar(d); raise exception 'PRUEBA 180 · 3: se dio por revisado con errores.';
  exception when invalid_parameter_value then null; end;
  raise notice 'PRUEBA 180 · 3: la [02] sube 1.000 y la [03], 190; el arrendador con su NIF, la provincia 08 y el 19 %%; sin inmueble, error, y no se revisa.';
end $$;

-- ── 3b · El inmueble ───────────────────────────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  sup uuid := (select v #>> '{}' from prueba_180 where k = 'proveedor')::uuid;
  r jsonb; d uuid; g jsonb;
begin
  begin perform public.conta_impuesto_180_inmueble_poner(emp, sup, '{"situacion":"1","nombre_via":"Calle de Prueba","municipio":"Madrid","provincia":"28","cp":"28001"}');
    raise exception 'PRUEBA 180 · 3b: guardó la situación 1 sin referencia catastral.';
  exception when invalid_parameter_value then null; end;
  r := public.conta_impuesto_180_inmueble_poner(emp, sup, '{"situacion":"1","catastral":"0000000AA0000A0001AA","tipo_via":"CL","nombre_via":"Calle de Prueba","numero":"12","municipio":"Madrid","codigo_municipio":"28079","provincia":"28","cp":"28001"}');
  if r->>'mensaje' not like 'Guardado el local de %: Calle de Prueba 12, 28001 Madrid, referencia catastral …01AA.%' then
    raise exception 'PRUEBA 180 · 3b: el mensaje no dice lo guardado (%).', r->>'mensaje';
  end if;
  d := (public.conta_impuesto_180_calcular(emp, 2026)->>'declaracion')::uuid;
  select l.frozen into g from public.tax_return_line l where l.tax_return_id = d and l.frozen->>'proveedor' = sup::text;
  if g->'inmueble'->>'catastral' is distinct from '0000000AA0000A0001AA' or g->'inmueble'->>'situacion' <> '1' or g->'inmueble'->>'tipo_numeracion' <> 'NUM' then
    raise exception 'PRUEBA 180 · 3b: recalculado, la línea no lleva el inmueble (%).', g->'inmueble';
  end if;
  raise notice 'PRUEBA 180 · 3b: sin referencia catastral en la situación 1, no; bien, se guarda, lo dice y el 180 lo lleva.';
end $$;

-- ── 4 · Con el 115 del 4T calculado, el 4T del 180 casa con él ─────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; d uuid; p jsonb;
begin
  if exists (select 1 from public.tax_return where company_id = emp and form_code = '115' and fiscal_year = 2026 and period = '4T' and status not in ('pending', 'draft', 'reviewed')) then
    raise notice 'PRUEBA 180 · 4: el 115 del 4T de A ya está presentado en staging: no se recalcula y se salta.';
    return;
  end if;
  perform public.conta_impuesto_retenciones_calcular(emp, 2026, '4T', '115');
  d := (public.conta_impuesto_180_calcular(emp, 2026)->>'declaracion')::uuid;
  select x into p from public.tax_return_check k, jsonb_array_elements(k.detail->'periodos') x
   where k.tax_return_id = d and k.check_key = 'sum_115_vs_180' and x->>'periodo' = '4T';
  if p is null or p->>'declaracion' is null or abs((p->>'retenido_115')::numeric - (p->>'retenido_diario')::numeric) >= 0.005 then
    raise exception 'PRUEBA 180 · 4: el 4T del 180 no casa con su 115 (%).', p;
  end if;
  raise notice 'PRUEBA 180 · 4: el 4T casa con el 115 (% € retenidos).', p->>'retenido_115';
end $$;

-- ── 5 · El fichero: solo el servicio ───────────────────────────────────────
do $$
declare d uuid := (select v #>> '{}' from prueba_180 where k = 'd180')::uuid;
begin
  begin perform public.conta_impuesto_180_fichero(d, null); raise exception 'PRUEBA 180 · 5: el administrador llama a la función del fichero.';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$
declare
  d uuid := (select v #>> '{}' from prueba_180 where k = 'd180')::uuid;
  sup text := (select v #>> '{}' from prueba_180 where k = 'proveedor');
  x jsonb; pendientes int;
begin
  select count(*) into pendientes from public.tax_return_check where tax_return_id = d and (result = 'error' or (result = 'warning' and accepted_at is null));
  begin
    x := public.conta_impuesto_180_fichero(d, null);
    if pendientes > 0 then raise exception 'PRUEBA 180 · 5: con % cosas sin resolver, dio los datos del fichero.', pendientes; end if;
    if not exists (select 1 from jsonb_array_elements(x->'perceptores') p where p->>'nif' = '00000000T' and p->'inmueble'->>'cp' = '28001')
       or x->>'numero' !~ '^1802026\d{6}$' then
      raise exception 'PRUEBA 180 · 5: los datos del fichero no traen al arrendador con su inmueble (%).', x;
    end if;
  exception when invalid_parameter_value then
    if pendientes = 0 then raise exception 'PRUEBA 180 · 5: sin nada pendiente, no dio los datos.'; end if;
  end;
  raise notice 'PRUEBA 180 · 5: el fichero lo pide el servicio; con % cosas pendientes, %.', pendientes, case when pendientes > 0 then 'no se prepara' else 'trae al arrendador con su inmueble' end;
end $$;

-- ── 6 · La cuenta B ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare sup uuid := (select v #>> '{}' from prueba_180 where k = 'proveedor')::uuid;
begin
  begin perform public.conta_impuesto_180_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026); raise exception 'PRUEBA 180 · 6: B calcula el 180 de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_impuesto_180_inmueble_poner('3b34403a-a7d6-4a48-a8d7-737e8cababdc', sup, '{"situacion":"4","nombre_via":"X","municipio":"X","provincia":"28","cp":"28001"}');
    raise exception 'PRUEBA 180 · 6: B pone el inmueble de A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.company_lease where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') then
    raise exception 'PRUEBA 180 · 6: B lee los inmuebles de A.';
  end if;
  raise notice 'PRUEBA 180 · 6: la cuenta B no calcula, no pone y no lee lo de A.';
end $$;
reset role;

-- ── 7 · La vuelta atrás, con datos, y otra vez delante ─────────────────────
do $$ begin
  if not exists (select 1 from public.tax_return_check where check_key in ('payees_180_nif', 'payees_180_province', 'lease_180'))
     or not exists (select 1 from public.company_lease) then
    raise exception 'PRUEBA 180 · 7: no hay comprobaciones nuevas o inmuebles con que probar la vuelta atrás.';
  end if;
end $$;
\i supabase/vuelta-atras/20261029T0845_s02_modelo_180.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_180_calcular(uuid,int)') is not null
     or to_regprocedure('public.conta_impuesto_180_inmueble_poner(uuid,uuid,jsonb)') is not null
     or to_regprocedure('public.conta_impuesto_180_fichero(uuid,uuid)') is not null
     or to_regclass('public.company_lease') is not null then
    raise exception 'PRUEBA 180 · 7: la vuelta atrás deja alguna función o la tabla.';
  end if;
  begin
    insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title)
    select id, account_id, company_id, 'lease_180', 'ok', 'x' from public.tax_return limit 1;
    raise exception 'PRUEBA 180 · 7: el CHECK de antes deja entrar una clave nueva.';
  exception when check_violation then null;
  end;
  -- Y las del 190 siguen entrando: el CHECK de antes es el de la 1950.
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title)
  select id, account_id, company_id, 'payroll_190', 'ok', 'x' from public.tax_return limit 1;
end $$;
\i supabase/migrations/20261029T0845_s02_modelo_180.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_180_calcular(uuid,int)') is null or to_regclass('public.company_lease') is null then
    raise exception 'PRUEBA 180 · 7: otra vez delante, falta el cálculo o la tabla.';
  end if;
  raise notice 'PRUEBA 180 · 7: la vuelta atrás quita las tres funciones y la tabla y deja el CHECK de antes; y otra vez delante.';
end $$;

rollback;
