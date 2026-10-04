-- ============================================================================
-- SOLO STAGING-CONTA · ¿PUEDE UN ROL «conta_migraciones» APLICAR LA TANDA?
-- ----------------------------------------------------------------------------
-- Encargo de Julio (04/10): en vez de la contraseña de postgres, un rol propio
-- con los permisos justos, creado por Julio en el SQL Editor (que corre como
-- postgres). Staging-conta está igual que producción en lo que importa:
-- PostgreSQL 17, postgres NO es superusuario y es dueño de supplier,
-- supplier_invoice, compliance_document y vat_rate_for.
--
-- La tanda tiene que ALTERAR esas tablas y REEMPLAZAR vat_rate_for, y en
-- Postgres eso solo lo puede hacer su dueño (o un miembro del rol dueño). Así
-- que el rol necesita ser miembro de postgres. Aquí se prueba, como postgres
-- (el usuario del workflow de staging, igual que el SQL Editor):
--
--   1. Crear el rol conta_migraciones: lo que haría el script.
--   2. GRANT postgres TO conta_migraciones: lo que le daría los permisos.
--   3. Sin esa membresía, ¿puede el rol alterar supplier o reemplazar
--      vat_rate_for? (Lo que haría la tanda.)
--
-- Cada resultado se comprueba (no se supone) y se escribe. TODO TERMINA EN
-- ROLLBACK: staging queda igual.
-- ============================================================================

\set ON_ERROR_STOP 1

select current_user as quien, current_setting('server_version') as version,
       (select rolsuper from pg_roles where rolname = current_user) as superusuario \gset
\echo 'Conectado como' :quien '· PostgreSQL' :version '· superusuario:' :superusuario

-- 1 · El rol, como lo crearía el script.
create role conta_migraciones login noinherit connection limit 2;
\echo 'Paso 1: rol conta_migraciones creado.'

-- 2 · La membresía de postgres. :ERROR se lee JUSTO después de la orden.
savepoint membresia;
\set ON_ERROR_STOP 0
grant postgres to conta_migraciones;
\set grant_fallo :ERROR
\set ON_ERROR_STOP 1
\if :grant_fallo
  \echo 'Paso 2: GRANT postgres TO conta_migraciones → FALLA:' :'LAST_ERROR_MESSAGE'
\else
  \echo 'Paso 2: GRANT postgres TO conta_migraciones → se concede.'
\endif
rollback to savepoint membresia;

-- 3 · Sin la membresía: lo que hace la tanda, como conta_migraciones.
-- (postgres creó el rol, así que puede darse SET sobre él para probar.)
grant conta_migraciones to postgres with set true;

savepoint alterar;
set role conta_migraciones;
\set ON_ERROR_STOP 0
alter table public.supplier add column if not exists prueba_permiso text;
\set alterar_fallo :ERROR
\set ON_ERROR_STOP 1
\if :alterar_fallo
  \echo 'Paso 3a: ALTER TABLE supplier como conta_migraciones → FALLA:' :'LAST_ERROR_MESSAGE'
\else
  \echo 'Paso 3a: ALTER TABLE supplier como conta_migraciones → se puede.'
\endif
rollback to savepoint alterar;

savepoint reemplazar;
set role conta_migraciones;
\set ON_ERROR_STOP 0
create or replace function public.vat_rate_for(p_category_id uuid, p_date date)
returns table(rate numeric, equivalence_surcharge numeric) language sql stable as $$ select null::numeric, null::numeric $$;
\set reemplazar_fallo :ERROR
\set ON_ERROR_STOP 1
\if :reemplazar_fallo
  \echo 'Paso 3b: CREATE OR REPLACE vat_rate_for como conta_migraciones → FALLA:' :'LAST_ERROR_MESSAGE'
\else
  \echo 'Paso 3b: CREATE OR REPLACE vat_rate_for como conta_migraciones → se puede.'
\endif
rollback to savepoint reemplazar;
reset role;

\echo 'RESULTADO · el GRANT de postgres falla:' :grant_fallo '· ALTER supplier falla sin él:' :alterar_fallo '· reemplazar vat_rate_for falla sin él:' :reemplazar_fallo

-- Nada de esto se queda.
rollback;
