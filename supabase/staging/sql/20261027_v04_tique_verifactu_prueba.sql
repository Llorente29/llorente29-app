-- supabase/staging/sql/20261027_v04_tique_verifactu_prueba.sql
--
-- SOLO STAGING. Prueba de la 0741 (V04 · PR 2: el tique de la bolsa con
-- Verifactu), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Cambia en caliente fiscal_for_print, fiscal_for_preview, _ticket_invoice_number,
-- ticket_invoice_ajustes y verifactu_modo, y pone un disparador en public.sale.
-- En la cuenta A (Taberna de Prueba Norte), con una tablet de verdad (su token)
-- y pedidos nuevos dentro de la transacción.
--
-- Regla 10: por los CAMINOS. Imprimir (fiscal_for_print), reimprimir
-- (reprint_order_by_token), cerrar (close_sale) y cancelar (cancel_sale), con
-- Verifactu apagado, en pruebas y en real, y que ninguno falle.
--
--   0. Lo de antes: si el ensayo ya pasó la 0741, su vuelta atrás; y las cinco
--      huellas de antes.
--   1. Apagado: el tique numera como en el PR 1, sin registro y sin QR.
--   2. Pruebas: su F2 registrado (una vez, también al reimprimir), a la cola, y
--      el papel SIN QR.
--   3. El motor falla: el tique sale igual, el registro queda pendiente y se
--      avisa; el reintento lo registra.
--   4. Cancelar después de imprimir: no se borra, se anula (registro de anulación).
--   5. Una devolución después de entregar: rectificativa R5 de la serie R.
--   6. Real: sin el fabricante, el candado no deja; con él, sí. El local ya dio
--      números este año: lo de real va en el tramo B (PN26B-000001), con QR.
--   7. Las cedidas no entran; los permisos; los ajustes (tramo y fabricante).
--   8. La vuelta atrás: primero, en limpio (las cinco huellas de antes, nada
--      nuevo y la clave única de la serie como estaba); al final, con números en
--      un tramo y registros dentro, PARA.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V04b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '240s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
-- El ensayo de la tanda ya ha pasado la 0741 en esta transacción: primero su
-- vuelta atrás (que restaura las cinco desde su respaldo, byte a byte).
select exists (select 1 from public.funcion_respaldo where migracion = '20261027T0741_v04_tique_verifactu') as v04b_aplicada \gset
\if :v04b_aplicada
\i supabase/vuelta-atras/20261027T0741_v04_tique_verifactu.down.sql
\endif
create temp table _md5 on commit drop as
  select f, md5(pg_get_functiondef(f::regprocedure)) h from unnest(array[
    'public.fiscal_for_print(text,uuid)', 'public.fiscal_for_preview(uuid)', 'public.ticket_invoice_ajustes(uuid)',
    'public._ticket_invoice_number(uuid,uuid,uuid,text,text,text,timestamptz)', 'public.verifactu_modo(uuid,text,text,text,text)']) f;
do $$ begin
  if to_regclass('public.verifactu_sistema') is not null or exists (select 1 from pg_trigger where tgname = 'ticket_tras_venta')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ticket_invoice' and column_name = 'verifactu_entorno') then
    raise exception 'PRUEBA V04b · 0: la base no está como antes de la 0741.';
  end if;
  raise notice '0 · antes de la 0741: las cinco huellas apuntadas, y nada de la 0741';
end $$;

-- ── 8 (primero) · La vuelta atrás, en limpio ───────────────────────────────
-- Antes de la prueba: la 0741 y su vuelta atrás dejan las cinco con su huella
-- de antes y nada nuevo. Va primero porque la prueba deja registros, que no se
-- borran nunca, y con ellos dentro la vuelta atrás para (se prueba al final).
\i supabase/migrations/20261027T0741_v04_tique_verifactu.sql
\i supabase/vuelta-atras/20261027T0741_v04_tique_verifactu.down.sql
do $$
declare v_mal text;
begin
  select string_agg(f, ', ') into v_mal from _md5 where md5(pg_get_functiondef(f::regprocedure)) <> h;
  if v_mal is not null then raise exception 'PRUEBA V04b · 8: no vuelven a ser las de antes: %.', v_mal; end if;
  if to_regclass('public.verifactu_sistema') is not null or exists (select 1 from pg_trigger where tgname = 'ticket_tras_venta')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('ticket_invoice', 'ticket_invoice_series')
                  and column_name in ('verifactu_entorno', 'importe_total', 'company_id', 'tramo'))
     or not exists (select 1 from pg_constraint where conname = 'ticket_invoice_series_unica')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                  and proname in ('_ticket_verifactu_alta', '_ticket_tramo', 'verifactu_sistema_completo', '_ticket_verifactu_se_puede_deshacer'))
     or exists (select 1 from cron.job where jobname = 'ticket-verifactu-pendientes')
     or exists (select 1 from public.funcion_respaldo where migracion = '20261027T0741_v04_tique_verifactu')
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fiscal_for_print', 'verifactu_modo', '_ticket_invoice_number')) <> 3 then
    raise exception 'PRUEBA V04b · 8: la vuelta atrás deja algo, no repone la clave de la serie, o hay sobrecargas (regla 2).';
  end if;
  raise notice '8 · la vuelta atrás, en limpio: las cinco funciones con su huella de antes, nada de la 0741 y la clave única de la serie como estaba';
