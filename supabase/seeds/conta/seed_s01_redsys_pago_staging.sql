-- ============================================================================
-- S01 · Respuesta 5 · Una empresa para PAGAR con Redsys en staging. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Julio paga a mano, contra el entorno de pruebas de Redsys (sis-t), una factura
-- de 12,10 € por su enlace de pago, con la tarjeta de pruebas de Redsys. Lo que
-- deja esta semilla:
--
--   cuenta «Pruebas de Cobro Redsys» (sin usuario que entre: la contraseña es
--   una al azar que nadie conoce; no hace falta, se paga sin cuenta)
--   empresa «Cobros Redsys de Prueba, S.L.» con su plan (pymes, 8 dígitos) por
--   la puerta del alta (company_chart_activate), su banco y el ejercicio de hoy
--   cliente «Cliente Redsys de Prueba» con su 430
--   factura RDS-1, emitida, 10,00 € + 21 % = 12,10 €, sin cobrar
--   el TPV del banco EN PRUEBAS con el comercio de pruebas PÚBLICO de Redsys
--   (999008881, terminal 1, la clave de pruebas pública de su documentación),
--   abierto para cobrar (cobra) y para el enlace; la clave, a Vault, por
--   conta_cobro_redsys_guardar, como la guarda conta-redsys
--   el enlace de pago de la factura, por conta_enlace_pago_para (su token sale
--   en el NOTICE y se lee con la consulta del parte)
--
-- No es de la plantilla de la e2e (scripts/e2e/carril/comun.sql la nombra
-- usuario a usuario) ni de las cuentas que limpia e2e_limpieza.sql: ningún
-- carril la copia ni la borra, y ninguna e2e la cuenta.
--
-- Se puede volver a aplicar: si la cuenta ya está, no toca nada; si el enlace
-- ya está, lo dice. Nada real: la empresa, el cliente y el comercio son de
-- prueba, y Redsys en pruebas no mueve dinero.
-- Guardas: aborta si al otro lado hay cuentas de producción.
-- ============================================================================

