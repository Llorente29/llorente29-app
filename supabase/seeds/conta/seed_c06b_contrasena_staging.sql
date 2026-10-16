-- ============================================================================
-- C06b · Frente C · Cuatro usuarios más para la prueba de «He olvidado la
-- contraseña» (tests/e2e/conta/c06/contrasena.spec.ts). SOLO STAGING.
-- ----------------------------------------------------------------------------
-- La prueba mide que el correo que existe y el que no contestan igual y tardan
-- lo mismo. Con solo dos usuarios que existen, para tener seis medidas de cada
-- lado había que pedir tres veces a cada uno y esperar más de un minuto entre
-- vuelta y vuelta (conta_contrasena_pedir no manda dos en 60 s al mismo correo:
-- desde la segunda, el que existe ya no mandaba nada y no se medía lo que se
-- quiere). Eran 2 × 62 s de espera: 264 s, el 13 % de la e2e (medido por W).
-- Con estos cuatro hay seis que existen y cada uno se pide UNA vez: las mismas
-- seis medidas de cada lado, sin esperar (Julio, 16/10: aprobado, con un
-- fichero de semilla en la rama y sin cambiar la plantilla a mano).
--
-- Cada uno, dueño de su cuenta SOLO de contabilidad con la marca de pruebas
-- «contabilidad», dada de alta con la función de verdad
-- (conta_crear_cuenta_sola), igual que seed_c06_staging.sql: persona activa de
-- una cuenta de esa marca, que es lo que mira conta_contrasena_pedir. Nadie
-- entra con ellos: su contraseña es al azar y no la conoce nadie. Todo
-- inventado, con nombres propios del frente C.
--
-- Guardas: aborta si al otro lado hay cuentas de producción, si falta el
-- administrador de plataforma de prueba del C06 (seed_c06_staging.sql) o si ya
-- está cargada.
-- ============================================================================

do $$
declare
  v_plat constant uuid := 'c0600000-0000-4000-8000-0000000000f0';
  r record;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla C06b contraseña ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.platform_admins where user_id = v_plat) then
    raise exception 'Semilla C06b contraseña: falta el administrador de plataforma de prueba del C06 (seed_c06_staging.sql).';
  end if;
  if exists (select 1 from auth.users where id::text like 'c06b0c00-%' or email like 'sola.correo%@c06-prueba.test')
     or exists (select 1 from public.accounts where slug like 'c06b-prueba-correo-%') then
    raise exception 'Semilla C06b contraseña: ya está cargada.';
  end if;

  for r in select * from (values
      ('c06b0c00-0000-4000-8000-000000000001'::uuid, 'sola.correo1@c06-prueba.test', 'Correos de Prueba Uno, S.L.',    'c06b-prueba-correo-1', 'Lucía Inventada'),
      ('c06b0c00-0000-4000-8000-000000000002'::uuid, 'sola.correo2@c06-prueba.test', 'Correos de Prueba Dos, S.L.',    'c06b-prueba-correo-2', 'Tomás Inventado'),
      ('c06b0c00-0000-4000-8000-000000000003'::uuid, 'sola.correo3@c06-prueba.test', 'Correos de Prueba Tres, S.L.',   'c06b-prueba-correo-3', 'Irene Inventada'),
      ('c06b0c00-0000-4000-8000-000000000004'::uuid, 'sola.correo4@c06-prueba.test', 'Correos de Prueba Cuatro, S.L.', 'c06b-prueba-correo-4', 'Bruno Inventado')
    ) as u(id, correo, empresa, slug, nombre)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', r.id, 'authenticated', 'authenticated', r.correo,
      extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (r.id::text, r.id, jsonb_build_object('sub', r.id::text, 'email', r.correo, 'email_verified', true), 'email', now(), now(), now());
    perform public.conta_crear_cuenta_sola(r.empresa, r.slug, r.id, r.nombre, 'contabilidad',
      'Cuenta de prueba del frente C (C06b): un correo que existe para la prueba de «He olvidado la contraseña».', v_plat);
  end loop;

  -- Comprobación: los cuatro, personas activas de una cuenta de la marca.
  if (select count(*) from auth.users u
       where u.id::text like 'c06b0c00-%'
         and exists (select 1 from public.user_profiles p join public.accounts a on a.id = p.account_id
                      where p.user_id = u.id and p.active and a.product_brand = 'contabilidad' and a.deleted_at is null)) <> 4 then
    raise exception 'Semilla C06b contraseña: no han quedado los cuatro como personas activas de una cuenta «contabilidad».';
  end if;
  raise notice 'Semilla C06b contraseña: cuatro usuarios más (sola.correo1…4@c06-prueba.test), cada uno con su cuenta «contabilidad».';
end $$;
