-- ============================================================================
-- P01 · La ASESORÍA DE DEMO de «Impuestos de tus clientes». SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Todo inventado: nombres, NIF (con su control bien hecho, de nadie conocido),
-- correos en .test, certificados que no son certificados. Ni una fila de
-- producción ni de Folvy Interno.
--
--   Asesoría de Prueba Centro, S.L. · marca Sumied · «Soy una asesoría»
--     p01.laura@p01-prueba.test   Laura Ortega   administración
--     p01.marta@p01-prueba.test   Marta Gil      encargada (puede presentar con el certificado)
--     p01.jorge@p01-prueba.test   Jorge Sanz     encargado (sin permiso para el certificado)
--
--   Clientes que SALEN (consentimiento vivo), 3T de 2026:
--     1 Hostal de Prueba Mayor        sociedad, hostelería: 303 a compensar por revisar; 111 y 115 presentados; 202 por preparar
--     2 Talleres de Prueba Ruiz       sociedad: 303, 111 y 115 revisados, listos (4.902,10 € a ingresar)
--     3 Clínica Dental de Prueba Sol  prorrata del 38 %: 303 con 2 avisos; 111 por revisar
--     4 Ana Prueba Gómez              autónoma, domicilia: 303 que vence (15/10) con un aviso; 130 por preparar
--     5 Importaciones de Prueba Levante  mensual con SII y ROI: julio, agosto y septiembre y el 349 presentados;
--                                     su certificado caduca en 6 días (se recalcula cada vez que se pasa la semilla)
--     6 Panadería de Prueba Norte     todo por preparar; su certificado caducó; sin responsable
--     7 Luis Prueba Martín            autónomo: 303 y 130 listos; su certificado caducó
--     8 Bar de Prueba Esquina         303 listo; 111 presentado
--   Clientes que NO salen:
--     9 Fontanería de Prueba Retirada retiró el consentimiento
--    10 Ferretería de Prueba Pendiente  invitó a la asesoría y aún no está aceptada
--
-- La contraseña no vive aquí: una al azar que nadie conoce; la e2e pone la suya.
-- Se puede volver a pasar: si ya está, solo pone al día la caducidad de los
-- certificados (que dependen de «hoy»).
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla P01 ABORTADA: al otro lado hay cuentas de producción.';
  end if;
end $$;

-- ── Piezas ───────────────────────────────────────────────────────────────────
create function pg_temp.p01_id(sufijo text) returns uuid language sql immutable as $f$
  select ('d5ac0000-0000-4000-8000-' || lpad(sufijo, 12, '0'))::uuid
$f$;

create function pg_temp.p01_usuario(p_id uuid, p_cuenta uuid, p_correo text, p_nombre text, p_rol text) returns void language plpgsql as $f$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (p_id::text, p_id, jsonb_build_object('sub', p_id::text, 'email', p_correo, 'email_verified', true), 'email', now(), now(), now());
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (p_id, p_cuenta, p_rol, true, p_nombre, now(), now());
end $f$;

-- Una cuenta con su empresa (alta terminada) y su perfil fiscal, sin modelos.
create function pg_temp.p01_empresa(n int, p_nombre text, p_razon text, p_nif text, p_tipo text, p_hosteleria boolean,
                                    p_periodo text, p_sii boolean, p_prorrata numeric) returns uuid language plpgsql as $f$
declare v_cuenta uuid := pg_temp.p01_id('c' || lpad(n::text, 2, '0') || '0');
        v_empresa uuid := pg_temp.p01_id('c' || lpad(n::text, 2, '0') || 'e');
