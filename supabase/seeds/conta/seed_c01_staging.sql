-- ============================================================================
-- C01 · Semillas de staging-conta (oseymswjlzplqoxrfjzi). SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Dos cuentas INVENTADAS, una por lado de la prueba de aislamiento (RLS):
--
--   A · «Taberna de Prueba Norte»  (prueba-norte)  · interruptor `conta` ACTIVO
--       usuario a.admin@prueba.folvy.test (admin)
--       Hermanos Ruiz   → email + teléfono + dirección antiguos
--       Bebidas Sol     → solo teléfono
--       Panadería Luna  → nada
--       1 factura aprobada F-2026-0915 de Hermanos Ruiz
--
--   B · «Cocina de Prueba Sur»     (prueba-sur)    · SIN interruptor
--       usuario b.admin@prueba.folvy.test (admin)
--       Carnes Sur        → solo email
--       Limpiezas Brillo  → nada
--       1 factura aprobada S-118 de Carnes Sur
--
-- Ni una fila de producción ni de Folvy Interno. Los NIF son CIF inventados
-- con el dígito de control bien calculado (validados con validarNifEs).
--
-- La contraseña NO vive aquí, ni viaja en claro a la base: el marcador
-- __HASH_CLAVE_PRUEBAS__ se sustituye al ejecutar por su hash bcrypt, calculado
-- en local desde un fichero fuera del repositorio:
--   python3 -c "import bcrypt,sys; print(bcrypt.hashpw(open(sys.argv[1]).read().strip().encode(), bcrypt.gensalt(10)).decode())" clave.txt
--
-- Se ejecuta ANTES de las migraciones del C01, para que la migración de datos
-- tenga algo que pasar (lo esperado: 3 contactos principales —A: 2, B: 1— y
-- 1 propuesta de dirección).
--
-- Guardas: aborta si no es staging-conta (no hay ninguna cuenta fuera de las
-- de prueba) o si las semillas ya están.
-- ============================================================================

do $$
declare
  c_hash constant text := '__HASH_CLAVE_PRUEBAS__';
  -- Identificadores fijos: las pruebas los usan por nombre.
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  b_user   constant uuid := 'c01b0000-0000-4000-8000-0000000000b1';
  a_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  b_local  constant uuid := 'c01b0000-0000-4000-8000-0000000000b2';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  a_sol    constant uuid := 'c01a0000-0000-4000-8000-0000000000a4';
  a_luna   constant uuid := 'c01a0000-0000-4000-8000-0000000000a5';
  b_carnes constant uuid := 'c01b0000-0000-4000-8000-0000000000b3';
  b_brillo constant uuid := 'c01b0000-0000-4000-8000-0000000000b4';
begin
  if c_hash !~ '^\$2[aby]\$[0-9]{2}\$.{53}$' then
    raise exception 'Semillas C01: falta sustituir el marcador por el hash bcrypt de la contraseña.';
  end if;
  if exists (select 1 from accounts where id not in (a_cuenta, b_cuenta)) then
    raise exception 'Semillas C01 ABORTADAS: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;
  if exists (select 1 from accounts where id in (a_cuenta, b_cuenta)) then
    raise exception 'Semillas C01: ya están cargadas.';
  end if;

  -- Usuarios de Auth, con el email confirmado.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('00000000-0000-0000-0000-000000000000', a_user, 'authenticated', 'authenticated',
     'a.admin@prueba.folvy.test', c_hash,
     now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', b_user, 'authenticated', 'authenticated',
     'b.admin@prueba.folvy.test', c_hash,
     now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values
    (a_user::text, a_user, jsonb_build_object('sub', a_user::text, 'email', 'a.admin@prueba.folvy.test', 'email_verified', true), 'email', now(), now(), now()),
    (b_user::text, b_user, jsonb_build_object('sub', b_user::text, 'email', 'b.admin@prueba.folvy.test', 'email_verified', true), 'email', now(), now(), now());

  -- Cuentas (sus disparadores de alta siembran lo de cualquier cuenta nueva).
  insert into accounts (id, name, slug, status, business_type)
  values (a_cuenta, 'Taberna de Prueba Norte', 'prueba-norte', 'active', 'restaurante'),
         (b_cuenta, 'Cocina de Prueba Sur',    'prueba-sur',   'active', 'restaurante');

  -- Administradores, con la bienvenida hecha para no pasar por el alta.
  insert into user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (a_user, a_cuenta, 'admin', true, 'Admin Norte', now(), now()),
         (b_user, b_cuenta, 'admin', true, 'Admin Sur',   now(), now());

  insert into locations (id, account_id, name, city)
  values (a_local, a_cuenta, 'Norte Centro', 'Madrid'),
         (b_local, b_cuenta, 'Sur Mercado',  'Sevilla');

  insert into supplier (id, account_id, name, tax_id, email, phone, address, created_by_name)
  values
    (a_ruiz,   a_cuenta, 'Hermanos Ruiz',    'B91000018', 'pedidos@hermanosruiz.test', '600 000 001', 'C/ Ejemplo 12, 28021 Madrid', 'Semillas C01'),
    (a_sol,    a_cuenta, 'Bebidas Sol',      'B91000026', null,                         '600 000 002', null,                          'Semillas C01'),
    (a_luna,   a_cuenta, 'Panadería Luna',   null,        null,                         null,          null,                          'Semillas C01'),
    (b_carnes, b_cuenta, 'Carnes Sur',       'B92000017', 'hola@carnessur.test',        null,          null,                          'Semillas C01'),
    (b_brillo, b_cuenta, 'Limpiezas Brillo', null,        null,                         null,          null,                          'Semillas C01');

  insert into supplier_invoice (account_id, supplier_id, location_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, created_by_name, approved_at, approved_by, approved_by_name)
  values
    (a_cuenta, a_ruiz,   a_local, 'F-2026-0915', date '2026-09-24', 'aprobada', 1166.50, 116.65, 1283.15, 'Semillas C01', now(), a_user, 'Admin Norte'),
    (b_cuenta, b_carnes, b_local, 'S-118',       date '2026-09-20', 'aprobada',  420.00,  42.00,  462.00, 'Semillas C01', now(), b_user, 'Admin Sur');

  -- El módulo de contabilidad, solo para A.
  insert into feature_flags (account_id, feature_key, enabled, source)
  values (a_cuenta, 'conta', true, 'manual_grant');

  raise notice 'Semillas C01 OK: 2 cuentas, 2 usuarios, 2 locales, 5 proveedores, 2 facturas, 1 interruptor.';
end $$;
