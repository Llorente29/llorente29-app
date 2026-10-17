-- supabase/staging/sql/20261120_w02_secreto_despacho_relevo_prueba.sql
--
-- SOLO STAGING. El relevo del secreto del despacho y su vuelta atrás,
-- ejecutados de verdad (regla 8: que no sea una vuelta atrás que nadie ha
-- corrido):
--   supabase/migrations/20261120T0100_w02_secreto_despacho_relevo.sql
--   supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql
--
--   1. Staging no tiene catcher_dispatch_secret en Vault: se crea uno de
--      prueba, dentro de la transacción. Si ya hubiera uno, se usa ese.
--   2. \i 0100: hay dos, catcher_dispatch_secret es OTRO (32 bytes en hex) y
--      el _anterior es el de antes.
--   3. \i 0100.down: catcher_dispatch_secret vuelve a ser el de antes y el
--      _anterior ya no existe.
-- Se compara por la huella (md5), con la misma consulta antes y después
-- (regla 31); ningún valor sale por pantalla.
--
-- Todo acaba en ROLLBACK: staging es compartido y no cambia.
-- sin usuario: aplica la migración y su vuelta atrás, que en producción corren
-- como dueño de la base; un usuario no lee Vault.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA relevo del secreto: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- 1. Lo de antes.
do $$ begin
  if exists (select 1 from vault.secrets where name = 'catcher_dispatch_secret_anterior') then
    raise exception 'PRUEBA relevo del secreto: staging ya tiene un catcher_dispatch_secret_anterior; la prueba parte de sin relevo';
  end if;
  if not exists (select 1 from vault.secrets where name = 'catcher_dispatch_secret') then
    perform vault.create_secret('prueba-w02-' || gen_random_uuid()::text, 'catcher_dispatch_secret', 'PRUEBA W02: se deshace al acabar');
  end if;
end $$;
create temp table w02_antes on commit drop as
  select md5(decrypted_secret) as huella from vault.decrypted_secrets where name = 'catcher_dispatch_secret';

-- 2. El relevo.
\i supabase/migrations/20261120T0100_w02_secreto_despacho_relevo.sql
do $$
declare
  v_antes text := (select huella from w02_antes);
  v_vivo  text := (select md5(decrypted_secret) from vault.decrypted_secrets where name = 'catcher_dispatch_secret');
  v_ant   text := (select md5(decrypted_secret) from vault.decrypted_secrets where name = 'catcher_dispatch_secret_anterior');
begin
  if v_ant is distinct from v_antes then raise exception 'PRUEBA relevo: el _anterior no es el secreto de antes'; end if;
  if v_vivo is null or v_vivo = v_antes then raise exception 'PRUEBA relevo: catcher_dispatch_secret no ha cambiado'; end if;
  if (select length(decrypted_secret) from vault.decrypted_secrets where name = 'catcher_dispatch_secret') <> 64 then
    raise exception 'PRUEBA relevo: el secreto nuevo no son 32 bytes en hexadecimal';
  end if;
  raise notice 'PRUEBA relevo: el vivo es otro y el _anterior es el de antes';
end $$;
-- 3. La vuelta atrás.
\i supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql
do $$
declare
  v_antes text := (select huella from w02_antes);
  v_vivo  text := (select md5(decrypted_secret) from vault.decrypted_secrets where name = 'catcher_dispatch_secret');
begin
  if v_vivo is distinct from v_antes then raise exception 'PRUEBA vuelta atrás: catcher_dispatch_secret no ha vuelto al de antes'; end if;
  if exists (select 1 from vault.secrets where name = 'catcher_dispatch_secret_anterior') then
    raise exception 'PRUEBA vuelta atrás: el _anterior sigue ahí';
  end if;
  raise notice 'PRUEBA vuelta atrás: el de antes otra vez, y sin _anterior';
end $$;

rollback;
