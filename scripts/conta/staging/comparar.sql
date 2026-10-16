-- scripts/conta/staging/comparar.sql — la foto de la estructura de `public`.
--
-- W02 (16/10). La MISMA consulta en producción y en staging (regla 31): una
-- línea por objeto, «tipo<TAB>nombre<TAB>huella». Solo lee el catálogo
-- (pg_class, pg_attribute, pg_proc, pg_trigger): ni una fila de datos. Por eso
-- vale con conta_lectura, que no ve information_schema de lo que no puede leer.
--
--   tabla      nombre                     md5 de sus columnas (nombre:tipo:not null:default), en orden de nombre
--   columna    tabla.columna              md5 de tipo, not null y default
--   funcion    nombre(argumentos)         md5 de prosrc (el método de C) | md5 de lo demás
--   disparador tabla.nombre               md5 de pg_get_triggerdef
--
-- Lo que es de una extensión no cuenta: no es nuestro y cambia con la versión.
with
ext as (
  select objid from pg_depend where deptype = 'e'
),
col as (
  select c.relname as tabla, a.attname as columna,
         format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') as def
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where c.relkind in ('r', 'p') and c.oid not in (select objid from ext)
),
fila as (
  select 'tabla' as tipo, tabla as nombre, md5(string_agg(columna || ':' || def, ',' order by columna)) as huella
    from col group by tabla
  union all
  select 'columna', tabla || '.' || columna, md5(def) from col
  union all
  select 'funcion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(p.prosrc) || '|' || md5(p.prokind::text || ':' || pg_get_function_result(p.oid) || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), ''))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.oid not in (select objid from ext)
  union all
  select 'disparador', c.relname || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where not t.tgisinternal
)
select tipo || E'\t' || nombre || E'\t' || huella from fila order by tipo, nombre;
