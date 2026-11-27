-- supabase/staging/sql/20261125_v05_verifactu_pruebas_empresas_prueba.sql
--
-- SOLO STAGING. Prueba de la 1830 (V05, solo añade), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A (NIF B28000016,
-- buscada por su cuenta: también corre en la base local del W09),
-- sin certificado autorizado:
--   0. Ninguna de las cuatro existe (tras la vuelta atrás, por si W05 la dejó).
--   1. Abrir el certificado para pruebas: sin autorización, no, y dice por qué;
--      un envío que no está, no; ni authenticated ni anon pueden llamarlas.
--   2. verifactu_despertar_empresa: otra persona, «Esa empresa no está»; una
--      acción que no existe, no; enviar con Verifactu apagado, «Primero pon
--      Verifactu en pruebas».
--   3. verifactu_conexion_ultima: sin pruebas, null; con una apuntada, la suya.
--      verifactu_pruebas_resumen: los recuentos de sus registros de pruebas,
--      igual que contados a mano; otra persona, «Esa empresa no está».
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
create temp table _r (r jsonb) on commit drop;
grant insert, select on _r to authenticated;
-- La empresa A por su cuenta y su NIF (regla 9): en staging y en la base local tiene ids distintos.
insert into _v values ('empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B28000016')),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1');
do $$ begin
  if (select v from _v where clave = 'empresa') is null then raise exception 'PRUEBA V05 · 0: no está la empresa A (B28000016) en la cuenta A.'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_cert_abrir_pruebas', 'verifactu_cert_abrir_pruebas_envio', 'verifactu_despertar_empresa', 'verifactu_conexion_ultima', 'verifactu_pruebas_resumen')) then
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
   where company_id = (select v::uuid from _v where clave = 'empresa') and retirada_at is null;
  v_r := public.verifactu_cert_abrir_pruebas((select v::uuid from _v where clave = 'empresa'));
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
    perform public.verifactu_despertar_empresa((select v::uuid from _v where clave = 'empresa'), 'probar_conexion');
    raise exception 'PRUEBA V05 · 2: otra persona pudo pedirlo.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_despertar_empresa((select v::uuid from _v where clave = 'empresa'), 'presentar');
    raise exception 'PRUEBA V05 · 2: una acción que no existe pasó.';
  exception when sqlstate '22023' then null;
  end;
end $$;
reset role;
update public.verifactu_empresa set modo = 'apagado' where company_id = (select v::uuid from _v where clave = 'empresa');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_despertar_empresa((select v::uuid from _v where clave = 'empresa'), 'enviar');
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
  if public.verifactu_conexion_ultima((select v::uuid from _v where clave = 'empresa')) is not null then raise exception 'PRUEBA V05 · 3: sin pruebas no da null.'; end if;
end $$;
reset role;
select public.verifactu_conexion_apuntar('pruebas', 'B28000016', false, 4102, 'fault · HTTP 500 · prueba V05', 'prueba V05');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare res jsonb := public.verifactu_conexion_ultima((select v::uuid from _v where clave = 'empresa'));
begin
  if res->>'ok' <> 'false' or (res->>'codigo')::int <> 4102 or res->>'mensaje' <> 'fault · HTTP 500 · prueba V05' then raise exception 'PRUEBA V05 · 3: la última no es la suya (%).', res; end if;
  raise notice '3 · la última prueba de conexión: null sin pruebas; la suya con su código';
end $$;
reset role;
-- Cinco registros de pruebas inventados (dentro de la transacción), para que el
-- resumen tenga algo que contar: 2 correctos, 1 con errores, 1 rechazado, 1 pendiente.
insert into public.verifactu_registro (account_id, company_id, entorno, tipo, origen, nif_emisor, nombre_emisor, num_serie, fecha_expedicion,
  primer_registro, fecha_hora_huso, generado_at, cadena_huella, huella, tipo_factura, cuota_total, importe_total, desglose, estado,
  codigo_error, descripcion_error, respondido_at)
select 'c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _v where clave = 'empresa'), 'pruebas', 'alta', 'simplificada', 'B28000016',
       'Taberna de Prueba Norte, S.L.', 'PRV05-' || n, date '2026-11-26', true, '2026-11-26T09:00:00+01:00', now(), 'prueba V05',
       upper(repeat(to_hex(n), 64)), 'F2', 21, 121, '[]'::jsonb, e,
       case when e = 'incorrecto' then 1100 end, case when e = 'incorrecto' then 'Valor o tipo incorrecto (prueba V05)' end,
       case when e <> 'pendiente' then now() - make_interval(mins => 10 - n) end
  from (values (1, 'correcto'), (2, 'correcto'), (3, 'aceptado_con_errores'), (4, 'incorrecto'), (5, 'pendiente')) x(n, e);

-- El resumen, leído como la persona de A, contra lo contado a mano con la misma regla (regla 31).
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into _r select public.verifactu_pruebas_resumen((select v::uuid from _v where clave = 'empresa'));
reset role;
do $$
declare res jsonb := (select r from _r); n int; ok int; mal int;
begin
  select count(*), count(*) filter (where estado = 'correcto'), count(*) filter (where estado = 'incorrecto') into n, ok, mal
    from public.verifactu_registro where company_id = (select v::uuid from _v where clave = 'empresa') and entorno = 'pruebas';
  if (res->>'total')::int <> n or (res->>'correctas')::int <> ok or (res->>'rechazadas')::int <> mal then
    raise exception 'PRUEBA V05 · 3: el resumen no cuadra (% contra % / % / %).', res, n, ok, mal;
  end if;
  if n < 5 or ok < 2 or mal < 1 then raise exception 'PRUEBA V05 · 3: faltan los registros inventados (% / % / %).', n, ok, mal; end if;
  if (res->>'pendientes')::int < 1 or (res->>'con_errores')::int < 1 then raise exception 'PRUEBA V05 · 3: no cuenta pendientes o con errores (%).', res; end if;
  if res->'para_qr'->>'num_serie' is null or res->'para_qr'->>'importe' <> '121.00' or res->'para_qr'->>'fecha' <> '26-11-2026' then
    raise exception 'PRUEBA V05 · 3: el QR de una aceptada no sale bien (%).', res->'para_qr';
  end if;
  if res->'ultimo_rechazo'->>'codigo' is null then raise exception 'PRUEBA V05 · 3: el último rechazo sin su código (%).', res->'ultimo_rechazo'; end if;
  raise notice '3 · el resumen de pruebas: % registros, % correctos, % rechazados, igual que contados a mano', n, ok, mal;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.verifactu_pruebas_resumen((select v::uuid from _v where clave = 'empresa'));
    raise exception 'PRUEBA V05 · 3: otra persona leyó el resumen.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 4 · La vuelta atrás.
\i supabase/vuelta-atras/20261125T1830_v05_verifactu_pruebas_empresas.down.sql
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verifactu_cert_abrir_pruebas', 'verifactu_cert_abrir_pruebas_envio', 'verifactu_despertar_empresa', 'verifactu_conexion_ultima', 'verifactu_pruebas_resumen')) then
    raise exception 'PRUEBA V05 · 4: la vuelta atrás dejó algo.';
  end if;
  raise notice '4 · la vuelta atrás: nada de la 1830';
end $$;

rollback;
