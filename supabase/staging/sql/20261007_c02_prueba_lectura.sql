-- supabase/staging/sql/20261007_c02_prueba_lectura.sql
--
-- C02 · Prueba de la 0185. En staging no existe conta_lectura: aquí se crea
-- DENTRO del ROLLBACK (como en producción, donde lo creó Julio), se aplica la
-- 0185, se comprueba que da SELECT sobre las cuatro tablas y nada más, y se
-- prueba la vuelta atrás. Al terminar no queda ni el rol.

begin;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    raise exception 'PRUEBA C02 0185: conta_lectura ya existe en staging; esta prueba lo da por ausente';
  end if;
end $$;
create role conta_lectura nologin;

\ir ../../migrations/20261007T0185_c02_lectura.sql
do $$
declare t text; n int;
begin
  foreach t in array array['pgc_account', 'company_account', 'company_account_link', 'company_account_log'] loop
    if not has_table_privilege('conta_lectura', 'public.' || t, 'SELECT') then
      raise exception 'PRUEBA C02 0185: conta_lectura no puede leer %', t;
    end if;
    if has_table_privilege('conta_lectura', 'public.' || t, 'INSERT') or has_table_privilege('conta_lectura', 'public.' || t, 'UPDATE')
       or has_table_privilege('conta_lectura', 'public.' || t, 'DELETE') then
      raise exception 'PRUEBA C02 0185: conta_lectura puede escribir en %', t;
    end if;
  end loop;
  select count(*) into n from information_schema.role_table_grants where grantee = 'conta_lectura';
  if n <> 4 then raise exception 'PRUEBA C02 0185: conta_lectura tiene % permisos (se esperaban 4 SELECT)', n; end if;
  raise notice 'PRUEBA C02 0185 · SELECT en las 4 tablas y nada más';
end $$;

\ir ../../vuelta-atras/20261007T0185_c02_lectura.down.sql
do $$ begin
  if exists (select 1 from information_schema.role_table_grants where grantee = 'conta_lectura') then
    raise exception 'PRUEBA C02 0185: la vuelta atrás deja permisos';
  end if;
  raise notice 'PRUEBA C02 0185 · vuelta atrás en verde';
end $$;

rollback;
