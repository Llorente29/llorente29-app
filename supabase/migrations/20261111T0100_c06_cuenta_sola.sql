-- ============================================================================
-- C06 · CONTABILIDAD SOLA — el alta de una cuenta solo de contabilidad
-- ----------------------------------------------------------------------------
-- cambia: public.accounts · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.trg_adopt_mandatory_courses_on_account_insert · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.trg_seed_appcc_on_account_insert · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.trg_seed_ingredient_families_on_account_insert · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.tg_seed_staff_roles · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.create_account_gestoria_config_default · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
-- cambia: public.trg_seed_vacation_settings_on_account_insert · prueba: supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql
--
-- Encargo C06 (13/10) y su respuesta 1. Hoy una cuenta solo sale de
-- create_account_tx, que pide un local y una marca y llama a onboard_account,
-- que siembra Cocina entera; y los seis disparadores AFTER INSERT de
-- `accounts` siembran además cursos obligatorios, APPCC, familias de
-- ingredientes, cargos de personal, configuración de gestoría y vacaciones
-- (medido en producción el 13/10, solo lectura). Nada de eso es de una
-- empresa que solo quiere la contabilidad.
--
-- Lo que hace este fichero (todo añade, salvo lo declarado arriba):
--   1. accounts.product_brand: la marca con la que se vendió una cuenta SOLO de
--      contabilidad (supabase/functions/_shared/marcas.ts). Null en todas las
--      de hoy: nada cambia para ellas. El front la lee para no enseñar nada
--      fuera de /conta y aterrizar en su Inicio.
--   2. feature_flags.grant_reason: por qué se encendió un interruptor a mano.
--   3. accounts_business_type_check admite 'otra_actividad' («Otra actividad»:
--      una empresa que no es de hostelería). Solo amplía: todo lo que valía,
--      vale.
--   4. Los seis disparadores de siembra, con la MISMA firma y el mismo cuerpo,
--      no siembran nada cuando la cuenta nace con product_brand. Para las
--      demás (product_brand null, todas las que crea create_account_tx) hacen
--      exactamente lo mismo que hoy: cuerpo copiado de producción el 13/10.
--   5. conta_crear_cuenta_sola: crea la cuenta (sin local, marca, canales,
--      familias, ingredientes ni almacén), el perfil de su administrador con
--      el conjunto de permisos de siempre, el interruptor `conta` con quién y
--      por qué, y el apunte en platform_audit_log (quién y cuándo). Solo la
--      llama service_role (la edge function conta-crear-cuenta, que comprueba
--      antes que quien la usa es administrador de la plataforma).
--
-- No toca create_account_tx ni onboard_account. No toca el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261111T0100_c06_cuenta_sola.down.sql
-- ============================================================================

-- ── 1 · La marca de una cuenta solo de contabilidad ─────────────────────────
alter table public.accounts add column if not exists product_brand text;
alter table public.accounts drop constraint if exists accounts_product_brand_formato;
alter table public.accounts add constraint accounts_product_brand_formato
  check (product_brand is null or product_brand ~ '^[a-z][a-z0-9_]{1,40}$');
comment on column public.accounts.product_brand is
  'C06 · Marca con la que se vendió una cuenta SOLO de contabilidad (id de supabase/functions/_shared/marcas.ts). Null: cuenta de Folvy de siempre.';

-- ── 2 · Por qué se encendió un interruptor a mano ───────────────────────────
alter table public.feature_flags add column if not exists grant_reason text;
comment on column public.feature_flags.grant_reason is
  'C06 · Por qué se encendió a mano (source = manual_grant): lo escribe quien da el alta.';

-- ── 3 · «Otra actividad»: una empresa que no es de hostelería ───────────────
alter table public.accounts drop constraint accounts_business_type_check;
alter table public.accounts add constraint accounts_business_type_check
  check (business_type = any (array['dark_kitchen'::text, 'bar'::text, 'restaurante'::text, 'cafeteria'::text, 'hotel'::text, 'otro'::text, 'otra_actividad'::text]));

-- ── 4 · Los disparadores de siembra no siembran en una cuenta solo de contabilidad ──
create or replace function public.trg_adopt_mandatory_courses_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.product_brand is not null then return new; end if;  -- C06: cuenta solo de contabilidad
  perform public.adopt_mandatory_courses(new.id);
  return new;
end;
$function$;

