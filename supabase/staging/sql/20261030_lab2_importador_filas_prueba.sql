-- supabase/staging/sql/20261030_lab2_importador_filas_prueba.sql
--
-- SOLO STAGING. Prueba de la 0950 (LAB2, tanda 2 del importador de Cegid: las
-- filas), con \i dentro de la transacción y ROLLBACK: staging no cambia. Entra
-- COMO CADA UNO, con su sesión de verdad (request.jwt.claims + role): el
-- administrador y el encargado de la cuenta A, y el administrador de la B.
-- Filas INVENTADAS, con las cabeceras de Cegid.
--
--   0 · lo de antes: si ya está aplicada, su vuelta atrás; la 0850 tiene que
--       estar (si la base es de antes, se pasa aquí).
--   1 · el administrador carga dos hojas por trozos: cada fila con su número,
--       tal cual y con su huella; al terminar, lo esperado = lo cargado.
--   2 · el mismo fichero otra vez: no duplica, no cambia nada; una fila
--       cambiada se cuenta como cambiada; una lectura más corta quita lo que
--       sobra, y una hoja que ya no viene, también.
--   3 · nadie más: ni el encargado, ni el administrador de otra cuenta, ni sin
--       sesión; y no ven las filas.
--   4 · lo que no entra: hoja desconocida, fila que no es un objeto, trozo
--       vacío, fila inicial 0 y un lote que no está «leido».
--   5 · la vuelta atrás: fuera las dos funciones.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA LAB2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select to_regprocedure('public.lab_import_cargar_filas(uuid,text,integer,jsonb)') is not null as lab2_aplicada \gset
\if :lab2_aplicada
\i supabase/vuelta-atras/20261030T0950_lab2_importador_filas.down.sql
\endif
select to_regclass('public.lab_import_lote') is null as lab1_falta \gset
\if :lab1_falta
\echo 'Esta base no tiene la 0850 (LAB1): se pasa aquí, dentro de la transacción.'
\i supabase/migrations/20261029T0850_lab1_importador_lote.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'),
  ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare v_falta text;
begin
  if to_regprocedure('public.lab_import_cargar_filas(uuid,text,integer,jsonb)') is not null
     or to_regprocedure('public.lab_import_terminar_filas(uuid,jsonb)') is not null then
    raise exception 'PRUEBA LAB2 · 0: ya hay algo de la 0950 antes de aplicarla.';
  end if;
  select string_agg(x.c, ', ') into v_falta
    from (values ('admin', 'admin', 'c01a0000-0000-4000-8000-00000000000a'), ('encargado', 'manager', 'c01a0000-0000-4000-8000-00000000000a'),
                 ('admin_b', 'admin', 'c01b0000-0000-4000-8000-00000000000b')) x(c, rol, cta)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = x.cta::uuid and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA LAB2 · faltan los usuarios de prueba: %.', v_falta; end if;
  raise notice '0 · lo de antes: nada de la 0950, y la 0850 puesta';
end $$;

\i supabase/migrations/20261030T0950_lab2_importador_filas.sql
-- Solo añade: se puede pasar dos veces.
\i supabase/migrations/20261030T0950_lab2_importador_filas.sql

-- ── 1 · El administrador carga dos hojas por trozos ─────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l jsonb; r jsonb; t jsonb;
begin
  l := public.lab_import_leer_cabeceras(a, 'paquete inventado.xlsx', repeat('ab', 32),
    '[{"nombre":"Conceptos","columnas":["codigo","concepto","tipo","codigo_red"],"filas":3},'
    '{"nombre":"Empresa","columnas":["NIF","razón social"],"filas":2}]');
  insert into _s values ('lote', l ->> 'id');
  r := public.lab_import_cargar_filas((l ->> 'id')::uuid, 'conceptos', 1,
    '[{"codigo":"001","concepto":"Salario base","tipo":"D","codigo_red":"1"},{"codigo":"002","concepto":"Plus inventado","tipo":"D","codigo_red":"2"}]');
  if (r ->> 'nuevas')::int <> 2 or (r ->> 'cambiadas')::int <> 0 then raise exception 'PRUEBA LAB2 · 1: el primer trozo no entra como 2 nuevas (%).', r; end if;
  r := public.lab_import_cargar_filas((l ->> 'id')::uuid, 'conceptos', 3, '[{"codigo":"003","concepto":"Retención inventada","tipo":"R","codigo_red":""}]');
  r := public.lab_import_cargar_filas((l ->> 'id')::uuid, 'empresa', 1,
    '[{"campo":"NIF","valor":"B00000000"},{"campo":"razón social","valor":"Empresa de Prueba"}]');
  t := public.lab_import_terminar_filas((l ->> 'id')::uuid, '{"conceptos":3,"empresa":2}');
  if not (t ->> 'completo')::boolean or (t ->> 'cargadas')::int <> 5 or (t -> 'hojas' -> 'conceptos' ->> 'cargadas')::int <> 3 then
    raise exception 'PRUEBA LAB2 · 1: al terminar, lo cargado no es lo esperado (%).', t;
  end if;
  if (select string_agg(fila_n::text || '=' || (datos ->> 'codigo'), ',' order by fila_n) from public.lab_import_fila
       where lote_id = (l ->> 'id')::uuid and hoja = 'conceptos') <> '1=001,2=002,3=003'
     or exists (select 1 from public.lab_import_fila where lote_id = (l ->> 'id')::uuid and huella <> md5(datos::text)) then
    raise exception 'PRUEBA LAB2 · 1: las filas no llevan su número, sus datos o su huella.';
  end if;
  raise notice '1 · el administrador carga dos hojas por trozos; cada fila con su número y su huella; lo esperado = lo cargado';
