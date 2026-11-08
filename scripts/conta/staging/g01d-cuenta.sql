-- scripts/conta/staging/g01d-cuenta.sql
--
-- G01d · La cuenta de pruebas de «Al instante», SOLO EN STAGING. Una asesoría
-- aparte, fuera de la plantilla de la e2e (scripts/e2e/carril/comun.sql), para
-- que ningún carril se lleve su conexión con el Bitrix24 de pruebas y el
-- sandbox de GoCardless (Julio, nº19). Todo inventado (T11): nombres, NIF
-- (B00000000, que se ve inventado) y correo en .test.
--
--   Asesoría G01d de Pruebas · 901d0000-0000-4000-8000-0000000000a0
--     su empresa, sector Gestoría   · 901d0000-0000-4000-8000-0000000000a9
--     g01d.admin@g01d-prueba.test   · 901d0000-0000-4000-8000-0000000000a1, administración
--
-- Se puede pasar las veces que haga falta: si ya está, solo pone el sector y
-- la contraseña de un solo uso de esta ejecución (:'clave', que no se guarda
-- en ningún sitio más). Lo lanza g01d-staging.yml.

\set ON_ERROR_STOP on

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'G01d ABORTADO: al otro lado hay cuentas de producción.';
  end if;
end $$;

begin;

do $$
declare
  v_cuenta  constant uuid := '901d0000-0000-4000-8000-0000000000a0';
  v_empresa constant uuid := '901d0000-0000-4000-8000-0000000000a9';
  v_admin   constant uuid := '901d0000-0000-4000-8000-0000000000a1';
  v_correo  constant text := 'g01d.admin@g01d-prueba.test';
begin
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    insert into public.accounts (id, name, legal_name, slug, status, business_type, product_brand, billing_email, tax_advisor_since)
    values (v_cuenta, 'Asesoría G01d de Pruebas', 'Asesoría G01d de Pruebas, S.L.', 'g01d-asesoria-pruebas', 'active', 'otra_actividad',
            'sumied', 'despacho@g01d-prueba.test', now());
    insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
    values (v_cuenta, 'conta', true, 'manual_grant', 'G01d: cuenta de pruebas de «Al instante» (solo staging).');

    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', v_correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_admin::text, v_admin, jsonb_build_object('sub', v_admin::text, 'email', v_correo, 'email_verified', true), 'email', now(), now(), now());
    insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
    values (v_admin, v_cuenta, 'admin', true, 'Administración G01d (prueba)', now(), now());
    update public.accounts set tax_advisor_by = v_admin where id = v_cuenta;

    insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
      fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
      setup_step, setup_completed_at, is_hospitality)
    values (v_empresa, v_cuenta, 'Asesoría G01d de Pruebas, S.L.', 'Asesoría G01d de Pruebas', 'B00000000', 'nif_es', 'company',
      'Calle', 'de la Prueba', '1', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), false);
    insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
    values (v_empresa, v_cuenta, 'pymes', 8, '{}');
    raise notice 'G01d: creada la cuenta de pruebas, su empresa y su administración.';
  else
    raise notice 'G01d: la cuenta de pruebas ya estaba.';
  end if;

  -- Sector Gestoría (G03): es lo que enciende Clientes y cuotas y la tarjeta del CRM y GoCardless de Ajustes › Cobros.
  update public.company set sector = 'gestoria' where id = v_empresa and sector is distinct from 'gestoria';
end $$;

-- La contraseña de un solo uso de esta ejecución.
update auth.users set encrypted_password = extensions.crypt(:'clave', extensions.gen_salt('bf')), updated_at = now()
 where id = '901d0000-0000-4000-8000-0000000000a1';

commit;

select 'cuenta' as que, (select name from public.accounts where id = '901d0000-0000-4000-8000-0000000000a0') as valor
union all select 'sector de su empresa', (select sector from public.company where id = '901d0000-0000-4000-8000-0000000000a9')
union all select 'administración', (select role from public.user_profiles where user_id = '901d0000-0000-4000-8000-0000000000a1');
