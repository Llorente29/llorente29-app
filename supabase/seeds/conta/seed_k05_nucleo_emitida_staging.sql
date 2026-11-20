-- ============================================================================
-- K05 · La ficha de la factura emitida en el núcleo: lo que necesita su e2e
-- (tests/e2e/conta/k05) en la gestoría de la cuenta del núcleo (semilla K02).
-- SOLO STAGING. Todo inventado (T11): NIF con ceros, nombres «de Prueba».
--
-- Solo AÑADE, con ids y fechas fijos: se puede aplicar dos veces igual (W07),
-- y va de verdad desde la rama (W05). Añade lo justo para que el asiento de una
-- emitida salga como en una empresa con su plan:
--
--   · las cuentas de venta 70000000 y 70400000, y el IVA repercutido al 4, 10
--     y 21 % (47700004, 47700010 y 47700021) con su enlace a cada tipo
--     («repercutido», el que lee conta_venta_emitir);
--   · tres clientes, cada uno con su 430 (43000081, 43000082 y 43000083) y su
--     ficha: operaciones interiores, 30 días y el cobro al banco principal de la
--     gestoría (su 57200001, semilla K02). Uno para cada tamaño de la e2e y el
--     tercero para «guarda lo mismo»;
--   · por cada tamaño, una emitida PROPUESTA (la rellenada, por revisar): la
--     K05R-<tamaño>-1, de su cliente, a la 70000000, con su IVA al 21 % en el
--     libro de expedidas. Con las mismas columnas que escribe
--     _journal_entry_proponer, sin validar: validar encadena la huella del
--     libro y eso no es «añadir». Las facturas anteriores de cada cliente (las que dan la duda de
--     la cuenta de venta) las escribe y valida la propia e2e.
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  k_banco   constant uuid := 'c0e20000-0000-4000-8000-0000000000b0';
  cuando    constant timestamptz := '2026-11-19 07:00:00+00';
  v_t record;
  v_c uuid;
  v_n int;
  v_t21 uuid;
  v_y uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K05 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.treasury_account where id = k_banco and company_id = k_emp2 and account_id = k_cuenta) then
    raise exception 'Semilla K05: falta el banco principal de la gestoría del núcleo (seed_k02_nucleo_staging.sql). Aplícala antes.';
  end if;

  -- 1 · Las cuentas de venta, el IVA repercutido y las 430 de los clientes.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values
    (k_cuenta, k_emp2, 'pymes', '70000000', '700', 'Ventas de mercaderías', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '70400000', '704', 'Ventas de envases y embalajes', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47700004', '477', 'IVA repercutido 4 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47700010', '477', 'IVA repercutido 10 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47700021', '477', 'IVA repercutido 21 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '43000081', '4300', 'Clientes · Cliente de Prueba Emitida Uno, S.L.', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '43000082', '4300', 'Clientes · Cliente de Prueba Emitida Dos, S.L.', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '43000083', '4300', 'Clientes · Cliente de Prueba Mismo Asiento, S.L.', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;
  for v_t in select t.id, t.rate from public.tax_rate t
              where t.tax_system = 'iva' and t.is_system and t.valid_to is null and t.treatment = 'taxed' and t.rate in (4, 10, 21) loop
    select id into v_c from public.company_account where company_id = k_emp2 and code = '477000' || lpad(v_t.rate::int::text, 2, '0');
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (k_cuenta, k_emp2, v_c, 'tax_rate', v_t.id::text, 'repercutido', 'serie')
    on conflict (company_id, entity, entity_id, role) do nothing;
    if v_t.rate = 21 then v_t21 := v_t.id; end if;
  end loop;
  if v_t21 is null then raise exception 'Semilla K05: no encuentro el tipo de IVA del 21 %% de serie.'; end if;

  -- 2 · Los clientes: su contacto, su papel, su ficha (30 días, cobro al banco principal) y su 430.
  insert into public.party (id, account_id, name, tax_id, source, created_at, updated_at)
  values
    ('c0e50000-0000-4000-8000-0000000000c1', k_cuenta, 'Cliente de Prueba Emitida Uno, S.L.', 'B00000703', 'manual', cuando, cuando),
    ('c0e50000-0000-4000-8000-0000000000c2', k_cuenta, 'Cliente de Prueba Emitida Dos, S.L.', 'B00000711', 'manual', cuando, cuando),
    ('c0e50000-0000-4000-8000-0000000000c3', k_cuenta, 'Cliente de Prueba Mismo Asiento, S.L.', 'B00000729', 'manual', cuando, cuando)
  on conflict (id) do nothing;
  insert into public.party_role (account_id, party_id, role)
  select k_cuenta, p.id, 'customer' from (values ('c0e50000-0000-4000-8000-0000000000c1'::uuid), ('c0e50000-0000-4000-8000-0000000000c2'), ('c0e50000-0000-4000-8000-0000000000c3')) p(id)
   where not exists (select 1 from public.party_role r where r.party_id = p.id and r.role = 'customer');
  insert into public.customer_fiscal (party_id, account_id, legal_name, country_code, operation_scope, payment_terms_days, collection_treasury_id)
  select p.id, k_cuenta, p.nombre, 'ES', 'domestic', 30, k_banco
    from (values ('c0e50000-0000-4000-8000-0000000000c1'::uuid, 'Cliente de Prueba Emitida Uno, S.L.'), ('c0e50000-0000-4000-8000-0000000000c2', 'Cliente de Prueba Emitida Dos, S.L.'),
                 ('c0e50000-0000-4000-8000-0000000000c3', 'Cliente de Prueba Mismo Asiento, S.L.')) p(id, nombre)
  on conflict (party_id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'customer', p.party, 'principal', 'manual'
    from (values ('43000081', 'c0e50000-0000-4000-8000-0000000000c1'), ('43000082', 'c0e50000-0000-4000-8000-0000000000c2'), ('43000083', 'c0e50000-0000-4000-8000-0000000000c3')) p(codigo, party)
    join public.company_account a on a.company_id = k_emp2 and a.code = p.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;

  -- 3 · Por cada tamaño, la emitida propuesta (la rellenada): K05R-<t>-1, a la 70000000, con su IVA al 21 %.
  -- Con las mismas columnas que escribe _journal_entry_proponer (v04), sin llamarla: así es «añadir» (el
  -- analizador de staging no deja ir de verdad lo que llama a una función), con ids fijos.
  select id into v_y from public.fiscal_year where company_id = k_emp2 and date '2026-10-15' between starts_on and ends_on;
  if v_y is null then raise exception 'Semilla K05: la gestoría no tiene ejercicio para el 15/10/2026 (semilla K02).'; end if;
  for v_t in select t, ('c0e50000-0000-4000-8000-0000000000e' || t)::uuid as entrada, ('c0e50000-0000-4000-8000-0000000000c' || t)::uuid as party,
                    '4300008' || t as c430, 'K05R-' || t || '-1' as numero,
                    'Cliente de Prueba Emitida ' || case t when 1 then 'Uno' else 'Dos' end || ', S.L.' as nombre, (100 + 10 * t)::numeric as base
               from generate_series(1, 2) t loop
    insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status,
                                      confidence, reason, reasons, party_id, document_ref, document_date, created_by_name, created_at)
    values (v_t.entrada, k_cuenta, k_emp2, v_y, 1, date '2026-10-15', 'Factura ' || v_t.numero || ' · ' || v_t.nombre, 'manual', null, 'propuesto',
            'probable', 'Propuesta de la semilla K05 (por revisar).', '[]'::jsonb, v_t.party, v_t.numero, date '2026-10-15', 'Semilla K05', cuando)
    on conflict (id) do nothing;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common,
                                     party_id, document_ref, tax_rate_id, tax_base, vat_book, tax_documents)
    select k_cuenta, k_emp2, v_t.entrada, x.pos, a.id, x.debe, x.haber, x.concepto, true, v_t.party, v_t.numero, x.tipo, x.base, x.libro, 1
      from (values (1, v_t.c430, round(v_t.base * 1.21, 2), 0::numeric, 'Factura ' || v_t.numero, null::uuid, null::numeric, null::text),
                   (2, '70000000', 0::numeric, v_t.base, 'Factura ' || v_t.numero, null::uuid, null::numeric, null::text),
                   (3, '47700021', 0::numeric, round(v_t.base * 0.21, 2), 'IVA factura ' || v_t.numero, v_t21, v_t.base, 'issued')) x(pos, cuenta, debe, haber, concepto, tipo, base, libro)
      join public.company_account a on a.company_id = k_emp2 and a.code = x.cuenta
     where not exists (select 1 from public.journal_line l where l.entry_id = v_t.entrada and l.position = x.pos);
  end loop;

  select count(*) into v_n from public.journal_entry where company_id = k_emp2 and document_ref like 'K05R-%' and status = 'propuesto';
  if v_n <> 2 then raise exception 'Semilla K05: hay % emitidas propuestas de la semilla y tenían que ser 2.', v_n; end if;
  select count(*) into v_n from public.company_account_link where company_id = k_emp2 and entity = 'tax_rate' and role = 'repercutido';
  if v_n < 3 then raise exception 'Semilla K05: solo % tipos de IVA con su repercutido (tenían que ser 3).', v_n; end if;
  raise notice 'Semilla K05 OK: 8 cuentas, % tipos con su repercutido, 3 clientes con su 430 y 2 emitidas propuestas en la gestoría del núcleo.', v_n;
end $$;
