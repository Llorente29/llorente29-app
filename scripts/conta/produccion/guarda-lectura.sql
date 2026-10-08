-- scripts/conta/produccion/guarda-lectura.sql
--
-- GUARDA 4 del nocturno de producción (cumplimiento-produccion-conta.yml):
-- el usuario con el que se conecta (conta_lectura) NO PUEDE ESCRIBIR.
-- Devuelve una sola línea: vacía si todo está bien, o los nombres de lo que
-- falla separados por espacios. La usan los dos trabajos que leen la base y la
-- prueba de staging supabase/staging/sql/20261013_c04r5_prueba_guarda.sql, que
-- la corre con el rol como está en producción (tiene que pasar) y con un
-- INSERT o una pertenencia a un rol que escribe (tiene que fallar).
--
-- BYPASSRLS NO se rechaza (C04 R5, autorizado por Julio el 08/10/2026):
-- conta_lectura lo tiene a propósito (crear-usuario-lectura.sql) para que la
-- seguridad por filas no le esconda filas a los agentes. No da escritura.
-- Rechazarlo dejó el nocturno en rojo desde la guarda del C04.
--
-- Lo que sí se exige:
--   · sin INSERT, UPDATE, DELETE ni TRUNCATE en ninguna tabla de public,
--     directo o heredado (has_table_privilege lo mira todo: roles y PUBLIC);
--   · ningún permiso concedido que no sea SELECT (information_schema);
--   · no superusuario, sin createrole ni createdb;
--   · no es miembro de ningún rol que pueda escribir en public.
-- La sesión de solo lectura (transaction_read_only) y Foodint al otro lado los
-- comprueba el workflow aparte: no son del rol.
with yo as (select oid, rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles where rolname = current_user),
tablas as (
  select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')),
fallos as (
  select 'escribe-en-public' as f
   where exists (select 1 from tablas t where has_table_privilege(current_user, t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))
  union all
  select 'permiso-que-no-es-select'
   where exists (select 1 from information_schema.role_table_grants
                  where grantee = current_user and privilege_type <> 'SELECT')
  union all
  select 'superusuario' from yo where rolsuper
  union all
  select 'createrole' from yo where rolcreaterole
  union all
  select 'createdb' from yo where rolcreatedb
  union all
  select 'miembro-de-rol-que-escribe:' || r.rolname
    from pg_roles r, yo
   where r.oid <> yo.oid
     and pg_has_role(yo.oid, r.oid, 'MEMBER')
     and exists (select 1 from tablas t where has_table_privilege(r.oid, t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE'))
)
select coalesce(string_agg(f, ' ' order by f), '') from fallos;
