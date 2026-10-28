-- supabase/staging/sql/20261028_s01b_ficha_desde_factura_prueba.sql
--
-- SOLO STAGING. Prueba de la 1304 (de qué factura sale cada dato de la ficha y
-- «Guardar este IBAN») y de la 1305 (el IBAN ya no se pone solo), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A, con
-- datos INVENTADOS que se siembra ella misma (tres proveedores y cuatro
-- lecturas), por los CAMINOS de verdad: la llegada por correo y su lectura
-- (conta_entrada_llegada → conta_factura_desde_lectura, como ocr-albaran),
-- elegir el proveedor después (supplier_invoice.supplier_id) y el botón
-- (conta_proveedor_iban_de_factura), como el administrador:
--
--   0. Lo de antes: el disparador es el de producción (md5 de prosrc medido el
--      28/10, d840156236f657fb49d44e7bb221795b).
--   1. La lectura: un proveedor sin IBAN NO recibe el de su factura; el
--      historial lo dice. Uno con otro IBAN, como siempre: aviso, y no cambia.
--      Elegido después, tampoco lo recibe.
--   2. «Guardar este IBAN»: lo guarda, con quién, cuándo y de qué factura
--      (data_from_invoice.iban); otra vez, «ya tiene este IBAN»; a uno con
--      otro, no (se decide en la factura); el de una factura de otro
--      proveedor, no; uno que no pasa el módulo 97, no.
--   3. Alguien sin cuenta no puede.
--   4. La vuelta atrás: el disparador byte a byte como estaba; sin la función
--      ni la columna.
--
-- Nombra lo que toca, para el analizador: _pc01e2b_iban_de_la_factura,
-- conta_proveedor_iban_de_factura, supplier, supplier_invoice,
-- document_activity, conta_factura_desde_lectura.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '60s';

-- ── 0 · Lo de antes es producción ───────────────────────────────────────────
select to_regprocedure('public.conta_proveedor_iban_de_factura(uuid,uuid)') is not null as ya_1304,
       exists (select 1 from public.funcion_respaldo where migracion = '20261028T1305_s01b_iban_no_se_pone_solo') as ya_1305 \gset
\if :ya_1305
\i supabase/vuelta-atras/20261028T1305_s01b_iban_no_se_pone_solo.down.sql
delete from public.funcion_respaldo where migracion = '20261028T1305_s01b_iban_no_se_pone_solo';
\endif
do $$ begin
  if md5((select prosrc from pg_proc where oid = 'public._pc01e2b_iban_de_la_factura()'::regprocedure)) <> 'd840156236f657fb49d44e7bb221795b' then
    raise exception 'PRUEBA S01b · 0: el disparador del IBAN de la factura no es el de producción.';
  end if;
  raise notice '0 · el disparador de antes es el de producción';
end $$;
create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, service_role, anon;
insert into _p select 'antes', md5(pg_get_functiondef('public._pc01e2b_iban_de_la_factura()'::regprocedure));
\if :ya_1304
\else
\i supabase/migrations/20261028T1304_s01b_ficha_desde_factura.sql
\endif
\i supabase/migrations/20261028T1305_s01b_iban_no_se_pone_solo.sql

insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');

-- ── Siembra (como el dueño): tres proveedores con su 400 y cuatro lecturas ───
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        s uuid; i int := 0; v_s uuid; k text;
        lect jsonb := '{"factura":{"proveedor":{"nombre":"X","nif":"X"},"numero":"X","fecha":"2026-10-20","vencimiento":"2026-11-20","clase":"completa","tipos":[{"tipo":21,"base":100,"cuota":21,"recargoTipo":null,"recargo":0}],"base":100,"cuota":21,"recargo":0,"retencion":null,"total":121,"iban":null,"forma":"transfer"},"comprobaciones":[],"confianza":"seguro","porque":["Prueba S01b."]}';
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'S01b Sin IBAN', 'S01b Sin IBAN SL', 'B00000711', true) returning id into s; insert into _p values ('p1', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, iban) values (a, 'S01b Con IBAN', 'S01b Con IBAN SL', 'B00000712', true, 'ES1720852066623456789011') returning id into s; insert into _p values ('p2', s);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active) values (a, 'S01b Elegido después', 'S01b Elegido después SL', 'B00000713', true) returning id into s; insert into _p values ('p3', s);
  foreach k in array array['p1', 'p2', 'p3'] loop
    i := i + 1;
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    select a, e, ca.plan, '4000971' || i, ca.template_code, 'Proveedores · S01b ' || i, ca.kind, ca.source
      from public.company_account ca where ca.company_id = e and ca.code = '40000001';
    if not found then raise exception 'PRUEBA S01b · siembra: la empresa A no tiene la 40000001 de molde.'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    select a, e, ca.id, 'supplier', (select v from _p where clave = k), 'principal', 'manual' from public.company_account ca where ca.company_id = e and ca.code = '4000971' || i;
  end loop;
  -- Las lecturas que dejaría ocr-albaran (modo factura): (NIF, número, IBAN leído).
  for i in 1..4 loop
    insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
    values (a, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura',
      jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(lect,
        '{factura,fecha}', to_jsonb('2026-10-2' || i)),
        '{factura,proveedor,nif}', to_jsonb((array['B00000711', 'B00000712', 'B00000799', 'B00000711'])[i])),
        '{factura,proveedor,nombre}', to_jsonb((array['S01b Sin IBAN SL', 'S01b Con IBAN SL', 'Una que no conozco SL', 'S01b Sin IBAN SL'])[i])),
        '{factura,numero}', to_jsonb('S01B-' || i)),
        '{factura,iban}', to_jsonb((array['ES7921000813610123456789', 'ES6621000418401234567891', 'ES9121000418450200051332', 'ES9121000418450200051333'])[i]))), 'prueba', 'pending_review') returning id into v_s;
    insert into _p values ('s' || i, v_s);
  end loop;
