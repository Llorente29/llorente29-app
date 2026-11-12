-- supabase/staging/sql/20261112_s01p_linea_socio_prueba.sql
--
-- SOLO STAGING. Prueba de la 1755 (S01p·18 · punto 1: la línea de la
-- transacción del socio que no es ninguna de las dos facturas se pregunta y se
-- apunta), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la
-- empresa A, con un socio de prueba por documentos que se crea aquí mismo.
--
-- Las cifras son las de octubre de Alcalá de Foodint: AF 11.408,42, FV 5.998,37,
-- «Financiación inventario pendiente por pagar» 770,00 y saldo 6.180,05 (el
-- cobro del banco del 06/11).
--
--   1. «Género que te cobrará el mes que viene»: los tres de siempre y el cuarto,
--      Debe su 430 / Haber 4009 por 770,00 en el local (el 3392 de Julio). Al
--      proponerse, lo pendiente con él en ese local es 770,00, y la 430 queda
--      con los 6.180,05 que paga.
--   2. Sin contestar: no se propone, y se dice qué línea falta.
--   3. Un saldo que no cuadra con lo contestado: no se propone.
--   4. Noviembre, «Género del mes pasado que ya te cobra» (−770,00): el
--      contrario, Debe 4009 / Haber 430; lo pendiente vuelve a 0.
--   5. Cancelar más de lo pendiente: no se fuerza, se pregunta.
--   6. «Otra cosa: la apunto yo a mano»: los tres de siempre, ninguno de la 4009,
--      y la factura que le haces lo dice en «Mira esto».
--   7. Las reglas: se guardan, se leen, se cambian y se olvidan; quien no es de
--      la cuenta, no.
--   8. La vuelta atrás: conta_propuestas_socio con su huella de antes y nada de la 1755.
--
-- Nombra lo que toca, para el analizador: conta_propuestas_socio,
-- _conta_proponer_socio, socio_linea_regla, compras_socio_reglas,
-- compras_socio_regla_guardar, _socio_linea_clave, _conta_socio_pendiente,
-- compras_socio_pendiente, licensed_settlement, journal_entry, journal_line,
-- company_account, company_account_link.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '120s';

select to_regclass('public.socio_linea_regla') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261112T1755_s01p_linea_socio.sql
\endif

create or replace function pg_temp.filas(p jsonb) returns text language sql as $$
  select string_agg((l->>'cuenta') || ' ' || (l->>'debe')::numeric(14,2) || '/' || (l->>'haber')::numeric(14,2), ' · ' order by o)
    from jsonb_array_elements(p->'lineas') with ordinality z(l, o)
