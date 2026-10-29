-- supabase/staging/sql/20261028_s01b2_lectura_releida_prueba.sql
--
-- SOLO STAGING. Prueba de la 1555 (conta_lectura_proveedor_releida: completar
-- la lectura guardada de una factura desde una relectura de SU PDF), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A, con
-- datos INVENTADOS que se siembra ella misma, con la forma de la R0672 de
-- Foodint: una factura sin proveedor cuya lectura es de antes del 28/10 (sin
-- las claves «telefono» ni «web»), y las lecturas que dejaría ocr-albaran al
-- volver a leer su PDF. Como el administrador:
--
--   1. Completa el teléfono, la web y el correo vacío; no cambia el nombre, el
--      NIF ni la dirección que ya tenía, ni el resto de la lectura; lo apunta
--      en su historial (document_activity) y le pone el sello «releida».
--   2. Otra vez: no añade nada.
--   3. Una lectura de otro PDF, de otra cuenta, o alguien sin cuenta: no.
--   4. Una relectura que no trae ni teléfono ni web: deja las claves, vacías.
--   5. La vuelta atrás: sin la función.
--
-- Nombra lo que toca, para el analizador: conta_lectura_proveedor_releida,
-- supplier_invoice, goods_receipt_ai_session, document_activity.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01b2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '60s';

\i supabase/migrations/20261028T1555_s01b2_lectura_releida.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, service_role, anon;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('otra', 'c01b0000-0000-4000-8000-00000000000b'), ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        b uuid := (select v::uuid from _p where clave = 'otra');
        ruta text := a || '/s01b2-prueba/factura-S01B2-1.pdf'; ruta2 text := a || '/s01b2-prueba/factura-S01B2-2.pdf';
        f uuid; s uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source, raw_document_url,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, reading, reading_confidence)
  values (a, e, null, 'invoice', 'S01B2-1', '2026-09-07', 'en_revision', 'ocr', ruta, 100, 21, 121, true, 'Prueba S01b2',
          '{"factura": {"numero": "S01B2-1", "proveedor": {"nif": "B12345674", "email": null, "nombre": "S01b2 Rollos del Ejemplo S.L.U.", "direccion": "Pol. Ind. Inventado, C/ Ejemplo 9, Nave 9, 11160 Barbate (Cádiz)"}}, "confianza": "duda", "porque": ["Prueba S01b2."]}', 'duda')
  returning id into f; insert into _p values ('f1', f);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source, raw_document_url,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name, reading, reading_confidence)
  values (a, e, null, 'invoice', 'S01B2-2', '2026-09-08', 'en_revision', 'ocr', ruta2, 100, 21, 121, true, 'Prueba S01b2',
          '{"factura": {"numero": "S01B2-2", "proveedor": {"nif": "B00000721", "nombre": "S01b2 Sin teléfono SL"}}, "confianza": "duda"}', 'duda')
  returning id into f; insert into _p values ('f2', f);
  -- La relectura de SU PDF: trae teléfono, web y correo, y otro nombre y otro NIF (que no se deben tocar).
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (a, 'pdf', jsonb_build_array(jsonb_build_object('path', ruta, 'bucket', 'receipt-uploads')), '{"document":{},"lines":[]}',
          '{"factura": {"factura": {"proveedor": {"nombre": "OTRO NOMBRE", "nif": "B00000000", "email": "facturas@ejemplo.es", "direccion": "Otra calle", "telefono": "956 000 000", "web": "www.ejemplo.es"}}}}', 'prueba', 'pending_review')
  returning id into s; insert into _p values ('s1', s);
  -- Una de otro PDF, una de otra cuenta y la de la segunda factura (sin teléfono ni web).
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (a, 'pdf', jsonb_build_array(jsonb_build_object('path', a || '/s01b2-prueba/otra.pdf')), '{"document":{},"lines":[]}', '{"factura": {"factura": {"proveedor": {"telefono": "1"}}}}', 'prueba', 'pending_review')
  returning id into s; insert into _p values ('s2', s);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (b, 'pdf', jsonb_build_array(jsonb_build_object('path', ruta)), '{"document":{},"lines":[]}', '{"factura": {"factura": {"proveedor": {"telefono": "1"}}}}', 'prueba', 'pending_review')
  returning id into s; insert into _p values ('s3', s);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (a, 'pdf', jsonb_build_array(jsonb_build_object('path', ruta2)), '{"document":{},"lines":[]}', '{"factura": {"factura": {"proveedor": {"nombre": "S01b2 Sin teléfono SL", "telefono": null, "web": null}}}}', 'prueba', 'pending_review')
  returning id into s; insert into _p values ('s4', s);