do $$
declare
  r_cuenta  constant uuid := '5ed50000-5ed5-4000-8000-0000000000e0';
  r_user    constant uuid := '5ed50000-5ed5-4000-8000-0000000000e1';
  r_empresa constant uuid := '5ed50000-5ed5-4000-8000-0000000000e2';
  r_cliente constant uuid := '5ed50000-5ed5-4000-8000-0000000000e3';
  r_factura constant uuid := '5ed50000-5ed5-4000-8000-0000000000e4';
  correo    constant text := 'redsys.admin@prueba.folvy.test';
  -- La clave de pruebas PÚBLICA del comercio 999008881 (documentación de Redsys).
  clave     constant text := 'sq7HjrUOBfKmC576ILgskD5srU870gJ7';
  v_tra uuid; v_430 record; r jsonb; v_token text; v_ano int := extract(year from public.conta_hoy())::int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla S01 Redsys ABORTADA: al otro lado hay cuentas de producción.';
  end if;
  if to_regclass('public.conta_cobro_redsys') is null then
    raise exception 'Semilla S01 Redsys: staging aún no tiene la 2030 (conta_cobro_redsys). Aplícala antes.';
  end if;

  if not exists (select 1 from public.accounts where id = r_cuenta) then
    -- La cuenta, su usuario (nadie entra con él) y la empresa con el alta terminada.
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', r_user, 'authenticated', 'authenticated', correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r_user::text, r_user, jsonb_build_object('sub', r_user::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());

    insert into public.accounts (id, name, slug, status, business_type)
    values (r_cuenta, 'Pruebas de Cobro Redsys', 'pruebas-cobro-redsys', 'active', 'otra_actividad');
    insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
    values (r_user, r_cuenta, 'admin', true, 'Admin Redsys', now(), now());
    insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
    values (r_cuenta, 'conta', true, 'manual_grant', 'S01: pagar con Redsys en staging (solo staging).');

    insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
    values (r_empresa, r_cuenta, 'Cobros Redsys de Prueba, S.L.', 'Cobros Redsys', 'B12345690', 'nif_es', 'company', 'hecho', now());
    insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
    values (r_empresa, r_cuenta, 'pymes', 8, array['303', '347', '390']);
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'is_hospitality') then
      execute 'update public.company set is_hospitality = false where id = $1 and account_id = $2' using r_empresa, r_cuenta;
    end if;

    -- El plan, por la puerta del alta, como su administrador; después, el banco.
    perform set_config('request.jwt.claims', json_build_object('sub', r_user, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', r_user::text, true);
    r := public.company_chart_activate(r_empresa, false, 'Folvy (semilla S01 Redsys)');
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (r_cuenta, r_empresa, 'pymes', '57200001', '572', 'Bancos · Cuenta principal', 'own', 'serie');
    if not exists (select 1 from public.fiscal_year where company_id = r_empresa and public.conta_hoy() between starts_on and ends_on) then
      insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, created_by)
      values (r_cuenta, r_empresa, v_ano::text, make_date(v_ano, 1, 1), make_date(v_ano, 12, 31), 'open', null);
    end if;

    -- El cliente y su 430, con el mismo molde que la 430 de serie del plan.
    insert into public.party (id, account_id, name, tax_id) values (r_cliente, r_cuenta, 'Cliente Redsys de Prueba', 'B00000690');
    select * into v_430 from public.company_account where company_id = r_empresa and template_code = '430' order by code limit 1;
    if v_430.id is null then raise exception 'Semilla S01 Redsys: el plan no dejó ninguna 430 de molde.'; end if;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (r_cuenta, r_empresa, v_430.plan, '43000901', v_430.template_code, 'Clientes · Cliente Redsys de Prueba', v_430.kind, v_430.source);
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select r_cuenta, r_empresa, ca.id, 'customer', r_cliente::text, 'principal', 'manual'
      from public.company_account ca where ca.company_id = r_empresa and ca.code = '43000901';

    -- La factura de 12,10 €, emitida y sin cobrar.
    select id into v_tra from public.payment_method where code = 'transferencia' and account_id is null limit 1;
    insert into public.customer_invoice (id, account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
                                         party_id, customer, payment_method_id, email_to, base, tax, total)
    values (r_factura, r_cuenta, r_empresa, 'emitida', 'a_mano', 'RDS', v_ano, 1, 'RDS-1', public.conta_hoy(), public.conta_hoy() + 15, r_cliente,
            jsonb_build_object('nombre', 'Cliente Redsys de Prueba'), v_tra, 'pagos@cliente-redsys.example', 10.00, 2.10, 12.10);

    -- El TPV en pruebas, abierto para cobrar y para el enlace (la clave, a Vault).
    r := public.conta_cobro_redsys_guardar(r_empresa, '999008881', '1', clave, false, true, 'prueba', true, 'Semilla S01 Redsys');
    if r->>'estado' <> 'pruebas' or r->>'proveedor_enlace' <> 'redsys' then
      raise exception 'Semilla S01 Redsys: el TPV no quedó en pruebas y en el enlace: %.', r;
    end if;
  else
    raise notice 'Semilla S01 Redsys: la cuenta ya estaba. No se crea nada.';
  end if;

  -- El enlace de pago (o el que ya había abierto).
  v_token := public.conta_enlace_pago_para(r_factura);
  if v_token is null then
    raise notice 'Semilla S01 Redsys: la factura RDS-1 no tiene enlace (¿ya cobrada?). Su estado: %.',
      (select status from public.conta_enlace_pago where invoice_id = r_factura order by created_at desc limit 1);
  else
    raise notice 'Semilla S01 Redsys OK: factura RDS-1 de 12,10 €, TPV 999008881 en pruebas; el enlace: /pagar.html?t=%', v_token;
  end if;
end $$;
