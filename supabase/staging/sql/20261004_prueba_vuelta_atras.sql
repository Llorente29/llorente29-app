-- ============================================================================
-- SOLO STAGING-CONTA · PRUEBA DE LAS VUELTAS ATRÁS (respuesta 7 del C00)
-- ----------------------------------------------------------------------------
-- Cada fichero de la tanda de producción que altera algo de Cocina lleva su
-- vuelta atrás (supabase/vuelta-atras/). Aquí se prueban, de verdad, sobre
-- staging-conta, y AL FINAL SE DESHACE TODO (rollback): staging queda igual.
--
--   1. Las guardas: con datos del C01 (staging los tiene), la vuelta atrás de
--      la T0100 PARA y dice qué perdería; con un related_party_kind puesto, la
--      de la 0110 también.
--   2. Se vacían, dentro de esta transacción, los datos del C01.
--   3. Las tres vueltas atrás, en orden: 0140, 0110 (C00), T0100 (C01).
--   4. Comprobación: supplier, supplier_invoice y compliance_document quedan
--      como en PRODUCCIÓN (leído el 04/10 en solo lectura) y vat_rate_for lee
--      de vat_rate. D1: entre la función nueva y la vieja, ninguna diferencia
--      salvo la decidida (2 % de los básicos en 4T2024).
--   5. Ida otra vez: las tres migraciones se vuelven a aplicar y todo queda como
--      antes de empezar (D1 idéntica a la primera foto).
--   6. rollback.
--
-- La corre el workflow de staging con psql -1 y ON_ERROR_STOP: cualquier
-- comprobación que falle aborta y lo dice. Las guardas se prueban con
-- ON_ERROR_STOP apagado un momento, dentro de un savepoint.
-- ============================================================================

\set ON_ERROR_STOP 1

-- 0 · La primera foto de D1, con la función de ahora (la de la 0140).
create temp table d1_inicio as
select c.code, d::date as dia, f.rate, f.equivalence_surcharge
  from public.vat_category c
 cross join generate_series(date '2024-01-01', date '2026-12-31', interval '1 day') d
  left join lateral public.vat_rate_for(c.id, d::date) f on true;

-- 1 · Las guardas paran con datos.
savepoint guarda_t0100;
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261002T0100_c01_ficha_proveedor_estructura.down.guarda.sql
\set ON_ERROR_STOP 1
rollback to savepoint guarda_t0100;
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS T0100 (C01): hay datos que se perderían%') as guarda_t0100_ok \gset
\echo 'Guarda T0100 dijo:' :'LAST_ERROR_MESSAGE'
\if :guarda_t0100_ok
\else
  do $$ begin raise exception 'PRUEBA: la guarda de la T0100 NO ha parado con datos del C01.'; end $$;
\endif

savepoint guarda_0110;
update public.supplier set related_party_kind = 'group'
 where id = (select id from public.supplier order by id limit 1);
\set ON_ERROR_STOP 0
\ir ../../vuelta-atras/20261003T0110_c00_empresa.down.guarda.sql
\set ON_ERROR_STOP 1
rollback to savepoint guarda_0110;
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0110 (C00): %proveedores tienen related_party_kind puesto%') as guarda_0110_ok \gset
\echo 'Guarda 0110 dijo:' :'LAST_ERROR_MESSAGE'
\if :guarda_0110_ok
\else
  do $$ begin raise exception 'PRUEBA: la guarda de la 0110 NO ha parado con un related_party_kind puesto.'; end $$;
\endif

-- 2 · Fuera, dentro de esta transacción, los datos del C01 (para que las guardas dejen pasar).
delete from public.supplier_invoice_payment_log;
delete from public.supplier_proposal;
delete from public.supplier_contact;
delete from public.compliance_document where doc_family = 'bank_ownership_certificate';
update public.supplier_invoice set due_date = null, due_date_set_by = null, due_date_set_name = null, due_date_set_at = null,
       paid_at = null, paid_method = null, paid_by = null, paid_by_name = null
 where due_date is not null or paid_at is not null or paid_method is not null or due_date_set_at is not null;
update public.supplier set legal_name = null, tax_id_type = null, entity_kind = null, tax_id_verified_at = null,
       tax_id_check_status = null, tax_id_checked_at = null, fiscal_street = null, fiscal_postal_code = null,
       fiscal_city = null, fiscal_province = null, vat_regime = null, usual_vat_rates = '{}', irpf_withholding_pct = null,
       expense_category_id = null, default_location_id = null, payment_method = null, payment_terms_days = null,
       payment_fixed_days = '{}', iban = null, iban_verified_at = null, bank_name = null, ledger_account_code = null,
       website = null, tags = '{}', bic = null, sepa_mandate_ref = null, sepa_mandate_date = null, country_code = 'ES',
       currency = 'EUR', early_payment_discount_pct = null, related_party_kind = null;

-- 3 · Las tres vueltas atrás, al revés de como se aplican.
\ir ../../vuelta-atras/20261003T0140_c00_vat_rate_lee_de_impuestos.down.sql
\ir ../../vuelta-atras/20261003T0110_c00_empresa.down.sql
\ir ../../vuelta-atras/20261002T0100_c01_ficha_proveedor_estructura.down.sql

