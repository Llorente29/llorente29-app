-- supabase/staging/sql/20261105_s01p_alquiler_del_mes_prueba.sql
--
-- SOLO STAGING. Prueba del alquiler del mes (1140 y 1141). Todo en una
-- transacción con ROLLBACK, en la empresa de la cuenta A, con arrendadores y
-- cuentas de mentira (NIF de todo ceros). Nombra lo que cambia, para el
-- analizador: conta_esperadas_del_mes, conta_cierre_bloque_repite,
-- recurring_contract, supplier_expected_invoice.
-- El camino entero termina en VALIDAR (regla 10).
--   1. Un alquiler sin factura, con su contrato: el de octubre se propone solo
--      (716,00 + IVA 21 %, sin retención hasta noviembre = 866,36), en su local,
--      y SE VALIDA; el de noviembre, con el 19 % del 115 (730,32), SE VALIDA y
--      su retención entra en el 115 del 4T.
--   2. Una vez por mes: proponer otra vez da el mismo asiento. Antes de
--      «se apunta solo desde», nada. La pasada de cada día no falla.
--   3. «Exento de retención» sin su certificado no se puede marcar.
--   4. Lo que se espera del mes: el alquiler que manda factura se espera; el que
--      se apunta solo, no; el terminado el 30/09, en septiembre sí y en octubre no.
--   5. «Lo que se repite» de octubre: 1 factura de alquiler sin llegar, el que se
--      apunta solo validado, y el terminado el 30/09 dicho (regla 7).
--   6. La vuelta atrás deja las dos funciones con su huella de producción y
--      quita lo nuevo; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p alquiler: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); para validar, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

\i supabase/migrations/20261105T1140_s01p_alquiler_del_mes.sql
\i supabase/migrations/20261105T1141_s01p_alquileres_foodint.sql

create temp table _p (clave text primary key, v uuid) on commit drop;
grant all on _p to authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; loc uuid; x record;
  s1 uuid; s2 uuid; s3 uuid; p1 uuid; k uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p alquiler: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-01' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  select id into loc from public.locations where account_id = v_acc order by id limit 1;
  for x in select * from (values ('62100099', '621'), ('47200099', '472'), ('47510099', '4751'), ('41000099', '4100'), ('41000098', '4100')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p alquiler ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  -- Tres arrendadores de mentira: el 1 se apunta solo, el 2 manda factura, el 3 terminó el 30/09.
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'PRUEBA arrendador 1', '00000000T') returning id into s1;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'PRUEBA arrendador 2', '00000001R') returning id into s2;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'PRUEBA arrendador 3', '00000002W') returning id into s3;
  select id into p1 from public.party where account_id = v_acc and tax_id = '00000000T';
  if p1 is null then insert into public.party (account_id, name, tax_id) values (v_acc, 'PRUEBA arrendador 1', '00000000T') returning id into p1; end if;
  insert into public.company_account_link (account_id, company_id, entity, entity_id, role, source, company_account_id)
  select v_acc, c, 'supplier', s1::text, 'principal', 'manual', a.id from public.company_account a where a.company_id = c and a.code = '41000099';
  insert into public.recurring_contract (account_id, company_id, kind, name, party_id, concept_contains, amount,
                                         expense_account, vat_account, withholding_account, creditor_account,
                                         vat_rate_id, withholding_rate_id, location_id, day_of_month, propose_from, withholding_since, is_active, created_by_name)
  values (v_acc, c, 'alquiler', 'PRUEBA alquiler del local', p1, 'PRUEBA', 716.00, '62100099', '47200099', '47510099', '41000099',
          (select id from public.tax_rate where code = 'iva_general' and rate = 21),
          (select id from public.withholding_rate where code = 'alquiler' and is_system and valid_to is null),
          loc, 1, '2026-10-01', '2026-11-01', true, 'PRUEBA')
  returning id into k;
  insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, cadence, typical_day, label, source, kind, location_id, since, covered_by_recurring_id)
  values (v_acc, c, s1, 'mensual', 1, 'PRUEBA alquiler 1', 'a_mano', 'alquiler', loc, '2026-01-01', k),
         (v_acc, c, s2, 'mensual', 1, 'PRUEBA alquiler 2', 'a_mano', 'alquiler', loc, '2026-01-01', null);
  insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, cadence, typical_day, label, source, kind, location_id, since, ends_on)
  values (v_acc, c, s3, 'mensual', 1, 'PRUEBA alquiler 3', 'a_mano', 'alquiler', loc, '2026-01-01', '2026-09-30');
  insert into _p values ('empresa', c), ('contrato', k), ('s1', s1), ('s2', s2), ('s3', s3), ('local', loc);
end $$;

