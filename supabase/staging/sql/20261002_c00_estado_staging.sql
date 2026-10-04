-- staging-conta · 02/10/2026 · C00, comprobación previa 8
-- SOLO LECTURA. Confirma que staging-conta sigue como la dejó el C01 antes de
-- empezar el C00. No escribe nada: si algo no cuadra, aborta y lo dice.

do $$
declare
  n int; v text;
begin
  select count(*) into n from accounts;
  if n <> 2 then raise exception 'Se esperaban 2 cuentas de prueba y hay %', n; end if;
  select count(*) into n from accounts
   where id in ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b');
  if n <> 2 then raise exception 'Las cuentas A y B no están'; end if;
  select count(*) into n from accounts
   where id = '00000000-0000-0000-0000-000000000001' or name ilike '%foodint%';
  if n <> 0 then raise exception 'Hay datos de producción en staging (% filas)', n; end if;

  select count(*), max(version) into n, v from supabase_migrations.schema_migrations;
  if n <> 536 or v <> '20261002060718' then
    raise exception 'Historial de migraciones inesperado: % filas, última %', n, v;
  end if;

  select count(*) into n from supplier
   where account_id in ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b');
  if n <> 5 then raise exception 'Se esperaban 5 proveedores de semilla y hay %', n; end if;
  select count(*) into n from cron.job;
  if n <> 0 then raise exception 'Hay % crons en staging y no debería haber ninguno', n; end if;

  raise notice 'staging-conta como la dejó el C01: 2 cuentas de prueba, 0 de producción, 536 migraciones (última 20261002060718), 5 proveedores de semilla, 0 crons.';
end $$;