-- 4 · Como en producción.
do $$
declare
  nuevas_sup constant text[] := array['legal_name','tax_id_type','country_code','entity_kind','tax_id_verified_at',
    'tax_id_check_status','tax_id_checked_at','fiscal_street','fiscal_postal_code','fiscal_city','fiscal_province',
    'vat_regime','usual_vat_rates','irpf_withholding_pct','expense_category_id','default_location_id','payment_method',
    'payment_terms_days','payment_fixed_days','iban','iban_verified_at','bank_name','ledger_account_code','website','tags',
    'bic','sepa_mandate_ref','sepa_mandate_date','currency','early_payment_discount_pct','related_party_kind'];
  nuevas_si constant text[] := array['due_date','due_date_set_by','due_date_set_name','due_date_set_at','paid_at',
    'paid_method','paid_by','paid_by_name'];
  quedan text; n_dif int; n_decididas int;
begin
  select string_agg(table_name || '.' || column_name, ', ') into quedan
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'supplier' and column_name = any (nuevas_sup))
       or (table_name = 'supplier_invoice' and column_name = any (nuevas_si)));
  if quedan is not null then raise exception 'PRUEBA: quedan columnas nuevas: %', quedan; end if;

  if to_regclass('public.supplier_contact') is not null or to_regclass('public.supplier_proposal') is not null
     or to_regclass('public.supplier_invoice_payment_log') is not null then
    raise exception 'PRUEBA: quedan tablas del C01.';
  end if;
  if to_regprocedure('public.mark_supplier_invoice_paid(uuid,date,text)') is not null
     or to_regprocedure('public.refresh_supplier_proposals(uuid)') is not null then
    raise exception 'PRUEBA: quedan funciones del C01.';
  end if;
  if to_regclass('public.expense_category') is null then
    raise exception 'PRUEBA: expense_category se ha ido, y la usa el C00.';
  end if;

  if pg_get_constraintdef((select oid from pg_constraint where conname = 'compliance_document_doc_family_check'))
     <> $c$CHECK ((doc_family = ANY (ARRAY['food_spec'::text, 'chemical_spec'::text, 'chemical_sds'::text, 'pest_contract'::text, 'pest_spec'::text, 'water_analysis'::text, 'oil_manager'::text, 'supplier_approval'::text, 'other'::text])))$c$ then
    raise exception 'PRUEBA: la restricción de doc_family no es la de producción: %',
      pg_get_constraintdef((select oid from pg_constraint where conname = 'compliance_document_doc_family_check'));
  end if;

  if pg_get_functiondef('public.vat_rate_for(uuid,date)'::regprocedure) not like '%FROM public.vat_rate r%'
     or (select proconfig from pg_proc where oid = 'public.vat_rate_for(uuid,date)'::regprocedure) is not null
     or obj_description('public.vat_rate'::regclass, 'pg_class') is not null then
    raise exception 'PRUEBA: vat_rate_for no ha vuelto a ser la de producción.';
  end if;

  -- D1: la vieja contra la nueva. Solo la diferencia decidida.
  with ahora as (
    select c.code, d::date as dia, f.rate, f.equivalence_surcharge
      from public.vat_category c
     cross join generate_series(date '2024-01-01', date '2026-12-31', interval '1 day') d
      left join lateral public.vat_rate_for(c.id, d::date) f on true
  )
  select count(*) filter (where not (a.code = 'alimento_basico' and a.dia between '2024-10-01' and '2024-12-31'
                                     and a.rate is null and i.rate = 2 and i.equivalence_surcharge = 0.26)),
         count(*) filter (where a.code = 'alimento_basico' and a.dia between '2024-10-01' and '2024-12-31'
                                and a.rate is null and i.rate = 2 and i.equivalence_surcharge = 0.26)
    into n_dif, n_decididas
    from ahora a join d1_inicio i using (code, dia)
   where (a.rate, a.equivalence_surcharge) is distinct from (i.rate, i.equivalence_surcharge);
  if n_dif <> 0 then raise exception 'PRUEBA: D1 entre la función vieja y la nueva da % diferencias no decididas.', n_dif; end if;
  raise notice 'PRUEBA vuelta atrás: como en producción. D1 vieja ↔ nueva: 0 diferencias no decididas, % decididas (2 %% de 4T2024).', n_decididas;
end $$;

-- 5 · Y otra vez adelante: las tres migraciones, como irán a producción.
\ir ../../migrations/20261002T0100_c01_ficha_proveedor_estructura.sql
\ir ../../migrations/20261003T0110_c00_empresa.sql
\ir ../../migrations/20261003T0140_c00_vat_rate_lee_de_impuestos.sql

do $$
declare n int;
begin
  select count(*) into n
    from (select c.code, d::date as dia, f.rate, f.equivalence_surcharge
            from public.vat_category c
           cross join generate_series(date '2024-01-01', date '2026-12-31', interval '1 day') d
            left join lateral public.vat_rate_for(c.id, d::date) f on true) a
    full join d1_inicio i using (code, dia)
   where (a.rate, a.equivalence_surcharge) is distinct from (i.rate, i.equivalence_surcharge);
  if n <> 0 then raise exception 'PRUEBA: después de volver a aplicar, D1 no es la del principio (% diferencias).', n; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier'
       and column_name in ('legal_name', 'iban', 'related_party_kind')) <> 3 then
    raise exception 'PRUEBA: al volver a aplicar no han vuelto las columnas de supplier.';
  end if;
  if to_regclass('public.supplier_contact') is null then raise exception 'PRUEBA: al volver a aplicar no ha vuelto supplier_contact.'; end if;
  raise notice 'PRUEBA ida y vuelta: OK. Las vueltas atrás dejan producción como estaba y las migraciones vuelven a entrar.';
end $$;

-- 6 · Nada de esto se queda: staging, igual que antes.
rollback;
