-- docs/conta/staging/comparar_estructura.sql
--
-- Huella de la estructura de public + propuestas. Se lanza IGUAL en producción
-- y en staging-conta y se comparan las filas: misma cuenta y mismo md5 = misma
-- estructura. Solo lee. Excluye lo que pertenece a extensiones (postgis…).
-- Ver docs/conta/staging.md.
with
esq as (select oid from pg_namespace where nspname in ('public','propuestas')),
ext as (select objid from pg_depend where deptype = 'e'),
rel as (
  select c.oid, c.relnamespace::regnamespace::text || '.' || c.relname as nombre, c.relkind, c.relrowsecurity, c.relacl
  from pg_class c
  where c.relnamespace in (select oid from esq) and c.oid not in (select objid from ext)
),
fn as (
  select p.oid, p.proacl from pg_proc p
  where p.pronamespace in (select oid from esq) and p.oid not in (select objid from ext)
),
partes as (
  select 'tablas' cat, nombre || ':' ||
    (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' nn' else '' end
       || coalesce(' d=' || pg_get_expr(ad.adbin, ad.adrelid), '') || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum)
     from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped) txt
  from rel where relkind = 'r'
  union all select 'vistas', nombre || ':' || pg_get_viewdef(oid) from rel where relkind in ('v','m')
  union all select 'secuencias', nombre from rel where relkind = 'S'
  union all select 'rls_activado', nombre from rel where relkind = 'r' and relrowsecurity
  union all select 'funciones', pg_get_functiondef(oid) from fn
  union all select 'restricciones', conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace in (select oid from esq)
  union all select 'indices', pg_get_indexdef(i.indexrelid)
    from pg_index i join rel on rel.oid = i.indrelid
  union all select 'triggers', pg_get_triggerdef(t.oid)
    from pg_trigger t join rel on rel.oid = t.tgrelid where not t.tgisinternal
  union all select 'politicas', schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || cmd || ':'
    || roles::text || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public','propuestas')
  union all select 'permisos_tablas', nombre || ':' || coalesce(relacl::text, '')
    from rel
  union all select 'permisos_funciones', p.oid::regprocedure::text || ':' || coalesce(p.proacl::text, '')
    from pg_proc p join fn on fn.oid = p.oid
  union all select 'comentarios', coalesce(d.objoid::regclass::text, d.objoid::text) || ':' || d.objsubid || ':' || d.description
    from pg_description d join rel on rel.oid = d.objoid
  union all select 'comentarios_funciones', d.objoid::regprocedure::text || ':' || d.description
    from pg_description d join fn on fn.oid = d.objoid
)
select cat as categoria, count(*) as n, md5(string_agg(txt, '|' order by txt)) as huella
from partes group by cat order by cat;
