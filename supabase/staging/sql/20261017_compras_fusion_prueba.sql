-- supabase/staging/sql/20261017_compras_fusion_prueba.sql
--
-- SOLO STAGING. Prueba de «unir dos fichas de proveedor» (20261017T0100):
-- _supplier_merge, _supplier_merge_undo, supplier_merge_do y las de terceros
-- partidas en _party_merge / party_merge_do.
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
-- La población tiene la forma de lo de producción: la ficha que se va (como
-- «CLOUDTOWN, S.L.») sin NIF, con recepciones, pedidos, artículos, avisos de
-- la cola, alias de emisor y notify_group; la que queda (como «CLOUDTOWN
-- BRANDS, S.L.») con NIF y sin nada de eso. Y los choques que pueden pasar en
-- cualquier cliente: el mismo artículo con el mismo código en las dos, dos
-- preferidos del mismo artículo, el mismo dato aprendido, dos contactos
-- principales, la misma cuenta con el mismo papel.
--
--   1. Siembra (empresa A). Nombres inventados.
--   2. Antes: recuento por tabla de lo que cuelga de las DOS fichas.
--   3. Unir como administrador de nadie (sin usuario): supplier_merge_do PARA
--      con 42501. _supplier_merge sí une.
--   4. Después: el MISMO recuento da lo mismo; de la que se va solo queda lo
--      que chocaba (2 artículos, 1 dato aprendido, 1 contacto principal, 1
--      cuenta) y lo dice el rastro; la ficha que queda tiene notify_group y
--      el plazo de pago de la otra; la que se va y su tercero, archivados; un
--      solo tercero vivo.
--   5. Una segunda unión de la que ya se fue PARA.
--   6. Deshacer: el MISMO recuento, fila a fila por ficha, da lo de antes, y
--      la ficha que queda vuelve a no tener notify_group.
--   7. La de terceros sigue igual: party_merge_do y party_merge_undo sin
--      usuario PARAN (42501 y «esa fusión no existe»); el deshacer de la de
--      terceros (_party_merge_undo) ya lo ha ensayado el paso 6.
--   8. Con usuario: el administrador de A une y deshace por la puerta
--      (supplier_merge_do / supplier_merge_undo).

begin;

do $$
declare
  c_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  c_empresa constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  c_a1 constant uuid := '7e000000-0000-4000-8000-000000000a01';
  c_a2 constant uuid := '7e000000-0000-4000-8000-000000000a02';
  c_a3 constant uuid := '7e000000-0000-4000-8000-000000000a03';
  c_cuenta_41 constant uuid := '03c9ed1c-f6cf-4942-b113-435d5360fae2';  -- 41000000, común
  c_cuenta_600 constant uuid := '4fcffcdf-690f-43df-9f77-8588a7488d3a';  -- 60000000
  v_q uuid := 'f0510000-0000-4000-8000-000000000001';  -- la que queda
  v_g uuid := 'f0510000-0000-4000-8000-000000000002';  -- la que se va
  v_rec uuid[] := '{}'; v_r uuid; i int;
begin
  -- 1 · Siembra, como el administrador de A: dar de alta un artículo de
  --     proveedor recalcula su coste, y eso mira quién lo hace.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  insert into supplier (id, account_id, name, tax_id, created_by_name)
  values (v_q, c_cuenta, 'Distribuciones Prueba Unión, S.L.', 'B00000001', 'prueba');
  insert into supplier (id, account_id, name, notify_group, payment_terms_days, created_by_name)
  values (v_g, c_cuenta, 'DISTRIBUCIONES PRUEBA UNION', 'ctb', 30, 'prueba');

  for i in 1..3 loop
    insert into goods_receipt (account_id, location_id, supplier_id, status, receipt_date, created_by_name)
    values (c_cuenta, c_local, v_g, 'borrador', date '2026-10-01' + i, 'prueba') returning id into v_r;
    v_rec := v_rec || v_r;
  end loop;
  insert into purchase_order (account_id, supplier_id) values (c_cuenta, v_g), (c_cuenta, v_g);
  insert into ctb_notification_queue (account_id, supplier_id, goods_receipt_id) values (c_cuenta, v_g, v_rec[1]);
  insert into supplier_alias (account_id, supplier_id, emitter_norm) values (c_cuenta, v_g, 'distribuciones prueba union el horno');
  insert into invoice_approval_rule (account_id, supplier_id, required_role) values (c_cuenta, v_g, 'manager');

  -- Artículos: a1 mismo código en las dos (choca), a2 sin código solo en la que se va (se mueve),
  -- a3 preferido en las dos (choca por preferido aunque los códigos difieren).
  insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code) values (c_cuenta, c_a1, v_q, 'X1');
  insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code) values (c_cuenta, c_a1, v_g, 'X1');
  insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, supplier_item_name) values (c_cuenta, c_a2, v_g, null, 'Nombre del proveedor');
  insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, is_preferred) values (c_cuenta, c_a3, v_q, null, true);
  insert into article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, is_preferred) values (c_cuenta, c_a3, v_g, 'Z3', true);

  insert into supplier_learning (account_id, supplier_id, campo, valor, etiqueta, porque)
  values (c_cuenta, v_q, 'tax_rates', '10', 'IVA', 'prueba'), (c_cuenta, v_g, 'tax_rates', '21', 'IVA', 'prueba'),
         (c_cuenta, v_g, 'payment', 'transfer', 'Forma de pago', 'prueba');
  insert into supplier_contact (account_id, supplier_id, name, is_primary)
  values (c_cuenta, v_q, 'Ana', true), (c_cuenta, v_g, 'Luis', true), (c_cuenta, v_g, 'Marta', false);

  insert into company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (c_cuenta, c_empresa, c_cuenta_41, 'supplier', v_q::text, 'principal', 'manual'),
         (c_cuenta, c_empresa, c_cuenta_41, 'supplier', v_g::text, 'principal', 'manual'),
         (c_cuenta, c_empresa, c_cuenta_600, 'supplier', v_g::text, 'suplidos', 'manual');
  raise notice '1 · sembradas dos fichas: % (queda) y % (se va)', v_q, v_g;
  -- Sin usuario desde aquí: las puertas se prueban así.
  perform set_config('request.jwt.claims', '', true);
