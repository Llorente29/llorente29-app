-- supabase/staging/sql/20261127_r21a_facturar_el_mes_prueba.sql
--
-- SOLO STAGING. Prueba del R21 · PR 1 (20261127T1826_r21a_facturar_el_mes), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que añade: public.conta_factura_pendiente,
-- public.conta_factura_visto_bueno, public.conta_factura_dejar, public.conta_factura_deshacer_pendiente,
-- public.conta_factura_resolver_pendiente y public.conta_factura_visto_bueno_dar.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), como el usuario del núcleo. Todo inventado (T11). Por
-- sus caminos:
--   1. «Dejar para después» un cobro de noviembre: queda en Pendientes con quién, el mes, el importe y el motivo; dejarlo
--      otra vez, no.
--   2. «Deshacer»: no borra, apunta quién y cuándo; el caso se puede volver a dejar.
--   3. Resolverlo: no antes del mes en que se dejó; en diciembre, con su mes en la descripción.
--   4. El visto bueno dos veces: el segundo sustituye al primero, que queda guardado.
--   5. Lo que ve otra cuenta: nada; y nadie escribe en las tablas sin las funciones.
--   6. La vuelta atrás (el fichero de verdad): sin las tablas ni las funciones.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R21a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_factura_pendiente') is null or to_regprocedure('public.conta_factura_dejar(uuid,text,text,date,text,numeric,text)') is null then
    raise exception 'PRUEBA R21a · 0: falta la 20261127T1826 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _r21 (k text primary key, valor text) on commit drop;
grant all on _r21 to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · Dejar para después
do $$ declare r jsonb; v public.conta_factura_pendiente; begin
  r := public.conta_factura_dejar('c0e20000-0000-4000-8000-0000000000e3', 'mov:00000000-0000-4000-8000-0000000000a1', 'no_se_sabe_quien', date '2026-11-01',
         null, 140.00, 'Traspaso de 140,00 € del 10/11 sin quién lo manda: preguntado a QBO.');
  insert into _r21 values ('p1', r->>'id');
  select * into v from public.conta_factura_pendiente where id = (r->>'id')::uuid;
  if v.importe <> 140.00 or v.mes <> date '2026-11-01' or v.dejado_por is null or v.dejado_at is null or v.tipo <> 'no_se_sabe_quien' then raise exception 'PRUEBA R21a · 1: %', to_jsonb(v); end if;
  if r->>'frase' not like 'Dejado para después: 140,00 €%' then raise exception 'PRUEBA R21a · 1: la frase: %', r->>'frase'; end if;
  begin
    perform public.conta_factura_dejar('c0e20000-0000-4000-8000-0000000000e3', 'mov:00000000-0000-4000-8000-0000000000a1', 'no_se_sabe_quien', date '2026-11-01', null, 140.00, 'Otra vez.');
    raise exception 'PRUEBA R21a · 1: se deja dos veces';
  exception when sqlstate '55000' then null; end;
  raise notice 'PRUEBA R21a · 1 OK: en Pendientes con quién, el mes, el importe y el motivo; dos veces, no';
end $$;

-- 2 · Deshacer
do $$ declare r jsonb; v public.conta_factura_pendiente; begin
  r := public.conta_factura_deshacer_pendiente((select valor from _r21 where k = 'p1')::uuid);
  select * into v from public.conta_factura_pendiente where id = (select valor from _r21 where k = 'p1')::uuid;
  if v.id is null or v.deshecho_at is null or v.deshecho_por is null then raise exception 'PRUEBA R21a · 2: deshacer borró o no apuntó: %', to_jsonb(v); end if;
  r := public.conta_factura_dejar('c0e20000-0000-4000-8000-0000000000e3', 'mov:00000000-0000-4000-8000-0000000000a1', 'no_se_sabe_quien', date '2026-11-01', null, 140.00, 'Preguntado a QBO.');
  insert into _r21 values ('p2', r->>'id');
  if (select count(*) from public.conta_factura_pendiente where clave = 'mov:00000000-0000-4000-8000-0000000000a1') <> 2 then raise exception 'PRUEBA R21a · 2: no quedan las dos filas'; end if;
  raise notice 'PRUEBA R21a · 2 OK: deshacer apunta quién y cuándo, no borra; se puede volver a dejar';
