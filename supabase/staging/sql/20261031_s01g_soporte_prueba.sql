-- supabase/staging/sql/20261031_s01g_soporte_prueba.sql
--
-- SOLO STAGING. Prueba de la 0930 y la 0931 (S01g, las recepciones de soporte
-- de la liquidación y las llegadas sin acción), por los caminos de la
-- pantalla, como el administrador de A, con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. Datos inventados.
--
--   1. Una recepción con la ruta «liquidacion» de un proveedor que liquida
--      cada mes sale «soporte» (no «por aclarar»), con su local y su mes, y
--      sin liquidación todavía.
--   2. La liquidación del socio (brand_partner_settlement_prepare) guarda su
--      proveedor, y la recepción ya dice con qué liquidación cuadra.
--   3. «No es soporte»: vuelve a «por aclarar» (y no se dice dos veces).
--   4. «Subir el PDF» de una llegada a la que le faltaba: queda recibida, con
--      su fichero; a una que no le falta, no.
--   5. La vuelta atrás deja las dos funciones como estaban y quita lo añadido,
--      y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01g: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261031T0930_s01g_soporte_columnas.sql
\i supabase/migrations/20261031T0931_s01g_soporte.sql

create temp table _s01g (k text primary key, v text) on commit drop;
grant all on _s01g to authenticated;

-- La preparación, antes de entrar como A: el socio (proveedor que liquida cada mes, con su tercero),
-- una recepción suya de un local de A con la ruta «liquidacion», y una llegada sin PDF.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_emp uuid := (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B28000016');
  v_loc uuid := (select id from public.locations where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by name limit 1);
  v_prov uuid; v_party uuid; v_ses uuid; v_rec uuid; v_inbox uuid;
begin
  if v_emp is null or v_loc is null then raise exception 'PRUEBA S01g: faltan la empresa o un local de A.'; end if;
  insert into public.supplier (account_id, name, invoicing_mode) values (v_acc, 'Socio de prueba S01g, S.L.', 'monthly_settlement') returning id into v_prov;
  -- El alta del proveedor le crea su tercero (disparador): se le añade el papel de socio.
  select party_id into v_party from public.party_role where supplier_id = v_prov;
  if v_party is null then raise exception 'PRUEBA S01g: el proveedor de prueba no tiene su tercero.'; end if;
  insert into public.party_role (account_id, party_id, role) values (v_acc, v_party, 'brand_partner');
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{"doc_type":"factura","doc_number":"PRUEBA-S01G-1","doc_date":"2026-10-20","grand_total":"163.32","supplier_name":"Socio de prueba S01g, S.L."},"lines":[]}', 'prueba', 'pending_review')
  returning id into v_ses;
  insert into public.goods_receipt (account_id, location_id, supplier_id, ai_session_id, receipt_date, status, source)
  values (v_acc, v_loc, v_prov, v_ses, '2026-10-20', 'confirmado', 'ocr') returning id into v_rec;
  insert into public.goods_receipt_path (account_id, goods_receipt_id, company_id, path, supplier_id, reason, decided_at)
  values (v_acc, v_rec, v_emp, 'liquidacion', v_prov, 'Prueba S01g: soporte de la liquidación', now());
  insert into public.document_inbox (account_id, company_id, channel, status, link_url, reason)
  values (v_acc, v_emp, 'subida', 'falta_pdf', 'https://example.com/factura-inventada', 'Prueba S01g: el correo traía un enlace') returning id into v_inbox;
  insert into _s01g values ('emp', v_emp::text), ('loc', v_loc::text), ('prov', v_prov::text), ('party', v_party::text), ('rec', v_rec::text), ('inbox', v_inbox::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · Soporte, sin liquidación todavía ───────────────────────────────────
do $$
declare d jsonb; f jsonb;
begin
  d := public.conta_documentos_recibidos((select x.v::uuid from _s01g x where x.k = 'emp'), '2026-10-01', '2026-10-31');
  select e into f from jsonb_array_elements(d->'filas') e where e->>'id' = (select x.v from _s01g x where x.k = 'rec');
  if f is null or f->>'estado' <> 'soporte' or f->'soporte'->>'mes' <> '2026-10' or f->'soporte'->>'proveedor' <> 'Socio de prueba S01g, S.L.'
     or f->'soporte'->'liquidacion' <> 'null'::jsonb or f->'recepcion'->>'local' is null or (d->'cifras'->>'soporte')::int < 1 then
    raise exception 'PRUEBA S01g · 1: la recepción de soporte no sale como debe: %', f;
  end if;
  raise notice 'PRUEBA S01g · 1: sale «soporte», con su local y su mes, sin liquidación todavía. %', f->>'porque';
end $$;

-- ── 2 · La liquidación del socio guarda su proveedor, y la recepción cuadra con ella ──
do $$
declare d jsonb; f jsonb; l public.licensed_settlement; res jsonb;
begin
  res := public.brand_partner_settlement_prepare((select x.v::uuid from _s01g x where x.k = 'party'), (select x.v::uuid from _s01g x where x.k = 'loc'), '2026-10-01', '2026-10-31', 'Prueba S01g');
  select * into l from public.licensed_settlement where id = (res->>'id')::uuid;
  if l.supplier_id is distinct from (select x.v::uuid from _s01g x where x.k = 'prov') then
    raise exception 'PRUEBA S01g · 2: la liquidación del socio no guarda su proveedor: %', row_to_json(l);
  end if;
  d := public.conta_documentos_recibidos((select x.v::uuid from _s01g x where x.k = 'emp'), '2026-10-01', '2026-10-31');
  select e into f from jsonb_array_elements(d->'filas') e where e->>'id' = (select x.v from _s01g x where x.k = 'rec');
  if f->'soporte'->'liquidacion'->>'id' is distinct from l.id::text then
    raise exception 'PRUEBA S01g · 2: la recepción no dice con qué liquidación cuadra: %', f->'soporte';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.compras_liquidacion_recepciones(l.id)) r where r->>'recepcion' = (select x.v from _s01g x where x.k = 'rec')) then
    raise exception 'PRUEBA S01g · 2: la liquidación no encuentra su recepción de soporte.';
  end if;
  raise notice 'PRUEBA S01g · 2: la liquidación del socio guarda su proveedor; la recepción cuadra con ella y la liquidación la encuentra.';
