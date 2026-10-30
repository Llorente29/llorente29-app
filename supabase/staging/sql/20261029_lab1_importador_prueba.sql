-- supabase/staging/sql/20261029_lab1_importador_prueba.sql
--
-- SOLO STAGING. Prueba de la 0850 (LAB1, tanda 1 del importador de Cegid: el
-- lote y las cabeceras), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Entra COMO CADA UNO, con su sesión de verdad (request.jwt.claims +
-- role): el administrador y el encargado de la cuenta A, y el administrador de
-- la cuenta B. Las cabeceras son las del paquete de Cegid (solo nombres); el
-- fichero es inventado.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás; nada de lab_import.
--   1 · el administrador guarda las cabeceras; el mismo fichero otra vez se
--       reconoce (repetido) y no hace otro lote.
--   2 · nadie más: ni el encargado, ni el administrador de otra cuenta, ni sin
--       sesión; y no ven el lote.
--   3 · solo cabeceras: una hoja con algo más (valores) no entra.
--   4 · sin escritura directa en las dos tablas.
--   5 · la vuelta atrás: nada de lab_import.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA LAB1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select to_regclass('public.lab_import_lote') is not null as lab1_aplicada \gset
\if :lab1_aplicada
\i supabase/vuelta-atras/20261029T0850_lab1_importador_lote.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('cuenta_b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1'),
  ('huella', repeat('ab', 32)),
  ('hojas', '[{"nombre":"Conceptos","columnas":["codigo","concepto","tipo","codigo_red"],"filas":3},'
            '{"nombre":"Empresa","columnas":["código ERP10","razón social","NIF"],"filas":3}]');

do $$
declare v_falta text;
begin
  if to_regclass('public.lab_import_lote') is not null or to_regclass('public.lab_import_fila') is not null
     or to_regprocedure('public.lab_import_leer_cabeceras(uuid,text,text,jsonb,jsonb)') is not null then
    raise exception 'PRUEBA LAB1 · 0: ya hay algo de la 0850 antes de aplicarla.';
  end if;
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin', 'cuenta'), ('encargado', 'manager', 'cuenta'), ('admin_b', 'admin', 'cuenta_b')) x(c, rol, cta)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = x.cta) and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA LAB1 · faltan los usuarios de prueba: %.', v_falta; end if;
  raise notice '0 · lo de antes: nada de lab_import';
end $$;

\i supabase/migrations/20261029T0850_lab1_importador_lote.sql
-- Solo añade: se puede pasar dos veces.
\i supabase/migrations/20261029T0850_lab1_importador_lote.sql

-- ── 1 · El administrador guarda las cabeceras ───────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); h text := (select v from _s where clave = 'huella');
        hojas jsonb := (select v::jsonb from _s where clave = 'hojas'); r1 jsonb; r2 jsonb;
begin
  r1 := public.lab_import_leer_cabeceras(a, 'paquete inventado.xlsx', h, hojas, '{"completa": false}');
  if (r1 ->> 'repetido')::boolean or r1 ->> 'estado' <> 'leido' then raise exception 'PRUEBA LAB1 · 1: el primer lote no es nuevo y «leido» (%).', r1; end if;
  r2 := public.lab_import_leer_cabeceras(a, 'el mismo, con otro nombre.xlsx', h, hojas, '{"completa": false}');
  if not (r2 ->> 'repetido')::boolean or r2 ->> 'id' <> r1 ->> 'id' then raise exception 'PRUEBA LAB1 · 1: el mismo fichero no se reconoce (%).', r2; end if;
  if (select count(*) from public.lab_import_lote where account_id = a) <> 1 then raise exception 'PRUEBA LAB1 · 1: el mismo fichero hace dos lotes.'; end if;
  if (select resumen -> 'hojas' -> 0 ->> 'nombre' from public.lab_import_lote where id = (r1 ->> 'id')::uuid) <> 'Conceptos'
     or (select fichero_nombre from public.lab_import_lote where id = (r1 ->> 'id')::uuid) <> 'el mismo, con otro nombre.xlsx' then
    raise exception 'PRUEBA LAB1 · 1: el lote no guarda las cabeceras o el nombre de ahora.';
  end if;
  insert into _s values ('lote', r1 ->> 'id');
  raise notice '1 · el administrador guarda las cabeceras; el mismo fichero, un solo lote';
