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
--       empresa, y para que salga el módulo Despacho.
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

  raise notice 'Semilla K02 OK: % con dos empresas y el núcleo encendido.', correo;
end $$;
