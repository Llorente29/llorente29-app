-- supabase/staging/sql/20261206_d03_recibida_pdf_prueba.sql
--
-- SOLO STAGING. Prueba de 20261206T0500_d03_recibida_pdf_sin_recepcion (y de
-- la 0510 y su vuelta atrás, que sin Foodint no hacen nada), con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Datos de la empresa A de
-- staging; las lecturas, las recepciones y las rutas son inventadas dentro de
-- la transacción (la función no mira el almacén: la ruta es la de la lectura).
--
--   (Empieza con la vuelta atrás, por si la 0500 ya estuviera.)
--   0. Lo de antes: _compras_factura_desde_papel es la de producción (md5
--      e0d04afd…), y con ella, una factura PDF subida SIN recepción, como
--      usuario de A («Subir una factura»), nace sin documento: el hueco.
--   1. La 0500.
--   2. Como usuario de A: un PDF sin recepción nace con el fichero de su
--      lectura. El que nació sin él antes de la 0500 sigue igual (lo arregla
--      la 0510 en producción): repetir la lectura no lo toca.
--   3. Una foto con su recepción, como antes: el documento de la RECEPCIÓN,
--      aunque la lectura diga otro.
--   4. Una recepción sin documento: el fichero de la lectura.
--   5. Una lectura sin ficheros, o con su fichero en otro bucket: sin
--      documento, y la factura nace igual.
--   6. B no hace facturas con la lectura de A.
--   7. La 0510 y su vuelta atrás: sin Foodint, no tocan nada.
--   8. La vuelta atrás: la función byte a byte (md5 de producción). Y otra
--      vez delante: su md5 nuevo.
-- No toca coste ni stock: las líneas nacen sin artículo (sin los cuatro
-- caminos de la regla 10, que no pasan por aquí).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261206T0500_d03_recibida_pdf_sin_recepcion.down.sql

-- 0 · Lo de antes.
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public._compras_factura_desde_papel(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)) into v_md5;
  if v_md5 <> 'e0d04afddb7e98ab9cb1b46deccb91e0' then raise exception 'PRUEBA D03 · 0: _compras_factura_desde_papel no es la de producción (%).', v_md5; end if;
end $$;

-- Las piezas (como postgres: es la preparación). Un proveedor de A y lecturas inventadas.
create temp table _d03 (clave text primary key, id uuid) on commit drop;
grant select on _d03 to authenticated;
insert into _d03 select 'prov', s.id from public.supplier s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' order by s.created_at, s.id limit 1;
do $$ begin
  if not exists (select 1 from _d03 where clave = 'prov') then raise exception 'PRUEBA D03 · 0: la cuenta A no tiene ningún proveedor en staging.'; end if;
end $$;

create function pg_temp.lectura(p_clave text, p_kind text, p_num text, p_ficheros jsonb)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', p_kind, p_ficheros,
          jsonb_build_object('document', jsonb_build_object('doc_type', 'factura', 'doc_number', p_num, 'doc_date', '2026-10-21',
                                                            'tax_base_total', 100, 'tax_total', 21, 'grand_total', 121),
                             'lines', '[{"raw_text": "Servicio", "line_amount": 100, "vat_pct": 21}]'::jsonb), 'pending_review')
  returning id into v;
  insert into _d03 values (p_clave, v);
  return v;
end $$;

create function pg_temp.fichero(p_ruta text, p_bucket text default 'receipt-uploads')
returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('path', p_ruta, 'bucket', p_bucket)) $$;

select pg_temp.lectura('antes', 'pdf', 'D03-PRUEBA-0', pg_temp.fichero('c01a0000-0000-4000-8000-00000000000a/prueba-d03/antes.pdf'));
select pg_temp.lectura('pdf', 'pdf', 'D03-PRUEBA-1', pg_temp.fichero('c01a0000-0000-4000-8000-00000000000a/prueba-d03/sin-recepcion.pdf'));
select pg_temp.lectura('foto', 'photo', 'D03-PRUEBA-2', pg_temp.fichero('c01a0000-0000-4000-8000-00000000000a/prueba-d03/lectura-foto.jpg'));
select pg_temp.lectura('recsin', 'photo', 'D03-PRUEBA-3', pg_temp.fichero('c01a0000-0000-4000-8000-00000000000a/prueba-d03/recepcion-sin-documento.jpg'));
select pg_temp.lectura('vacia', 'pdf', 'D03-PRUEBA-4', null);
select pg_temp.lectura('otrobucket', 'pdf', 'D03-PRUEBA-5', pg_temp.fichero('c01a0000-0000-4000-8000-00000000000a/prueba-d03/otro.pdf', 'otro-bucket'));