end $$;

-- El recuento que se usa antes, después y al deshacer: lo mismo, con la misma consulta.
create temp table _recuento (momento text, tabla text, ficha text, n int) on commit drop;
create or replace function pg_temp.contar(p_momento text) returns void language sql as $$
  insert into _recuento
  select p_momento, t, case s when 'f0510000-0000-4000-8000-000000000001'::uuid then 'queda' else 'se_va' end, n from (
    select 'goods_receipt' t, supplier_id s, count(*)::int n from goods_receipt group by 2
    union all select 'purchase_order', supplier_id, count(*) from purchase_order group by 2
    union all select 'ctb_notification_queue', supplier_id, count(*) from ctb_notification_queue group by 2
    union all select 'supplier_alias', supplier_id, count(*) from supplier_alias group by 2
    union all select 'invoice_approval_rule', supplier_id, count(*) from invoice_approval_rule group by 2
    union all select 'article_supplier', supplier_id, count(*) from article_supplier group by 2
    union all select 'supplier_learning', supplier_id, count(*) from supplier_learning group by 2
    union all select 'supplier_contact', supplier_id, count(*) from supplier_contact group by 2
    union all select 'company_account_link', entity_id::uuid, count(*) from company_account_link where entity = 'supplier' group by 2
  ) x where s in ('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002');
$$;
select pg_temp.contar('antes');
select tabla, ficha, n from _recuento where momento = 'antes' order by 1, 2;

do $$
declare v_res jsonb; v_err text;
begin
  -- 3 · Sin usuario, la puerta pública para.
  begin
    perform public.supplier_merge_do('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002', 'prueba');
    raise exception 'FALLO 3: supplier_merge_do unió sin usuario';
  exception when sqlstate '42501' then raise notice '3 · supplier_merge_do sin usuario: para con 42501 (bien)';
  end;
  v_res := public._supplier_merge('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002', 'prueba');
  raise notice '3 · %', v_res->>'resumen';
  raise notice '3 · rellenados: %', v_res->'rellenados';
  raise notice '3 · se quedan: %', v_res->'se_quedan';
end $$;

select pg_temp.contar('despues');
select tabla, ficha, n from _recuento where momento = 'despues' order by 1, 2;

