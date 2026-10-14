-- Vuelta atrás de «C06 · Contabilidad sola — el alta de una cuenta solo de
-- contabilidad» (20261111T0100). Los seis disparadores vuelven a su cuerpo de
-- producción del 13/10 (copiado con pg_get_functiondef), se quita la función
-- del alta y las dos columnas. Si ya hay cuentas con business_type
-- 'otra_actividad', la restricción de antes no entra: se dice y se para, en vez
-- de reescribirles el tipo a escondidas.

do $$
begin
  if exists (select 1 from public.accounts where business_type = 'otra_actividad') then
    raise exception 'Hay cuentas con business_type = otra_actividad: la restricción de antes no las admite. Decide antes qué tipo llevan.';
  end if;
end $$;

drop function if exists public.conta_crear_cuenta_sola(text, text, uuid, text, text, text, uuid);
drop function if exists public.conta_contrasena_de_marca(text, text);

create or replace function public.trg_adopt_mandatory_courses_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.adopt_mandatory_courses(new.id);
  return new;
end;
$function$;

create or replace function public.trg_seed_appcc_on_account_insert()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
BEGIN
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
  PERFORM public.seed_ingredient_families_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

create or replace function public.tg_seed_staff_roles()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  perform public.seed_staff_roles_for_account(new.id);
  return new;
end;
$function$;

create or replace function public.create_account_gestoria_config_default()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
BEGIN
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
  PERFORM public.seed_vacation_settings_for_account(NEW.id);
  RETURN NEW;
END;
$function$;

alter table public.accounts drop constraint accounts_business_type_check;
alter table public.accounts add constraint accounts_business_type_check
  check (business_type = any (array['dark_kitchen'::text, 'bar'::text, 'restaurante'::text, 'cafeteria'::text, 'hotel'::text, 'otro'::text]));

alter table public.accounts drop constraint if exists accounts_product_brand_formato;
alter table public.accounts drop column if exists product_brand;
alter table public.feature_flags drop column if exists grant_reason;