begin
  insert into public.accounts (id, name, slug, status, business_type, product_brand)
  values (v_cuenta, p_nombre, 'p01-cliente-' || n, 'active', case when p_hosteleria then 'restaurante' else 'otra_actividad' end, 'sumied');
  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
    fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
    setup_step, setup_completed_at, is_hospitality)
  values (v_empresa, v_cuenta, p_razon, p_nombre, p_nif, 'nif_es', p_tipo,
    'Calle', 'de la Prueba', n::text, '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), p_hosteleria);
  -- Sin modelos en la lista: los pone p01_modelo (el espejo la rellena).
  insert into public.company_tax_profile (company_id, account_id, vat_period, sii, vat_prorata, vat_prorata_pct, chart_kind, account_digits, tax_forms)
  values (v_empresa, v_cuenta, p_periodo, p_sii, p_prorrata is not null, p_prorrata, 'pymes', 8, '{}');
  return v_empresa;
end $f$;

create function pg_temp.p01_banco(p_empresa uuid) returns uuid language plpgsql as $f$
declare v uuid; v_cuenta uuid := (select account_id from public.company where id = p_empresa);
begin
  -- IBAN de ejemplo de la documentación bancaria (válido por su control, no es de nadie).
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default)
  values (v_cuenta, p_empresa, 'bank', 'Cuenta principal', 'ES9121000418450200051332', '572', true)
  returning id into v;
  return v;
end $f$;

create function pg_temp.p01_modelo(p_empresa uuid, p_modelo text, p_cadencia text, p_banco uuid default null) returns void language plpgsql as $f$
begin
  insert into public.tax_obligation (account_id, company_id, form_code, cadence, active, origin, rule_key, why, payment_mode, payment_treasury_account_id, decided_by_name)
  select c.account_id, p_empresa, p_modelo, p_cadencia, true, 'rule', 'p01_semilla', 'Semilla de la demo de despachos (P01).',
         case when p_banco is null then 'none' else 'direct_debit' end, p_banco, 'Semilla P01'
    from public.company c where c.id = p_empresa;
end $f$;

-- Una declaración. p_estado: pending, draft, reviewed o filed. El plazo, el de
-- verdad (conta_impuesto_plazo_si_hay) o, si no lo hay (el 130), el que se da.
create function pg_temp.p01_dec(p_empresa uuid, p_modelo text, p_cadencia text, p_ano int, p_periodo text, p_estado text,
                                p_resultado text, p_importe numeric, p_banco uuid default null, p_plazo date default null,
                                p_cert uuid default null) returns uuid language plpgsql as $f$
declare v uuid; c public.company; pl record; v_csv text;
begin
  select * into c from public.company where id = p_empresa;
  select * into pl from public.conta_impuesto_plazo_si_hay(p_modelo, p_cadencia, p_ano, p_periodo) limit 1;
  v_csv := upper(substr(md5(p_empresa::text || p_modelo || p_periodo), 1, 16));
  insert into public.tax_return (account_id, company_id, obligation_id, form_code, fiscal_year, cadence, period,
    due_date, due_date_direct_debit, status, result_kind, amount, payment_mode, payment_treasury_account_id,
    calculated_at, reviewed_at, reviewed_by_name,
    filed_at, filed_by_name, filed_via, presenter_kind, certificate_id, aeat_csv, aeat_receipt_number)
  values (c.account_id, p_empresa,
    (select o.id from public.tax_obligation o where o.company_id = p_empresa and o.form_code = p_modelo and o.valid_to is null),
    p_modelo, p_ano, p_cadencia, p_periodo,
    coalesce(pl.presentacion, p_plazo), pl.domiciliacion, p_estado, p_resultado, p_importe,
    case when p_banco is not null then 'direct_debit' end, p_banco,
    case when p_estado <> 'pending' then now() end,
    case when p_estado in ('reviewed', 'filed') then now() end, case when p_estado in ('reviewed', 'filed') then 'Laura Ortega' end,
    case when p_estado = 'filed' then timestamptz '2026-10-13 10:30:00+02' end, case when p_estado = 'filed' then 'Laura Ortega' end,
    case when p_estado = 'filed' then 'sumied' end, case when p_estado = 'filed' then 'advisor' end,
    case when p_estado = 'filed' then p_cert end,
    case when p_estado = 'filed' then v_csv end, case when p_estado = 'filed' then '3030000' || right(v_csv, 6) end)
  returning id into v;
  return v;
end $f$;