$$;
create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
-- La empresa de la cuenta A: en staging, la de siempre; en la base local, la primera de A.
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('local', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('socio', 'c18a0000-0000-4000-8000-000000001801'), ('party', null), ('fv', 'c18a0000-0000-4000-8000-000000001803'),
  ('oct', 'c18a0000-0000-4000-8000-000000001810'), ('nov', 'c18a0000-0000-4000-8000-000000001811'), ('mano', 'c18a0000-0000-4000-8000-000000001812');
insert into _p select 'empresa', coalesce((select id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
                                          (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1))::text;

-- La siembra, toda en esta transacción: el plan de A si no lo tiene (la base local),
-- su año abierto, y un socio de prueba por documentos con su 430, su 400, su gasto y su factura.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); a uuid := (select v::uuid from _p where clave = 'cuenta'); v_c uuid; v_pr uuid; v_t text;
begin
  if e is null then raise exception 'PRUEBA S01p·18 · siembra: la cuenta A no tiene empresa.'; end if;
  if not exists (select 1 from public.company_account where company_id = e) then perform public.company_chart_activate(e, false, 'Prueba S01p·18'); end if;
  if not coalesce(public.conta_dia_abierto(e, '2026-11-03'), false) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin) values (a, e, 'P18-2026', '2026-01-01', '2026-12-31', 'open', 'folvy');
  end if;
  if not coalesce(public.conta_dia_abierto(e, '2027-01-03'), false) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin) values (a, e, 'P18-2027', '2027-01-01', '2027-12-31', 'open', 'folvy');
  end if;
  insert into public.supplier (id, account_id, name, tax_id, invoicing_mode) values ((select v::uuid from _p where clave = 'socio'), a, 'Socio de Prueba Línea, S.L.', 'B00001810', 'monthly_settlement');
  -- Su tercero lo crea el alta del proveedor.
  update _p set v = (select pr.party_id::text from public.party_role pr where pr.supplier_id = (select v::uuid from _p where clave = 'socio') limit 1) where clave = 'party';
  if (select v from _p where clave = 'party') is null then
    insert into public.party (account_id, name, tax_id) values (a, 'Socio de Prueba Línea, S.L.', 'B00001810') returning id::text into v_t;
    insert into public.party_role (account_id, party_id, role, supplier_id) values (a, v_t::uuid, 'supplier', (select v::uuid from _p where clave = 'socio'));
    update _p set v = v_t where clave = 'party';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, e, 'pymes', '43001810', '4300', 'Socio de Prueba Línea (cliente)', 'own', 'manual') returning id into v_c;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, e, 'pymes', '40001810', '4000', 'Socio de Prueba Línea (proveedor)', 'own', 'manual') returning id into v_pr;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values
    (a, e, v_c, 'customer', (select v from _p where clave = 'party'), 'principal', 'manual'),
    (a, e, v_pr, 'supplier', (select v from _p where clave = 'socio'), 'principal', 'manual'),
    (a, e, (select id from public.company_account where company_id = e and code = public._conta_hoja(e, '600')), 'supplier', (select v from _p where clave = 'socio'), 'gasto', 'manual');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, status, grand_total)
  values ((select v::uuid from _p where clave = 'fv'), a, e, (select v::uuid from _p where clave = 'socio'), 'FV-P1810', '2026-11-03', 'aprobada', 5998.37);
  if public._conta_hoja(e, '4009') is null or public._conta_hoja(e, '705') is null or not coalesce(public.conta_dia_abierto(e, '2026-11-03'), false) then
    raise exception 'PRUEBA S01p·18 · siembra: sin la 4009, sin la 705 o con el 03/11 cerrado.';
  end if;
end $$;

-- Las liquidaciones de la prueba: las cifras de octubre de Alcalá.
create or replace function pg_temp.detalle(p_num text, p_fecha text, p_saldo numeric, p_lineas jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('bloqueos', '[]'::jsonb, 'avisos', '[]'::jsonb,
    'emitida', jsonb_build_object('numero', 'AF-' || p_num, 'fecha', p_fecha, 'total', 11408.42, 'lineas', jsonb_build_array(
       jsonb_build_object('concepto', 'Servicio por Ventas Multimarcas', 'base', 8134.96, 'tipo', 10, 'total', 8948.46),
       jsonb_build_object('concepto', 'Servicio por Ventas con Reparto Propio', 'base', 188.8, 'tipo', 10, 'total', 207.68),
       jsonb_build_object('concepto', 'Mercaderías Aportadas por el Partner', 'base', 1999.07, 'tipo', 10, 'total', 2198.98),
       jsonb_build_object('concepto', 'Delivery fee Ventas con Reparto Propio', 'base', 48.46, 'tipo', 10, 'total', 53.31))),
    'recibida', jsonb_build_object('numero', 'FV-' || p_num, 'fecha', p_fecha, 'total', 5998.37, 'lineas', jsonb_build_array(
       jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 664.18, 'tipo', 4, 'total', 690.75),
       jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 4147.25, 'tipo', 10, 'total', 4561.98),
       jsonb_build_object('concepto', 'Mercaderías en Stock', 'base', 616.24, 'tipo', 21, 'total', 745.65))),
    'transaccion', jsonb_build_object('saldo', jsonb_build_object('importe', p_saldo)),
    'lineasSocio', p_lineas)