end $$;

-- ── 3 · «No es soporte»: vuelve a «por aclarar» ────────────────────────────
do $$
declare d jsonb; f jsonb; res jsonb;
begin
  res := public.conta_recepcion_no_es_soporte((select x.v::uuid from _s01g x where x.k = 'rec'));
  d := public.conta_documentos_recibidos((select x.v::uuid from _s01g x where x.k = 'emp'), '2026-10-01', '2026-10-31');
  select e into f from jsonb_array_elements(d->'filas') e where e->>'id' = (select x.v from _s01g x where x.k = 'rec');
  if f->>'estado' <> 'por_aclarar' or f->'soporte' <> 'null'::jsonb or res->>'mensaje' not like '%vuelve a «Por aclarar».' then
    raise exception 'PRUEBA S01g · 3: «No es soporte» no la devuelve a por aclarar: % (%)', f, res;
  end if;
  begin
    perform public.conta_recepcion_no_es_soporte((select x.v::uuid from _s01g x where x.k = 'rec'));
    raise exception 'PRUEBA S01g · 3: se dice dos veces que no es soporte.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01g · 3: «%»', res->>'mensaje';
end $$;

-- ── 4 · «Subir el PDF» de una llegada a la que le faltaba ──────────────────
do $$
declare res jsonb; d public.document_inbox; v_ruta text := 'c01a0000-0000-4000-8000-00000000000a/prueba-s01g.pdf';
begin
  res := public.conta_llegada_pdf_subido((select x.v::uuid from _s01g x where x.k = 'inbox'), v_ruta, 'factura-inventada.pdf', 'application/pdf', 1234, repeat('a', 64));
  select * into d from public.document_inbox where id = (select x.v::uuid from _s01g x where x.k = 'inbox');
  if d.status <> 'recibido' or d.file_path <> v_ruta or d.file_name <> 'factura-inventada.pdf' then
    raise exception 'PRUEBA S01g · 4: la llegada no queda recibida con su PDF: %', row_to_json(d);
  end if;
  begin
    perform public.conta_llegada_pdf_subido(d.id, v_ruta, 'otra.pdf', 'application/pdf', 1, repeat('b', 64));
    raise exception 'PRUEBA S01g · 4: sube un PDF a una llegada que ya lo tiene.';
  exception when sqlstate '22023' then null; end;
  raise notice 'PRUEBA S01g · 4: «%» La llegada queda recibida, con su fichero; a una que ya lo tiene, no.', res->>'mensaje';
end $$;
reset role;

-- ── 5 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261031T0931_s01g_soporte.down.sql
\i supabase/vuelta-atras/20261031T0930_s01g_soporte_columnas.down.sql
do $$ begin
  if position('soporte' in pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure)) > 0
     or position('v_prov' in pg_get_functiondef('public.brand_partner_settlement_prepare(uuid,uuid,date,date,text)'::regprocedure)) > 0
     or to_regprocedure('public.conta_recepcion_no_es_soporte(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'goods_receipt_path' and column_name = 'not_support_at') then
    raise exception 'PRUEBA S01g · 5: la vuelta atrás deja algo de la 0930 o la 0931.';
  end if;
end $$;
\i supabase/migrations/20261031T0930_s01g_soporte_columnas.sql
\i supabase/migrations/20261031T0931_s01g_soporte.sql
do $$ begin raise notice 'PRUEBA S01g · 5: la vuelta atrás deja las dos funciones como estaban y quita lo añadido; y otra vez delante.'; end $$;

rollback;
