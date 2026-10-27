-- scripts/conta/produccion/cuentas/l00-ancestros-por-cuenta.sql
--
-- L00 · Respuesta 6 (27/10) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE, y solo el catálogo (pg_proc): ninguna tabla que crezca sola.
-- La huella de kitchen_ancestors_of, cuántas firmas tiene (regla 2: una) y qué
-- guarda usa. Medido en producción el 27/10 a las 16:50 UTC, antes:
-- eef6dc15 · 1 · administrador o encargado.
select clave, valor from (
  select 1 o, 'huella de kitchen_ancestors_of' clave, (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'kitchen_ancestors_of') valor union all
  select 2, 'firmas de kitchen_ancestors_of', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'kitchen_ancestors_of')::text union all
  select 3, 'guarda de kitchen_ancestors_of', (select case when p.prosrc ~ 'belongs_to_account' then 'de la cuenta' when p.prosrc ~ 'current_user_is_admin_or_manager_of' then 'administrador o encargado' else 'otra' end from pg_proc p where p.oid = 'public.kitchen_ancestors_of(uuid)'::regprocedure)
) t order by o;
