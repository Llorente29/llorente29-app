-- ============================================================================
-- PRUEBA (staging) · Compras · la 0350: al guardar cómo factura un proveedor,
-- las preguntas que salen de la ficha se vuelven a mirar, también en las
-- recepciones que ya tienen factura. Todo en una transacción con ROLLBACK.
--
-- Prueba _compras_camino_guarda y _compras_forma_facturar (las dos de la
-- 0350), por la puerta que usa la pantalla: compras_forma_facturar como el
-- administrador de A.
--
-- La población es la FORMA de lo que se midió en Foodint el 21/10 (nombres
-- inventados: el repositorio es público): recepciones ya con factura y la
-- pregunta «la ficha no dice cómo factura», de un albarán-factura y de una
-- factura; una con la pregunta del paso de la factura (factura repetida); y
-- un albarán sin consumir del que factura «con cada entrega».
--
--   1. Siembra: dos proveedores sin forma y cinco recepciones confirmadas por
--      confirm_goods_receipt; luego, las consumidas puestas como en Foodint.
--   2. «Con cada entrega» en el primero: las dos consumidas pierden la
--      pregunta y siguen con su camino, su factura y su consumed_at; la de la
--      factura repetida no se toca; el albarán sin consumir pasa a «el
--      documento y la ficha no dicen lo mismo».
--   3. «Albarán y factura después» en el segundo: su albarán-factura ya con
--      factura pasa a «no dicen lo mismo» (verdad), no desaparece.
--   4. «Por revisar» (compras_mirar) ya no las enseña.
--   5. Guardar otra vez lo mismo no cambia nada (ni la pregunta ni el resto).
--   6. Las puertas: sin usuario no se cambia la ficha.
--   7. La 0360 en staging no hace nada (no hay Foodint).
--   8. La vuelta atrás de la 0350 deja las dos funciones como en la 0120.
-- ============================================================================

begin;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recepcion(p_id uuid, p_sup uuid, p_doc text, p_dia date)
returns uuid language plpgsql as $$
declare v_s uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', p_doc, 'bill_to_name', 'TABERNA DE PRUEBA NORTE, SOCIEDAD LIMITADA'), 'lines', '[]'::jsonb),
          'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_sup, 'borrador', p_dia, v_s, 'P-' || right(p_id::text, 3), 'prueba');
  perform confirm_goods_receipt(p_id);
  return p_id;
end $$;

create function pg_temp.camino(p_id uuid) returns goods_receipt_path language sql as $$
  select * from goods_receipt_path where goods_receipt_id = p_id
$$;

-- ── 1 · Siembra ────────────────────────────────────────────────────────────
do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := 'c0c35000-0000-4000-8000-000000000001';  -- «Obrador Prueba Cinco»: con cada entrega
  v_o uuid := 'c0c35000-0000-4000-8000-000000000002';  -- «Gourmet Prueba Seis»: albarán y factura después
begin
  insert into supplier (id, account_id, name, invoicing_mode, created_by_name) values
    (v_e, c_cuenta, 'Obrador Prueba Cinco, S.A.', null, 'prueba'),
    (v_o, c_cuenta, 'Gourmet Prueba Seis, S.L.', null, 'prueba');
  perform pg_temp.recepcion('c0c35000-0000-4000-8000-000000000101', v_e, 'albaran_factura', date '2026-10-01');
  perform pg_temp.recepcion('c0c35000-0000-4000-8000-000000000102', v_e, 'factura',         date '2026-10-02');
  perform pg_temp.recepcion('c0c35000-0000-4000-8000-000000000103', v_e, 'factura',         date '2026-10-03');
  perform pg_temp.recepcion('c0c35000-0000-4000-8000-000000000104', v_e, 'albaran',         date '2026-10-04');
  perform pg_temp.recepcion('c0c35000-0000-4000-8000-000000000105', v_o, 'albaran_factura', date '2026-10-05');

  -- Las consumidas, como las de Foodint: su factura hecha y la pregunta de la
  -- ficha (101, 102 y 105), o la del paso de la factura (103).
  update goods_receipt_path set consumed_at = now() - interval '1 day', path = 'factura', question = 'ficha_sin_forma',
         question_detail = jsonb_build_object('ficha', null, 'papel', doc_type, 'sugerida', 'per_delivery', 'ficha_dice', null, 'sugerida_dice', 'con cada entrega')
   where goods_receipt_id in ('c0c35000-0000-4000-8000-000000000101', 'c0c35000-0000-4000-8000-000000000102', 'c0c35000-0000-4000-8000-000000000105');
  update goods_receipt_path set consumed_at = now() - interval '1 day', path = 'factura', question = 'factura_repetida',
         question_detail = jsonb_build_object('motivo', 'prueba')
   where goods_receipt_id = 'c0c35000-0000-4000-8000-000000000103';

  if (pg_temp.camino('c0c35000-0000-4000-8000-000000000104')).question is distinct from 'ficha_sin_forma'
     or (pg_temp.camino('c0c35000-0000-4000-8000-000000000104')).consumed_at is not null then
    raise exception 'PRUEBA 0350 · 1: el albarán sin consumir no ha salido con «la ficha no dice cómo factura» (%).',
      (pg_temp.camino('c0c35000-0000-4000-8000-000000000104')).question;
  end if;
  raise notice '1 · sembrados 2 proveedores sin forma y 5 recepciones: %',
    (select string_agg(right(goods_receipt_id::text, 3) || ' ' || path || ' (' || question || case when consumed_at is not null then ', con factura' else '' end || ')', ' · ' order by goods_receipt_id)
       from goods_receipt_path where goods_receipt_id::text like 'c0c35000-%');
