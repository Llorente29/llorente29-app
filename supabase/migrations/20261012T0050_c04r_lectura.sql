-- ============================================================================
-- C04 R4 · LO QUE LEEN LOS AGENTES, para conta_lectura (primero de la tanda)
-- ----------------------------------------------------------------------------
-- El ensayo de la tanda C04 R4 paró en «Antes · D1, salud del pedido y
-- agentes»: «agente-libro.sql:144: permission denied for table sale». El
-- agente «Libro diario» (C04) lee tablas que nadie dio a conta_lectura.
--
-- La lista NO es de memoria: sale de los cuatro SQL con los que los agentes
-- leen la base como conta_lectura (scripts/conta/agente-datos-maestros.sql,
-- agente-terceros.sql, agente-libro.sql y agente-plan-contable.sql; los
-- workflows de producción no corren otros; «Normativa al día» no lee la
-- base). Se sacaron todos sus identificadores y se preguntó a
-- producción (pg_class / pg_proc, 08/10, solo lectura) cuáles son tablas o
-- funciones de public, y qué tiene ya conta_lectura:
--   · 37 tablas: 33 ya con SELECT; FALTAN 4, todas del agente del libro:
--     sale, supplier_invoice, fiscal_period_lock y brand.
--   · 2 funciones: journal_entry_canonico y journal_huella, las dos ya con EXECUTE.
-- Aquí se dan las 37 y las 2 (lo que ya tiene no cambia: GRANT es idempotente)
-- para que el fichero diga entero qué lee el rol, y la prueba de staging
-- (supabase/staging/sql/20261012_c04r_prueba_lectura.sql) pasa cada agente
-- con este rol y FALLA si falta un permiso.
--
-- Solo SELECT y EXECUTE de lectura. Nada de escritura: conta_lectura sigue
-- siendo de solo lectura (default_transaction_read_only) y la guarda del
-- nocturno lo comprueba.
-- En staging el rol no existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261012T0050_c04r_lectura.down.sql
-- (quita SOLO las 4 que faltaban; las demás las dieron ficheros anteriores).
-- ============================================================================

do $$
declare
  t text; faltan text := ''; n int := 0;
  tablas constant text[] := array[
    -- Datos maestros e impuestos (C00).
    'tax_rate', 'withholding_rate', 'payment_method', 'payment_term', 'entry_text', 'expense_category',
    'vat_scheme', 'tax_form', 'legal_form', 'vat_category_tax', 'country', 'currency', 'iae_heading', 'cnae_code',
    'company', 'company_tax_profile', 'company_activity', 'company_person', 'fiscal_year', 'vat_category', 'supplier',
    -- Plan contable (C02, C02c).
    'pgc_account', 'company_account', 'company_account_link', 'company_chart_import',
    -- Terceros (C03).
    'party', 'party_role', 'customer_fiscal', 'channel_settlement',
    -- Libro diario (C04): las cuatro primeras son las que faltaban.
    'sale', 'supplier_invoice', 'fiscal_period_lock', 'brand',
    'journal_entry', 'journal_line', 'sales_day_summary', 'allocation_rule'];
begin
  if not exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise notice 'conta_lectura no existe aquí (staging): no se da nada.';
    return;
  end if;
  grant usage on schema public to conta_lectura;
  foreach t in array tablas loop
    if to_regclass('public.' || t) is null then
      faltan := faltan || ' ' || t;
    else
      execute format('grant select on table public.%I to conta_lectura', t);
      n := n + 1;
    end if;
  end loop;
  grant execute on function public.journal_entry_canonico(uuid) to conta_lectura;
  grant execute on function public.journal_huella(text, text) to conta_lectura;
  if faltan <> '' then
    raise exception 'conta_lectura: no existen%; los agentes las leen y fallarían. PARA.', faltan;
  end if;
  raise notice 'conta_lectura lee las % tablas y las 2 funciones de los agentes.', n;
end $$;
