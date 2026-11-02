-- supabase/staging/sql/20261101_s01n_recibidas_prueba.sql
--
-- S01n · Prueba en ROLLBACK de la tanda claude/s01n-recibidas-rapidas (1134),
-- con la cuenta D de staging y 1.000 facturas inventadas (T11) de 25
-- proveedores, sin cuenta de gasto en su ficha ni asiento (las que preguntan a
-- lo aprendido):
--
--   1. Con la versión de antes, conta_gasto_aprendido se llama 1.000 veces o
--      más (una o varias por factura): así se ve que la prueba caza la vuelta
--      de la llamada por fila.
--   2. Con la 1134: como mucho una llamada por proveedor (25), en menos de
--      1 s, y el JSON idéntico al de antes (también el orden de las filas).
--   3. conta_pendientes, con la 1134, en menos de 1 s y con sus cifras.
--   4. La vuelta atrás deja el cuerpo de antes (su huella), y otra vez delante.
--
-- Para contar las llamadas sin track_functions (pide superusuario), dentro de
-- este ROLLBACK la función de verdad se renombra y una envoltura con su nombre
-- cuenta y la llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01n: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

alter function public.conta_gasto_aprendido(uuid, uuid) rename to conta_gasto_aprendido_s01n_real;
create function public.conta_gasto_aprendido(p_company uuid, p_supplier uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform set_config('prueba.llamadas', (coalesce(nullif(current_setting('prueba.llamadas', true), ''), '0')::int + 1)::text, true);
  return public.conta_gasto_aprendido_s01n_real(p_company, p_supplier);
end $$;
grant execute on function public.conta_gasto_aprendido(uuid, uuid) to authenticated;

do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_sup uuid[] := '{}'; v_s uuid;
begin
  for i in 1..25 loop
    insert into public.supplier (account_id, name, tax_id) values (v_acc, format('Proveedor Inventado S01n %s, S.L.', i), format('B99%s', lpad(i::text, 6, '0')))
    returning id into v_s;
    v_sup := v_sup || v_s;
  end loop;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name)
  select v_acc, v_e, v_sup[1 + (n % 25)], format('PRUEBA-S01N-%s', n), date '2026-10-01' + (n % 28), 10 + n, 'en_revision', 'manual', 'Prueba S01n'
    from generate_series(1, 1000) n;
end $$;

-- 1 · Con la versión de antes: una llamada (o más) por factura. Desde la rama,
-- el workflow ya ha pasado la 1134 en esta transacción: se vuelve al cuerpo de
-- antes desde su respaldo (y si no se ha pasado, ya es el de antes).
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_documentos_recibidos(uuid,date,date)'::regprocedure) = '6a1943f6f411e8fc4bd32dfe59fcef28' then
    perform public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261101T1134_s01n_recibidas_rapidas');
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_documentos_recibidos(uuid,date,date)'::regprocedure) <> '3e5a1a7e07564eab372eea33e20cec05' then
    raise exception 'PRUEBA S01n · 1: no tengo el cuerpo de antes (huella 3e5a1a7e…) para medirlo.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; t0 timestamptz := clock_timestamp(); v_ms numeric;
begin
  perform set_config('prueba.llamadas', '0', true);
  r := public.conta_documentos_recibidos('c01d0000-0000-4000-8000-0000000000d2', '2026-10-01', '2026-10-31');
  v_ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  if current_setting('prueba.llamadas')::int < 1000 then
    raise exception 'PRUEBA S01n · 1: con la versión de antes salen % llamadas, y tenían que ser 1.000 o más: la prueba no caza la llamada por fila.', current_setting('prueba.llamadas');
  end if;
  perform set_config('prueba.antes', r::text, true);
  raise notice 'PRUEBA S01n · 1: antes, % filas, % llamadas a conta_gasto_aprendido, % ms.', jsonb_array_length(r->'filas'), current_setting('prueba.llamadas'), v_ms;
end $$;
reset role;

\i supabase/migrations/20261101T1134_s01n_recibidas_rapidas.sql

-- 2 · Con la 1134: una por proveedor, en menos de 1 s, y el mismo JSON.
set local role authenticated;
do $$
declare r jsonb; a jsonb := current_setting('prueba.antes')::jsonb; t0 timestamptz := clock_timestamp(); v_ms numeric;
begin
  perform set_config('prueba.llamadas', '0', true);
  r := public.conta_documentos_recibidos('c01d0000-0000-4000-8000-0000000000d2', '2026-10-01', '2026-10-31');
  v_ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  if current_setting('prueba.llamadas')::int > 25 then
    raise exception 'PRUEBA S01n · 2: % llamadas a conta_gasto_aprendido con 25 proveedores: ha vuelto la llamada por fila.', current_setting('prueba.llamadas');
  end if;
  if v_ms >= 1000 then
    raise exception 'PRUEBA S01n · 2: con 1.000 facturas tarda % ms (tiene que ser menos de 1 s).', v_ms;
  end if;
  if jsonb_array_length(r->'filas') < 1000 then
    raise exception 'PRUEBA S01n · 2: salen % filas y había 1.000 facturas.', jsonb_array_length(r->'filas');
  end if;
  if r is distinct from a then
    raise exception 'PRUEBA S01n · 2: el JSON no es el de antes.';
  end if;
  raise notice 'PRUEBA S01n · 2: después, % filas, % llamadas (una por proveedor), % ms, el JSON idéntico (md5 %).',
    jsonb_array_length(r->'filas'), current_setting('prueba.llamadas'), v_ms, md5(r::text);
end $$;

-- 3 · conta_pendientes, que la llama con los 12 meses de la pantalla.
do $$
declare r jsonb; t0 timestamptz := clock_timestamp(); v_ms numeric;
begin
  r := public.conta_pendientes('c01d0000-0000-4000-8000-0000000000d2');
  v_ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  if v_ms >= 1000 then
    raise exception 'PRUEBA S01n · 3: conta_pendientes tarda % ms (tiene que ser menos de 1 s).', v_ms;
  end if;
  if r->'facturas_para_mirar' is null or r->'facturas_para_mirar' = 'null'::jsonb or (r->>'facturas_para_mirar')::int < 1000 then
    raise exception 'PRUEBA S01n · 3: conta_pendientes no cuenta las 1.000 para mirar: %', r - 'compras_filas';
  end if;
  raise notice 'PRUEBA S01n · 3: conta_pendientes en % ms, % facturas para mirar.', v_ms, r->>'facturas_para_mirar';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 4 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T1134_s01n_recibidas_rapidas.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_documentos_recibidos(uuid,date,date)'::regprocedure) <> '3e5a1a7e07564eab372eea33e20cec05' then
    raise exception 'PRUEBA S01n · 4: la vuelta atrás no deja el cuerpo de antes.';
  end if;
  raise notice 'PRUEBA S01n · 4: la vuelta atrás deja el cuerpo de antes (md5 3e5a1a7e…).';
end $$;
\i supabase/migrations/20261101T1134_s01n_recibidas_rapidas.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_documentos_recibidos(uuid,date,date)'::regprocedure) <> '6a1943f6f411e8fc4bd32dfe59fcef28' then
    raise exception 'PRUEBA S01n · 4: otra vez delante no deja el cuerpo nuevo.';
  end if;
end $$;

rollback;
