-- supabase/staging/sql/20261123_k11b_lineas_solo_lo_que_cambia_prueba.sql
--
-- SOLO STAGING. Prueba del K11b (20261123T1750): en cada línea de la recibida, conta_recibida_otros_datos guarda solo
-- las claves que vienen. Todo en una transacción con ROLLBACK: staging no cambia. Nombra el objeto que cambia:
-- public.conta_recibida_otros_datos.
--
-- Es el camino de la ficha (regla 10), con las lecturas retrasadas de la e2e 45225555049: elegir la marca y, antes de
-- que vuelva la lectura, la plataforma. En la gestoría de la cuenta del núcleo (semilla K02), como su usuario; una
-- recibida, una marca y una plataforma inventadas (T11):
--   1. Solo la marca A: la línea queda con A y sin plataforma.
--   2. Solo la plataforma P (lo que manda la ficha al elegirla): la marca A se queda. Con la función de antes, se borraba.
--   3. Solo la marca B: la plataforma P se queda.
--   4. La marca con null: se borra la marca; la plataforma P se queda.
--   5. Solo el concepto: la marca (vacía) y la plataforma se quedan.
--   6. Las tres claves juntas: lo de siempre, las tres.
--   Y el rastro: cada paso deja su fila en supplier_invoice_change con la línea de antes y la de ahora.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K11b líneas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_recibida_otros_datos(uuid,jsonb,text)'::regprocedure), 'K11b: solo lo que viene') = 0 then
    raise exception 'PRUEBA K11b líneas · 0: falta la 20261123T1750 (conta_recibida_otros_datos sin «solo lo que viene»).';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.supplier (id, account_id, name, tax_id, country_code, vat_regime) values
    ('c0f90000-0000-4000-8000-0000000000a1', a, 'Proveedor de Prueba K11b Líneas, S.L.', 'B00011222', 'ES', 'general');
  insert into public.brand (id, account_id, name, slug) values
    ('c0f90000-0000-4000-8000-0000000000b1', a, 'Marca de Prueba K11b A', 'prueba-k11b-lineas-a'),
    ('c0f90000-0000-4000-8000-0000000000b2', a, 'Marca de Prueba K11b B', 'prueba-k11b-lineas-b');
  insert into public.sales_channel (id, account_id, name, slug) values
    ('c0f90000-0000-4000-8000-0000000000d1', a, 'Plataforma de Prueba K11b', 'prueba-k11b-lineas-p');
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, created_at)
  values ('c0f90000-0000-4000-8000-0000000000f1', a, emp, 'c0f90000-0000-4000-8000-0000000000a1', 'invoice', 'K11B-LINEAS', date '2026-11-05',
          'en_revision', 'manual', 100, 21, 121, true, 'prueba K11b', timestamptz '2026-11-05 10:00+01');
end $$;

-- La línea 0 tal como queda, y cuántas filas de rastro lleva la factura.
create or replace function pg_temp.k11b_linea() returns text language sql as $$
  select coalesce((select concat_ws(' · ', coalesce(d.concept, '-'), coalesce(right(d.brand_id::text, 2), '-'), coalesce(right(d.channel_id::text, 2), '-'))
                     from public.supplier_invoice_expense_dato d where d.supplier_invoice_id = 'c0f90000-0000-4000-8000-0000000000f1' and d.position = 0), 'sin fila')
$$;
grant execute on function pg_temp.k11b_linea() to authenticated;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  f constant uuid := 'c0f90000-0000-4000-8000-0000000000f1';
  ma constant text := 'c0f90000-0000-4000-8000-0000000000b1'; mb constant text := 'c0f90000-0000-4000-8000-0000000000b2';
  p constant text := 'c0f90000-0000-4000-8000-0000000000d1';
  v text; n int;
