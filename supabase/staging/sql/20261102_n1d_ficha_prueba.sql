-- supabase/staging/sql/20261102_n1d_ficha_prueba.sql
--
-- SOLO STAGING. Prueba del paso 1 del PR 2 del N1: 0817 (los catálogos
-- oficiales), 0830 (lab_ficha y lab_poner_categoria) y 0831 (cambia
-- public.lab_volcar_lote: «en Cegid no traía centro»). Con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Entra COMO CADA UNO: el
-- administrador y el encargado de la cuenta A, y el administrador de la B.
-- Todo INVENTADO.
--
--   0 · lo de antes: nada de la 0817 ni de la 0830.
--   1 · los catálogos: los nueve, con su fuente; los códigos de Cegid de
--       Foodint (contrato 100 y 200, grupo 4, países 170, 724 y 862) están;
--       se leen con sesión y no se escriben.
--   2 · la ficha: el administrador la ve entera, con el tipo de contrato y el
--       grupo en palabras; sin categoría, el mínimo «no se puede calcular»; el
--       encargado la ve sin lo privado; el de otra cuenta, no.
--   3 · poner la categoría: una condición nueva con fecha de hoy (la de antes
--       se cierra, no se pisa), su línea en el historial, y el mínimo ya sale;
--       una que no es del convenio, no; el encargado, no.
--   4 · el volcado: «en Cegid no traía centro», sin la clave interna.
--   5 · la vuelta atrás, en orden inverso.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N1d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select position('no traía centro' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0 as n1d_0831 \gset
\if :n1d_0831
\i supabase/vuelta-atras/20261102T0831_n1d_sin_centro_en_palabras.down.sql
\endif
select to_regprocedure('public.lab_ficha(uuid)') is not null as n1d_0830 \gset
\if :n1d_0830
\i supabase/vuelta-atras/20261102T0830_n1d_ficha.down.sql
\endif
select to_regclass('public.lab_catalogo') is not null as n1d_0817 \gset
\if :n1d_0817
\i supabase/vuelta-atras/20261102T0817_n1d_catalogos_oficiales.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
                      ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'), ('admin_b', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; l1 uuid; l2 uuid; e uuid; k uuid;
begin
  if position('__sin_centro__' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) = 0 then
    raise exception 'PRUEBA N1d · 0: falta la 2248 (el volcado con «Sin centro en Cegid»).';
  end if;
  select id into l1 from public.locations where account_id = a order by name limit 1;
  select id into l2 from public.locations where account_id = a and id <> l1 order by name limit 1;
  if l2 is null then raise exception 'PRUEBA N1d · 0: la cuenta A necesita dos locales.'; end if;
  insert into _s values ('l1', l1::text), ('l2', l2::text);
  -- Una persona con su ficha de Laboral, como la deja el volcado: contrato 100, grupo 4, sin categoría.
  insert into public.employees (account_id, location_id, name, dni, active, position) values (a, null, 'Persona Inventada N1d', 'INVN1D0001', true, 'Ayudante')
  returning id into e;
  update public.employees set location_id = l1 where id = e;
  insert into _s values ('e', e::text);
  insert into public.lab_persona (employee_id, account_id, naf, nacionalidad) values (e, a, '280000000000', '862');
  insert into public.lab_convenio (account_id, codigo, nombre, paga_13, paga_14) values (a, 'CONVN1D', 'Convenio inventado', 'Paga de junio', 'Paga de diciembre');
  insert into public.lab_convenio_tabla (account_id, convenio_codigo, categoria, categoria_nombre, concepto_codigo, concepto_nombre, importe, modo_pago)
  values (a, 'CONVN1D', 'AYU', 'Ayudante inventado', '001', 'Salario base', 1200, 'Mensual'),
         (a, 'CONVN1D', 'AYU', 'Ayudante inventado', '013', 'Paga extra', 1200, 'Paga');
  insert into public.lab_contrato (account_id, employee_id, numero, clave, fecha_alta, origen) values (a, e, '1', '100', date '2024-03-01', 'cegid')
  returning id into k;
  insert into _s values ('k', k::text);
  insert into public.lab_contrato_condicion (account_id, contrato_id, vigente_desde, grupo_cotizacion, convenio_codigo, location_id, jornada)
  values (a, k, date '2024-03-01', '4', 'CONVN1D', l1, 'completa');
  insert into public.lab_persona_concepto (account_id, employee_id, contrato_id, concepto_codigo, concepto_nombre, importe, periodicidad, origen, vigente_desde)
  values (a, e, k, '050', 'Plus pactado', 1350, 'mes', 'pactado', date '2026-09-01');
  raise notice '0 · lo de antes: nada de la 0817 ni de la 0830; la 2248 puesta';
end $$;

\i supabase/migrations/20261102T0817_n1d_catalogos_oficiales.sql
\i supabase/migrations/20261102T0830_n1d_ficha.sql
\i supabase/migrations/20261102T0831_n1d_sin_centro_en_palabras.sql
-- La 0817 y la 0830 solo añaden: se pueden pasar dos veces.
\i supabase/migrations/20261102T0817_n1d_catalogos_oficiales.sql
\i supabase/migrations/20261102T0830_n1d_ficha.sql

-- ── 1 · Los catálogos ───────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.lab_catalogo_fuente) <> 9
     or (select count(*) from public.lab_catalogo_fuente where url !~ '^https://www\.(seg-social|boe)\.es/') <> 0 then
    raise exception 'PRUEBA N1d · 1: los nueve catálogos no tienen su fuente oficial.';
  end if;
  if (select count(*) from public.lab_catalogo where (catalogo, codigo) in
        (('contrato', '100'), ('contrato', '200'), ('grupo_cotizacion', '4'), ('pais', '170'), ('pais', '724'), ('pais', '862'))) <> 6 then
    raise exception 'PRUEBA N1d · 1: faltan códigos de los que trae Cegid de Foodint.';
  end if;
  if (select calle from public.lab_catalogo where catalogo = 'contrato' and codigo = '100') <> 'Indefinido a jornada completa'
     or (select oficial from public.lab_catalogo where catalogo = 'contrato' and codigo = '100') <> 'INDEFINIDO TIEMPO COMPLETO – ORDINARIO' then
    raise exception 'PRUEBA N1d · 1: la clave 100 no lleva su palabra de la calle y su texto oficial.';
  end if;
  begin
    insert into public.lab_catalogo (catalogo, codigo, calle, oficial) values ('contrato', '999', 'x', 'x');
    raise exception 'PRUEBA N1d · 1: se escribe en los catálogos desde la sesión.';
  exception when insufficient_privilege then null;
  end;
  raise notice '1 · los catálogos: los nueve con su fuente, con los códigos de Cegid; se leen y no se escriben';