-- 1 · Octubre sin retención y noviembre con el 19 %: propuestos solos y validados.
do $$
declare c uuid := (select v from _p where clave = 'empresa'); k uuid := (select v from _p where clave = 'contrato');
  v_oct uuid; v_nov uuid; r record; v_err text; d jsonb;
begin
  v_oct := public._conta_alquiler_proponer(k, '2026-10-15');
  select e.entry_date, e.status, e.series, e.reason,
         sum(l.debit) filter (where a.code = '62100099') renta, sum(l.debit) filter (where a.code = '47200099') iva,
         sum(l.credit) filter (where a.code = '47510099') ret, sum(l.credit) filter (where a.code = '41000099') arr,
         bool_and(l.location_id = (select v from _p where clave = 'local')) en_su_local,
         bool_or(l.vat_book = 'received' and l.tax_base = 716.00) libro
    into r from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
   where e.id = v_oct group by e.entry_date, e.status, e.series, e.reason;
  if r.entry_date <> '2026-10-01' or r.status <> 'propuesto' or r.series <> 2 or r.renta <> 716.00 or r.iva <> 150.36 or r.ret is not null
     or r.arr <> 866.36 or not r.en_su_local or not r.libro or r.reason !~ 'Falta el contrato' then
    raise exception 'PRUEBA S01p alquiler · 1: octubre no sale como toca (%).', row_to_json(r);
  end if;
  perform public.journal_entry_validar(v_oct, 'PRUEBA D');
  if (select status from public.journal_entry where id = v_oct) <> 'validado' then raise exception 'PRUEBA S01p alquiler · 1: octubre no queda validado.'; end if;

  v_nov := public._conta_alquiler_proponer(k, '2026-11-01');
  select sum(l.credit) filter (where a.code = '47510099') ret, sum(l.credit) filter (where a.code = '41000099') arr,
         bool_or(l.withholding_model = '115' and l.withholding_base = 716.00 and l.withholding_rate_id is not null) con_115
    into r from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_nov;
  if r.ret <> 136.04 or r.arr <> 730.32 or not r.con_115 then raise exception 'PRUEBA S01p alquiler · 1: noviembre no sale como toca (%).', row_to_json(r); end if;
  perform public.journal_entry_validar(v_nov, 'PRUEBA D');
  if (select status from public.journal_entry where id = v_nov) <> 'validado' then raise exception 'PRUEBA S01p alquiler · 1: noviembre no queda validado.'; end if;
  d := public.conta_impuesto_retenciones_diario(c, 2026, '4T');
  if strpos(d::text, v_nov::text) = 0 then raise exception 'PRUEBA S01p alquiler · 1: la retención de noviembre no entra en el 115 del 4T: %', left(d::text, 300); end if;
  insert into _p values ('oct', v_oct), ('nov', v_nov);
  raise notice 'PRUEBA S01p alquiler · 1 en verde: octubre 866,36 (sin retención) y noviembre 730,32 (136,04 del 115), propuestos solos y validados.';
end $$;

-- 2 · Una vez por mes; nada antes de «se apunta solo desde»; la pasada no falla.
do $$
declare k uuid := (select v from _p where clave = 'contrato'); n int;
begin
  if public._conta_alquiler_proponer(k, '2026-10-20') is distinct from (select v from _p where clave = 'oct') then
    raise exception 'PRUEBA S01p alquiler · 2: proponer octubre otra vez no da el mismo asiento.';
  end if;
  if public._conta_alquiler_proponer(k, '2026-09-01') is not null then raise exception 'PRUEBA S01p alquiler · 2: propone septiembre, antes de «se apunta solo desde».'; end if;
  perform public._conta_alquileres_proponer_todas();
  select count(*) into n from public.journal_entry e join public.recurring_contract_month m on m.id = e.source_id
   where e.source_type = 'manual' and m.contract_id = k and e.status <> 'anulado' and e.entry_date between '2026-10-01' and '2026-11-30';
  if n <> 2 then raise exception 'PRUEBA S01p alquiler · 2: hay % apuntes de octubre y noviembre, no 2.', n; end if;
  raise notice 'PRUEBA S01p alquiler · 2 en verde: uno por mes, nada en septiembre, y la pasada de cada día no falla.';
end $$;

-- 3 · Exento solo con su certificado.
do $$
declare k uuid := (select v from _p where clave = 'contrato');
begin
  begin
    update public.recurring_contract set withholding_exempt = true where id = k;
    raise exception 'PRUEBA S01p alquiler · 3: se marca exento sin su certificado.';
  exception when check_violation then null;
  end;
  update public.recurring_contract set withholding_exempt = true, exempt_document_name = 'certificado.pdf', exempt_document_uploaded_at = now() where id = k;
  update public.recurring_contract set withholding_exempt = false, exempt_document_name = null, exempt_document_uploaded_at = null where id = k;
  raise notice 'PRUEBA S01p alquiler · 3 en verde: «exento de retención» no se marca sin su certificado.';
