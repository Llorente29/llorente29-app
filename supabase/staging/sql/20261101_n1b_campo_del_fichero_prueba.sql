-- supabase/staging/sql/20261101_n1b_campo_del_fichero_prueba.sql
--
-- SOLO STAGING. Prueba de la 2154 (N1 · respuesta 2: public._lab_campo
-- encuentra el campo por el código entre paréntesis del fichero real), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. El lote lo crea y lo
-- vuelca el administrador de la cuenta A, con su sesión de verdad. Todo
-- INVENTADO; los NOMBRES de los campos de Empresa son los del fichero real
-- (regla 31), con su fila «campo | valor».
--
--   0 · lo de antes: la 1937 y la 1938 puestas; la 2154, no.
--   1 · con la 2154: «CCC» encuentra «Código cuenta de cotización (CCC)»; el
--       nombre exacto gana si está; la fila «campo | valor» no estorba.
--   2 · el volcado con la Empresa real: cada contrato lleva el CCC de la
--       empresa como cuenta de cotización.
--   3 · la vuelta atrás: _lab_campo como estaba (y «CCC» ya no encuentra nada).

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N1b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
select position('position(' in pg_get_functiondef('public._lab_campo(uuid,text,text)'::regprocedure)) > 0 as n1b_aplicada \gset
\if :n1b_aplicada
\i supabase/vuelta-atras/20261101T2154_n1b_campo_del_fichero.down.sql
\endif

create temp table _s (clave text primary key, v text) on commit drop;
grant select, insert on _s to authenticated, anon;
insert into _s values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1');

do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_loc uuid;
begin
  if to_regprocedure('public.lab_volcar_lote(uuid)') is null or to_regclass('public.lab_contrato_condicion') is null then
    raise exception 'PRUEBA N1b · 0: falta la 1937 o la 1938.';
  end if;
  select id into v_loc from public.locations where account_id = a order by name limit 1;
  if v_loc is null then raise exception 'PRUEBA N1b · 0: la cuenta A necesita un local.'; end if;
  insert into _s values ('loc', v_loc::text), ('loc_nombre', (select name from public.locations where id = v_loc));
  raise notice '0 · lo de antes: la 1937 y la 1938 puestas; la 2154, no';
end $$;

-- Un lote con la hoja Empresa como la real, cargado por el administrador.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); l jsonb; c text := (select v from _s where clave = 'loc_nombre');
begin
  l := public.lab_import_leer_cabeceras(a, 'paquete n1b inventado.xlsx', repeat('ef', 32),
    '[{"nombre":"Empresa","columnas":["código ERP10","Código cuenta de cotización (CCC)"],"filas":3}]', '{"completa":true}');
  insert into _s values ('lote', l ->> 'id');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'empresa', 1,
    '[{"campo":"campo","valor":"valor"},{"campo":"Código cuenta de cotización (CCC)","valor":"28000000000"},'
    '{"campo":"Banco nóminas","valor":"Banco Inventado"},{"campo":"Centro de trabajo 1","valor":"Centro Inventado"}]');
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'trabajadores', 1, jsonb_build_array(
    jsonb_build_object('trabajador', '1', 'nombre', 'Persona Inventada N1b', 'nif', 'INVN1B0001', 'centro', c, 'en_alta_hoy', 'N')));
  perform public.lab_import_cargar_filas((l ->> 'id')::uuid, 'contratos', 1,
    '[{"trabajador":"1","contrato_n":"1","fecha_alta":"2023-01-10","fecha_fin":"2024-06-30","tipo_contrato":"401"}]');
  perform public.lab_confirmar_centro((l ->> 'id')::uuid, c, (select v::uuid from _s where clave = 'loc'));
end $$;
reset role;

-- Antes de la 2154: «CCC» no encuentra el campo del fichero real.
do $$ begin
  if public._lab_campo((select v::uuid from _s where clave = 'lote'), 'empresa', 'CCC') is not null then
    raise exception 'PRUEBA N1b · 0: antes de la 2154, «CCC» ya encuentra algo: la prueba no mediría nada.';
  end if;
end $$;

\i supabase/migrations/20261101T2154_n1b_campo_del_fichero.sql

-- ── 1 · Con la 2154 ─────────────────────────────────────────────────────────
do $$
declare lote uuid := (select v::uuid from _s where clave = 'lote');
begin
  if public._lab_campo(lote, 'empresa', 'CCC') is distinct from '28000000000' then
    raise exception 'PRUEBA N1b · 1: «CCC» no encuentra «Código cuenta de cotización (CCC)».';
  end if;
  if public._lab_campo(lote, 'empresa', 'Banco nóminas') is distinct from 'Banco Inventado' then
    raise exception 'PRUEBA N1b · 1: el nombre exacto ya no encuentra su campo.';
  end if;
  if public._lab_campo(lote, 'empresa', 'campo') is distinct from 'valor' or public._lab_campo(lote, 'empresa', 'NIF') is not null then
    raise exception 'PRUEBA N1b · 1: encuentra lo que no es.';
  end if;
  -- El nombre exacto gana: un campo que se llama «CCC» tal cual va antes que el del paréntesis.
  insert into public.lab_import_fila (lote_id, account_id, hoja, fila_n, datos, huella)
  values (lote, (select v::uuid from _s where clave = 'cuenta'), 'empresa', 99, '{"campo":"CCC","valor":"exacto"}', md5('x'));
  if public._lab_campo(lote, 'empresa', 'CCC') <> 'exacto' then raise exception 'PRUEBA N1b · 1: el nombre exacto no gana.'; end if;
  delete from public.lab_import_fila where lote_id = lote and fila_n = 99;
  raise notice '1 · «CCC» encuentra «Código cuenta de cotización (CCC)»; el nombre exacto gana; nada de más';
end $$;

-- ── 2 · El volcado con la Empresa real ──────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb := public.lab_volcar_lote((select v::uuid from _s where clave = 'lote'));
begin
  if (r ->> 'contratos')::int <> 1 then raise exception 'PRUEBA N1b · 2: el volcado devuelve %.', r; end if;
  if (select cc.cuenta_cotizacion from public.lab_contrato_condicion cc join public.lab_contrato c on c.id = cc.contrato_id
       where c.lote_id = (select v::uuid from _s where clave = 'lote')) is distinct from '28000000000' then
    raise exception 'PRUEBA N1b · 2: el contrato no lleva el CCC de la empresa.';
  end if;
  raise notice '2 · el volcado con la Empresa real: el contrato lleva el CCC de la empresa';
end $$;
reset role;

-- ── 3 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261101T2154_n1b_campo_del_fichero.down.sql
do $$ begin
  if position('position(' in pg_get_functiondef('public._lab_campo(uuid,text,text)'::regprocedure)) > 0
     or public._lab_campo((select v::uuid from _s where clave = 'lote'), 'empresa', 'CCC') is not null then
    raise exception 'PRUEBA N1b · 3: la vuelta atrás no deja _lab_campo como estaba.';
  end if;
  raise notice '3 · la vuelta atrás: _lab_campo como estaba';
end $$;

rollback;