end $$;
reset role;

-- ── 2 · La ficha ────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare f jsonb := public.lab_ficha((select v::uuid from _s where clave = 'e'));
begin
  if not (f ->> 'privado')::boolean or f -> 'contrato' -> 'tipo' ->> 'calle' <> 'Indefinido a jornada completa'
     or f -> 'contrato' -> 'grupo' ->> 'calle' <> 'Ayudantes sin título' or f -> 'persona' -> 'nacionalidad' ->> 'calle' <> 'Venezuela'
     or f -> 'persona' ->> 'naf' <> '280000000000' or f -> 'persona' -> 'nivel_formativo' <> 'null'::jsonb then
    raise exception 'PRUEBA N1d · 2: la ficha del administrador no sale como debe: %.', f;
  end if;
  if f -> 'salario' ->> 'minimo_porque' <> 'sin_categoria' or f -> 'salario' -> 'minimo_convenio' <> 'null'::jsonb
     or (f -> 'salario' ->> 'pagas')::int <> 14 or (f -> 'salario' ->> 'bruto_mes')::numeric <> 1350
     or jsonb_array_length(f -> 'contrato' -> 'categorias') <> 1 then
    raise exception 'PRUEBA N1d · 2: sin categoría, el mínimo o la lista del convenio no salen como deben: %.', f -> 'salario';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare f jsonb;
begin
  -- El encargado ve a las de su local: la persona está en el primero de la cuenta A.
  begin
    f := public.lab_ficha((select v::uuid from _s where clave = 'e'));
    if (f ->> 'privado')::boolean or f -> 'salario' <> 'null'::jsonb or f -> 'irpf' <> 'null'::jsonb
       or f -> 'persona' -> 'naf' <> 'null'::jsonb or f -> 'persona' -> 'documento' <> 'null'::jsonb then
      raise exception 'PRUEBA N1d · 2: el encargado ve lo privado: %.', f;
    end if;
  exception when insufficient_privilege then null;  -- si no es de su local, ni la ve
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.lab_ficha((select v::uuid from _s where clave = 'e'));
    raise exception 'PRUEBA N1d · 2: el administrador de otra cuenta ve la ficha.';
  exception when insufficient_privilege then null;
  end;
  raise notice '2 · la ficha: el administrador, entera y en palabras, sin categoría «no se puede calcular»; el encargado, sin lo privado; otra cuenta, no';
end $$;
reset role;

