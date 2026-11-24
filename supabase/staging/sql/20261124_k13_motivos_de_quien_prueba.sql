-- supabase/staging/sql/20261124_k13_motivos_de_quien_prueba.sql
--
-- SOLO STAGING. Prueba del K13 (20261124T0720): conta_motivos_para_validar ya no llama a la interna _conta_de_quien.
-- Todo en una transacción con ROLLBACK: staging no cambia. Nombra el objeto que cambia: public.conta_motivos_para_validar.
--
-- El camino, como la línea de estado (regla 10): en la empresa del núcleo (semilla K02), una recibida leída con su
-- asiento propuesto (inventados, T11); como su usuario:
--   1. conta_motivos_para_validar de ese asiento contesta (antes: «permission denied for function _conta_de_quien»);
--   2. conta_esperan de la empresa contesta;
--   3. conta_pendientes cuenta los asientos (un número, no null: la línea de estado dice «Asientos al día» o cuántos).
--   4. La vuelta atrás, sobre los mismos datos: la función de antes, y el contador vuelve a no poder contar (null).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K13 motivos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'public._conta_de_quien(') > 0 then
    raise exception 'PRUEBA K13 motivos · 0: falta la 20261124T0720 (conta_motivos_para_validar sigue llamando a _conta_de_quien).';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e2'; v_y uuid;
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f15000-0000-4000-8000-0000000000a1', a, 'Proveedor de Prueba K13 Motivos, S.L.', 'B00015015', 'ES', 'general');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, reading, created_at)
  values ('c0f15000-0000-4000-8000-0000000000f1', a, emp, 'c0f15000-0000-4000-8000-0000000000a1', 'invoice', 'K13-MOTIVOS', date '2026-11-05',
          'en_revision', 'ocr', 100, 21, 121, true, 'prueba K13',
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', 'Proveedor de Prueba K13 Motivos, S.L.', 'nif', 'B00015015'),
                                                           'destinatario', jsonb_build_object('nombre', 'Otra de Prueba K13, S.L.', 'nif', 'B00015023'))),
          timestamptz '2026-11-05 10:00+01');
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-05' between starts_on and ends_on;
  if v_y is null then raise exception 'PRUEBA K13 motivos: la empresa del núcleo no tiene ejercicio 2026 (semilla K02).'; end if;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason)
  values ('c0f15000-0000-4000-8000-0000000000e1', a, emp, v_y, 2, '2026-11-05', 'K13-MOTIVOS', 'supplier_invoice', 'c0f15000-0000-4000-8000-0000000000f1',
          'propuesto', 'probable', 'Prueba K13');
  -- Y un borrador a mano: con algo que contar, conta_pendientes lee «las que esperan» (conta_esperan), que pasa por
  -- los motivos de cada asiento, también el de la recibida (así se ve el fallo en la gestoría del núcleo).
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values ('c0f15000-0000-4000-8000-0000000000e2', a, emp, v_y, 1, '2026-11-05', 'K13-MOTIVOS borrador', 'manual', 'borrador');
end $$;

create or replace function pg_temp.k13_contar() returns jsonb language sql as $$
  select public.conta_pendientes('c0e20000-0000-4000-8000-0000000000e2')
$$;
grant execute on function pg_temp.k13_contar() to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int; v jsonb;
begin
  select count(*) into n from public.conta_motivos_para_validar('c0f15000-0000-4000-8000-0000000000e1');
  raise notice 'PRUEBA K13 motivos · 1: conta_motivos_para_validar contesta (% motivos).', n;
  select count(*) into n from public.conta_esperan('c0e20000-0000-4000-8000-0000000000e2', date '1900-01-01', date '2999-12-31');
  raise notice 'PRUEBA K13 motivos · 2: conta_esperan contesta (% esperan).', n;
  v := pg_temp.k13_contar();
  if jsonb_typeof(v -> 'asientos_por_validar') is distinct from 'number' then
    raise exception 'PRUEBA K13 motivos · 3: los asientos no se pueden contar (%)', v -> 'asientos_por_validar';
  end if;
  raise notice 'PRUEBA K13 motivos · 3: conta_pendientes cuenta % asientos por validar.', v -> 'asientos_por_validar';
end $$;
reset role;

-- 4 · La vuelta atrás, sobre los mismos datos.
\i supabase/vuelta-atras/20261124T0720_k13_motivos_de_quien.down.sql
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb;
begin
  if strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'public._conta_de_quien(') = 0 then
    raise exception 'PRUEBA K13 motivos · 4: después de la vuelta atrás, la función sigue siendo la nueva';
  end if;
  v := pg_temp.k13_contar();
  if v -> 'asientos_por_validar' is not null and jsonb_typeof(v -> 'asientos_por_validar') <> 'null' then
    raise exception 'PRUEBA K13 motivos · 4: con la función de antes, los asientos se cuentan (%): la prueba no mide el fallo', v -> 'asientos_por_validar';
  end if;
  raise notice 'PRUEBA K13 motivos · 4: vuelta atrás: la función de antes, y los asientos vuelven a no poder contarse (el fallo que arregla).';
end $$;
reset role;

rollback;