end $$;

-- ── 1 y 2 · Como el administrador ───────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; p jsonb; l jsonb;
begin
  r := public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f1'), (select v::uuid from _p where clave = 's1'));
  select reading into l from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f1');
  p := l->'factura'->'proveedor';
  if p->>'nombre' <> 'S01b2 Rollos del Ejemplo S.L.U.' or p->>'nif' <> 'B12345674' or p->>'direccion' not like 'Pol. Ind. Inventado%' then
    raise exception 'PRUEBA S01b2 · 1: ha cambiado lo que ya traía: %', p;
  end if;
  if p->>'telefono' is distinct from '956 000 000' or p->>'web' is distinct from 'www.ejemplo.es' or p->>'email' is distinct from 'facturas@ejemplo.es' then
    raise exception 'PRUEBA S01b2 · 1: no ha completado el teléfono, la web y el correo: %', p;
  end if;
  if l->>'confianza' <> 'duda' or l->'factura'->>'numero' <> 'S01B2-1' or not (l ? 'releida') then
    raise exception 'PRUEBA S01b2 · 1: ha tocado el resto de la lectura o no le ha puesto el sello: %', l;
  end if;
  if r->'puesto' <> '["telefono", "web", "email"]'::jsonb then raise exception 'PRUEBA S01b2 · 1: dice que ha puesto %', r->'puesto'; end if;
  if not exists (select 1 from public.document_activity d where d.supplier_invoice_id = (select v::uuid from _p where clave = 'f1') and d.action = 'leida'
                   and d.text like '% vuelve a leer su PDF para los datos del proveedor: añade el teléfono, la web y el correo.') then
    raise exception 'PRUEBA S01b2 · 1: el historial no lo dice.';
  end if;
  raise notice '1 · completa el teléfono, la web y el correo, no toca el nombre ni el NIF, y lo apunta';
  r := public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f1'), (select v::uuid from _p where clave = 's1'));
  if r->'puesto' <> '[]'::jsonb then raise exception 'PRUEBA S01b2 · 2: la segunda vez añade %', r->'puesto'; end if;
  raise notice '2 · otra vez, no añade nada';
end $$;

-- ── 3 · Lo que no se puede ──────────────────────────────────────────────────
do $$
declare v_err text;
begin
  v_err := null;
  begin perform public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f1'), (select v::uuid from _p where clave = 's2'));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Esa lectura no es del PDF de esta factura.' then raise exception 'PRUEBA S01b2 · 3a: con otro PDF dio «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f1'), (select v::uuid from _p where clave = 's3'));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Esa lectura no está.' then raise exception 'PRUEBA S01b2 · 3b: con la de otra cuenta dio «%».', v_err; end if;
  raise notice '3 · una lectura de otro PDF o de otra cuenta, no';
end $$;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f1'), (select v::uuid from _p where clave = 's1'));
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01b2 · 3c: alguien sin cuenta completa una lectura.'; end if;
  raise notice '3 · alguien sin cuenta, no (%)', v_err;
end $$;

-- ── 4 · Una relectura sin teléfono ni web: las claves, vacías ───────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare p jsonb;
begin
  perform public.conta_lectura_proveedor_releida((select v::uuid from _p where clave = 'f2'), (select v::uuid from _p where clave = 's4'));
  select reading->'factura'->'proveedor' into p from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f2');
  if not (p ? 'telefono' and p ? 'web') or p->>'telefono' is not null or p->>'web' is not null then
    raise exception 'PRUEBA S01b2 · 4: sin teléfono ni web en la factura, las claves no han quedado vacías: %', p;
  end if;
  raise notice '4 · sin teléfono ni web: las claves quedan, vacías (y no se vuelve a leer)';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
reset role;
\i supabase/vuelta-atras/20261028T1555_s01b2_lectura_releida.down.sql
do $$ begin
  if to_regprocedure('public.conta_lectura_proveedor_releida(uuid,uuid)') is not null then raise exception 'PRUEBA S01b2 · 5: la vuelta atrás no quita la función.'; end if;
  raise notice '5 · la vuelta atrás quita la función';
end $$;

rollback;