-- ── 3 · Poner la categoría ──────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.lab_poner_categoria((select v::uuid from _s where clave = 'k'), 'AYU');
    raise exception 'PRUEBA N1d · 3: el encargado pone la categoría.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare k uuid := (select v::uuid from _s where clave = 'k'); r jsonb; f jsonb;
begin
  begin
    perform public.lab_poner_categoria(k, 'NO-EXISTE');
    raise exception 'PRUEBA N1d · 3: se pone una categoría que no es del convenio.';
  exception when invalid_parameter_value then null;
  end;
  r := public.lab_poner_categoria(k, 'AYU', 'La dice la gestoría');
  if not (r ->> 'cambia')::boolean or r ->> 'nombre' <> 'Ayudante inventado' then raise exception 'PRUEBA N1d · 3: poner la categoría devuelve %.', r; end if;
  if (select count(*) from public.lab_contrato_condicion where contrato_id = k) <> 2
     or (select count(*) from public.lab_contrato_condicion where contrato_id = k and vigente_hasta is null) <> 1
     or (select categoria from public.lab_contrato_condicion where contrato_id = k and vigente_desde = date '2024-03-01') is not null then
    raise exception 'PRUEBA N1d · 3: la condición de antes no se ha cerrado o se ha pisado.';
  end if;
  if (select count(*) from public.lab_cambio where registro_id = k and campo = 'categoria' and quien is not null) <> 1 then
    raise exception 'PRUEBA N1d · 3: el cambio no está en el historial con quién lo hizo.';
  end if;
  f := public.lab_ficha((select v::uuid from _s where clave = 'e'));
  if (f -> 'salario' ->> 'minimo_convenio')::numeric <> 1200 or f -> 'salario' -> 'minimo_porque' <> 'null'::jsonb
     or f -> 'contrato' ->> 'categoria_nombre' <> 'Ayudante inventado' then
    raise exception 'PRUEBA N1d · 3: con categoría, el mínimo del convenio no sale: %.', f -> 'salario';
  end if;
  raise notice '3 · la categoría: una condición nueva y la de antes cerrada, con su historial; el mínimo ya sale (1.200); fuera del convenio y el encargado, no';
end $$;
reset role;

-- ── 4 · El volcado, en palabras ─────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l jsonb; r jsonb;
begin
  l := public.lab_import_leer_cabeceras(a, 'paquete n1d inventado.xlsx', repeat('d1', 32),
    '[{"nombre":"Trabajadores","columnas":["trabajador","nif"],"filas":2}]', '{"completa":true}');
  -- Una que ya está en Folvy (en el primer local) y otra que no, las dos sin centro en Cegid.
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'trabajadores', 1, jsonb_build_array(
    jsonb_build_object('trabajador', '1', 'nombre', 'Persona Inventada N1d', 'nif', 'INVN1D0001', 'en_alta_hoy', 'S'),
    jsonb_build_object('trabajador', '2', 'nombre', 'Otra Inventada N1d', 'nif', 'INVN1D0002', 'en_alta_hoy', 'N')));
  perform public.lab_confirmar_centro((l ->> 'id')::uuid, '__sin_centro__', (select v::uuid from _s where clave = 'l2'));
  r := public.lab_volcar_lote((l ->> 'id')::uuid);
  if exists (select 1 from jsonb_array_elements_text(r -> 'para_saber') m where m like '%__sin_centro__%')
     or not exists (select 1 from jsonb_array_elements_text(r -> 'para_saber') m
                     where m like 'Persona Inventada N1d: se deja el local de Folvy (%); en Cegid no traía centro.') then
    raise exception 'PRUEBA N1d · 4: «Para saber» no lo dice en palabras: %.', r -> 'para_saber';
  end if;
  raise notice '4 · el volcado: «en Cegid no traía centro», sin la clave interna';
end $$;
reset role;

-- ── 5 · La vuelta atrás, en orden inverso ───────────────────────────────────
\i supabase/vuelta-atras/20261102T0831_n1d_sin_centro_en_palabras.down.sql
\i supabase/vuelta-atras/20261102T0830_n1d_ficha.down.sql
\i supabase/vuelta-atras/20261102T0817_n1d_catalogos_oficiales.down.sql
do $$ begin
  if to_regclass('public.lab_catalogo') is not null or to_regprocedure('public.lab_ficha(uuid)') is not null
     or position('no traía centro' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA N1d · 5: la vuelta atrás no deja todo como estaba.';
  end if;
  raise notice '5 · la vuelta atrás: fuera los catálogos y la ficha; el volcado, como estaba';
end $$;

rollback;
