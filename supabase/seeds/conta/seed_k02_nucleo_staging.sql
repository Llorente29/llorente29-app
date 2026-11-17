-- ============================================================================
-- K02 · Una cuenta con el NÚCLEO encendido, para la e2e del marco nuevo.
-- SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/k02/marco.spec.ts (encargo K02, 17/11): el marco del
-- núcleo va detrás del interruptor `conta_nucleo`, por cuenta y apagado de
-- fábrica. Ninguna de las cuentas de prueba de siempre lo tiene (encenderlo en
-- una de ellas cambiaría el marco de todas sus pruebas), así que va en una
-- cuenta propia, con todo inventado:
--
--   nucleo@prueba.folvy.test · «Persona del Núcleo» · administradora de la
--   cuenta «Cuenta de Prueba Núcleo», con la contabilidad, el núcleo,
--   Facturación, Laboral e Impuestos encendidos, y dos empresas:
--     · «Empresa de Ejemplo Núcleo, S.L.» (general), con los ejercicios 2025
--       (cerrado) y 2026 (abierto): para cambiar de ejercicio arriba;
--     · «Gestoría de Ejemplo Núcleo, S.L.» (gestoría): para cambiar de
--       empresa.
--   La cuenta es una ASESORÍA (accounts.tax_advisor_since): así sale el
--   módulo Despacho en todas sus empresas, como lo verá una gestoría
--   (respuesta K02 · 1, arreglo 4).
--   Y, para que la cinta y la línea de estado salgan con número (arreglo 2),
--   en la empresa general: un proveedor inventado con 9 facturas por revisar,
--   y un banco con un extracto sin saldo y 14 movimientos sin casar (9
--   propuestos y 5 por aclarar). Todo inventado (T11): el IBAN, del banco 9999.
--
-- La contraseña NO vive aquí: el carril le pone la de un solo uso de cada
-- ejecución (scripts/e2e/carril/comun.sql la lleva en la lista de la
-- plantilla).
--
-- Solo añade, con fechas fijas: aplicarla dos veces deja lo mismo (W07).
-- Guarda: aborta si al otro lado hay cuentas de producción.
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_user    constant uuid := 'c0e20000-0000-4000-8000-0000000000e1';
  k_emp1    constant uuid := 'c0e20000-0000-4000-8000-0000000000e2';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  correo    constant text := 'nucleo@prueba.folvy.test';
  cuando    constant timestamptz := '2026-11-17 00:00:00+00';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K02 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;

  if not exists (select 1 from auth.users where id = k_user) then
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', k_user, 'authenticated', 'authenticated', correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      cuando, '{"provider":"email","providers":["email"]}', '{}', cuando, cuando, '', '', '', '');
  end if;
  if not exists (select 1 from auth.identities where user_id = k_user) then
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (k_user::text, k_user, jsonb_build_object('sub', k_user::text, 'email', correo, 'email_verified', true), 'email', cuando, cuando, cuando);
  end if;

  insert into public.accounts (id, name, slug, status, business_type, created_at, updated_at)
  values (k_cuenta, 'Cuenta de Prueba Núcleo', 'prueba-nucleo', 'active', 'otra_actividad', cuando, cuando)
  on conflict (id) do nothing;
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at, created_at, updated_at)
  values (k_user, k_cuenta, 'admin', true, 'Persona del Núcleo', cuando, cuando, cuando, cuando)
  on conflict (user_id, account_id) do nothing;
  insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason, created_at, updated_at)
  select k_cuenta, f, true, 'manual_grant', 'K02: cuenta de prueba del núcleo (solo staging).', cuando, cuando
    from unnest(array['conta', 'conta_nucleo', 'conta_facturacion', 'conta_laboral', 'conta_impuestos']) f
   where not exists (select 1 from public.feature_flags x where x.account_id = k_cuenta and x.feature_key = f);

  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at, sector, created_at, updated_at)
  values
    (k_emp1, k_cuenta, 'Empresa de Ejemplo Núcleo, S.L.', 'Ejemplo Núcleo', 'B00000002', 'nif_es', 'company', 'hecho', cuando, 'general', cuando, cuando),
    (k_emp2, k_cuenta, 'Gestoría de Ejemplo Núcleo, S.L.', 'Gestoría Núcleo', 'B00000003', 'nif_es', 'company', 'hecho', cuando, 'gestoria', cuando + interval '1 minute', cuando + interval '1 minute')
  on conflict (id) do nothing;
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
  select e, k_cuenta, 'pymes', 8, array['303', '347', '390']
    from unnest(array[k_emp1, k_emp2]) e
   where not exists (select 1 from public.company_tax_profile t where t.company_id = e);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select k_cuenta, e, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie'
    from unnest(array[k_emp1, k_emp2]) e
   where not exists (select 1 from public.company_account a where a.company_id = e and a.code = '57200001');

  insert into public.fiscal_year (id, account_id, company_id, code, starts_on, ends_on, status, closed_at, created_at)
  values
    ('c0e20000-0000-4000-8000-0000000000f5', k_cuenta, k_emp1, '2025', '2025-01-01', '2025-12-31', 'closed', cuando, cuando),
    ('c0e20000-0000-4000-8000-0000000000f6', k_cuenta, k_emp1, '2026', '2026-01-01', '2026-12-31', 'open', null, cuando),
    ('c0e20000-0000-4000-8000-0000000000f7', k_cuenta, k_emp2, '2026', '2026-01-01', '2026-12-31', 'open', null, cuando)
  on conflict (id) do nothing;

  -- K02 · arreglo 4: la cuenta es una asesoría (Despacho sale en todas sus empresas).
  update public.accounts set tax_advisor_since = date '2026-11-17'
   where id = k_cuenta and tax_advisor_since is distinct from date '2026-11-17';

  -- K02 · arreglo 2: un proveedor con 9 facturas por revisar (en revisión, sin asiento).
  insert into public.supplier (id, account_id, name, legal_name, created_by_name)
  values ('c0e20000-0000-4000-8000-0000000000a0', k_cuenta, 'Distribuciones Ejemplo', 'Distribuciones Ejemplo, S.L.', 'Semilla K02')
  on conflict (id) do nothing;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, source, created_by_name, created_at, updated_at)
  select ('c0e20000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid, k_cuenta, k_emp1, 'c0e20000-0000-4000-8000-0000000000a0',
         'F-2026/04' || lpad((10 + n)::text, 2, '0'), date '2026-10-01' + (n * 4), 'en_revision',
         round(100 + n * 23.17, 2), round((100 + n * 23.17) * 0.21, 2), round((100 + n * 23.17) * 1.21, 2), 'manual', 'Semilla K02', cuando, cuando
    from generate_series(1, 9) n
  on conflict (id) do nothing;

  -- K02 · arreglo 2: un banco, un extracto sin saldo y 14 movimientos sin casar.
  insert into public.treasury_account (id, account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active)
  values ('c0e20000-0000-4000-8000-0000000000b0', k_cuenta, k_emp1, 'bank', 'Banco principal', 'ES7699990000000000000001', '572', true, true)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp1, a.id, 'bank_account', 'c0e20000-0000-4000-8000-0000000000b0', 'principal', 'manual'
    from public.company_account a where a.company_id = k_emp1 and a.code = '57200001'
  on conflict (company_id, entity, entity_id, role) do nothing;
  insert into public.bank_statement (id, account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
    movements_count, new_count, repeated_count, continuity, unchecked_reason, imported_at, imported_by_name)
  values ('c0e20000-0000-4000-8000-0000000000b1', k_cuenta, k_emp1, 'c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'n43', 'extracto-ejemplo.n43',
    date '2026-10-01', date '2026-10-31', 14, 14, 0, 'sin_saldo', 'Semilla K02: extracto sin saldos.', cuando, 'Semilla K02')
  on conflict (id) do nothing;
  insert into public.bank_movement (id, account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
    bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason, created_at, updated_at)
  select ('c0e20000-0000-4000-8000-0000000003' || lpad(n::text, 2, '0'))::uuid, k_cuenta, k_emp1, 'c0e20000-0000-4000-8000-0000000000b0',
         'c0e20000-0000-4000-8000-0000000000b1', date '2026-10-01' + (n * 2), date '2026-10-01' + (n * 2),
         case when n % 3 = 0 then round(45 + n * 11.5, 2) else -round(29.99 + n * 17.3, 2) end,
         'Movimiento de ejemplo ' || n, 'Movimiento de ejemplo ' || n, 'k02-semilla-' || n, 'k02-semilla-suave-' || n,
         case when n <= 9 then 'propuesto' else 'por_aclarar' end,
         case when n <= 9 then 'Semilla K02: propuesto para revisar.' else 'Semilla K02: no sé qué es.' end, cuando, cuando
    from generate_series(1, 14) n
  on conflict (id) do nothing;

  raise notice 'Semilla K02 OK: % con dos empresas y el núcleo encendido.', correo;
end $$;