do $$
declare v_antes int; v_despues int; v_q supplier; v_g supplier; v_vivos int; r record;
begin
  -- 4a · El total de cada tabla, igual antes y después.
  for r in select a.tabla, sum(a.n) antes, (select coalesce(sum(n), 0) from _recuento d where d.momento = 'despues' and d.tabla = a.tabla) despues
             from _recuento a where a.momento = 'antes' group by a.tabla loop
    if r.antes <> r.despues then raise exception 'FALLO 4a: % tenía % filas y tiene %', r.tabla, r.antes, r.despues; end if;
  end loop;
  -- 4b · En la que se va solo queda lo que chocaba.
  for r in select tabla, n from _recuento where momento = 'despues' and ficha = 'se_va' loop
    if (r.tabla, r.n) not in (('article_supplier', 2), ('supplier_learning', 1), ('supplier_contact', 1), ('company_account_link', 1)) then
      raise exception 'FALLO 4b: en la que se va quedan % filas de %', r.n, r.tabla;
    end if;
  end loop;
  if (select count(*) from _recuento where momento = 'despues' and ficha = 'se_va') <> 4 then raise exception 'FALLO 4b: no quedan exactamente los 4 choques'; end if;
  -- 4c · La ficha que queda, rellena; la que se va, archivada.
  select * into v_q from supplier where id = 'f0510000-0000-4000-8000-000000000001';
  select * into v_g from supplier where id = 'f0510000-0000-4000-8000-000000000002';
  if v_q.notify_group is distinct from 'ctb' or v_q.payment_terms_days is distinct from 30 then raise exception 'FALLO 4c: no se rellenó la ficha (%, %)', v_q.notify_group, v_q.payment_terms_days; end if;
  if v_q.tax_id is distinct from 'B00000001' then raise exception 'FALLO 4c: cambió el NIF de la que queda'; end if;
  if v_g.archived_at is null then raise exception 'FALLO 4c: la que se va sigue viva'; end if;
  -- 4d · Un solo tercero vivo para las dos.
  select count(*) into v_vivos from party p join party_role pr on pr.party_id = p.id
   where pr.supplier_id in ('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002') and p.archived_at is null;
  if v_vivos <> 1 then raise exception 'FALLO 4d: % terceros vivos', v_vivos; end if;
  if (select count(*) from supplier_merge where gone_supplier_id = 'f0510000-0000-4000-8000-000000000002' and party_merge_id is not null) <> 1 then
    raise exception 'FALLO 4d: el rastro no apunta la fusión de terceros';
  end if;
  raise notice '4 · totales iguales; en la que se va solo los 4 choques; ficha rellena; un tercero vivo (bien)';

  -- 5 · Unir otra vez a la que ya se fue, para.
  begin
    perform public._supplier_merge('f0510000-0000-4000-8000-000000000002', 'f0510000-0000-4000-8000-000000000001', 'prueba');
    raise exception 'FALLO 5: se pudo unir a una ficha ya unida';
  exception when sqlstate '22023' then raise notice '5 · unir a la que ya se fue: para (bien)';
  end;

  -- 6 · Deshacer.
  perform public._supplier_merge_undo((select id from supplier_merge where gone_supplier_id = 'f0510000-0000-4000-8000-000000000002'), 'prueba');
end $$;

select pg_temp.contar('deshecho');
select tabla, ficha, n from _recuento where momento = 'deshecho' order by 1, 2;

do $$
declare v_dif int; v_q supplier; v_g supplier; v_vivos int; v_res jsonb;
begin
  select count(*) into v_dif from (
    (select tabla, ficha, n from _recuento where momento = 'antes' except select tabla, ficha, n from _recuento where momento = 'deshecho')
    union all
    (select tabla, ficha, n from _recuento where momento = 'deshecho' except select tabla, ficha, n from _recuento where momento = 'antes')) x;
  if v_dif <> 0 then raise exception 'FALLO 6: deshacer no deja el recuento como antes (% diferencias)', v_dif; end if;
  select * into v_q from supplier where id = 'f0510000-0000-4000-8000-000000000001';
  select * into v_g from supplier where id = 'f0510000-0000-4000-8000-000000000002';
  if v_q.notify_group is not null or v_q.payment_terms_days is not null then raise exception 'FALLO 6: la que queda conserva lo rellenado'; end if;
  if v_g.archived_at is not null then raise exception 'FALLO 6: la que se fue sigue archivada'; end if;
  select count(*) into v_vivos from party p join party_role pr on pr.party_id = p.id
   where pr.supplier_id in ('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002') and p.archived_at is null;
  if v_vivos <> 2 then raise exception 'FALLO 6: % terceros vivos (tienen que ser 2)', v_vivos; end if;
  raise notice '6 · deshecho: el mismo recuento que antes, ficha sin rellenar, dos terceros vivos (bien)';

  -- 7 · La de terceros, igual que antes: sin usuario para.
  begin
    perform public.party_merge_do((select party_id from party_role where supplier_id = 'f0510000-0000-4000-8000-000000000001'),
                                  (select party_id from party_role where supplier_id = 'f0510000-0000-4000-8000-000000000002'), 'prueba');
    raise exception 'FALLO 7: party_merge_do fusionó sin usuario';
  exception when sqlstate '42501' then raise notice '7 · party_merge_do sin usuario: para con 42501 (bien)';
  end;
  begin
    perform public.party_merge_undo(gen_random_uuid(), 'prueba');
    raise exception 'FALLO 7: party_merge_undo deshizo algo que no existe';
  exception when sqlstate 'P0002' then raise notice '7 · party_merge_undo de algo que no existe: para (bien)';
  end;

  -- 8 · Con usuario: el administrador de A sí puede unir por la puerta, y deshacer.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  v_res := public.supplier_merge_do('f0510000-0000-4000-8000-000000000001', 'f0510000-0000-4000-8000-000000000002', 'prueba');
  if (select archived_at from supplier where id = 'f0510000-0000-4000-8000-000000000002') is null then raise exception 'FALLO 8: la puerta con permiso no unió'; end if;
  perform public.supplier_merge_undo((v_res->>'fusion')::uuid, 'prueba');
  if (select archived_at from supplier where id = 'f0510000-0000-4000-8000-000000000002') is not null then raise exception 'FALLO 8: la puerta con permiso no deshizo'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise notice '8 · el administrador de A une y deshace por la puerta (bien)';
end $$;

rollback;