end $$;

-- ── 2 · El mismo fichero otra vez, uno cambiado y uno más corto ─────────────
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); r jsonb; t jsonb;
begin
  r := public.lab_import_cargar_filas(lote, 'conceptos', 1,
    '[{"codigo":"001","concepto":"Salario base","tipo":"D","codigo_red":"1"},{"codigo":"002","concepto":"Plus inventado","tipo":"D","codigo_red":"2"}]');
  if (r ->> 'nuevas')::int <> 0 or (r ->> 'cambiadas')::int <> 0 then raise exception 'PRUEBA LAB2 · 2: el mismo trozo otra vez cambia algo (%).', r; end if;
  r := public.lab_import_cargar_filas(lote, 'conceptos', 1,
    '[{"codigo":"001","concepto":"Salario base mensual","tipo":"D","codigo_red":"1"}]');
  if (r ->> 'cambiadas')::int <> 1 then raise exception 'PRUEBA LAB2 · 2: una fila cambiada no se cuenta como cambiada (%).', r; end if;
  if (select count(*) from public.lab_import_fila where lote_id = lote) <> 5 then raise exception 'PRUEBA LAB2 · 2: releer duplica filas.'; end if;
  -- Ahora el fichero trae 2 conceptos y ya no trae Empresa.
  t := public.lab_import_terminar_filas(lote, '{"conceptos":2}');
  if (t ->> 'quitadas')::int <> 3 or (t ->> 'cargadas')::int <> 2 or not (t ->> 'completo')::boolean then
    raise exception 'PRUEBA LAB2 · 2: una lectura más corta no quita lo que sobra (%).', t;
  end if;
  raise notice '2 · el mismo fichero no duplica; lo cambiado se cuenta; lo que sobra se quita';
end $$;
reset role;

-- ── 3 · Nadie más ───────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); n int := 0;
begin
  begin perform public.lab_import_cargar_filas(lote, 'conceptos', 1, '[{"codigo":"9"}]');
  exception when insufficient_privilege then n := n + 1; end;
  begin perform public.lab_import_terminar_filas(lote, '{}');
  exception when insufficient_privilege then n := n + 1; end;
  if n <> 2 then raise exception 'PRUEBA LAB2 · 3: el encargado carga o termina (% de 2 cerradas).', n; end if;
  if exists (select 1 from public.lab_import_fila) then raise exception 'PRUEBA LAB2 · 3: el encargado ve las filas.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); ok boolean := false;
begin
  begin perform public.lab_import_cargar_filas(lote, 'conceptos', 1, '[{"codigo":"9"}]');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA LAB2 · 3: el administrador de otra cuenta carga en la A.'; end if;
  if exists (select 1 from public.lab_import_fila where lote_id = lote) then raise exception 'PRUEBA LAB2 · 3: otra cuenta ve las filas de la A.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$
declare ok boolean := false;
begin
  begin perform public.lab_import_cargar_filas((select v::uuid from _s where clave = 'lote'), 'conceptos', 1, '[{"codigo":"9"}]');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'PRUEBA LAB2 · 3: sin sesión se carga.'; end if;
  raise notice '3 · nadie más: ni el encargado, ni otra cuenta, ni sin sesión';
end $$;
reset role;

-- ── 4 · Lo que no entra ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); n int := 0;
begin
  begin perform public.lab_import_cargar_filas(lote, 'hoja1', 1, '[{"a":"1"}]');
  exception when invalid_parameter_value then n := n + 1; end;
  begin perform public.lab_import_cargar_filas(lote, 'conceptos', 1, '["suelto"]');
  exception when invalid_parameter_value then n := n + 1; end;
  begin perform public.lab_import_cargar_filas(lote, 'conceptos', 1, '[]');
  exception when invalid_parameter_value then n := n + 1; end;
  begin perform public.lab_import_cargar_filas(lote, 'conceptos', 0, '[{"a":"1"}]');
  exception when invalid_parameter_value then n := n + 1; end;
  if n <> 4 then raise exception 'PRUEBA LAB2 · 4: entra algo que no debe (% de 4 paradas).', n; end if;
end $$;
reset role;
-- Un lote que ya no está «leido» (lo pone así el sistema; la sesión no escribe en el lote).
update public.lab_import_lote set estado = 'descartado' where id = (select v::uuid from _s where clave = 'lote');
set local role authenticated;
do $$
declare ok boolean := false;
begin
  begin perform public.lab_import_cargar_filas((select v::uuid from _s where clave = 'lote'), 'conceptos', 1, '[{"a":"1"}]');
  exception when invalid_parameter_value then ok := sqlerrm = 'LOTE_NO_LEIDO'; end;
  if not ok then raise exception 'PRUEBA LAB2 · 4: se cargan filas en un lote descartado.'; end if;
  raise notice '4 · lo que no entra: hoja desconocida, fila suelta, trozo vacío, fila 0 y lote no «leido»';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261030T0950_lab2_importador_filas.down.sql
do $$
begin
  if to_regprocedure('public.lab_import_cargar_filas(uuid,text,integer,jsonb)') is not null
     or to_regprocedure('public.lab_import_terminar_filas(uuid,jsonb)') is not null then
    raise exception 'PRUEBA LAB2 · 5: la vuelta atrás deja algo de la 0950.';
  end if;
  raise notice '5 · la vuelta atrás: fuera las dos funciones';
end $$;

rollback;
