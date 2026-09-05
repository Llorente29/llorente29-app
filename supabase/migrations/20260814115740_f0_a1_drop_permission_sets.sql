drop table permission_sets;

do $$
begin
  if to_regclass('public.permission_sets') is not null then
    raise exception 'A.1: permission_sets sigue existiendo';
  end if;
end $$;