end $$;

-- ── 2 · «Con cada entrega» en el primero ───────────────────────────────────
-- Lo de antes, para comparar; la llamada, como el usuario de A (la pantalla
-- llama a compras_forma_facturar con su sesión: R7 del C04b).
create temp table pg_temp.antes_101 as
  select consumed_at, path, supplier_invoice_id, reason, decided_at from goods_receipt_path where goods_receipt_id = 'c0c35000-0000-4000-8000-000000000101';

set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.compras_forma_facturar('c0c35000-0000-4000-8000-000000000001', 'per_delivery', null, null);
  if (v->>'recepciones')::int <> 3 then
    raise exception 'PRUEBA 0350 · 2: debía volver a mirar 3 recepciones del proveedor (las 2 consumidas con pregunta de la ficha y la sin consumir; no la de la factura repetida), y ha mirado %.', v->>'recepciones';
  end if;
  raise notice '2 · como el usuario de A: «con cada entrega» guardado, % recepciones vueltas a mirar', v->>'recepciones';
end $$;
reset role;

do $$
declare a goods_receipt_path; d goods_receipt_path; antes record;
begin
  select * into antes from pg_temp.antes_101;
  for a in select * from goods_receipt_path where goods_receipt_id in ('c0c35000-0000-4000-8000-000000000101', 'c0c35000-0000-4000-8000-000000000102') loop
    if a.question is not null or a.question_detail is not null then
      raise exception 'PRUEBA 0350 · 2: la recepción % ya con factura sigue preguntando «%».', right(a.goods_receipt_id::text, 3), a.question;
    end if;
    if a.consumed_at is null or a.path <> 'factura' then
      raise exception 'PRUEBA 0350 · 2: a la recepción % se le ha tocado el camino (%/%).', right(a.goods_receipt_id::text, 3), a.path, a.consumed_at;
    end if;
  end loop;
  a := pg_temp.camino('c0c35000-0000-4000-8000-000000000101');
  if (a.consumed_at, a.path, a.supplier_invoice_id, a.reason, a.decided_at) is distinct from (antes.consumed_at, antes.path, antes.supplier_invoice_id, antes.reason, antes.decided_at) then
    raise exception 'PRUEBA 0350 · 2: en la consumida ha cambiado algo más que la pregunta.';
  end if;
  d := pg_temp.camino('c0c35000-0000-4000-8000-000000000103');
  if d.question <> 'factura_repetida' or d.question_detail->>'motivo' <> 'prueba' then
    raise exception 'PRUEBA 0350 · 2: se ha tocado la pregunta del paso de la factura (%).', d.question;
  end if;
  d := pg_temp.camino('c0c35000-0000-4000-8000-000000000104');
  if d.question <> 'papel_y_ficha' or d.question_detail->>'ficha' <> 'per_delivery' then
    raise exception 'PRUEBA 0350 · 2: el albarán de quien factura con cada entrega no pregunta «no dicen lo mismo» (%).', d.question;
  end if;
  raise notice '2 · 101 y 102 sin pregunta (camino, factura y fecha intactos), 103 sigue «factura_repetida», 104 → «%»', d.question;
end $$;