$f$;
insert into public.licensed_settlement (id, account_id, company_id, party_id, supplier_id, location_id, period_from, period_to, status, formula, settlement_ref, received_invoice_id, detail)
select x.id, (select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'party'),
       (select v::uuid from _p where clave = 'socio'), (select v::uuid from _p where clave = 'local'), x.desde, x.hasta, 'borrador', 'documentos', x.ref,
       (select v::uuid from _p where clave = 'fv'), x.det
  from (values
    ((select v::uuid from _p where clave = 'oct'), date '2026-10-01', date '2026-10-31', 'AF-P1810',
     pg_temp.detalle('P1810', '2026-11-03', 6180.05, '[{"concepto": "Financiación inventario pendiente por pagar", "importe": 770, "queEs": "pendiente_facturar"}]')),
    ((select v::uuid from _p where clave = 'nov'), date '2026-11-01', date '2026-11-30', 'AF-P1811',
     pg_temp.detalle('P1811', '2026-12-03', 4640.05, '[{"concepto": "Financiación inventario pendiente por pagar", "importe": -770, "queEs": "cancela_pendiente"}]')),
    ((select v::uuid from _p where clave = 'mano'), date '2026-12-01', date '2026-12-31', 'AF-P1812',
     pg_temp.detalle('P1812', '2027-01-03', 5460.05, '[{"concepto": "Ajuste de envases", "importe": 50, "queEs": "a_mano"}]'))) x(id, desde, hasta, ref, det);

-- ── 1 · Octubre: género que te cobrará el mes que viene ───────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := (select v::uuid from _p where clave = 'oct'); x jsonb; r jsonb; je public.journal_entry;
begin
  x := public.conta_propuestas_socio(e, liq);
  if x ? 'sin_propuesta' then raise exception 'PRUEBA S01p·18 · 1: no se propone: %', x->>'sin_propuesta'; end if;
  if jsonb_array_length(x->'propuestas') <> 4 or x->'propuestas'->3->'entrada'->>'source_type' <> 'purchase_accrual'
     or (x->'propuestas'->3->'entrada'->>'source_id')::uuid <> liq
     or pg_temp.filas(x->'propuestas'->3) <> '43001810 770.00/0.00 · 40090000 0.00/770.00'
     or (x->'propuestas'->3->'lineas'->0->>'local_id')::uuid <> (select v::uuid from _p where clave = 'local')
     or pg_temp.filas(x->'propuestas'->2) <> '40001810 5998.37/0.00 · 43001810 0.00/5998.37' then
    raise exception 'PRUEBA S01p·18 · 1: las propuestas son %', x->'propuestas';
  end if;
  r := public._conta_proponer_socio(e, liq, 'Prueba S01p·18');
  select * into je from public.journal_entry where company_id = e and source_type = 'purchase_accrual' and source_id = liq;
  if je.id is null or je.status <> 'propuesto' or je.entry_date <> '2026-11-03' then
    raise exception 'PRUEBA S01p·18 · 1: el asiento de la 4009 no se propuso (%; %).', r, je.status;
  end if;
  if public._conta_socio_pendiente(e, (select v::uuid from _p where clave = 'party'), (select v::uuid from _p where clave = 'local'), null) <> 770 then
    raise exception 'PRUEBA S01p·18 · 1: lo pendiente con el socio no es 770 (%).',
      public._conta_socio_pendiente(e, (select v::uuid from _p where clave = 'party'), (select v::uuid from _p where clave = 'local'), null);
  end if;
  raise notice '1 · octubre: los tres y «%» (%); pendiente con el socio en el local: 770,00', x->'propuestas'->3->'entrada'->>'concepto', pg_temp.filas(x->'propuestas'->3);
end $$;

-- La 430 de octubre: lo que paga (AF − FV + 770 = 6.180,05).
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; v_430 numeric;
begin
  x := public.conta_propuestas_socio(e, (select v::uuid from _p where clave = 'oct'));
  select sum((l->>'debe')::numeric - (l->>'haber')::numeric) into v_430
    from jsonb_array_elements(x->'propuestas') p, jsonb_array_elements(p->'lineas') l where l->>'cuenta' = '43001810';
  if v_430 <> 6180.05 then raise exception 'PRUEBA S01p·18 · 1: la 430 queda en % y paga 6.180,05.', v_430; end if;
  raise notice '1 · la 430 de octubre queda en %: lo que dice la transacción (el cobro la deja a cero)', v_430;
end $$;