end $$;

-- Y ahora, otra vez, para probarla por sus caminos.
\i supabase/migrations/20261027T0741_v04_tique_verifactu.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select, insert, update on _v to authenticated, anon;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');
insert into _v select 'token', d.token from public.kds_device d
  where d.account_id = 'c01a0000-0000-4000-8000-00000000000a' and d.is_active and d.location_id is not null order by d.created_at limit 1;
insert into _v select 'local', d.location_id::text from public.kds_device d where d.token = (select v from _v where clave = 'token');
insert into _v select 'local2', l.id::text from public.locations l
  where l.account_id = 'c01a0000-0000-4000-8000-00000000000a' and l.id::text <> (select v from _v where clave = 'local') order by l.created_at limit 1;
insert into _v select 'propia', b.id::text from public.brand b where b.account_id = 'c01a0000-0000-4000-8000-00000000000a' and b.ownership_type = 'own' and b.is_active order by b.created_at limit 1;
insert into _v select 'cedida', b.id::text from public.brand b where b.account_id = 'c01a0000-0000-4000-8000-00000000000a' and b.ownership_type = 'licensed' and b.is_active order by b.created_at limit 1;

-- El local de la tablet, con código y con su empresa (en staging la cuenta A no
-- la tiene: medido el 27/10). El NIF, válido (B12345674: su control es el 4).
insert into public.company (account_id, legal_name, tax_id)
values ('c01a0000-0000-4000-8000-00000000000a', 'Norte Prueba V04b, S.L.', 'B12345674');
insert into _v select 'empresa', c.id::text from public.company c
  where c.account_id = 'c01a0000-0000-4000-8000-00000000000a' and c.legal_name = 'Norte Prueba V04b, S.L.';
insert into public.location_company (location_id, company_id, account_id, source)
select (select v::uuid from _v where clave = 'local'), (select v::uuid from _v where clave = 'empresa'), 'c01a0000-0000-4000-8000-00000000000a', 'manual'
on conflict (location_id) do update set company_id = excluded.company_id;
delete from public.location_invoice_code where location_id = (select v::uuid from _v where clave = 'local');
insert into public.location_invoice_code (location_id, account_id, code, set_by_name)
values ((select v::uuid from _v where clave = 'local'), 'c01a0000-0000-4000-8000-00000000000a', 'PN', 'Prueba V04b');
delete from public.location_invoice_code where location_id = (select v::uuid from _v where clave = 'local2');
delete from public.verifactu_empresa where company_id = (select v::uuid from _v where clave = 'empresa');