-- Dos recepciones en borrador: una con su documento (otro que el de la lectura) y una sin él.
insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, raw_document_url, created_by_name)
select 'd0300000-0000-4000-8000-000000000101', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p.id, 'borrador', date '2026-10-21',
       (select id from _d03 where clave = 'foto'), 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/recepcion.jpg', 'prueba D03'
  from _d03 p where p.clave = 'prov';
insert into public.goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, raw_document_url, created_by_name)
select 'd0300000-0000-4000-8000-000000000102', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p.id, 'borrador', date '2026-10-21',
       (select id from _d03 where clave = 'recsin'), null, 'prueba D03'
  from _d03 p where p.clave = 'prov';

-- Sin la 0500, como usuario de A: el PDF sin recepción nace sin documento.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.compras_factura_desde_papel((select id from _d03 where clave = 'antes'), (select id from _d03 where clave = 'prov'), null, '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  if not coalesce((v->>'creada')::boolean, false) then raise exception 'PRUEBA D03 · 0: no se ha creado la factura de antes (%).', v; end if;
  if (select raw_document_url from public.supplier_invoice where id = (v->>'factura')::uuid) is not null then
    raise exception 'PRUEBA D03 · 0: sin la 0500 ya nace con documento: ¿está ya aplicada?';
  end if;
  raise notice '0 · sin la 0500, «Subir una factura» con un PDF: % sin documento (el hueco de FAC-00098 y FAC-00101)', (select code from public.supplier_invoice where id = (v->>'factura')::uuid);
end $$;
reset role;

-- 1 · La 0500.
\i supabase/migrations/20261206T0500_d03_recibida_pdf_sin_recepcion.sql

-- 2 · Como usuario de A, un PDF sin recepción.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb; v2 jsonb; f public.supplier_invoice;
begin
  v := public.compras_factura_desde_papel((select id from _d03 where clave = 'pdf'), (select id from _d03 where clave = 'prov'), null, '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  select * into f from public.supplier_invoice where id = (v->>'factura')::uuid;
  if not coalesce((v->>'creada')::boolean, false) or f.raw_document_url is distinct from 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/sin-recepcion.pdf'
     or f.source <> 'ocr' or f.status <> 'en_revision' or f.ai_session_id <> (select id from _d03 where clave = 'pdf') then
    raise exception 'PRUEBA D03 · 2: el PDF sin recepción no nace con el fichero de su lectura (% / %).', v, f.raw_document_url;
  end if;
  -- El de antes de la 0500 sigue sin él: repetir su lectura no lo toca.
  v2 := public.compras_factura_desde_papel((select id from _d03 where clave = 'antes'), (select id from _d03 where clave = 'prov'), null, '3b34403a-a7d6-4a48-a8d7-737e8cababdc');
  if not coalesce((v2->>'repetida')::boolean, false)
     or (select raw_document_url from public.supplier_invoice where id = (v2->>'factura')::uuid) is not null then
    raise exception 'PRUEBA D03 · 2: la de antes de la 0500 ha cambiado al repetir su lectura (%).', v2;
  end if;
  raise notice '2 · %: nace con el fichero de su lectura; la de antes, repetida, sigue sin documento', f.code;
end $$;
reset role;

-- 3, 4 y 5 · Por dentro (como la llama el disparador de la recepción).
do $$
declare
  c_a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid := (select id from _d03 where clave = 'prov');
  v jsonb; v_url text;
begin
  v := public._compras_factura_desde_papel(c_a, (select id from _d03 where clave = 'foto'), v_p, null, c_e, 'd0300000-0000-4000-8000-000000000101', null);
  select raw_document_url into v_url from public.supplier_invoice where id = (v->>'factura')::uuid;
  if not coalesce((v->>'creada')::boolean, false) or v_url is distinct from 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/recepcion.jpg'
     or not exists (select 1 from public.supplier_invoice_receipt where supplier_invoice_id = (v->>'factura')::uuid and goods_receipt_id = 'd0300000-0000-4000-8000-000000000101') then
    raise exception 'PRUEBA D03 · 3: con recepción y documento no es el de la recepción, como antes (% / %).', v, v_url;
  end if;
  raise notice '3 · foto con su recepción: el documento de la recepción, como antes';

  v := public._compras_factura_desde_papel(c_a, (select id from _d03 where clave = 'recsin'), v_p, null, c_e, 'd0300000-0000-4000-8000-000000000102', null);
  select raw_document_url into v_url from public.supplier_invoice where id = (v->>'factura')::uuid;
  if not coalesce((v->>'creada')::boolean, false) or v_url is distinct from 'c01a0000-0000-4000-8000-00000000000a/prueba-d03/recepcion-sin-documento.jpg' then
    raise exception 'PRUEBA D03 · 4: la recepción sin documento no coge el de la lectura (% / %).', v, v_url;
  end if;
  raise notice '4 · recepción sin documento: el fichero de la lectura';

  v := public._compras_factura_desde_papel(c_a, (select id from _d03 where clave = 'vacia'), v_p, null, c_e, null, null);
  select raw_document_url into v_url from public.supplier_invoice where id = (v->>'factura')::uuid;
  if not coalesce((v->>'creada')::boolean, false) or v_url is not null then
    raise exception 'PRUEBA D03 · 5: una lectura sin ficheros no da una factura sin documento (% / %).', v, v_url;
  end if;
  v := public._compras_factura_desde_papel(c_a, (select id from _d03 where clave = 'otrobucket'), v_p, null, c_e, null, null);
  select raw_document_url into v_url from public.supplier_invoice where id = (v->>'factura')::uuid;
  if not coalesce((v->>'creada')::boolean, false) or v_url is not null then
    raise exception 'PRUEBA D03 · 5: un fichero de otro bucket se ha puesto como documento (% / %).', v, v_url;
  end if;
  raise notice '5 · sin ficheros o en otro bucket: nace igual, sin documento';
end $$;

-- 6 · B no hace facturas con la lectura de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.compras_factura_desde_papel((select id from _d03 where clave = 'pdf'), (select id from _d03 where clave = 'prov'), null, null);
    raise exception 'PRUEBA D03 · 6: B ha hecho una factura con la lectura de A.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 7 · La 0510 y su vuelta atrás: sin Foodint, nada.
create temp table _d03_antes on commit drop as
  select id, raw_document_url from public.supplier_invoice where raw_document_url is null;
\i supabase/migrations/20261206T0510_d03_recibida_pdf_datos.sql
\i supabase/vuelta-atras/20261206T0510_d03_recibida_pdf_datos.down.sql
do $$ begin
  if exists (select 1 from _d03_antes a join public.supplier_invoice i on i.id = a.id where i.raw_document_url is not null) then
    raise exception 'PRUEBA D03 · 7: sin Foodint, la 0510 o su vuelta atrás han tocado alguna recibida.';
  end if;
  raise notice '7 · la 0510 y su vuelta atrás, sin Foodint: ninguna recibida tocada';
end $$;

-- 8 · La vuelta atrás, byte a byte; y otra vez delante.
\i supabase/vuelta-atras/20261206T0500_d03_recibida_pdf_sin_recepcion.down.sql
do $$
declare v_md5 text; v_n int;
begin
  select md5(pg_get_functiondef('public._compras_factura_desde_papel(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)) into v_md5;
  if v_md5 <> 'e0d04afddb7e98ab9cb1b46deccb91e0' then raise exception 'PRUEBA D03 · 8: la vuelta atrás no la deja como en producción (%).', v_md5; end if;
  select count(*) into v_n from pg_proc where proname = '_compras_factura_desde_papel' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'PRUEBA D03 · 8: hay % firmas de _compras_factura_desde_papel (regla 2).', v_n; end if;
end $$;
\i supabase/migrations/20261206T0500_d03_recibida_pdf_sin_recepcion.sql
do $$
declare v_md5 text; v_n int;
begin
  select md5(pg_get_functiondef('public._compras_factura_desde_papel(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)) into v_md5;
  if v_md5 <> '8beefcf524b9bb482e6529e96589ad70' then raise exception 'PRUEBA D03 · 8: la 0500 no deja la función que se espera (%).', v_md5; end if;
  select count(*) into v_n from pg_proc where proname = '_compras_factura_desde_papel' and pronamespace = 'public'::regnamespace;
  if v_n <> 1 then raise exception 'PRUEBA D03 · 8: hay % firmas de _compras_factura_desde_papel (regla 2).', v_n; end if;
  raise notice '8 · vuelta atrás byte a byte (e0d04afd…) y otra vez delante (8beefcf5…), una sola firma';
end $$;

rollback;
