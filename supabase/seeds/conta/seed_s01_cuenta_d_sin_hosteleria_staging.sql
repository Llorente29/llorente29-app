-- ============================================================================
-- S01 · Una CUENTA D de prueba, SIN HOSTELERÍA. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Julio (17/10, respuesta 1 del paso 1): una cuenta nueva, sin locales,
-- canales ni marcas, para probar que en una empresa que no es de hostelería no
-- sale nada de hostelería. B se queda como está (la usa el reparto, R02).
--
--   d.admin@prueba.folvy.test · cuenta D «Asesoría de Prueba Oeste» · admin
--
-- Es una cuenta de Folvy de las de siempre (sin product_brand: el esqueleto es
-- el mismo para las dos marcas), de otra actividad, con el interruptor `conta`
-- y una empresa con el alta terminada, su plan (pymes, 8 dígitos), su banco y
-- la marca de hostelería en NO, puesta a mano: es la marca, y no los datos,
-- lo que decide (si la columna aún no existe, la pone la 0110 por la
-- actividad, y también queda en no).
--
-- La contraseña NO vive aquí: se crea con una al azar que nadie conoce, y el
-- workflow e2e le pone la de un solo uso de cada ejecución (carril.sh).
--
-- Guardas: aborta si al otro lado hay cuentas de producción, o si ya está.
-- ============================================================================

do $$
declare
  d_cuenta  constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  d_user    constant uuid := 'c01d0000-0000-4000-8000-0000000000d1';
  d_empresa constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  correo    constant text := 'd.admin@prueba.folvy.test';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla S01 cuenta D ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if exists (select 1 from public.accounts where id = d_cuenta) or exists (select 1 from auth.users where id = d_user or email = correo) then
    raise notice 'Semilla S01 cuenta D: ya está cargada.';
    return;
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', d_user, 'authenticated', 'authenticated', correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (d_user::text, d_user, jsonb_build_object('sub', d_user::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());

  insert into public.accounts (id, name, slug, status, business_type)
  values (d_cuenta, 'Asesoría de Prueba Oeste', 'prueba-oeste', 'active', 'otra_actividad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (d_user, d_cuenta, 'admin', true, 'Admin Oeste', now(), now());
  insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
  values (d_cuenta, 'conta', true, 'manual_grant', 'S01: cuenta de prueba sin hostelería (solo staging).');

  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values (d_empresa, d_cuenta, 'Asesoría de Prueba Oeste, S.L.', 'Asesoría Oeste', 'B12345682', 'nif_es', 'company', 'hecho', now());
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
  values (d_empresa, d_cuenta, 'pymes', 8, array['303', '347', '390']);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (d_cuenta, d_empresa, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');

  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'is_hospitality') then
    execute 'update public.company set is_hospitality = false where id = $1 and account_id = $2' using d_empresa, d_cuenta;
  end if;

  raise notice 'Semilla S01 cuenta D OK: % con «Asesoría Oeste», sin hostelería.', correo;
end $$;
