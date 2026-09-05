drop table permission_set_assignments;

do $$
begin
  if to_regclass('public.permission_set_assignments') is not null then
    raise exception 'A.1: permission_set_assignments sigue existiendo';
  end if;
end $$;