-- supabase/staging/sql/20261007_c02_prueba_sin_dueno.sql
--
-- C02 · Prueba de la 0187: no quedan huérfanos; borrar un proveedor enlazado
-- quita su enlace y lo deja en el registro; vuelta atrás. Termina en ROLLBACK.

begin;

do $$ begin
  if exists (select 1 from public.company_account_link l where l.entity = 'supplier'
              and not exists (select 1 from public.supplier s where s.id::text = l.entity_id)) then
    raise exception 'PRUEBA C02 0187: quedan enlaces de proveedores que no existen';
  end if;
end $$;

insert into public.supplier (id, account_id, name)
values ('c02c0187-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'Proveedor de Prueba Borrado');
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.company_account_link_set('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'supplier', 'c02c0187-0000-4000-8000-000000000001', 'principal',
    (select id from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '40000000'), 'prueba', 'manual');
end $$;
reset role;

delete from public.supplier where id = 'c02c0187-0000-4000-8000-000000000001';
do $$ begin
  if exists (select 1 from public.company_account_link where entity_id = 'c02c0187-0000-4000-8000-000000000001') then
    raise exception 'PRUEBA C02 0187: borrar el proveedor no ha quitado su enlace';
  end if;
  if not exists (select 1 from public.company_account_log where que = 'enlace_quitado' and code = '40000000'
                  and despues ->> 'entity_id' = 'c02c0187-0000-4000-8000-000000000001' and despues ->> 'motivo' = 'borrado') then
    raise exception 'PRUEBA C02 0187: no está en el registro';
  end if;
  raise notice 'PRUEBA C02 0187 · borrar quita el enlace y lo registra';
end $$;

\ir ../../vuelta-atras/20261007T0187_c02_enlaces_sin_dueno.down.sql
do $$ begin
  if exists (select 1 from pg_trigger where tgname = 'company_account_link_sin_dueno') or to_regprocedure('public.company_account_link_sin_dueno()') is not null then
    raise exception 'PRUEBA C02 0187: la vuelta atrás deja disparadores o la función';
  end if;
  raise notice 'PRUEBA C02 0187 · vuelta atrás en verde';
end $$;

rollback;