end $$;

-- 4 · Lo que se espera del mes.
do $$
declare c uuid := (select v from _p where clave = 'empresa'); v_oct text[]; v_sep text[];
begin
  select array_agg(n.supplier_id::text) into v_oct from public.conta_esperadas_del_mes(c, '2026-10-01') n;
  select array_agg(n.supplier_id::text) into v_sep from public.conta_esperadas_del_mes(c, '2026-09-01') n;
  if not (select v from _p where clave = 's2')::text = any (v_oct) then raise exception 'PRUEBA S01p alquiler · 4: el que manda factura no se espera en octubre.'; end if;
  if (select v from _p where clave = 's1')::text = any (coalesce(v_oct, '{}')) then raise exception 'PRUEBA S01p alquiler · 4: al que se apunta solo se le pide factura.'; end if;
  if (select v from _p where clave = 's3')::text = any (coalesce(v_oct, '{}')) then raise exception 'PRUEBA S01p alquiler · 4: el terminado el 30/09 se pide en octubre.'; end if;
  if not (select v from _p where clave = 's3')::text = any (v_sep) then raise exception 'PRUEBA S01p alquiler · 4: el terminado el 30/09 ya no se pide en septiembre.'; end if;
  raise notice 'PRUEBA S01p alquiler · 4 en verde: se espera el que manda factura; ni el que se apunta solo ni el terminado (en septiembre, sí).';
end $$;

-- 5 · «Lo que se repite» de octubre.
do $$
declare c uuid := (select v from _p where clave = 'empresa'); b jsonb; t text;
begin
  b := public.conta_cierre_bloque_repite(c, '2026-10-01');
  t := b::text;
  if (b->'cifras'->>'alquileres_sin_llegar')::int is distinct from 1 and strpos(t, '"alquileres_sin_llegar": 1') = 0 then
    raise exception 'PRUEBA S01p alquiler · 5: no cuenta 1 factura de alquiler sin llegar: %', left(t, 600);
  end if;
  if strpos(t, '1 factura de alquiler sin llegar') = 0 or strpos(t, '1 alquiler del mes, validado') = 0
     or strpos(t, '1 alquiler terminado el 30/09: no se pide') = 0 or strpos(t, 'terminado el 30/09/2026: no se pide') = 0 then
    raise exception 'PRUEBA S01p alquiler · 5: «Lo que se repite» no lo dice como toca: %', left(t, 900);
  end if;
  raise notice 'PRUEBA S01p alquiler · 5 en verde: 1 factura de alquiler sin llegar, el que se apunta solo validado y el terminado dicho.';
end $$;

-- 6 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261105T1141_s01p_alquileres_foodint.down.sql
-- Los datos de mentira de la prueba usan las columnas nuevas: fuera antes de quitarlas.
delete from public.recurring_contract where id = (select v from _p where clave = 'contrato');
update public.supplier_expected_invoice set covered_by_recurring_id = null where covered_by_recurring_id = (select v from _p where clave = 'contrato');
\i supabase/vuelta-atras/20261105T1140_s01p_alquiler_del_mes.down.sql
do $$
declare x record;
begin
  for x in select * from (values
      ('public.conta_esperadas_del_mes(uuid,date)', '6bbd127117216fe53c544e2f122c874c'),
      ('public.conta_cierre_bloque_repite(uuid,date)', 'fccd3f504820e4ac231944a7eef677a8')) v(f, h) loop
    -- La base local va por detrás de producción en la de «Lo que se repite»: allí no se compara la huella.
    if md5(pg_get_functiondef(x.f::regprocedure)) <> x.h and current_database() <> 'staging_local' then
      raise exception 'PRUEBA S01p alquiler · 6: % no vuelve a su huella de producción.', x.f;
    end if;
  end loop;
  if to_regprocedure('public._conta_alquiler_proponer(uuid,date)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'recurring_contract' and column_name = 'propose_from')
     or exists (select 1 from information_schema.columns where table_name = 'supplier_expected_invoice' and column_name = 'ends_on')
     or to_regclass('public.recurring_contract_month') is not null then
    raise exception 'PRUEBA S01p alquiler · 6: queda algo de lo nuevo.';
  end if;
  raise notice 'PRUEBA S01p alquiler · 6 en verde: las dos funciones vuelven a su huella de producción y lo nuevo se va.';
end $$;
\i supabase/migrations/20261105T1140_s01p_alquiler_del_mes.sql
do $$ begin
  if to_regprocedure('public._conta_alquiler_proponer(uuid,date)') is null then raise exception 'PRUEBA S01p alquiler · 6: no vuelve delante.'; end if;
  raise notice 'PRUEBA S01p alquiler · 6: y otra vez delante, bien.';
end $$;

rollback;
