-- supabase/staging/sql/20261112_s01p_contabilizar_valida_prueba.sql
--
-- SOLO STAGING. Prueba de la 1915 (S01p·18 · punto 2: «Contabilizar» valida lo
-- que propone), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la empresa A, con un socio de prueba por documentos que se crea aquí mismo y
-- las cifras de octubre de Alcalá (con la línea de 770,00 contestada).
--
--   1. Contabilizar como el administrador de A: los cuatro asientos (la que le
--      haces, su factura, la compensación y el género pendiente) quedan
--      validados a su nombre, con número; y uno que no se puede validar (un
--      propuesto de un solo apunte, de la misma liquidación) queda propuesto y
--      se dice por qué. La frase lo cuenta.
--   2. La vuelta atrás: _compras_liquidacion_confirmar con su huella de producción.
--
-- Nombra lo que toca, para el analizador: _compras_liquidacion_confirmar,
-- compras_liquidacion_confirmar, _journal_entry_validar, conta_motivos_para_validar,
-- conta_propuestas_socio, licensed_settlement, supplier_invoice, journal_entry, journal_line.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18·2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '120s';

select to_regclass('public.socio_linea_regla') is not null as ya_1755,
       strpos(pg_get_functiondef('public._compras_liquidacion_confirmar(uuid,text)'::regprocedure), 'S01p·18 · 2') > 0 as ya_1915 \gset
\if :ya_1755
\else
\i supabase/migrations/20261112T1755_s01p_linea_socio.sql
\endif
\if :ya_1915
\else
\i supabase/migrations/20261112T1915_s01p_contabilizar_valida.sql
\endif

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
  -- Su factura no se siembra: la registra «Contabilizar».
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
       null, x.det
  from (values
    ((select v::uuid from _p where clave = 'oct'), date '2026-10-01', date '2026-10-31', 'AF-P1810',
     pg_temp.detalle('P1810', '2026-11-03', 6180.05, '[{"concepto": "Financiación inventario pendiente por pagar", "importe": 770, "queEs": "pendiente_facturar"}]')),
    ((select v::uuid from _p where clave = 'nov'), date '2026-11-01', date '2026-11-30', 'AF-P1811',
     pg_temp.detalle('P1811', '2026-12-03', 4640.05, '[{"concepto": "Financiación inventario pendiente por pagar", "importe": -770, "queEs": "cancela_pendiente"}]')),
    ((select v::uuid from _p where clave = 'mano'), date '2026-12-01', date '2026-12-31', 'AF-P1812',
     pg_temp.detalle('P1812', '2027-01-03', 5460.05, '[{"concepto": "Ajuste de envases", "importe": 50, "queEs": "a_mano"}]'))) x(id, desde, hasta, ref, det);


-- Un propuesto de esa misma liquidación que no se puede validar (un solo apunte): tiene que quedar y decirse.
insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason)
select (select v::uuid from _p where clave = 'cuenta'), e.id, y.id, 4, '2026-11-03', 'Prueba: un asiento cojo', 'purchase_accrual_reversal',
       (select v::uuid from _p where clave = 'oct'), 'propuesto', 'duda', 'Prueba S01p·18·2'
  from public.company e join public.fiscal_year y on y.company_id = e.id and date '2026-11-03' between y.starts_on and y.ends_on
 where e.id = (select v::uuid from _p where clave = 'empresa');
insert into public.journal_line (account_id, company_id, entry_id, company_account_id, debit, credit, position)
select je.account_id, je.company_id, je.id, ca.id, 1, 0, 1 from public.journal_entry je join public.company_account ca on ca.company_id = je.company_id and ca.code = '43001810'
 where je.concept = 'Prueba: un asiento cojo' and je.company_id = (select v::uuid from _p where clave = 'empresa');

-- ── 1 · Contabilizar valida lo que propone ───────────────────────────────────
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); liq uuid := (select v::uuid from _p where clave = 'oct'); x jsonb; n int; v_q text;
begin
  x := public.compras_liquidacion_confirmar(liq);
  if jsonb_array_length(x->'validados') <> 4 or jsonb_array_length(x->'sinValidar') <> 1 then
    raise exception 'PRUEBA S01p·18·2 · 1: confirmar da %', x;
  end if;
  if x->'sinValidar'->0->>'concepto' <> 'Prueba: un asiento cojo' or x->'sinValidar'->0->>'porque' <> 'Un asiento lleva al menos dos apuntes.' then
    raise exception 'PRUEBA S01p·18·2 · 1: lo que no se valida es %', x->'sinValidar';
  end if;
  select count(*), min(je.validated_by_name) into n, v_q from public.journal_entry je
   where je.company_id = e and je.status = 'validado' and je.number is not null and je.validated_by = (select v::uuid from _p where clave = 'admin')
     and je.id in (select (z->>'id')::uuid from jsonb_array_elements(x->'validados') z);
  if n <> 4 then raise exception 'PRUEBA S01p·18·2 · 1: validados a nombre del administrador, % de 4.', n; end if;
  if (select status from public.journal_entry where concept = 'Prueba: un asiento cojo' and company_id = e) <> 'propuesto' then
    raise exception 'PRUEBA S01p·18·2 · 1: el cojo no queda propuesto.';
  end if;
  if x->>'frase' not like 'Contabilizada. Su factura FV-P1810 queda registrada y 0 recepción(es) del mes, cubiertas. Validados 4 asientos a tu nombre. 1 no se ha podido validar: queda en «Para revisar».' then
    raise exception 'PRUEBA S01p·18·2 · 1: la frase es «%».', x->>'frase';
  end if;
  raise notice '1 · contabilizar: «%» (validados por %: %)', x->>'frase', v_q,
    (select string_agg((z->>'concepto') || ' nº ' || (z->>'numero'), ' · ') from jsonb_array_elements(x->'validados') z);
end $$;
reset role;

-- ── 2 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261112T1915_s01p_contabilizar_valida.down.sql
do $$
declare v_h text := md5(pg_get_functiondef('public._compras_liquidacion_confirmar(uuid,text)'::regprocedure));
begin
  if v_h <> 'bd7e9531adab28949f3ecf00e0b90c5d' then
    raise exception 'PRUEBA S01p·18·2 · 2: la vuelta atrás deja _compras_liquidacion_confirmar con % y la de producción es bd7e9531adab28949f3ecf00e0b90c5d.', v_h;
  end if;
  raise notice '2 · la vuelta atrás: _compras_liquidacion_confirmar con su huella de producción (%)', v_h;
end $$;
\i supabase/migrations/20261112T1915_s01p_contabilizar_valida.sql

rollback;
