-- staging-conta · 02/10/2026
-- Acceso de administrador a la cuenta de prueba A para el usuario que Julio
-- creó en el panel (Authentication → Users), para probar la ficha a mano en la
-- vista previa de Vercel antes de producción.
--
-- Ancla por el id del usuario, no por el email: el email no entra en el
-- repositorio. Cuenta A = c01a0000-…-0a, inventada (regla 9: nada de Folvy
-- Interno). Si algo no cuadra, aborta y no escribe nada.

do $$
declare
  julio   constant uuid := '2d1a4a73-99b6-4ffc-bd6f-9ef1da94647d';
  cuenta  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  n int;
begin
  -- Guarda 1: el usuario existe, está confirmado y no es de prueba.
  select count(*) into n from auth.users
   where id = julio and email_confirmed_at is not null and email not like '%@prueba.folvy.test';
  if n <> 1 then raise exception 'Guarda 1: el usuario % no existe, no está confirmado o es de prueba', julio; end if;

  -- Guarda 2: la cuenta A existe y no es Folvy Interno.
  select count(*) into n from public.accounts where id = cuenta;
  if n <> 1 or cuenta = '00000000-0000-0000-0000-000000000001' then
    raise exception 'Guarda 2: la cuenta A no está';
  end if;

  -- Guarda 3: todavía no tiene perfil en ninguna cuenta.
  select count(*) into n from public.user_profiles where user_id = julio;
  if n <> 0 then raise exception 'Guarda 3: el usuario ya tiene % perfil(es); no se toca', n; end if;

  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (julio, cuenta, 'admin', true, 'Julio', now(), now());

  -- Comprobación: exactamente un perfil, admin y activo, en la cuenta A.
  select count(*) into n from public.user_profiles
   where user_id = julio and account_id = cuenta and role = 'admin' and active;
  if n <> 1 then raise exception 'Comprobación: el perfil no quedó como se esperaba (%)', n; end if;
  raise notice 'Acceso dado: 1 perfil admin activo en la cuenta de prueba A';
end $$;
