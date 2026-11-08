-- ============================================================================
-- G05 · Un cliente de Folvy con DOS SOCIEDADES DEL MISMO NOMBRE COMERCIAL, de
-- la asesoría de demo del P01. SOLO STAGING. Va después de
-- seed_p01_despacho_staging.sql (usa su asesoría, d5ac…a0).
-- ----------------------------------------------------------------------------
-- Todo inventado (T11): nombres, NIF de sociedad (con su control bien hecho, de
-- nadie conocido) y correos en .test.
--
--   Asadores de Prueba · cuenta de FOLVY (sin product_brand): la gestoría entra
--   y tiene que ver solo Sumied.
--     Asador de Prueba Norte, S.L.  B91000901  nombre comercial «Asador de Prueba»
--     Asador de Prueba Sur, S.L.    B91000919  nombre comercial «Asador de Prueba»
--   g05.asador@g05-prueba.test   Administración del Asador (prueba)   admin
--   Las dos dan permiso a la asesoría de demo.
--
-- Se puede volver a pasar: si ya está, no hace nada.
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla G05 ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if not exists (select 1 from public.accounts where id = 'd5ac0000-0000-4000-8000-0000000000a0') then
    raise exception 'Semilla G05 ABORTADA: falta la asesoría de demo del P01 (seed_p01_despacho_staging.sql).';
  end if;
end $$;

do $$
declare
  v_ase uuid := 'd5ac0000-0000-4000-8000-0000000000a0';
  v_cuenta uuid := '90500000-0000-4000-8000-0000000000c0';
  v_admin uuid := '90500000-0000-4000-8000-0000000000f1';
  r record;
begin
  if exists (select 1 from public.accounts where id = v_cuenta) then return; end if;

  insert into public.accounts (id, name, slug, status, business_type)
  values (v_cuenta, 'Asadores de Prueba', 'g05-asadores-de-prueba', 'active', 'restaurante');

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'g05.asador@g05-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_admin::text, v_admin, jsonb_build_object('sub', v_admin::text, 'email', 'g05.asador@g05-prueba.test', 'email_verified', true), 'email', now(), now(), now());
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (v_admin, v_cuenta, 'admin', true, 'Administración del Asador (prueba)', now(), now());

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