end $$;
reset role;

-- ── 2 · Nadie más ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); ok boolean := false;
begin
  begin
    perform public.lab_import_leer_cabeceras(a, 'x.xlsx', repeat('cd', 32), (select v::jsonb from _s where clave = 'hojas'));
  exception when insufficient_privilege then ok := sqlerrm = 'NO_AUTORIZADO'; end;
  if not ok then raise exception 'PRUEBA LAB1 · 2: el encargado importa.'; end if;
  if exists (select 1 from public.lab_import_lote) then raise exception 'PRUEBA LAB1 · 2: el encargado ve los lotes.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); ok boolean := false;
begin
  begin
    perform public.lab_import_leer_cabeceras(a, 'x.xlsx', repeat('cd', 32), (select v::jsonb from _s where clave = 'hojas'));
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA LAB1 · 2: el administrador de otra cuenta importa en la A.'; end if;
  if exists (select 1 from public.lab_import_lote where id = (select v::uuid from _s where clave = 'lote')) then
    raise exception 'PRUEBA LAB1 · 2: el administrador de otra cuenta ve el lote de la A.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform public.lab_import_leer_cabeceras((select v::uuid from _s where clave = 'cuenta'), 'x.xlsx', repeat('cd', 32), '[]');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA LAB1 · 2: sin sesión se llama a la función.'; end if;
  raise notice '2 · nadie más: ni el encargado, ni otra cuenta, ni sin sesión';
end $$;
reset role;

-- ── 3 · Solo cabeceras ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); n int := 0;
begin
  begin
    perform public.lab_import_leer_cabeceras(a, 'x.xlsx', repeat('ef', 32),
      '[{"nombre":"Empresa","columnas":["NIF"],"filas":1,"valores":["B00000000"]}]');
  exception when invalid_parameter_value then n := n + 1; end;
  begin
    perform public.lab_import_leer_cabeceras(a, 'x.xlsx', repeat('ef', 32), '[{"nombre":"Empresa","columnas":[{"NIF":"B00000000"}],"filas":1}]');
  exception when invalid_parameter_value then n := n + 1; end;
  begin
    perform public.lab_import_leer_cabeceras(a, 'x.xlsx', 'no-es-una-huella', (select v::jsonb from _s where clave = 'hojas'));
  exception when invalid_parameter_value then n := n + 1; end;
  if n <> 3 then raise exception 'PRUEBA LAB1 · 3: entra algo que no son solo cabeceras (% de 3 paradas).', n; end if;
  raise notice '3 · solo cabeceras: lo que trae valores no entra';
end $$;

-- ── 4 · Sin escritura directa ───────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); n int := 0;
begin
  begin
    insert into public.lab_import_lote (account_id, fichero_nombre, fichero_huella) values (a, 'x', repeat('aa', 32));
  exception when insufficient_privilege then n := n + 1; end;
  begin
    update public.lab_import_lote set estado = 'aplicado' where account_id = a;
  exception when insufficient_privilege then n := n + 1; end;
  begin
    insert into public.lab_import_fila (lote_id, account_id, hoja, fila_n, datos, huella)
    values ((select v::uuid from _s where clave = 'lote'), a, 'conceptos', 1, '{}', 'x');
  exception when insufficient_privilege then n := n + 1; end;
  if n <> 3 then raise exception 'PRUEBA LAB1 · 4: el administrador escribe directo en las tablas del lote (% de 3 cerradas).', n; end if;
  raise notice '4 · sin escritura directa en el lote ni en las filas';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261029T0850_lab1_importador_lote.down.sql
do $$
begin
  if to_regclass('public.lab_import_lote') is not null or to_regclass('public.lab_import_fila') is not null
     or to_regprocedure('public.lab_import_leer_cabeceras(uuid,text,text,jsonb,jsonb)') is not null then
    raise exception 'PRUEBA LAB1 · 5: la vuelta atrás deja algo de la 0850.';
  end if;
  raise notice '5 · la vuelta atrás: nada de lab_import';
end $$;

rollback;