-- ── 2 · Sin contestar, no ─────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := (select v::uuid from _p where clave = 'oct'); x jsonb;
begin
  update public.licensed_settlement set detail = jsonb_set(detail, '{lineasSocio,0,queEs}', 'null') where id = liq;
  x := public.conta_propuestas_socio(e, liq);
  if x->>'sin_propuesta' is distinct from 'La transacción trae «Financiación inventario pendiente por pagar» y aún no me has dicho qué es: contéstalo en la liquidación.' then
    raise exception 'PRUEBA S01p·18 · 2: sin contestar da %', x;
  end if;
  raise notice '2 · sin contestar: «%»', x->>'sin_propuesta';
  -- ── 3 · Un saldo que no cuadra con lo contestado ──
  update public.licensed_settlement set detail = jsonb_set(jsonb_set(detail, '{lineasSocio,0,queEs}', '"pendiente_facturar"'), '{lineasSocio,0,importe}', '700') where id = liq;
  x := public.conta_propuestas_socio(e, liq);
  if x->>'sin_propuesta' not like 'La transacción dice 6.180,05 € de saldo y las dos facturas dan 5.410,05 € más sus otras líneas, 700,00 €%' then
    raise exception 'PRUEBA S01p·18 · 3: el saldo que no cuadra da %', x;
  end if;
  raise notice '3 · el saldo que no cuadra: «%»', x->>'sin_propuesta';
  update public.licensed_settlement set detail = jsonb_set(detail, '{lineasSocio,0,importe}', '770') where id = liq;
end $$;

-- ── 4 · Noviembre: el género del mes pasado que ya te cobra ───────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := (select v::uuid from _p where clave = 'nov'); x jsonb; je public.journal_entry;
begin
  x := public.conta_propuestas_socio(e, liq);
  if x ? 'sin_propuesta' then raise exception 'PRUEBA S01p·18 · 4: no se propone: %', x->>'sin_propuesta'; end if;
  if jsonb_array_length(x->'propuestas') <> 4 or x->'propuestas'->3->'entrada'->>'source_type' <> 'purchase_accrual_reversal'
     or pg_temp.filas(x->'propuestas'->3) <> '40090000 770.00/0.00 · 43001810 0.00/770.00' then
    raise exception 'PRUEBA S01p·18 · 4: las propuestas son %', x->'propuestas';
  end if;
  perform public._conta_proponer_socio(e, liq, 'Prueba S01p·18');
  select * into je from public.journal_entry where company_id = e and source_type = 'purchase_accrual_reversal' and source_id = liq;
  if je.id is null or je.status <> 'propuesto' then raise exception 'PRUEBA S01p·18 · 4: el contrario no se propuso.'; end if;
  if public._conta_socio_pendiente(e, (select v::uuid from _p where clave = 'party'), (select v::uuid from _p where clave = 'local'), null) <> 0 then
    raise exception 'PRUEBA S01p·18 · 4: lo pendiente no vuelve a 0.';
  end if;
  raise notice '4 · noviembre: «%» (%); pendiente con el socio: 0,00', x->'propuestas'->3->'entrada'->>'concepto', pg_temp.filas(x->'propuestas'->3);
  -- ── 5 · Cancelar más de lo pendiente: no se fuerza ──
  update public.licensed_settlement set detail = jsonb_set(jsonb_set(detail, '{lineasSocio,0,importe}', '-800'), '{transaccion,saldo,importe}', '4610.05') where id = liq;
  x := public.conta_propuestas_socio(e, liq);
  if x->>'sin_propuesta' not like 'Cancela 800,00 € de género pendiente y con % solo queda 770,00 € pendiente de facturar: dime qué es esa línea.' then
    raise exception 'PRUEBA S01p·18 · 5: cancelar de más da %', x;
  end if;
  raise notice '5 · cancelar de más: «%»', x->>'sin_propuesta';
end $$;

