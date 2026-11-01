-- supabase/staging/sql/20261101_n1c_centro_de_folvy_prueba.sql
--
-- SOLO STAGING. Prueba de la 2248 (N1 · respuesta 3: el local de cada persona
-- es el de su ficha en Folvy; las que no están en Folvy y no traen centro van
-- en «Sin centro en Cegid»), que cambia public.lab_centros_del_lote y
-- public.lab_volcar_lote. Con \i dentro de la transacción y ROLLBACK: staging
-- no cambia. Lo vuelca el administrador de la cuenta A, con su sesión de
-- verdad. Todo INVENTADO.
--
-- Los cuatro casos de la tabla de Julio (regla 31), con un paquete que solo
-- trae el centro de la empresa:
--   · E1 · en Folvy, activa, con local; en Cegid de alta y sin centro.
--   · E2 · en Folvy, dada de baja, con local; en Cegid de baja y sin centro.
--   · E3 · en Folvy, activa, en OTRO local que el del centro de Cegid.
--   · N4 · no está en Folvy; en Cegid de baja y sin centro.
--
--   0 · lo de antes, como pasó en producción: con las funciones de la 1938,
--       E1, E2 y N4 no entran («sin centro») y el contrato de E3 queda con el
--       local del centro de Cegid.
--   1 · con la 2248: la tabla de centros trae «Sin centro en Cegid · 1» (solo
--       N4: las de Folvy no la necesitan).
--   2 · confirmado su local, el volcado: 4 personas, 4 contratos, 0 avisos;
--       cada contrato con el local de la ficha de su persona (E3, corregido);
--       N4 entra de baja en el local confirmado; E3, como línea «para saber».
--   3 · otra vez: lo mismo, sin duplicar.
--   4 · la vuelta atrás: las dos funciones como estaban.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N1c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select position('__sin_centro__' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0 as n1c_aplicada \gset
\if :n1c_aplicada
\i supabase/vuelta-atras/20261101T2248_n1c_centro_de_folvy.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1');

do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; l1 uuid; l2 uuid; e uuid;
begin
  select id into l1 from public.locations where account_id = a order by name limit 1;
  select id into l2 from public.locations where account_id = a and id <> l1 order by name limit 1;
  if l2 is null then raise exception 'PRUEBA N1c · 0: la cuenta A necesita dos locales.'; end if;
  insert into _s values ('l1', l1::text), ('l2', l2::text), ('l1_nombre', (select name from public.locations where id = l1));
  -- Las tres que ya están en Folvy (sin local primero: así no reciben cursos de bienvenida, como las bajas del volcado).
  insert into public.employees (account_id, location_id, name, dni, active) values (a, null, 'Persona Inventada N1c Uno', 'INVN1C0001', true) returning id into e;
  update public.employees set location_id = l1 where id = e; insert into _s values ('e1', e::text);
  insert into public.employees (account_id, location_id, name, dni, active) values (a, null, 'Persona Inventada N1c Dos', 'INVN1C0002', false) returning id into e;
  update public.employees set location_id = l1 where id = e; insert into _s values ('e2', e::text);
  insert into public.employees (account_id, location_id, name, dni, active) values (a, null, 'Persona Inventada N1c Tres', 'INVN1C0003', true) returning id into e;
  update public.employees set location_id = l2 where id = e; insert into _s values ('e3', e::text);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l jsonb; c text := (select v from _s where clave = 'l1_nombre'); r jsonb;
begin
  l := public.lab_import_leer_cabeceras(a, 'paquete n1c inventado.xlsx', repeat('a1', 32),
    '[{"nombre":"Trabajadores","columnas":["trabajador","nif"],"filas":4}]', '{"completa":true}');
  insert into _s values ('lote', l ->> 'id');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'trabajadores', 1, jsonb_build_array(
    jsonb_build_object('trabajador', '1', 'nombre', 'Persona Inventada N1c Uno', 'nif', 'INVN1C0001', 'en_alta_hoy', 'S'),
    jsonb_build_object('trabajador', '2', 'nombre', 'Persona Inventada N1c Dos', 'nif', 'INVN1C0002', 'en_alta_hoy', 'N'),
    jsonb_build_object('trabajador', '3', 'nombre', 'Persona Inventada N1c Tres', 'nif', 'INVN1C0003', 'centro', c, 'en_alta_hoy', 'S'),
    jsonb_build_object('trabajador', '4', 'nombre', 'Persona Inventada N1c Cuatro', 'nif', 'INVN1C0004', 'en_alta_hoy', 'N')));
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'contratos', 1,
    '[{"trabajador":"1","contrato_n":"1","fecha_alta":"2024-03-01","tipo_contrato":"100"},'
    '{"trabajador":"2","contrato_n":"1","fecha_alta":"2023-01-10","fecha_fin":"2024-06-30","tipo_contrato":"401"},'
    '{"trabajador":"3","contrato_n":"1","fecha_alta":"2024-05-01","tipo_contrato":"100"},'
    '{"trabajador":"4","contrato_n":"1","fecha_alta":"2022-01-01","fecha_fin":"2022-12-31","tipo_contrato":"401"}]');
  perform public.lab_confirmar_centro((l ->> 'id')::uuid, c, (select v::uuid from _s where clave = 'l1'));
  -- Con las funciones de antes, como en producción.
  r := public.lab_volcar_lote((l ->> 'id')::uuid);
  if (r ->> 'personas')::int <> 1 or (r ->> 'contratos')::int <> 1 then
    raise exception 'PRUEBA N1c · 0: con las funciones de antes no sale lo de producción: %.', r;
  end if;
  if (select cc.location_id from public.lab_contrato_condicion cc join public.lab_contrato k on k.id = cc.contrato_id
       where k.employee_id = (select v::uuid from _s where clave = 'e3')) <> (select v::uuid from _s where clave = 'l1') then
    raise exception 'PRUEBA N1c · 0: el contrato de E3 no quedó con el local del centro de Cegid (lo que hay que corregir).';
  end if;
  raise notice '0 · lo de antes: sin centro no entran E1, E2 ni N4; el contrato de E3, con el local de Cegid';