create function pg_temp.p01_aviso(p_dec uuid, p_clave text, p_resultado text, p_titulo text) returns void language plpgsql as $f$
begin
  insert into public.tax_return_check (tax_return_id, account_id, company_id, check_key, result, title)
  select r.id, r.account_id, r.company_id, p_clave, p_resultado, p_titulo from public.tax_return r where r.id = p_dec;
end $f$;

create function pg_temp.p01_consentir(p_empresa uuid, p_cert uuid default null) returns void language plpgsql as $f$
begin
  insert into public.company_tax_presenter (company_id, account_id, mode, advisor_account_id, advisor_basis, certificate_id,
                                           consented_by, consented_by_name, consented_at, since)
  select c.id, c.account_id, 'advisor', pg_temp.p01_id('a0'), 'social_collaborator', p_cert,
         pg_temp.p01_id('c' || substr(c.id::text, 34, 2) || 'f'), 'Administración del cliente (prueba)', now() - interval '30 days', current_date - 30
    from public.company c where c.id = p_empresa;
end $f$;

create function pg_temp.p01_responsable(p_empresa uuid, p_usuario uuid) returns void language plpgsql as $f$
begin
  insert into public.tax_client_assignee (account_id, company_id, user_id, assigned_by, assigned_by_name)
  values (pg_temp.p01_id('a0'), p_empresa, p_usuario, pg_temp.p01_id('a1'), 'Laura Ortega');
end $f$;

-- La ficha de un certificado. No es un certificado: el secreto no existe y
-- nunca se abre (la conexión con Hacienda está cerrada para la demo).
create function pg_temp.p01_cert(p_sufijo text, p_titular text, p_hasta timestamptz, p_estado text) returns uuid language plpgsql as $f$
declare v uuid := pg_temp.p01_id(p_sufijo);
begin
  insert into public.tax_certificate (id, owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial,
    valid_from, valid_to, fingerprint_sha256, kind, storage, vault_secret_id, status, uploaded_by_name)
  values (v, pg_temp.p01_id('a0'), p_titular, encode(extensions.digest('p01-nif-' || p_sufijo, 'sha256'), 'hex'), '91X',
    'Emisor de Prueba P01', 'P01-' || p_sufijo, now() - interval '700 days', p_hasta,
    encode(extensions.digest('p01-huella-' || p_sufijo, 'sha256'), 'hex'), 'legal_representative', 'vault',
    pg_temp.p01_id(p_sufijo || 'f'), p_estado, 'Laura Ortega');
  return v;
end $f$;

-- P01 · El resumen del trimestre va a la administración de cada cliente: dos
-- clientes de la demo la tienen (inventada), para que el envío tenga a quién
-- mandar y se vea el freno de send-email. Se pone también si la asesoría ya
-- estaba; si ya está, no hace nada.
create function pg_temp.p01_administracion_de_clientes() returns void language plpgsql as $f$
declare r record;
begin
  for r in select * from (values
      ('c02a', 'c020', 'p01.talleres@p01-prueba.test', 'Administración de Talleres (prueba)'),
      ('c08a', 'c080', 'p01.bar@p01-prueba.test', 'Administración del Bar (prueba)')) v(usuario, cuenta, correo, nombre) loop
    continue when not exists (select 1 from public.accounts where id = pg_temp.p01_id(r.cuenta));
    continue when exists (select 1 from auth.users where id = pg_temp.p01_id(r.usuario));
    perform pg_temp.p01_usuario(pg_temp.p01_id(r.usuario), pg_temp.p01_id(r.cuenta), r.correo, r.nombre, 'admin');
  end loop;
end $f$;