end $$;

-- ── 1 · La lectura, como la función de correo (service_role) ────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        l jsonb; r jsonb; i int; f public.supplier_invoice; p public.supplier;
begin
  for i in 1..3 loop
    l := public.conta_entrada_llegada(jsonb_build_object('account_id', a, 'company_id', e, 'email_id', 'prueba-s01b-' || i, 'to', 'facturas-prueba-s01b@entrada.folvy.app',
           'ruta', a::text || '/_correo/prueba-s01b-' || i || '/01.pdf', 'nombre', 'factura.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', repeat(lpad(i::text, 2, 'c'), 32)));
    r := public.conta_factura_desde_lectura((l->>'id')::uuid, (select v::uuid from _p where clave = 's' || i));
    if r->>'estado' <> 'factura' then raise exception 'PRUEBA S01b · 1: la lectura % no dio factura: %', i, r; end if;
    insert into _p values ('f' || i, r->>'factura_id');
  end loop;
  -- 1a · Sin IBAN: NO se lo pongo; el historial lo dice.
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'f1');
  select * into p from public.supplier where id = (select v::uuid from _p where clave = 'p1');
  if f.supplier_id is distinct from p.id or f.read_iban is distinct from 'ES7921000813610123456789' or p.iban is not null or p.iban_unconfirmed_invoice_id is not null
     or not exists (select 1 from public.document_activity d where d.supplier_invoice_id = f.id and (d.detail->>'iban_propuesto')::boolean
                     and d.text = 'Esta factura trae un IBAN (···· 6789) y S01b Sin IBAN no tiene en su ficha. No lo pongo solo: al revisarla, «Guardar este IBAN» lo guarda.') then
    raise exception 'PRUEBA S01b · 1a: el IBAN se puso solo, o el historial no lo dice (factura %, ficha %/%).', f.read_iban, p.iban, p.iban_unconfirmed_invoice_id;
  end if;
  -- 1b · Con otro IBAN: como siempre (aviso, y la ficha no cambia).
  select * into p from public.supplier where id = (select v::uuid from _p where clave = 'p2');
  if p.iban <> 'ES1720852066623456789011'
     or not exists (select 1 from public.document_activity d where d.supplier_invoice_id = (select v::uuid from _p where clave = 'f2') and (d.detail->>'iban_distinto')::boolean) then
    raise exception 'PRUEBA S01b · 1b: el IBAN distinto no quedó como aviso.';
  end if;
  -- 1c · Una que no conozco: sin proveedor. Se le elige después y tampoco recibe el IBAN.
  update public.supplier_invoice set supplier_id = (select v::uuid from _p where clave = 'p3') where id = (select v::uuid from _p where clave = 'f3');
  if (select iban from public.supplier where id = (select v::uuid from _p where clave = 'p3')) is not null then
    raise exception 'PRUEBA S01b · 1c: elegido después, el IBAN se puso solo.';
  end if;
  raise notice '1 · el IBAN ya no entra solo en una ficha vacía (al leerla ni al elegir después); el distinto, como siempre';
end $$;
reset role;

