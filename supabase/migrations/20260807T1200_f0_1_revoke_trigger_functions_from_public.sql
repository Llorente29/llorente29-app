-- Aplicada: 2026-08-07 por MCP (verificada en vivo: 0 triggers anon-exec)
-- F0.1 · Revocar EXECUTE de las funciones-trigger DEFINER.
-- Nota: el EXECUTE se hereda de PUBLIC → revocar solo FROM anon/authenticated NO basta.
-- Los triggers se disparan por el mecanismo de trigger, no por el EXECUTE del llamante:
-- revocar de PUBLIC es inocuo y cierra el acceso vía /rest/v1/rpc.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Guard: abortar si quedó algún trigger DEFINER ejecutable por anon.
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.prosecdef and p.prorettype='pg_catalog.trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then
    raise exception 'F0.1 incompleta: % triggers siguen anon-exec', n;
  end if;
end $$;