-- ── La asesoría y sus clientes ───────────────────────────────────────────────
do $$
declare
  v_ase constant uuid := pg_temp.p01_id('a0');
  v_ase_emp constant uuid := pg_temp.p01_id('a9');
  v_laura constant uuid := pg_temp.p01_id('a1');
  v_marta constant uuid := pg_temp.p01_id('a2');
  v_jorge constant uuid := pg_temp.p01_id('a3');
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  e uuid; b uuid; d uuid;
begin
  if exists (select 1 from public.accounts where id = v_ase) then
    raise notice 'Semilla P01: la asesoría de demo ya está; solo se pone al día la caducidad de los certificados.';
    perform pg_temp.p01_administracion_de_clientes();
    return;
  end if;
  if exists (select 1 from auth.users where email like '%@p01-prueba.test') then
    raise exception 'Semilla P01: hay usuarios @p01-prueba.test sin su asesoría. Revisa staging antes de seguir.';
  end if;

  insert into public.accounts (id, name, legal_name, slug, status, business_type, product_brand, billing_email, tax_advisor_since)
  values (v_ase, 'Asesoría de Prueba Centro', 'Asesoría de Prueba Centro, S.L.', 'p01-asesoria-prueba-centro', 'active', 'otra_actividad',
          'sumied', 'despacho@p01-prueba.test', now());
  insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
  values (v_ase, 'conta', true, 'manual_grant', 'P01: asesoría de demo (solo staging).');
  perform pg_temp.p01_usuario(v_laura, v_ase, 'p01.laura@p01-prueba.test', 'Laura Ortega', 'admin');
  perform pg_temp.p01_usuario(v_marta, v_ase, 'p01.marta@p01-prueba.test', 'Marta Gil', 'manager');
  perform pg_temp.p01_usuario(v_jorge, v_ase, 'p01.jorge@p01-prueba.test', 'Jorge Sanz', 'manager');
  update public.accounts set tax_advisor_by = v_laura where id = v_ase;
  -- Su propia empresa (sin ella, Impuestos pide el alta).
  insert into public.company (id, account_id, legal_name, trade_name, tax_id, tax_id_type, entity_kind,
    fiscal_street_type, fiscal_street, fiscal_number, fiscal_postal_code, fiscal_city, fiscal_province, fiscal_country,
    setup_step, setup_completed_at, is_hospitality)
  values (v_ase_emp, v_ase, 'Asesoría de Prueba Centro, S.L.', 'Asesoría de Prueba Centro', 'B91000885', 'nif_es', 'company',
    'Calle', 'de la Prueba', '1', '28001', 'Madrid', 'Madrid', 'ES', 'hecho', now(), false);
  insert into public.company_tax_profile (company_id, account_id, chart_kind, account_digits, tax_forms)
  values (v_ase_emp, v_ase, 'pymes', 8, '{}');

  -- Los certificados de la asesoría.
  c1 := pg_temp.p01_cert('ce1', 'ASESORIA DE PRUEBA CENTRO SL', now() + interval '300 days', 'active');
  c2 := pg_temp.p01_cert('ce2', 'IMPORTACIONES DE PRUEBA LEVANTE SA', now() + interval '6 days', 'active');
  c3 := pg_temp.p01_cert('ce3', 'PANADERIA DE PRUEBA NORTE SL', now() - interval '10 days', 'expired');
  c4 := pg_temp.p01_cert('ce4', 'LUIS PRUEBA MARTIN', now() - interval '3 days', 'expired');
  -- Marta puede presentar con los dos vivos; Jorge, con ninguno (lo dice su vista).
  insert into public.tax_certificate_grant (certificate_id, user_id, permission, granted_by)
  values (c1, v_marta, 'file', v_laura), (c2, v_marta, 'file', v_laura), (c1, v_jorge, 'view', v_laura);

  -- 1 · Hostal de Prueba Mayor
  e := pg_temp.p01_empresa(1, 'Hostal de Prueba Mayor', 'Hostal de Prueba Mayor, S.L.', 'B91000117', 'company', true, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '111', 'quarterly');
  perform pg_temp.p01_modelo(e, '115', 'quarterly'); perform pg_temp.p01_modelo(e, '202', 'instalments_202');
  perform pg_temp.p01_modelo(e, '390', 'annual');
  d := pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'draft', 'to_offset', 3723.44);
  perform pg_temp.p01_aviso(d, 'book_vs_303', 'ok', 'Libro de IVA = 477 y 472 del diario');
  perform pg_temp.p01_dec(e, '111', 'quarterly', 2026, '3T', 'filed', 'to_pay', 578.01, null, null, c1);
  perform pg_temp.p01_dec(e, '115', 'quarterly', 2026, '3T', 'filed', 'to_pay', 1069.02, null, null, c1);
  perform pg_temp.p01_consentir(e); perform pg_temp.p01_responsable(e, v_laura);

  -- 2 · Talleres de Prueba Ruiz: los tres revisados (3.104,60 + 1.202,50 + 595,00 = 4.902,10).
  e := pg_temp.p01_empresa(2, 'Talleres de Prueba Ruiz', 'Talleres de Prueba Ruiz, S.L.', 'B91000224', 'company', false, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '111', 'quarterly'); perform pg_temp.p01_modelo(e, '115', 'quarterly');
  perform pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 3104.60);
  perform pg_temp.p01_dec(e, '111', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 1202.50);
  perform pg_temp.p01_dec(e, '115', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 595.00);
  perform pg_temp.p01_consentir(e); perform pg_temp.p01_responsable(e, v_marta);

  -- 3 · Clínica Dental de Prueba Sol: prorrata del 38 %, dos avisos.
  e := pg_temp.p01_empresa(3, 'Clínica Dental de Prueba Sol', 'Clínica Dental de Prueba Sol, S.L.P.', 'B91000331', 'company', false, 'quarterly', false, 38);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '111', 'quarterly');
  d := pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'draft', 'to_pay', 1210.44);
  perform pg_temp.p01_aviso(d, 'third_parties_347', 'warning', 'Factura sin NIF del proveedor');
  perform pg_temp.p01_aviso(d, 'book_vs_303', 'warning', 'La prorrata del 38 % no está aplicada en 2 facturas');
  perform pg_temp.p01_dec(e, '111', 'quarterly', 2026, '3T', 'draft', null, null);
  perform pg_temp.p01_consentir(e); perform pg_temp.p01_responsable(e, v_laura);

  -- 4 · Ana Prueba Gómez: autónoma, domicilia el 303 (vence el 15/10) y le faltan facturas.
  e := pg_temp.p01_empresa(4, 'Ana Prueba Gómez', 'Ana Prueba Gómez', '91000123W', 'self_employed', false, 'quarterly', false, null);
  b := pg_temp.p01_banco(e);
  perform pg_temp.p01_modelo(e, '303', 'quarterly', b); perform pg_temp.p01_modelo(e, '130', 'quarterly');
  d := pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'draft', 'to_pay', 612.30, b);
  perform pg_temp.p01_aviso(d, 'mail_invoices_missing', 'warning', 'Faltan 3 facturas por correo');
  perform pg_temp.p01_dec(e, '130', 'quarterly', 2026, '3T', 'pending', null, null, null, date '2026-10-20');
  perform pg_temp.p01_consentir(e); perform pg_temp.p01_responsable(e, v_jorge);

  -- 5 · Importaciones de Prueba Levante: mensual con SII; todo presentado; su certificado caduca.
  e := pg_temp.p01_empresa(5, 'Importaciones de Prueba Levante', 'Importaciones de Prueba Levante, S.A.', 'A91001115', 'company', false, 'monthly', true, null);
  perform pg_temp.p01_modelo(e, '303', 'monthly'); perform pg_temp.p01_modelo(e, '349', 'quarterly');
  perform pg_temp.p01_dec(e, '303', 'monthly', 2026, '07', 'filed', 'to_pay', 2100.00, null, null, c2);
  perform pg_temp.p01_dec(e, '303', 'monthly', 2026, '08', 'filed', 'to_pay', 1850.00, null, null, c2);
  perform pg_temp.p01_dec(e, '303', 'monthly', 2026, '09', 'filed', 'to_offset', 12040.00, null, null, c2);
  perform pg_temp.p01_dec(e, '349', 'quarterly', 2026, '3T', 'filed', 'zero', 0, null, null, c2);
  perform pg_temp.p01_consentir(e, c2); perform pg_temp.p01_responsable(e, v_marta);

  -- 6 · Panadería de Prueba Norte: todo por preparar, el certificado caducado, sin responsable.
  e := pg_temp.p01_empresa(6, 'Panadería de Prueba Norte', 'Panadería de Prueba Norte, S.L.', 'B91000448', 'company', true, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '111', 'quarterly');
  perform pg_temp.p01_consentir(e, c3);

  -- 7 · Luis Prueba Martín: listo, pero su certificado caducó.
  e := pg_temp.p01_empresa(7, 'Luis Prueba Martín', 'Luis Prueba Martín', '91000234K', 'self_employed', false, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '130', 'quarterly');
  perform pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 312.40);
  perform pg_temp.p01_dec(e, '130', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 180.00, null, date '2026-10-20');
  perform pg_temp.p01_consentir(e, c4); perform pg_temp.p01_responsable(e, v_jorge);

  -- 8 · Bar de Prueba Esquina: 303 listo; 111 presentado.
  e := pg_temp.p01_empresa(8, 'Bar de Prueba Esquina', 'Bar de Prueba Esquina, S.L.', 'B91000554', 'company', true, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly'); perform pg_temp.p01_modelo(e, '111', 'quarterly');
  perform pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'reviewed', 'to_pay', 1204.50);
  perform pg_temp.p01_dec(e, '111', 'quarterly', 2026, '3T', 'filed', 'to_pay', 340.00, null, null, c1);
  perform pg_temp.p01_consentir(e); perform pg_temp.p01_responsable(e, v_marta);

  -- 9 · Fontanería de Prueba Retirada: dio permiso y lo retiró. No sale.
  e := pg_temp.p01_empresa(9, 'Fontanería de Prueba Retirada', 'Fontanería de Prueba Retirada, S.L.', 'B91000661', 'company', false, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly');
  perform pg_temp.p01_dec(e, '303', 'quarterly', 2026, '3T', 'draft', 'to_pay', 845.20);
  perform pg_temp.p01_consentir(e);
  update public.company_tax_presenter set revoked_by = pg_temp.p01_id('c09f'), revoked_at = now() - interval '5 days' where company_id = e;
  perform pg_temp.p01_responsable(e, v_laura);   -- se queda, pero no se ve: el permiso manda

  -- 10 · Ferretería de Prueba Pendiente: invitó a la asesoría; sin aceptar. No sale.
  e := pg_temp.p01_empresa(10, 'Ferretería de Prueba Pendiente', 'Ferretería de Prueba Pendiente, S.L.', 'B91000778', 'company', false, 'quarterly', false, null);
  perform pg_temp.p01_modelo(e, '303', 'quarterly');
  insert into public.company_tax_presenter (company_id, account_id, mode, since)
  values (e, pg_temp.p01_id('c100'), 'company', current_date);
  insert into public.tax_advisor_invitation (account_id, company_id, email, advisor_name, basis, token_hash, invited_by, invited_by_name, expires_at)
  values (pg_temp.p01_id('c100'), e, 'p01.laura@p01-prueba.test', 'Asesoría de Prueba Centro', 'social_collaborator',
          encode(extensions.digest('p01-invitacion-10', 'sha256'), 'hex'), pg_temp.p01_id('c10f'), 'Administración del cliente (prueba)', now() + interval '6 days');

  perform pg_temp.p01_administracion_de_clientes();
  raise notice 'Semilla P01 OK: la asesoría de demo con 3 personas, 4 certificados y 10 clientes (8 con permiso; 2 con administración).';
end $$;

-- ── Lo que se repasa en cada pasada ────────────────────────────────────────
-- El interruptor de Impuestos de la asesoría (sin él no ve la pestaña).
insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
select pg_temp.p01_id('a0'), 'conta_impuestos', true, 'manual_grant', 'P01: asesoría de demo (solo staging).'
 where exists (select 1 from public.accounts where id = pg_temp.p01_id('a0'))
   and not exists (select 1 from public.feature_flags where account_id = pg_temp.p01_id('a0') and feature_key = 'conta_impuestos');

-- Los RESÚMENES ANUALES y el 347 de cada empresa de la demo (Julio, 21/10).
-- La semilla ponía a mano solo los periódicos, sin las reglas que en un alta
-- de verdad añaden sus anuales, y el agente «Datos maestros e impuestos» las
-- daba en rojo (incidencia #253, 25 fallos). La misma regla que el alta y el
-- agente (tax_form.annual_form_code y default_for), con la excepción del SII:
-- quien lo lleva no presenta el 390 (instrucciones del modelo 390, AEAT) ni el
-- 347. Y la empresa de la propia asesoría, que no tenía ninguno, con los de una
-- sociedad de servicios que retiene (303, 111 y 202, y sus anuales).
-- Se repasa en cada pasada: solo añade lo que falta.
do $$
declare v_ase_emp constant uuid := pg_temp.p01_id('a9'); r record; n int := 0;
begin
  if not exists (select 1 from public.company where id = v_ase_emp) then return; end if;
  if not exists (select 1 from public.tax_obligation where company_id = v_ase_emp and valid_to is null) then
    perform pg_temp.p01_modelo(v_ase_emp, '303', 'quarterly');
    perform pg_temp.p01_modelo(v_ase_emp, '111', 'quarterly');
    perform pg_temp.p01_modelo(v_ase_emp, '202', 'instalments_202');
  end if;
  for r in
    -- El anual de cada periódico activo (con el SII, sin el 390)…
    select distinct o.company_id, f.annual_form_code as modelo
      from public.tax_obligation o
      join public.tax_form f on f.code = o.form_code and f.annual_form_code is not null
      join public.company_tax_profile p on p.company_id = o.company_id
     where o.account_id::text like 'd5ac0000-%' and o.active and o.valid_to is null
       and not (coalesce(p.sii, false) and f.annual_form_code = '390')
    union
    -- …y el 347 en toda sociedad fuera del SII.
    select c.id, f.code
      from public.company c
      join public.company_tax_profile p on p.company_id = c.id
      join public.tax_form f on f.default_for = 'company_not_sii'
     where c.account_id::text like 'd5ac0000-%' and c.entity_kind = 'company' and not coalesce(p.sii, false)
  loop
    continue when exists (select 1 from public.tax_obligation o where o.company_id = r.company_id and o.form_code = r.modelo and o.valid_to is null);
    perform pg_temp.p01_modelo(r.company_id, r.modelo, 'annual');
    n := n + 1;
  end loop;
  raise notice 'Semilla P01: % resúmenes anuales o 347 añadidos a la demo.', n;
end $$;

-- La caducidad de los certificados, que depende de «hoy».
update public.tax_certificate set valid_to = now() + interval '6 days', status = 'active' where id = pg_temp.p01_id('ce2');
update public.tax_certificate set valid_to = now() - interval '10 days', status = 'expired' where id = pg_temp.p01_id('ce3');
update public.tax_certificate set valid_to = now() - interval '3 days', status = 'expired' where id = pg_temp.p01_id('ce4');
update public.tax_certificate set valid_to = now() + interval '300 days', status = 'active' where id = pg_temp.p01_id('ce1');

-- ── Comprobación, con la misma vara que la pantalla ─────────────────────────
do $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.p01_id('a1'), 'role', 'authenticated')::text, true);
  v := public.conta_despacho_trimestre(pg_temp.p01_id('a0'), 2026, '3T', date '2026-10-13');
  if (v->'resumen'->>'clientes')::int <> 8 then
    raise exception 'Semilla P01: la asesoría ve % clientes, y tienen que ser 8 (los dos sin permiso no salen).', v->'resumen'->>'clientes';
  end if;
  -- Los anuales no son del 3T: el trimestre sigue con sus 21 modelos.
  if (v->'resumen'->>'modelos')::int <> 21 then
    raise exception 'Semilla P01: el 3T a 13/10 tiene % modelos, y tienen que ser 21.', v->'resumen'->>'modelos';
  end if;
  if exists (select 1 from jsonb_array_elements(v->'clientes') c where c->>'nombre' in ('Fontanería de Prueba Retirada', 'Ferretería de Prueba Pendiente')) then
    raise exception 'Semilla P01: sale un cliente sin permiso.';
  end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'Semilla P01 · el 3T a 13/10: %', v->'resumen';
end $$;