-- ── 3 · «Albarán y factura después» en el segundo ──────────────────────────
set local role authenticated;
select public.compras_forma_facturar('c0c35000-0000-4000-8000-000000000002', 'delivery_note_then_invoice', false, 'monthly');
reset role;
do $$
declare a goods_receipt_path;
begin
  a := pg_temp.camino('c0c35000-0000-4000-8000-000000000105');
  if a.question <> 'papel_y_ficha' or a.question_detail->>'ficha' <> 'delivery_note_then_invoice' or a.question_detail->>'papel' <> 'albaran_factura'
     or a.consumed_at is null or a.path <> 'factura' then
    raise exception 'PRUEBA 0350 · 3: el albarán-factura ya con factura de quien factura «después» no ha quedado en «no dicen lo mismo» con su camino (%/%/%).', a.question, a.path, a.consumed_at;
  end if;
  raise notice '3 · «albarán y factura después» (como el usuario de A): 105 → «%» (ficha %, documento %), camino intacto', a.question, a.question_detail->>'ficha', a.question_detail->>'papel';
end $$;

-- ── 4 · «Por revisar», como lo lee la pantalla ─────────────────────────────
set local role authenticated;
do $$
declare v jsonb; v_cod text[];
begin
  v := public.compras_mirar('c01a0000-0000-4000-8000-00000000000a');
  select coalesce(array_agg(right(x->>'recepcion', 3) || ':' || (x->>'pregunta') order by x->>'recepcion'), '{}') into v_cod
    from jsonb_array_elements(v->'recepciones') x where x->>'recepcion' like 'c0c35000-%';
  if v_cod <> array['103:factura_repetida', '104:papel_y_ficha', '105:papel_y_ficha'] then
    raise exception 'PRUEBA 0350 · 4: «Por revisar» enseña %, y debía enseñar 103, 104 y 105.', v_cod;
  end if;
  raise notice '4 · «Por revisar» (como el usuario de A) enseña de estas: % (101 y 102 ya no)', v_cod;
end $$;
reset role;

-- ── 5 · Guardar otra vez lo mismo ──────────────────────────────────────────
do $$
declare v_antes text; v_despues text;
begin
  select md5(string_agg(p::text, '|' order by goods_receipt_id)) into v_antes
    from goods_receipt_path p where goods_receipt_id::text like 'c0c35000-%' and consumed_at is not null;
  perform public.compras_forma_facturar('c0c35000-0000-4000-8000-000000000002', 'delivery_note_then_invoice', false, 'monthly');
  select md5(string_agg(p::text, '|' order by goods_receipt_id)) into v_despues
    from goods_receipt_path p where goods_receipt_id::text like 'c0c35000-%' and consumed_at is not null;
  if v_antes <> v_despues then raise exception 'PRUEBA 0350 · 5: guardar lo mismo ha cambiado las consumidas.'; end if;
  raise notice '5 · guardar lo mismo otra vez: las consumidas, idénticas (md5 % a los dos lados)', left(v_antes, 8);
end $$;

-- ── 6 · Las puertas ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform public.compras_forma_facturar('c0c35000-0000-4000-8000-000000000001', 'monthly_settlement', null, null);
    raise exception 'PRUEBA 0350 · 6: sin usuario se ha podido cambiar la ficha.';
  exception when sqlstate '42501' then null;
  end;
  raise notice '6 · sin usuario, cambiar la ficha para (42501)';
end $$;

-- ── 7 · La 0360 aquí no hace nada ──────────────────────────────────────────
do $$
begin
  if exists (select 1 from accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'PRUEBA 0350 · 7: staging tiene la cuenta de Foodint: la 0360 tocaría datos aquí.';
  end if;
  raise notice '7 · staging no tiene a Foodint: la 0360 no hace nada aquí (su prueba con datos es el ensayo en producción)';
end $$;

-- ── 8 · La vuelta atrás de la 0350 deja las dos funciones como en la 0120 ──
\i supabase/vuelta-atras/20261129T0350_compras_preguntas_de_la_ficha.down.sql
do $$
declare v_g text; v_f text;
begin
  select md5(prosrc) into v_g from pg_proc where oid = 'public._compras_camino_guarda(uuid)'::regprocedure;
  select md5(prosrc) into v_f from pg_proc where oid = 'public._compras_forma_facturar(uuid,text,boolean,text)'::regprocedure;
  -- Los md5 de la 0120, medidos en producción el 21/10.
  if v_g <> '63843e289225aa9f57ee76de5127b709' or v_f <> '73d8f96272d57d7c2684521e7f4484d6' then
    raise exception 'PRUEBA 0350 · 8: la vuelta atrás no deja los cuerpos de la 0120 (guarda %, forma %).', v_g, v_f;
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_compras_camino_guarda', '_compras_forma_facturar')) <> 2 then
    raise exception 'PRUEBA 0350 · 8: tras la vuelta atrás hay más de una firma.';
  end if;
  raise notice '8 · vuelta atrás: las dos funciones, byte a byte las de la 0120 (md5 63843e28… y 73d8f962…)';
end $$;

rollback;