begin
  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'marca', ma))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · b1 · -' then raise exception 'PRUEBA K11b líneas · 1: solo la marca A, la línea es «%»', v; end if;
  raise notice 'PRUEBA K11b líneas · 1: solo la marca A → «%»', v;

  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'plataforma', p))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · b1 · d1' then raise exception 'PRUEBA K11b líneas · 2: solo la plataforma, la línea es «%» (la marca A se tenía que quedar)', v; end if;
  raise notice 'PRUEBA K11b líneas · 2: solo la plataforma → «%»: la marca A se queda', v;

  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'marca', mb))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · b2 · d1' then raise exception 'PRUEBA K11b líneas · 3: solo la marca B, la línea es «%» (la plataforma se tenía que quedar)', v; end if;
  raise notice 'PRUEBA K11b líneas · 3: solo la marca B → «%»: la plataforma se queda', v;

  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'marca', null))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · - · d1' then raise exception 'PRUEBA K11b líneas · 4: la marca con null, la línea es «%»', v; end if;
  raise notice 'PRUEBA K11b líneas · 4: la marca con null → «%»: se borra la marca, la plataforma se queda', v;

  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('posicion', 0, 'concepto', 'Comida de prueba'))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from 'Comida de prueba · - · d1' then raise exception 'PRUEBA K11b líneas · 5: solo el concepto, la línea es «%»', v; end if;
  raise notice 'PRUEBA K11b líneas · 5: solo el concepto → «%»', v;

  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(
    jsonb_build_object('posicion', 0, 'concepto', null, 'marca', ma, 'plataforma', null))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · b1 · -' then raise exception 'PRUEBA K11b líneas · 6: las tres claves, la línea es «%»', v; end if;
  raise notice 'PRUEBA K11b líneas · 6: las tres claves juntas → «%»: lo de siempre', v;

  select count(*) into n from public.supplier_invoice_change c, jsonb_array_elements(c.cambios) x
   where c.supplier_invoice_id = f and x->>'campo' = 'linea';
  if n <> 6 then raise exception 'PRUEBA K11b líneas · rastro: % filas de línea en supplier_invoice_change, y eran 6', n; end if;
  if not exists (select 1 from public.supplier_invoice_change c, jsonb_array_elements(c.cambios) x
                  where c.supplier_invoice_id = f and x->>'campo' = 'linea'
                    and x->'antes'->>'marca' = ma and x->'ahora'->>'marca' = ma and x->'ahora'->>'plataforma' = p) then
    raise exception 'PRUEBA K11b líneas · rastro: el paso 2 no deja la marca A antes y después';
  end if;
  raise notice 'PRUEBA K11b líneas · rastro: 6 cambios de línea, con la línea de antes y la de ahora.';
end $$;
reset role;

-- 7 · La vuelta atrás, sobre los mismos datos: la función vuelve a la de antes, y con ella solo la plataforma vuelve a
--     borrar la marca (lo que se arregla). Lo guardado no se toca: la línea sigue como la dejó el paso 6.
\i supabase/vuelta-atras/20261123T1750_k11b_lineas_solo_lo_que_cambia.down.sql
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare f constant uuid := 'c0f90000-0000-4000-8000-0000000000f1'; v text;
begin
  if strpos(pg_get_functiondef('public.conta_recibida_otros_datos(uuid,jsonb,text)'::regprocedure), 'K11b: solo lo que viene') > 0 then
    raise exception 'PRUEBA K11b líneas · 7: después de la vuelta atrás, la función sigue siendo la nueva';
  end if;
  v := pg_temp.k11b_linea();
  if v is distinct from '- · b1 · -' then raise exception 'PRUEBA K11b líneas · 7: la vuelta atrás ha movido la línea («%»)', v; end if;
  perform public.conta_recibida_otros_datos(f, jsonb_build_object('lineas', jsonb_build_array(
    jsonb_build_object('posicion', 0, 'plataforma', 'c0f90000-0000-4000-8000-0000000000d1'))), 'Prueba K11b');
  v := pg_temp.k11b_linea();
  if v is distinct from '- · - · d1' then raise exception 'PRUEBA K11b líneas · 7: con la función de antes, solo la plataforma deja «%»', v; end if;
  raise notice 'PRUEBA K11b líneas · 7: vuelta atrás: la función de antes, la línea sin mover, y solo la plataforma vuelve a borrar la marca («%»).', v;
end $$;
reset role;

rollback;
