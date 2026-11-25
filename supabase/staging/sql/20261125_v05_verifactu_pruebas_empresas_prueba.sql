-- supabase/staging/sql/20261125_v05_verifactu_pruebas_empresas_prueba.sql
--
-- SOLO STAGING. Prueba de la 1830 (V05, solo añade), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A (NIF B28000016),
-- sin certificado autorizado:
--   0. Ninguna de las cuatro existe (tras la vuelta atrás, por si W05 la dejó).
--   1. Abrir el certificado para pruebas: sin autorización, no, y dice por qué;
--      un envío que no está, no; ni authenticated ni anon pueden llamarlas.
--   2. verifactu_despertar_empresa: otra persona, «Esa empresa no está»; una
--      acción que no existe, no; enviar con Verifactu apagado, «Primero pon
--      Verifactu en pruebas».
--   3. verifactu_conexion_ultima: sin pruebas, null; con una apuntada, la suya.
--   4. La vuelta atrás: nada de la 1830.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261125T1830_v05_verifactu_pruebas_empresas.down.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select on _v to authenticated;
insert into _v values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1');
do $$ begin
  if (select tax_id from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') <> 'B28000016' then raise exception 'PRUEBA V05 · 0: la empresa A no es la de siempre.'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_cert_abrir_pruebas', 'verifactu_cert_abrir_pruebas_envio', 'verifactu_despertar_empresa', 'verifactu_conexion_ultima')) then
    raise exception 'PRUEBA V05 · 0: lo de la 1830 ya estaba antes de aplicarla.';
  end if;
  raise notice '0 · nada de la 1830';
end $$;

\i supabase/migrations/20261125T1830_v05_verifactu_pruebas_empresas.sql

-- 1 · Abrir el certificado para pruebas.
do $$
declare v_r jsonb;
begin
  -- La empresa A, sin autorización vigente dentro de la prueba.
  update public.verifactu_autorizacion set retirada_at = now(), retirada_motivo = 'prueba V05'
   where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and retirada_at is null;
  v_r := public.verifactu_cert_abrir_pruebas('3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  if (v_r->>'ok')::boolean or v_r ? 'material' then raise exception 'PRUEBA V05 · 1: sin autorización abrió el certificado (%).', v_r - 'material'; end if;
  if v_r->>'mensaje' not in ('La empresa no ha autorizado usar su certificado para Verifactu (o lo ha retirado).', 'La empresa no envía con su certificado: autorízalo para Verifactu primero.') then
    raise exception 'PRUEBA V05 · 1: no dice por qué (%).', v_r->>'mensaje';
  end if;
  v_r := public.verifactu_cert_abrir_pruebas_envio(gen_random_uuid());
  if v_r->>'mensaje' <> 'Ese envío no está.' then raise exception 'PRUEBA V05 · 1: un envío que no está (%).', v_r; end if;
  if has_function_privilege('authenticated', 'public.verifactu_cert_abrir_pruebas(uuid)', 'execute')
     or has_function_privilege('anon', 'public.verifactu_cert_abrir_pruebas(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.verifactu_cert_abrir_pruebas_envio(uuid)', 'execute') then
    raise exception 'PRUEBA V05 · 1: una persona puede abrir el certificado.';
  end if;
  if not has_function_privilege('authenticated', 'public.verifactu_despertar_empresa(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.verifactu_despertar_empresa(uuid, text)', 'execute') then
    raise exception 'PRUEBA V05 · 1: los permisos de verifactu_despertar_empresa no son los de la migración.';
  end if;
  raise notice '1 · el certificado: sin autorización no se abre y lo dice; solo el servicio';
end $$;

-- 2 · Lo que pulsa una persona.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_despertar_empresa('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'probar_conexion');
    raise exception 'PRUEBA V05 · 2: otra persona pudo pedirlo.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_despertar_empresa('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'presentar');
    raise exception 'PRUEBA V05 · 2: una acción que no existe pasó.';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
update public.verifactu_empresa set modo = 'apagado' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_despertar_empresa('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'enviar');
    raise exception 'PRUEBA V05 · 2: con Verifactu apagado se pudo enviar.';
  exception when sqlstate '23514' then
    if sqlerrm <> 'Primero pon Verifactu en pruebas.' then raise; end if;
  end;
  raise notice '2 · pedir: otra persona no, una acción que no existe no, enviar apagado no';
end $$;
reset role;

-- 3 · La última prueba de conexión.
delete from public.verifactu_conexion where entorno = 'pruebas' and nif = 'B28000016';
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if public.verifactu_conexion_ultima('3b34403a-a7d6-4a48-a8d7-737e8cababdc') is not null then raise exception 'PRUEBA V05 · 3: sin pruebas no da null.'; end if;
end $$;
reset role;
select public.verifactu_conexion_apuntar('pruebas', 'B28000016', false, 4102, 'fault · HTTP 500 · prueba V05', 'prueba V05');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v jsonb := public.verifactu_conexion_ultima('3b34403a-a7d6-4a48-a8d7-737e8cababdc');
begin
  if v->>'ok' <> 'false' or (v->>'codigo')::int <> 4102 or v->>'mensaje' <> 'fault · HTTP 500 · prueba V05' then raise exception 'PRUEBA V05 · 3: la última no es la suya (%).', v; end if;
  raise notice '3 · la última prueba de conexión: null sin pruebas; la suya con su código';
end $$;
reset role;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261125T1830_v05_verifactu_pruebas_empresas.down.sql
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_cert_abrir_pruebas', 'verifactu_cert_abrir_pruebas_envio', 'verifactu_despertar_empresa', 'verifactu_conexion_ultima')) then
    raise exception 'PRUEBA V05 · 4: la vuelta atrás dejó algo.';
  end if;
  raise notice '4 · la vuelta atrás: nada de la 1830';
end $$;

rollback;