-- ── 6 · Otra cosa: la apunto yo a mano ────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  x := public.conta_propuestas_socio(e, (select v::uuid from _p where clave = 'mano'));
  if x ? 'sin_propuesta' then raise exception 'PRUEBA S01p·18 · 6: no se propone: %', x->>'sin_propuesta'; end if;
  if jsonb_array_length(x->'propuestas') <> 3
     or not exists (select 1 from jsonb_array_elements(x->'propuestas'->1->'entrada'->'razones') z
                     where z->>'porque' = 'La transacción trae «Ajuste de envases» (50,00 €) y dijiste que la apuntas tú a mano: no va en ningún asiento.') then
    raise exception 'PRUEBA S01p·18 · 6: a mano da %', x->'propuestas';
  end if;
  raise notice '6 · a mano: los tres de siempre, y «Mira esto» en la que le haces';
end $$;

-- ── 7 · Las reglas ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); s uuid := (select v::uuid from _p where clave = 'socio'); r jsonb;
begin
  r := public.compras_socio_regla_guardar(e, s, '  Financiación  inventario pendiente por pagar ', 'pendiente_facturar');
  if r->>'clave' <> 'financiación inventario pendiente por pagar' or r->>'queEs' <> 'pendiente_facturar' then raise exception 'PRUEBA S01p·18 · 7: guardar da %', r; end if;
  r := public.compras_socio_regla_guardar(e, s, 'FINANCIACIÓN INVENTARIO PENDIENTE POR PAGAR', 'a_mano');
  if jsonb_array_length(public.compras_socio_reglas(e, s)) <> 1 or public.compras_socio_reglas(e, s)->0->>'queEs' <> 'a_mano' then
    raise exception 'PRUEBA S01p·18 · 7: cambiar da %', public.compras_socio_reglas(e, s);
  end if;
  if public.compras_socio_pendiente(e, s, (select v::uuid from _p where clave = 'local')) <> 0 then
    raise exception 'PRUEBA S01p·18 · 7: compras_socio_pendiente no da lo pendiente.';
  end if;
  perform public.compras_socio_regla_guardar(e, s, 'Financiación inventario pendiente por pagar', null);
  if jsonb_array_length(public.compras_socio_reglas(e, s)) <> 0 then raise exception 'PRUEBA S01p·18 · 7: olvidar no la borra.'; end if;
  begin perform public.compras_socio_regla_guardar(e, s, 'Algo', 'regalo'); raise exception 'PRUEBA S01p·18 · 7: acepta «regalo».';
  exception when sqlstate '22023' then null; end;
  raise notice '7 · las reglas: se guardan con su clave, se cambian, se leen y se olvidan';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.compras_socio_regla_guardar((select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'socio'), 'Algo', 'a_mano');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01p·18 · 7: alguien sin cuenta guarda una regla.'; end if;
  raise notice '7 · sin cuenta, no («%»)', v_err;
end $$;
reset role;

-- ── 8 · La vuelta atrás ─────────────────────────────────────────────────────
delete from public.journal_line where entry_id in (select id from public.journal_entry where source_id in (select v::uuid from _p where clave in ('oct', 'nov', 'mano')));
delete from public.journal_entry where source_id in (select v::uuid from _p where clave in ('oct', 'nov', 'mano'));
\i supabase/vuelta-atras/20261112T1755_s01p_linea_socio.down.sql
do $$
declare v_h text := md5(pg_get_functiondef('public.conta_propuestas_socio(uuid,uuid)'::regprocedure));
begin
  -- La de producción (la misma en staging y en la base local antes de la 1755). El workflow aplica la 1755 antes de esta prueba.
  if v_h <> 'b716120913963dca46f9bda310a24fcc' then
    raise exception 'PRUEBA S01p·18 · 8: la vuelta atrás deja conta_propuestas_socio con % y la de producción es b716120913963dca46f9bda310a24fcc.', v_h;
  end if;
  if to_regclass('public.socio_linea_regla') is not null or to_regprocedure('public.compras_socio_pendiente(uuid,uuid,uuid)') is not null then
    raise exception 'PRUEBA S01p·18 · 8: la vuelta atrás deja cosas de la 1755.';
  end if;
  raise notice '8 · la vuelta atrás: conta_propuestas_socio como antes (%) y nada de la 1755', v_h;
end $$;
\i supabase/migrations/20261112T1755_s01p_linea_socio.sql

rollback;