-- ── 2 · «Guardar este IBAN», como el administrador ──────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; p public.supplier; v_err text;
begin
  r := public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p1'), (select v::uuid from _p where clave = 'f1'));
  select * into p from public.supplier where id = (select v::uuid from _p where clave = 'p1');
  if p.iban <> 'ES7921000813610123456789' or p.iban_set_at is null or p.iban_set_by is distinct from (select v::uuid from _p where clave = 'usuario')
     or p.data_from_invoice->'iban'->>'factura' is distinct from 'S01B-1' or p.data_from_invoice->'iban'->>'facturaId' is distinct from (select v from _p where clave = 'f1')
     or r->>'frase' not like 'IBAN de S01b Sin IBAN guardado en su ficha (···· 6789), de la factura S01B-1. Queda apuntado: %' then
    raise exception 'PRUEBA S01b · 2a: no quedó guardado con quién, cuándo y de qué factura: % / % / %', p.iban, p.data_from_invoice, r;
  end if;
  r := public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p1'), (select v::uuid from _p where clave = 'f1'));
  if r->>'frase' <> 'S01b Sin IBAN ya tiene este IBAN (···· 6789) en su ficha.' then raise exception 'PRUEBA S01b · 2b: otra vez dio %', r; end if;
  v_err := null;
  begin perform public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p2'), (select v::uuid from _p where clave = 'f2'));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'S01b Con IBAN ya tiene otro IBAN (···· 9011): si esta factura trae el nuevo, decídelo en ella.' then raise exception 'PRUEBA S01b · 2c: con otro IBAN dio «%».', v_err; end if;
  v_err := null;
  begin perform public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p3'), (select v::uuid from _p where clave = 'f1'));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'Esa factura no es de S01b Elegido después: elige primero su proveedor y guarda.' then raise exception 'PRUEBA S01b · 2d: con la factura de otro dio «%».', v_err; end if;
  raise notice '2 · «Guardar este IBAN»: con quién, cuándo y de la factura S01B-1; otra vez, ya lo tiene; a uno con otro, no; con la factura de otro, no';
end $$;
reset role;
-- 2e · Uno que no pasa el módulo 97: la lectura 4 a un proveedor sin IBAN (el lector no lo guarda en read_iban; el botón lo mira en la lectura).
set local role service_role;
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa'); l jsonb; r jsonb;
begin
  update public.supplier set iban = null where id = (select v::uuid from _p where clave = 'p1');
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', a, 'company_id', e, 'email_id', 'prueba-s01b-4', 'to', 'facturas-prueba-s01b@entrada.folvy.app',
         'ruta', a::text || '/_correo/prueba-s01b-4/01.pdf', 'nombre', 'factura.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', repeat('c4', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, (select v::uuid from _p where clave = 's4'));
  insert into _p values ('f4', r->>'factura_id');
  if r->>'estado' <> 'factura' then raise exception 'PRUEBA S01b · 2e: la lectura 4 no dio factura: %', r; end if;
  update public.supplier_invoice set reading = coalesce(reading, '{}'::jsonb) || jsonb_build_object('factura', coalesce(reading->'factura', '{}'::jsonb) || '{"iban":"ES9121000418450200051333"}'::jsonb)
   where id = (r->>'factura_id')::uuid;
end $$;
reset role;
set local role authenticated;
do $$
declare v_err text;
begin
  begin perform public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p1'), (select v::uuid from _p where clave = 'f4'));
  exception when others then v_err := sqlerrm; end;
  if v_err is distinct from 'El IBAN de esta factura no es correcto: puede estar mal leído. Compruébalo en el papel.' then raise exception 'PRUEBA S01b · 2e: con un IBAN mal leído dio «%».', v_err; end if;
  raise notice '2e · un IBAN que no pasa el módulo 97 no se guarda';
end $$;
reset role;

-- ── 3 · Sin cuenta, no ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_proveedor_iban_de_factura((select v::uuid from _p where clave = 'p3'), (select v::uuid from _p where clave = 'f3'));
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01b · 3: alguien sin cuenta guarda un IBAN.'; end if;
  raise notice '3 · sin cuenta, no («%»)', v_err;
end $$;
reset role;

-- ── 4 · Las vueltas atrás ───────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T1305_s01b_iban_no_se_pone_solo.down.sql
\i supabase/vuelta-atras/20261028T1304_s01b_ficha_desde_factura.down.sql
do $$ begin
  if md5(pg_get_functiondef('public._pc01e2b_iban_de_la_factura()'::regprocedure)) <> (select v from _p where clave = 'antes')
     or to_regprocedure('public.conta_proveedor_iban_de_factura(uuid,uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'data_from_invoice') then
    raise exception 'PRUEBA S01b · 4: las vueltas atrás no lo dejan como estaba.';
  end if;
  raise notice '4 · las vueltas atrás: el disparador como estaba, sin la función ni la columna';
end $$;
rollback;