end $$;
reset role;

\i supabase/migrations/20261101T2248_n1c_centro_de_folvy.sql

-- ── 1 · La tabla de centros ─────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); r jsonb;
begin
  r := public.lab_centros_del_lote(lote);
  if (select (x ->> 'personas')::int from jsonb_array_elements(r) x where x ->> 'centro' = '__sin_centro__') is distinct from 1
     or (select x -> 'propuesto' from jsonb_array_elements(r) x where x ->> 'centro' = '__sin_centro__') <> 'null'::jsonb then
    raise exception 'PRUEBA N1c · 1: la fila «Sin centro en Cegid» no es la de N4 sola, sin propuesto: %.', r;
  end if;
  raise notice '1 · la tabla de centros trae «Sin centro en Cegid · 1» (solo la que no está en Folvy)';
end $$;

-- ── 2 · Confirmado su local, el volcado ─────────────────────────────────────
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote'); r jsonb;
begin
  perform public.lab_confirmar_centro(lote, '__sin_centro__', (select v::uuid from _s where clave = 'l2'));
  r := public.lab_volcar_lote(lote);
  insert into _s values ('r', r::text);
  if (r ->> 'personas')::int <> 4 or (r ->> 'contratos')::int <> 4 or (r ->> 'nuevas_de_baja')::int <> 1 or (r ->> 'ya_estaban')::int <> 3
     or jsonb_array_length(r -> 'mensajes') <> 0 or jsonb_array_length(r -> 'centros_sin_confirmar') <> 0 then
    raise exception 'PRUEBA N1c · 2: el volcado devuelve %.', r;
  end if;
  if not exists (select 1 from jsonb_array_elements_text(r -> 'para_saber') m
                  where m like 'Persona Inventada N1c Tres: se deja el local de Folvy (%); en Cegid ponía %') then
    raise exception 'PRUEBA N1c · 2: E3 no sale como línea «para saber»: %.', r -> 'para_saber';
  end if;
end $$;
reset role;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l1 uuid := (select v::uuid from _s where clave = 'l1');
        l2 uuid := (select v::uuid from _s where clave = 'l2'); n4 public.employees;
begin
  -- Cada contrato, con el local de la ficha de su persona.
  if exists (select 1 from public.lab_contrato k join public.lab_contrato_condicion cc on cc.contrato_id = k.id
               join public.employees e on e.id = k.employee_id
              where k.lote_id = (select v::uuid from _s where clave = 'lote') and cc.location_id is distinct from e.location_id) then
    raise exception 'PRUEBA N1c · 2: hay contratos con otro local que el de la ficha de su persona.';
  end if;
  if (select cc.location_id from public.lab_contrato_condicion cc join public.lab_contrato k on k.id = cc.contrato_id
       where k.employee_id = (select v::uuid from _s where clave = 'e3')) <> l2 then
    raise exception 'PRUEBA N1c · 2: el contrato de E3 no se ha corregido al local de Folvy.';
  end if;
  -- Las de Folvy, con su local de siempre; N4, de baja en el confirmado.
  if (select location_id from public.employees where id = (select v::uuid from _s where clave = 'e1')) <> l1
     or (select location_id from public.employees where id = (select v::uuid from _s where clave = 'e3')) <> l2 then
    raise exception 'PRUEBA N1c · 2: el volcado ha cambiado el local de una ficha de Folvy.';
  end if;
  select * into n4 from public.employees where account_id = a and dni = 'INVN1C0004';
  if n4.id is null or n4.active or n4.location_id is distinct from l2 then
    raise exception 'PRUEBA N1c · 2: N4 no ha entrado de baja en el local de «Sin centro en Cegid».';
  end if;
  raise notice '2 · confirmado: 4 personas y 4 contratos, 0 avisos; cada contrato con el local de su ficha (E3, corregido); N4 de baja en el confirmado';
end $$;

-- ── 3 · Otra vez: no duplica ────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb := public.lab_volcar_lote((select v::uuid from _s where clave = 'lote'));
begin
  if (r ->> 'personas')::int <> 4 or (r ->> 'contratos')::int <> 4 or (r ->> 'nuevas_de_baja')::int <> 0 or (r ->> 'ya_estaban')::int <> 4
     or jsonb_array_length(r -> 'mensajes') <> 0 then
    raise exception 'PRUEBA N1c · 3: la segunda vez devuelve %.', r;
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.employees where account_id = (select v::uuid from _s where clave = 'cuenta') and dni like 'INVN1C%') <> 4
     or (select count(*) from public.lab_contrato where lote_id = (select v::uuid from _s where clave = 'lote')) <> 4 then
    raise exception 'PRUEBA N1c · 3: la segunda vez ha duplicado personas o contratos.';
  end if;
  raise notice '3 · otra vez: 4 personas y 4 contratos, sin duplicar';
end $$;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261101T2248_n1c_centro_de_folvy.down.sql
do $$ begin
  if position('__sin_centro__' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0
     or position('__sin_centro__' in pg_get_functiondef('public.lab_centros_del_lote(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA N1c · 4: la vuelta atrás no deja las dos funciones como estaban.';
  end if;
  raise notice '4 · la vuelta atrás: las dos funciones como estaban';
end $$;

rollback;
