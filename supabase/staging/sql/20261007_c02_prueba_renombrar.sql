-- supabase/staging/sql/20261007_c02_prueba_renombrar.sql
--
-- C02 · Prueba de la 0189: una subcuenta propia cambia de nombre y queda en el
-- registro; una de serie no; vuelta atrás. Termina en ROLLBACK.

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_sub uuid; v_code text; v_serie uuid; v text; j jsonb;
begin
  j := public.company_account_add('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '629', 'Prueba renombrar', null, null, null, 'prueba', 'manual');
  v_sub := (j ->> 'id')::uuid;
  v_code := j ->> 'code';
  v := public.company_account_rename(v_sub, '  Prueba   renombrada  ', 'prueba');
  if v <> 'Prueba renombrada' or (select name from public.company_account where id = v_sub) <> 'Prueba renombrada' then
    raise exception 'PRUEBA C02 0189: el nombre es «%»', v;
  end if;
  if not exists (select 1 from public.company_account_log where que = 'renombrada' and code = v_code
                  and antes ->> 'name' = 'Prueba renombrar' and despues ->> 'name' = 'Prueba renombrada') then
    raise exception 'PRUEBA C02 0189: no está en el registro';
  end if;
  select id into v_serie from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code = '62900000';
  begin
    perform public.company_account_rename(v_serie, 'Otro nombre', 'prueba');
    raise exception 'PRUEBA C02 0189: una de serie se ha dejado renombrar';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.company_account_rename(v_sub, '   ', 'prueba');
    raise exception 'PRUEBA C02 0189: se ha dejado un nombre vacío';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PRUEBA C02 0189 · % renombrada, con registro; la de serie y el nombre vacío, rechazados', v_code;
end $$;
reset role;

\ir ../../vuelta-atras/20261007T0189_c02_renombrar_subcuenta.down.sql
do $$ begin
  if to_regprocedure('public.company_account_rename(uuid, text, text)') is not null then
    raise exception 'PRUEBA C02 0189: la vuelta atrás deja la función';
  end if;
  raise notice 'PRUEBA C02 0189 · vuelta atrás en verde';
end $$;

rollback;
