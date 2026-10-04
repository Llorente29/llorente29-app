-- supabase/staging/sql/20261007_c02_prueba_serie.sql
--
-- C02, tarea 2 · Prueba de la serie del plan contable en staging-conta, una
-- vez aplicadas 20261007T0100 y 0110. Termina en ROLLBACK: no deja nada.
--
--   1. Recuentos: pymes 772 códigos y 615 hojas; general 898 y 714 (con la 502 y la 1141
--      recuperada); 7 y 9 grupos; pymes sin grupos 8 ni 9.
--   2. Las correcciones están puestas (232 y 606 de pymes, 500/501/502 del
--      general) con el título del BOE al lado.
--   3. Rellenar las hojas a 6, 8 y 12 dígitos: cero choques.
--   4. Lectura: un usuario con sesión lee; nadie escribe.
--   5. Vuelta atrás: los dos .down.sql dejan la base sin la tabla.

begin;

\echo '>>> 1-3. Recuentos, correcciones y relleno'
do $$
declare n int; h int; g int;
begin
  select count(*) filter (where length(code) > 1), count(*) filter (where is_leaf), count(*) filter (where length(code) = 1)
    into n, h, g from public.pgc_account where plan = 'pymes' and valid_to is null;
  if (n, h, g) is distinct from (772, 615, 7) then raise exception 'PRUEBA C02: pymes tiene % códigos, % hojas y % grupos (esperado 772, 615, 7)', n, h, g; end if;
  select count(*) filter (where length(code) > 1), count(*) filter (where is_leaf), count(*) filter (where length(code) = 1)
    into n, h, g from public.pgc_account where plan = 'general' and valid_to is null;
  if (n, h, g) is distinct from (898, 714, 9) then raise exception 'PRUEBA C02: general tiene % códigos, % hojas y % grupos (esperado 898, 714, 9)', n, h, g; end if;
  if exists (select 1 from public.pgc_account where plan = 'pymes' and group_code in (8, 9)) then
    raise exception 'PRUEBA C02: pymes tiene cuentas de los grupos 8 o 9';
  end if;

  if (select name || ' | ' || boe_name from public.pgc_account where plan = 'pymes' and code = '232')
     is distinct from 'Instalaciones técnicas en montaje | Propiedad industrial' then
    raise exception 'PRUEBA C02: la 232 de pymes no lleva la corrección';
  end if;
  if (select name from public.pgc_account where plan = 'pymes' and code = '606') is distinct from 'Descuentos sobre compras por pronto pago' then
    raise exception 'PRUEBA C02: la 606 de pymes no lleva la corrección';
  end if;
  if (select string_agg(code || '=' || name || '/' || coalesce(boe_name, '∅'), ' · ' order by code)
        from public.pgc_account where plan = 'general' and code in ('500', '501', '502'))
     is distinct from '500=Obligaciones y bonos a corto plazo/Obligaciones y bonos a corto plazo Obligaciones y bonos convertibles a corto plazo · '
                   || '501=Obligaciones y bonos convertibles a corto plazo/Acciones o participaciones a corto plazo consideradas como pasivos financieros · '
                   || '502=Acciones o participaciones a corto plazo consideradas como pasivos financieros/∅' then
    raise exception 'PRUEBA C02: 500/501/502 del general no están como deben';
  end if;

  foreach n in array array[6, 8, 12] loop
    select count(*) into h from (
      select plan, rpad(code, n, '0') r from public.pgc_account where is_leaf and valid_to is null
      group by plan, rpad(code, n, '0') having count(*) > 1) x;
    if h <> 0 then raise exception 'PRUEBA C02: % choques al rellenar las hojas a % dígitos', h, n; end if;
  end loop;
  raise notice 'PRUEBA C02 · 1-3 en verde';
end $$;

\echo '>>> 4. Lectura con sesión; nadie escribe'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare fallo text;
begin
  if (select count(*) from public.pgc_account) <> 779 + 907 then raise exception 'PRUEBA C02: con sesión no se lee la serie entera'; end if;
  begin
    insert into public.pgc_account (plan, code, name, group_code, parent_code, is_leaf, legal_ref, valid_from, boe_version_id, source_key, source_sha256, verified_at)
    values ('pymes', '6299', 'Inventada', 6, '629', true, 'x', current_date, 'x', 'rd-1515-2007', 'x', current_date);
    raise exception 'PRUEBA C02: un usuario con sesión ha podido escribir en la serie';
  exception when insufficient_privilege then fallo := sqlerrm;
  end;
  raise notice 'PRUEBA C02 · 4 en verde (escribir: %)', fallo;
end $$;
reset role;

\echo '>>> 5. Vuelta atrás'
\ir ../../vuelta-atras/20261007T0110_c02_pgc_serie.down.sql
do $$ begin
  if (select count(*) from public.pgc_account) <> 0 then raise exception 'PRUEBA C02: la vuelta atrás de la 0110 no vacía la serie'; end if;
end $$;
\ir ../../vuelta-atras/20261007T0100_c02_pgc_account.down.sql
do $$ begin
  if to_regclass('public.pgc_account') is not null then raise exception 'PRUEBA C02: la vuelta atrás de la 0100 no quita la tabla'; end if;
  raise notice 'PRUEBA C02 · 5 en verde';
end $$;

rollback;