end $$;

-- 3 · Resolver
do $$ declare r jsonb; v public.conta_factura_pendiente; begin
  begin
    perform public.conta_factura_resolver_pendiente((select valor from _r21 where k = 'p2')::uuid, date '2026-10-01');
    raise exception 'PRUEBA R21a · 3: se resuelve antes del mes en que se dejó';
  exception when sqlstate '22023' then null; end;
  r := public.conta_factura_resolver_pendiente((select valor from _r21 where k = 'p2')::uuid, date '2026-12-01');
  select * into v from public.conta_factura_pendiente where id = (select valor from _r21 where k = 'p2')::uuid;
  if v.resuelto_mes <> date '2026-12-01' or v.resuelto_por is null then raise exception 'PRUEBA R21a · 3: %', to_jsonb(v); end if;
  if r->>'frase' <> 'Resuelto: sale de Pendientes y se factura en diciembre, con «noviembre» en la descripción.' then raise exception 'PRUEBA R21a · 3: la frase: %', r->>'frase'; end if;
  raise notice 'PRUEBA R21a · 3 OK: resuelto en diciembre, con su mes en la descripción';
end $$;

-- 4 · El visto bueno dos veces
do $$ declare r jsonb; begin
  perform public.conta_factura_visto_bueno_dar('c0e20000-0000-4000-8000-0000000000e3', date '2026-11-01', '1', 21034.09, 187);
  r := public.conta_factura_visto_bueno_dar('c0e20000-0000-4000-8000-0000000000e3', date '2026-11-01', '1', 21094.59, 188);
  if (select count(*) from public.conta_factura_visto_bueno where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and mes = date '2026-11-01') <> 2 then raise exception 'PRUEBA R21a · 4: no quedan los dos'; end if;
  if (select count(*) from public.conta_factura_visto_bueno where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and mes = date '2026-11-01' and sustituido_at is null) <> 1
     or (select facturas from public.conta_factura_visto_bueno where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and mes = date '2026-11-01' and sustituido_at is null) <> 188 then
    raise exception 'PRUEBA R21a · 4: el vivo no es el último';
  end if;
  if r->>'frase' <> 'Apuntado: Cegid da 21.094,59 € en 188 facturas de la serie 1 de noviembre. Listado para QBO.' then raise exception 'PRUEBA R21a · 4: la frase: %', r->>'frase'; end if;
  raise notice 'PRUEBA R21a · 4 OK: el segundo visto bueno sustituye al primero, que queda guardado';
end $$;

-- 5 · Otra cuenta no ve nada; nadie escribe sin las funciones
do $$ begin
  begin
    insert into public.conta_factura_pendiente (account_id, company_id, clave, tipo, mes, importe, motivo)
    values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', 'mov:x', 'sin_datos', date '2026-11-01', 1, 'x');
    raise exception 'PRUEBA R21a · 5: se escribe sin la función';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-00000000ffff","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.conta_factura_pendiente) or exists (select 1 from public.conta_factura_visto_bueno) then raise exception 'PRUEBA R21a · 5: otra cuenta ve algo'; end if;
  raise notice 'PRUEBA R21a · 5 OK: otra cuenta no ve nada; nadie escribe sin las funciones';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás, el fichero de verdad
\i supabase/vuelta-atras/20261127T1826_r21a_facturar_el_mes.down.sql
do $$ begin
  if to_regclass('public.conta_factura_pendiente') is not null or to_regclass('public.conta_factura_visto_bueno') is not null
     or to_regprocedure('public.conta_factura_dejar(uuid,text,text,date,text,numeric,text)') is not null then
    raise exception 'PRUEBA R21a · 6: la vuelta atrás dejó algo';
  end if;
  raise notice 'PRUEBA R21a · 6 OK: sin las tablas ni las funciones';
end $$;

rollback;
