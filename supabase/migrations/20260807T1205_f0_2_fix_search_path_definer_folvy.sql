-- Aplicada: 2026-08-07 por MCP (verificada en vivo: 0 DEFINER de Folvy sin search_path)
-- F0.2 · Fijar search_path en las funciones SECURITY DEFINER de Folvy que lo tenían mutable.
-- Se excluyen funciones de extensión (PostGIS st_estimatedextent): no somos owner y son
-- helpers de solo lectura → excepción documentada, no se tocan.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- Guard: abortar si quedó alguna DEFINER de Folvy (no-extensión) sin search_path.
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.prosecdef
    and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  if n <> 0 then
    raise exception 'F0.2 incompleta: % funciones Folvy sin search_path', n;
  end if;
end $$;