create or replace function public.trg_seed_appcc_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.product_brand IS NOT NULL THEN RETURN NEW; END IF;  -- C06: cuenta solo de contabilidad
  PERFORM seed_appcc_for_account(NEW.id);
  PERFORM public.apply_appcc_assignment_moments(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- No bloquear el INSERT de accounts si el seed falla.
  -- La cuenta queda creada; el admin puede ejecutar manualmente
  -- SELECT seed_appcc_for_account(<uuid>) mas tarde.
  RAISE WARNING 'Seed APPCC fallo para cuenta % (%): %', NEW.id, NEW.slug, SQLERRM;
  RETURN NEW;
END;
$function$;

create or replace function public.trg_seed_ingredient_families_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
BEGIN
  IF NEW.product_brand IS NOT NULL THEN RETURN NEW; END IF;  -- C06: cuenta solo de contabilidad
  PERFORM public.seed_ingredient_families_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

create or replace function public.tg_seed_staff_roles()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.product_brand is not null then return new; end if;  -- C06: cuenta solo de contabilidad
  perform public.seed_staff_roles_for_account(new.id);
  return new;
end;
$function$;

create or replace function public.create_account_gestoria_config_default()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
BEGIN
  IF NEW.product_brand IS NOT NULL THEN RETURN NEW; END IF;  -- C06: cuenta solo de contabilidad
  INSERT INTO public.account_gestoria_config (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

create or replace function public.trg_seed_vacation_settings_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  IF NEW.product_brand IS NOT NULL THEN RETURN NEW; END IF;  -- C06: cuenta solo de contabilidad
  PERFORM public.seed_vacation_settings_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

-- ── 5 · El alta de una cuenta solo de contabilidad ──────────────────────────
create or replace function public.conta_crear_cuenta_sola(
  p_nombre text, p_slug text, p_admin_user_id uuid, p_admin_nombre text,
  p_marca text, p_motivo text, p_creada_por uuid
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_admin_plataforma uuid;
  v_gerente_total    uuid := null;
  v_cuenta           uuid;
  v_perfil           uuid;
begin
  if coalesce(trim(p_nombre), '') = '' then raise exception 'Falta el nombre de la empresa.'; end if;
  if coalesce(trim(p_marca), '') = '' then raise exception 'Falta la marca con la que se vende.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Falta por qué se da de alta (queda en el registro).'; end if;
  if p_admin_user_id is null then raise exception 'Falta el usuario del administrador del cliente.'; end if;

  select id into v_admin_plataforma from platform_admins where user_id = p_creada_por and active = true limit 1;
  if v_admin_plataforma is null then
    raise exception 'Solo un administrador activo de la plataforma da de alta cuentas (usuario %).', p_creada_por using errcode = '42501';
  end if;

  -- El conjunto de permisos de siempre (gerente_total), como create_account_tx.
  -- staging-conta no tiene permission_sets (su esquema es solo el de
  -- contabilidad): allí la cuenta nace sin él y lo dice; en producción es obligatorio.
  if to_regclass('public.permission_sets') is not null then
    execute $q$select id from public.permission_sets where name = 'gerente_total' and is_system = true and account_id is null limit 1$q$
      into v_gerente_total;
    if v_gerente_total is null then raise exception 'No existe el conjunto de permisos global gerente_total.'; end if;
  else
    raise notice 'Esta base no tiene permission_sets (staging-conta): el administrador queda sin conjunto de permisos.';
  end if;

  -- product_brand va en el INSERT: los disparadores de siembra la ven y no siembran.
  insert into accounts (name, slug, status, country, created_by, business_type, product_brand)
  values (trim(p_nombre), p_slug, 'active', 'ES', p_creada_por, 'otra_actividad', p_marca)
  returning id into v_cuenta;

  insert into user_profiles (user_id, account_id, role, active, display_name)
  values (p_admin_user_id, v_cuenta, 'admin', true, nullif(trim(p_admin_nombre), ''))
  returning id into v_perfil;
  if v_gerente_total is not null then
    execute $q$insert into public.permission_set_assignments (user_profile_id, permission_set_id, assigned_by) values ($1, $2, $3)$q$
      using v_perfil, v_gerente_total, p_creada_por;
  end if;

  insert into feature_flags (account_id, feature_key, enabled, source, granted_by, grant_reason)
  values (v_cuenta, 'conta', true, 'manual_grant', p_creada_por, trim(p_motivo));

  insert into platform_audit_log (platform_admin_id, event_type, target_account_id, target_user_id, details)
  values (v_admin_plataforma, 'account_created', v_cuenta, p_admin_user_id,
    jsonb_build_object('slug', p_slug, 'producto', 'contabilidad', 'marca', p_marca, 'motivo', trim(p_motivo), 'sin_cocina', true));

  return v_cuenta;
end;
$$;

revoke all on function public.conta_crear_cuenta_sola(text, text, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.conta_crear_cuenta_sola(text, text, uuid, text, text, text, uuid) to service_role;
comment on function public.conta_crear_cuenta_sola(text, text, uuid, text, text, text, uuid) is
  'C06 · Alta de una cuenta SOLO de contabilidad: sin Cocina, con el interruptor conta (quién y por qué) y su apunte en platform_audit_log. Solo service_role (edge function conta-crear-cuenta).';

-- ── 6 · «He olvidado la contraseña» con la marca ────────────────────────────
-- La edge function conta-contrasena manda el correo de la marca solo si el
-- correo es de una persona activa de una cuenta de ESA marca, y como mucho
-- uno por minuto (el correo de Supabase tiene su propio freno; éste no pasa
-- por él). Responde siempre igual a quien lo pide: no dice si el correo existe.
create or replace function public.conta_contrasena_de_marca(p_correo text, p_marca text)
returns table (user_id uuid, se_puede boolean)
language sql stable security definer set search_path = public, auth
as $$
  select u.id,
         (u.recovery_sent_at is null or u.recovery_sent_at < now() - interval '60 seconds')
    from auth.users u
   where lower(u.email) = lower(trim(p_correo))
     and exists (select 1 from public.user_profiles p join public.accounts a on a.id = p.account_id
                  where p.user_id = u.id and p.active and a.product_brand = p_marca and a.deleted_at is null)
   limit 1
$$;
revoke all on function public.conta_contrasena_de_marca(text, text) from public, anon, authenticated;
grant execute on function public.conta_contrasena_de_marca(text, text) to service_role;
comment on function public.conta_contrasena_de_marca(text, text) is
  'C06 · ¿Es este correo de una persona activa de una cuenta de esta marca, y ha pasado un minuto desde la última recuperación? Solo service_role (edge function conta-contrasena).';
