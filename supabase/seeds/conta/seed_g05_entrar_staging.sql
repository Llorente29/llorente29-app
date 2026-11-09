-- ============================================================================
-- G05 · Una gestoría de demo con un cliente de Folvy con DOS SOCIEDADES DEL
-- MISMO NOMBRE COMERCIAL. SOLO STAGING. Su propia gestoría, para no cambiar
-- los 8 clientes de la asesoría del P01 (su semilla y su e2e los cuentan).
-- ----------------------------------------------------------------------------
-- Todo inventado (T11): nombres, NIF de sociedad (con su control bien hecho, de
-- nadie conocido) y correos en .test.
--
--   Gestoría de Prueba G05 · marca Sumied · «Soy una asesoría»
--     g05.gestora@g05-prueba.test   Gestora de Prueba G05   administración
--   Asadores de Prueba · cuenta de FOLVY (sin product_brand): la gestoría entra
--   y tiene que ver solo Sumied.
--     Asador de Prueba Norte, S.L.  B91000901  nombre comercial «Asador de Prueba»
--     Asador de Prueba Sur, S.L.    B91000919  nombre comercial «Asador de Prueba»
--   g05.asador@g05-prueba.test   Administración del Asador (prueba)   admin
--   Las dos dan permiso a la Gestoría de Prueba G05.
--
-- Se puede volver a pasar: si ya está, no hace nada.
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla G05 ABORTADA: al otro lado hay cuentas de producción.';
  end if;
end $$;

do $$
declare
  v_ase uuid := '90500000-0000-4000-8000-0000000000a0';
  v_gestora uuid := '90500000-0000-4000-8000-0000000000a1';
  v_cuenta uuid := '90500000-0000-4000-8000-0000000000c0';
  v_admin uuid := '90500000-0000-4000-8000-0000000000f1';
  r record;
begin
  if exists (select 1 from public.accounts where id = v_cuenta) then return; end if;

  insert into public.accounts (id, name, slug, status, business_type, product_brand, tax_advisor_since)
  values (v_ase, 'Gestoría de Prueba G05', 'g05-gestoria-de-prueba', 'active', 'otra_actividad', 'sumied', now() - interval '30 days');
  insert into public.accounts (id, name, slug, status, business_type)
  values (v_cuenta, 'Asadores de Prueba', 'g05-asadores-de-prueba', 'active', 'restaurante');

  for r in select * from (values
      (v_gestora, v_ase, 'g05.gestora@g05-prueba.test', 'Gestora de Prueba G05'),
      (v_admin, v_cuenta, 'g05.asador@g05-prueba.test', 'Administración del Asador (prueba)')) v(id, cuenta, correo, nombre) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', r.correo, 'email_verified', true), 'email', now(), now(), now());
    insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
    values (r.id, r.cuenta, 'admin', true, r.nombre, now(), now());
  end loop;

  for r in select * from (values
      ('90500000-0000-4000-8000-0000000000e1'::uuid, 'Asador de Prueba Norte, S.L.', 'B91000901', '1', '#B4532A'),
      ('90500000-0000-4000-8000-0000000000e2'::uuid, 'Asador de Prueba Sur, S.L.', 'B91000919', '2', '#2F6B4F')) v(id, razon, nif, n, color) loop
    insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
      fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
      setup_step, setup_completed_at, is_hospitality, color)
    values (r.id, v_cuenta, r.razon, 'Asador de Prueba', r.nif, 'nif_es', 'company',
      'Calle', 'del Asador de Prueba', r.n, '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), true, r.color);
    insert into public.company_tax_profile (company_id, account_id, vat_period, sii, vat_prorata, vat_prorata_pct, chart_kind, account_digits, tax_forms)
    values (r.id, v_cuenta, 'quarterly', false, false, null, 'pymes', 8, '{}');
    insert into public.company_tax_presenter (company_id, account_id, mode, advisor_account_id, advisor_basis,
                                             consented_by, consented_by_name, consented_at, since)
    values (r.id, v_cuenta, 'advisor', v_ase, 'social_collaborator', v_admin, 'Administración del Asador (prueba)', now() - interval '10 days', current_date - 10);
  end loop;
end $$;
