do $guarda$
declare n int;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname not in ('pg_catalog','information_schema')
    and p.proname <> 'list_costless_sold_products'
    and p.prosrc ilike '%list_costless_sold_products%';
  if n > 0 then
    raise exception 'No se borra: % funciones la nombran', n;
  end if;

  select count(*) into n from cron.job where command ilike '%list_costless_sold_products%';
  if n > 0 then
    raise exception 'No se borra: % crons la nombran', n;
  end if;
end
$guarda$;

drop function if exists public.list_costless_sold_products(uuid, timestamptz, timestamptz);

do $verif$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'list_costless_sold_products') then
    raise exception 'La funcion sigue existiendo';
  end if;
end
$verif$;