create temp table _s (clave text primary key, id uuid) on commit drop;
grant select on _s to authenticated, anon;
with n as (
  insert into public.sale (account_id, brand_id, location_id, source, sold_at, total, status, order_status, raw_tab, external_tab_ref)
  select 'c01a0000-0000-4000-8000-00000000000a', x.marca, x.local, x.fuente, now(), 20.18, 'open', 'accepted', x.raw, 'v04b-' || x.clave
  from (values
    ('ap', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('pr1', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('pr2', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('cae', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('re1', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('re2', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('sin', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local2'), 'hubrise', '{}'),
    ('c1', (select v::uuid from _v where clave = 'cedida'), (select v::uuid from _v where clave = 'local'), 'lastapp',
       '{"bills":[{"number":"LS53-9214","company":{"name":"CLOUDTOWN BRANDS SL","taxId":"B67621425","address":"Calle de Prueba, 1, 28001 Madrid"}}]}')
  ) x(clave, marca, local, fuente, raw)
  returning id, external_tab_ref)
insert into _s select substring(external_tab_ref from 6), id from n;
do $$ begin
  if (select count(*) from _v) <> 8 or exists (select 1 from _v where v is null) or (select count(*) from _s) <> 8 then
    raise exception 'PRUEBA V04b · 0: falta algo de la cuenta A (% y % pedidos).', (select string_agg(clave, ', ') from _v), (select count(*) from _s);
  end if;
end $$;

-- ── 1 · Apagado: como en el PR 1 ───────────────────────────────────────────
set local role anon;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; v_aa text := to_char(now() at time zone 'Europe/Madrid', 'YY');
begin
  a := public.fiscal_for_print(t, (select id from _s where clave = 'ap'));
  if a->>'ticketNumber' <> 'PN' || v_aa || '-000001' or a->>'verifactu' is not null or a->>'verifactuQr' is not null or a->>'taxId' <> 'B12345674' then
    raise exception 'PRUEBA V04b · 1: apagado (%).', a;
  end if;
  raise notice '1 · apagado: %, sin registro y sin QR', a->>'ticketNumber';
end $$;
reset role;
do $$ begin
  if (select importe_total from public.ticket_invoice where sale_id = (select id from _s where clave = 'ap')) <> 20.18
     or (select verifactu_entorno from public.ticket_invoice where sale_id = (select id from _s where clave = 'ap')) is not null
     or exists (select 1 from public.verifactu_registro where company_id = (select v::uuid from _v where clave = 'empresa')) then
    raise exception 'PRUEBA V04b · 1: apagado, el tique apunta mal su importe o tiene registro.';
  end if;
end $$;

-- ── 2 · Pruebas: el F2, una vez, y el papel sin QR ─────────────────────────
insert into public.verifactu_empresa (company_id, account_id, modo, pruebas_desde)
values ((select v::uuid from _v where clave = 'empresa'), 'c01a0000-0000-4000-8000-00000000000a', 'pruebas', now());
set local role anon;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; b jsonb;
begin
  a := public.fiscal_for_print(t, (select id from _s where clave = 'pr1'));
  if right(a->>'ticketNumber', 6) <> '000002' or a->>'verifactu' <> 'pruebas' or a->>'verifactuQr' is not null then
    raise exception 'PRUEBA V04b · 2: en pruebas (%).', a;
  end if;
  perform public.reprint_order_by_token(t, (select id from _s where clave = 'pr1'), 'bag');
  b := public.fiscal_for_print(t, (select id from _s where clave = 'pr1'));
  if b->>'ticketNumber' <> a->>'ticketNumber' or b->>'verifactuQr' is not null then raise exception 'PRUEBA V04b · 2: al reimprimir (%).', b; end if;
  a := public.fiscal_for_print(t, (select id from _s where clave = 'pr2'));
  raise notice '2 · pruebas: % y %, sin QR en el papel', b->>'ticketNumber', a->>'ticketNumber';
end $$;
reset role;
do $$
declare r public.verifactu_registro; v_n int;
begin
  select count(*) into v_n from public.verifactu_registro where company_id = (select v::uuid from _v where clave = 'empresa');
  select x.* into r from public.verifactu_registro x join public.ticket_invoice t on t.verifactu_registro_id = x.id
   where t.sale_id = (select id from _s where clave = 'pr1');
  if v_n <> 2 or r.id is null or r.entorno <> 'pruebas' or r.tipo_factura <> 'F2' or r.origen <> 'simplificada' or r.importe_total <> 20.18
     or r.cuota_total <> 1.83 or (r.desglose->0->>'base')::numeric <> 18.35 or (r.desglose->0->>'tipo')::numeric <> 10
     or r.num_serie <> (select number_text from public.ticket_invoice where sale_id = (select id from _s where clave = 'pr1'))
     or r.nif_emisor <> 'B12345674' or r.estado <> 'pendiente' or r.origen_programa <> 'folvy' then
    raise exception 'PRUEBA V04b · 2: el registro F2 (% registros; %).', v_n, to_jsonb(r) - 'cadena_huella';
  end if;
  raise notice '2 · un F2 por tique (% registros), % € (base 18,35 + IVA 1,83 al 10 %%), a la cola (pendiente) y con huella %…', v_n, r.importe_total, left(r.huella, 8);
end $$;

-- ── 3 · El motor falla: el tique sale, el registro queda pendiente ─────────
-- Un NIF que la cadena no admite: el registro no se puede escribir.
update public.company set tax_id = 'MAL' where id = (select v::uuid from _v where clave = 'empresa');
set local role anon;
do $$
declare a jsonb;
begin
  a := public.fiscal_for_print((select v from _v where clave = 'token'), (select id from _s where clave = 'cae'));
  if a is null or right(a->>'ticketNumber', 6) <> '000004' or a->>'verifactu' <> 'pruebas' then raise exception 'PRUEBA V04b · 3: con el motor caído (%).', a; end if;
  raise notice '3 · con el motor caído, el tique % sale igual', a->>'ticketNumber';
end $$;
reset role;
do $$ begin
  if (select verifactu_estado from public.ticket_invoice where sale_id = (select id from _s where clave = 'cae')) <> 'pendiente'
     or not exists (select 1 from public.system_alert_queue where kind = 'tique_verifactu_pendiente' and severity = 'alto') then
    raise exception 'PRUEBA V04b · 3: no queda pendiente o no avisa.';
  end if;
end $$;
update public.company set tax_id = 'B12345674' where id = (select v::uuid from _v where clave = 'empresa');
do $$
declare r jsonb;
begin
  r := public.ticket_verifactu_pendientes();
  if (r->>'registrados')::int < 1 or (select verifactu_estado from public.ticket_invoice where sale_id = (select id from _s where clave = 'cae')) <> 'registrado' then
    raise exception 'PRUEBA V04b · 3: el reintento (%).', r;
  end if;
  raise notice '3 · pendiente y avisado (alto); el reintento lo registra (%)', r;
end $$;

-- ── 4 · Cancelar después de imprimir: se anula, no se borra ────────────────
do $$
declare t public.ticket_invoice; a public.verifactu_registro;
begin
  perform public.cancel_sale((select id from _s where clave = 'pr2'), 'Prueba V04b');
  select * into t from public.ticket_invoice where sale_id = (select id from _s where clave = 'pr2');
  select * into a from public.verifactu_registro where id = t.verifactu_anulacion_id;
  if (select status from public.sale where id = (select id from _s where clave = 'pr2')) <> 'cancelled'
     or t.id is null or t.verifactu_estado <> 'anulado' or a.tipo <> 'anulacion' or a.num_serie <> t.number_text or a.alta_id <> t.verifactu_registro_id
     or a.sin_registro_previo then
    raise exception 'PRUEBA V04b · 4: cancelar después de imprimir (%; %).', to_jsonb(t), to_jsonb(a) - 'cadena_huella';
  end if;
  raise notice '4 · cancelado: el tique % sigue, y su anulación va a Hacienda (encadenada tras %…)', t.number_text, left(a.huella_anterior, 8);
end $$;

-- ── 5 · Una devolución después de entregar: rectificativa R5 ───────────────
set local role anon;
select public.fiscal_for_print((select v from _v where clave = 'token'), (select id from _s where clave = 're1')) is not null as ok \gset
reset role;
do $$
declare r public.ticket_invoice; x public.verifactu_registro; v_aa text := to_char(now() at time zone 'Europe/Madrid', 'YY');
begin
  perform public.close_sale((select id from _s where clave = 're1'));
  if (select status from public.sale where id = (select id from _s where clave = 're1')) <> 'closed' then raise exception 'PRUEBA V04b · 5: no se cierra.'; end if;
  update public.sale set refund_amount = 5.18 where id = (select id from _s where clave = 're1');
  select * into r from public.ticket_invoice where sale_id = (select id from _s where clave = 're1') and kind = 'R';
  select * into x from public.verifactu_registro where id = r.verifactu_registro_id;
  if r.id is null or r.number_text <> 'PN' || v_aa || '-R-000001' or r.importe_total <> -5.18 or x.tipo_factura <> 'R5' or x.tipo_rectificativa <> 'I'
     or x.rectificadas->0->>'num_serie' <> (select number_text from public.ticket_invoice where sale_id = (select id from _s where clave = 're1') and kind = 'F') then
    raise exception 'PRUEBA V04b · 5: la rectificativa (%; %).', to_jsonb(r), to_jsonb(x) - 'cadena_huella';
  end if;
  -- La misma devolución otra vez no hace otra.
  update public.sale set refund_amount = 5.18, total = total where id = (select id from _s where clave = 're1');
  if (select count(*) from public.ticket_invoice where sale_id = (select id from _s where clave = 're1') and kind = 'R') <> 1 then
    raise exception 'PRUEBA V04b · 5: rectifica dos veces lo mismo.';
  end if;
  raise notice '5 · devuelto 5,18 € después de entregar: la % (R5, por diferencias, %) rectifica la %', r.number_text, x.importe_total, x.rectificadas->0->>'num_serie';
end $$;

-- ── 6 · Real: el candado con el fabricante; el tramo B y el QR ─────────────
insert into public.verifactu_conexion (entorno, nif, ok, codigo, mensaje, origen) values ('real', 'B12345674', true, 0, 'Prueba V04b', 'prueba V04b');
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_msg text;
begin
  if public.verifactu_sistema_completo() then raise exception 'PRUEBA V04b · 6: el fabricante no nace vacío.'; end if;
  begin
    perform public.verifactu_modo((select v::uuid from _v where clave = 'empresa'), 'real', 'FV04B', 'EMPEZAR', 'Prueba V04b');
    raise exception 'PRUEBA V04b · 6: pasa a real sin el fabricante.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg !~ 'fabrica Sumied' then raise exception 'PRUEBA V04b · 6: el candado dice otra cosa («%»).', v_msg; end if;
  r := public.ticket_invoice_ajustes((select v::uuid from _v where clave = 'cuenta'));
  if not (r->>'fabricante_falta')::boolean then raise exception 'PRUEBA V04b · 6: Ajustes no avisa del fabricante.'; end if;
  raise notice '6 · sin el fabricante: «%», y Ajustes lo avisa', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  begin perform public.verifactu_sistema_poner('Fabricante', 'B12345670'); raise exception 'PRUEBA V04b · 6: acepta un NIF que no vale.';
  exception when check_violation then null; end;
  perform public.verifactu_sistema_poner('Fabricante de Prueba V04b, S.L.', 'B12345674', 'Prueba V04b');
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.verifactu_modo((select v::uuid from _v where clave = 'empresa'), 'real', 'FV04B', 'EMPEZAR', 'Prueba V04b')->>'modo' as modo \gset
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if (select modo from public.verifactu_empresa where company_id = (select v::uuid from _v where clave = 'empresa')) is distinct from 'real' then
    raise exception 'PRUEBA V04b · 6: con el fabricante no pasa a real.';
  end if;
end $$;
-- El paso a real «después» de los tiques de esta transacción (todos llevan la
-- misma hora, now()): así el local ya había dado números este año.
update public.verifactu_empresa set real_desde = now() + interval '1 second' where company_id = (select v::uuid from _v where clave = 'empresa');
set local role anon;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; b jsonb; v_aa text := to_char(now() at time zone 'Europe/Madrid', 'YY');
begin
  a := public.fiscal_for_print(t, (select id from _s where clave = 're2'));
  if a->>'ticketNumber' <> 'PN' || v_aa || 'B-000001' or a->>'verifactu' <> 'real'
     or a->>'verifactuQr' is distinct from 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345674&numserie=PN' || v_aa || 'B-000001&fecha='
          || to_char(now() at time zone 'Europe/Madrid', 'DD-MM-YYYY') || '&importe=20.18' then
    raise exception 'PRUEBA V04b · 6: en real (%).', a;
  end if;
  b := public.fiscal_for_print(t, (select id from _s where clave = 're2'));
  if b->>'verifactuQr' <> a->>'verifactuQr' or b->>'ticketNumber' <> a->>'ticketNumber' then raise exception 'PRUEBA V04b · 6: al reimprimir en real (%).', b; end if;
  raise notice '6 · real: el local ya dio números este año, así que va en el tramo B: %, con QR (%)', a->>'ticketNumber', a->>'verifactuQr';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare p jsonb; r jsonb; l jsonb; v_aa text := to_char(now() at time zone 'Europe/Madrid', 'YY');
begin
  p := public.fiscal_for_preview((select id from _s where clave = 're2'));
  if p->>'verifactuQr' is null or p->>'verifactu' <> 'real' then raise exception 'PRUEBA V04b · 6: la vista previa en real (%).', p; end if;
  p := public.fiscal_for_preview((select id from _s where clave = 'pr1'));
  if p->>'verifactuQr' is not null then raise exception 'PRUEBA V04b · 6: la vista previa de un tique de pruebas lleva QR (%).', p; end if;
  r := public.ticket_invoice_ajustes((select v::uuid from _v where clave = 'cuenta'));
  select x into l from jsonb_array_elements(r->'locales') x where x->>'location_id' = (select v from _v where clave = 'local');
  if (r->>'fabricante_falta')::boolean or l->>'tramo' <> 'B' or l->>'serie' <> 'PN' || v_aa || 'B-000001' or (l->>'ultimo')::int <> 1 then
    raise exception 'PRUEBA V04b · 6: los ajustes en real (%).', l;
  end if;
  raise notice '6 · la vista previa lleva el QR; Ajustes: serie %, último %, sin aviso del fabricante', l->>'serie', l->>'ultimo';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$ begin
  if not exists (select 1 from public.verifactu_registro x join public.ticket_invoice t on t.verifactu_registro_id = x.id
                  where t.sale_id = (select id from _s where clave = 're2') and x.entorno = 'real' and x.tipo_factura = 'F2') then
    raise exception 'PRUEBA V04b · 6: el tique de real no tiene su F2 en real.';
  end if;
end $$;

-- ── 7 · Las cedidas no entran; permisos ─────────────────────────────────────
set local role anon;
do $$
declare a jsonb; s jsonb;
begin
  a := public.fiscal_for_print((select v from _v where clave = 'token'), (select id from _s where clave = 'c1'));
  if a->>'ticketNumber' <> 'LS53-9214' or a->>'verifactuQr' is not null or a->>'verifactu' is not null then raise exception 'PRUEBA V04b · 7: la cedida (%).', a; end if;
  s := public.fiscal_for_print((select v from _v where clave = 'token'), (select id from _s where clave = 'sin'));
  if (s->>'serie')::boolean or s->>'verifactuQr' is not null then raise exception 'PRUEBA V04b · 7: el local sin código (%).', s; end if;
end $$;
reset role;
do $$
declare f text;
begin
  if exists (select 1 from public.ticket_invoice where sale_id in (select id from _s where clave in ('c1', 'sin')))
     or exists (select 1 from public.verifactu_registro where origen_ref in (select id::text from _s where clave in ('c1', 'sin'))) then
    raise exception 'PRUEBA V04b · 7: una cedida o un local sin código entran en la serie o en Verifactu.';
  end if;
  foreach f in array array['public._ticket_verifactu_alta(uuid)', 'public._ticket_verifactu_anular(uuid)', 'public._ticket_rectificar(uuid,uuid)',
                           'public._ticket_tramo(uuid,uuid,integer,text)', 'public._ticket_numero_texto(text,integer,text,text,integer)',
                           'public.ticket_verifactu_pendientes(integer)', 'public.verifactu_sistema_ver()', 'public.verifactu_sistema_poner(text,text,text)',
                           'public._ticket_tras_venta()', 'public._ticket_invoice_number(uuid,uuid,uuid,text,text,text,timestamptz)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA V04b · 7: % es de cualquiera.', f; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.verifactu_sistema_completo()', 'execute') or has_function_privilege('anon', 'public.verifactu_sistema_completo()', 'execute')
     or not has_function_privilege('anon', 'public.fiscal_for_print(text,uuid)', 'execute') or has_table_privilege('authenticated', 'public.verifactu_sistema', 'select') then
    raise exception 'PRUEBA V04b · 7: los permisos de lo abierto.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ticket-verifactu-pendientes' and schedule = '*/5 * * * *') then
    raise exception 'PRUEBA V04b · 7: falta el cron del reintento.';
  end if;
  raise notice '7 · ni la cedida ni el local sin código entran; 10 internas cerradas; la tablet y la pantalla, abiertas; el reintento, cada 5 minutos';
end $$;

-- ── 8 (al final) · Con números en un tramo y registros, la vuelta atrás PARA
-- Es su primera sentencia (la misma función): no deshace a ciegas.
do $$
declare v_msg text;
begin
  begin
    perform public._ticket_verifactu_se_puede_deshacer();
    raise exception 'PRUEBA V04b · 8: con números dados, la vuelta atrás no para.';
  exception when object_not_in_prerequisite_state then v_msg := sqlerrm;
  end;
  if (select count(*) from public.verifactu_registro where company_id = (select v::uuid from _v where clave = 'empresa')) < 5 then
    raise exception 'PRUEBA V04b · 8: faltan registros de la prueba.';
  end if;
  raise notice '8 · con números en un tramo y registros, la vuelta atrás para: «%»', v_msg;
end $$;

rollback;
