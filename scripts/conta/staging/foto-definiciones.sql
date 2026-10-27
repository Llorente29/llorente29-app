-- scripts/conta/staging/foto-definiciones.sql
--
-- W06 (26/10) · LA FOTO DE LAS DEFINICIONES, para comparar antes y después de
-- deshacer una tanda. SOLO LEE. Una fila por objeto: «clave,valor».
--
-- Las cuentas de la tanda («cuenta:») miden cifras; esto mide lo que no es una
-- cifra y se puede quedar a medias al deshacer: el #230 dejó el almacén
-- conta-entrada y el #241 se paró por otra cosa, pero un índice sin borrar o
-- una columna que se queda tampoco los cuenta nadie. Aquí van todos:
--
--   función   huella de su definición entera (pg_get_functiondef: cuerpo,
--             argumentos, SECURITY, search_path…) y de sus permisos;
--   índice    su definición exacta (pg_get_indexdef);
--   columna   tipo, si admite vacío y su valor por defecto;
--   tabla     tipo de relación, RLS y huella de sus permisos;
--   restricción, disparador, política y vista: su definición (o su huella);
--   tipo      los valores de cada enum;
--   almacén   cada almacén de Storage: si es público, su límite y sus tipos;
--   tarea     cada tarea de pg_cron: su horario y la huella de su orden.
--
-- De la base entera, a propósito: lo que no toca la tanda sale igual a los dos
-- lados y no se enseña; lo que sí toca, sale. Sin los esquemas del sistema ni
-- w06_staging (el registro de staging, que no es de ninguna tanda).
with esq as (
  select oid, nspname from pg_namespace
  where nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'w06_staging', 'e2e_carril')
    and nspname !~ '^pg_(temp|toast_temp)_'
)
select clave, valor from (
  select 'esquema ' || e.nspname as clave, 'existe' as valor from esq e
  union all
  select 'función ' || p.oid::regprocedure::text,
         'huella ' || left(md5(pg_get_functiondef(p.oid)), 12) || ' · permisos ' || left(md5(coalesce(p.proacl::text, '')), 8)
  from pg_proc p join esq e on e.oid = p.pronamespace
  where p.prokind in ('f', 'p')
  union all
  select 'agregado ' || p.oid::regprocedure::text, 'permisos ' || left(md5(coalesce(p.proacl::text, '')), 8)
  from pg_proc p join esq e on e.oid = p.pronamespace
  where p.prokind in ('a', 'w')
  union all
  select 'índice ' || e.nspname || '.' || c.relname, pg_get_indexdef(c.oid)
  from pg_class c join esq e on e.oid = c.relnamespace
  where c.relkind in ('i', 'I')
  union all
  select 'tabla ' || e.nspname || '.' || c.relname,
         case c.relkind when 'r' then 'tabla' when 'p' then 'tabla particionada' when 'v' then 'vista' when 'm' then 'vista materializada'
                        when 'S' then 'secuencia' when 'f' then 'tabla externa' when 'c' then 'tipo compuesto' else c.relkind::text end
         || case when c.relrowsecurity then ' · RLS' else '' end
         || case when c.relforcerowsecurity then ' forzada' else '' end
         || ' · permisos ' || left(md5(coalesce(c.relacl::text, '')), 8)
  from pg_class c join esq e on e.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
  union all
  select 'columna ' || e.nspname || '.' || c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
         || case when a.attnotnull then ' not null' else '' end
         || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
         || case when a.attgenerated <> '' then ' generada' else '' end
         || case when a.attidentity <> '' then ' identity' else '' end
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join esq e on e.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f')
  union all
  select 'restricción ' || e.nspname || '.' || c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
  from pg_constraint k join pg_class c on c.oid = k.conrelid join esq e on e.oid = c.relnamespace
  union all
  select 'disparador ' || e.nspname || '.' || c.relname || '.' || t.tgname,
         pg_get_triggerdef(t.oid) || case t.tgenabled when 'D' then ' · DESACTIVADO' else '' end
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join esq e on e.oid = c.relnamespace
  where not t.tgisinternal
  union all
  select 'política ' || pl.schemaname || '.' || pl.tablename || '.' || pl.policyname,
         pl.cmd || ' · ' || pl.permissive || ' · ' || array_to_string(pl.roles, ' ')
         || ' · huella ' || left(md5(coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, '')), 12)
  from pg_policies pl
  where pl.schemaname not in ('w06_staging')
  union all
  select 'vista ' || e.nspname || '.' || c.relname, 'huella ' || left(md5(pg_get_viewdef(c.oid)), 12)
  from pg_class c join esq e on e.oid = c.relnamespace
  where c.relkind in ('v', 'm')
  union all
  select 'tipo ' || e.nspname || '.' || t.typname,
         coalesce((select string_agg(en.enumlabel, ' · ' order by en.enumsortorder) from pg_enum en where en.enumtypid = t.oid), t.typtype::text)
  from pg_type t join esq e on e.oid = t.typnamespace
  where t.typtype in ('e', 'd')
  union all
  -- Los almacenes de Storage y las tareas de pg_cron, solo si existen (query_to_xml:
  -- la consulta no se compila si la tabla no está).
  select 'almacén ' || (x->>'id'), 'público ' || (x->>'public') || ' · límite ' || coalesce(x->>'file_size_limit', '—')
         || ' · tipos ' || coalesce(x->>'allowed_mime_types', '—')
  from jsonb_array_elements(case when to_regclass('storage.buckets') is null then '[]'::jsonb else
         (xpath('/row/j/text()', query_to_xml('select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''public'', public, ''file_size_limit'', file_size_limit, ''allowed_mime_types'', allowed_mime_types::text)), ''[]'')::text as j from storage.buckets', false, true, '')))[1]::text::jsonb end) x
  union all
  select 'tarea ' || (x->>'jobname'), (x->>'schedule') || ' · huella ' || left(md5(x->>'command'), 12) || ' · ' || case when (x->>'active')::boolean then 'activa' else 'parada' end
  from jsonb_array_elements(case when to_regclass('cron.job') is null then '[]'::jsonb else
         (xpath('/row/j/text()', query_to_xml('select coalesce(jsonb_agg(jsonb_build_object(''jobname'', coalesce(jobname, jobid::text), ''schedule'', schedule, ''command'', command, ''active'', active)), ''[]'')::text as j from cron.job', false, true, '')))[1]::text::jsonb end) x
) f
order by clave;
