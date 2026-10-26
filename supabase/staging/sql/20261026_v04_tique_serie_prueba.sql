-- supabase/staging/sql/20261026_v04_tique_serie_prueba.sql
--
-- SOLO STAGING. Prueba de la 2309 (V04 · PR 1: el número y quién factura en el
-- tique de la bolsa), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Cambia en caliente public.fiscal_for_print (la llama la tablet al
-- imprimir la bolsa). En la cuenta A (Taberna de Prueba Norte), con una tablet
-- de verdad (su token) y pedidos nuevos dentro de la transacción.
--
-- Regla 10: se ensaya por los CAMINOS, no por la fórmula. Los de este cambio:
-- imprimir la bolsa (fiscal_for_print), reimprimirla (reprint_order_by_token),
-- cerrar la venta (close_sale) y cancelarla (cancel_sale), y que ninguno falle
-- ni cambie el número.
--
--   0. Lo de antes (tras la vuelta atrás: el ensayo ya pasó la 2309):
--      fiscal_for_print con el md5 de producción, y nada de la 2309.
--   1. Ajustes: el código propuesto; uno mal escrito o repetido, no.
--   2. Imprimir y reimprimir una propia: el número de su serie, y el mismo al
--      reimprimir; la siguiente, el siguiente.
--   3. Cerrar y cancelar después de imprimir: el número sigue, no se borra.
--   4. Cedida con la factura de Last: sus datos y su número, sin nuestra serie.
--      Sin la factura: el tique sin la línea, y el aviso.
--   5. Un local sin código: como antes (sin serie).
--   6. Si la serie no puede dar número (llena), la impresión NO falla: el tique
--      sale como antes y se avisa.
--   7. El código no se cambia con números dados; la vista previa no gasta
--      número; los permisos.
--   8. La vuelta atrás: fiscal_for_print con el md5 del principio, y nada nuevo.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V04: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- El ensayo de la tanda ya ha pasado la 2309 antes de esta prueba, en la misma
-- transacción: primero su vuelta atrás (que restaura fiscal_for_print desde su
-- respaldo, byte a byte), y lo de antes se mide después. Si no la ha pasado,
-- no hay respaldo y no hay nada que deshacer.
select to_regclass('public.funcion_respaldo') is not null as hay_respaldo \gset
\if :hay_respaldo
select exists (select 1 from public.funcion_respaldo where migracion = '20261026T2309_v04_tique_serie_y_quien_factura') as v04_aplicada \gset
\else
\set v04_aplicada false
\endif
\if :v04_aplicada
\i supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql
\endif

create temp table _v (clave text primary key, v text) on commit drop;
grant select, insert, update on _v to authenticated;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');
-- Una tablet activa de A con su local; otro local de A; una marca propia y una cedida de A.
insert into _v select 'token', d.token from public.kds_device d
  where d.account_id = 'c01a0000-0000-4000-8000-00000000000a' and d.is_active and d.location_id is not null order by d.created_at limit 1;
insert into _v select 'local', d.location_id::text from public.kds_device d where d.token = (select v from _v where clave = 'token');
insert into _v select 'local2', l.id::text from public.locations l
  where l.account_id = 'c01a0000-0000-4000-8000-00000000000a' and l.id::text <> (select v from _v where clave = 'local') order by l.created_at limit 1;
insert into _v select 'propia', b.id::text from public.brand b where b.account_id = 'c01a0000-0000-4000-8000-00000000000a' and b.ownership_type = 'own' and b.is_active order by b.created_at limit 1;
insert into _v select 'cedida', b.id::text from public.brand b where b.account_id = 'c01a0000-0000-4000-8000-00000000000a' and b.ownership_type = 'licensed' and b.is_active order by b.created_at limit 1;
create temp table _md5 on commit drop as select md5(pg_get_functiondef('public.fiscal_for_print(text,uuid)'::regprocedure)) h;
do $$ begin
  if (select count(*) from _v) <> 7 or exists (select 1 from _v where v is null) then
    raise exception 'PRUEBA V04 · 0: falta algo de la cuenta A (hay %).', (select string_agg(clave, ', ') from _v);
  end if;
  if to_regclass('public.ticket_invoice') is not null or exists (select 1 from pg_proc where proname in ('fiscal_for_preview', 'ticket_invoice_ajustes')) then
    raise exception 'PRUEBA V04 · 0: la vuelta atrás no deja la base como antes de la 2309.';
  end if;
  -- La de producción, medida el 26/10 y el 27/10 (staging y producción, iguales,
  -- con 31 \r en su cuerpo): la vuelta atrás tiene que dejar ESTA huella, con
  -- sus saltos de línea (el ensayo #256 paró porque una copia con \n no la dejaba).
  if (select h from _md5) <> '6efe86f51f4bc6a1f336a68bf0875c49' then
    raise exception 'PRUEBA V04 · 0: fiscal_for_print no es la de producción (md5 %): la vuelta atrás no la deja byte a byte.', (select h from _md5);
  end if;
  if (select length(prosrc) - length(replace(prosrc, chr(13), '')) from pg_proc where oid = 'public.fiscal_for_print(text,uuid)'::regprocedure) = 0 then
    raise exception 'PRUEBA V04 · 0: fiscal_for_print ha perdido sus \r\n.';
  end if;
  raise notice '0 · fiscal_for_print de antes (md5 %), y nada de la 2309', (select h from _md5);
end $$;

\i supabase/migrations/20261026T2309_v04_tique_serie_y_quien_factura.sql

-- Pedidos nuevos de A, en la transacción: dos propias y uno sin código en el
-- otro local, una cedida con la factura de Last y otra sin ella.
create temp table _s (clave text primary key, id uuid) on commit drop;
grant select on _s to authenticated, anon;
grant select on _v to anon;
with n as (
  insert into public.sale (account_id, brand_id, location_id, source, sold_at, total, status, order_status, raw_tab, external_tab_ref)
  select 'c01a0000-0000-4000-8000-00000000000a', x.marca, x.local, x.fuente, now(), 20.18, 'open', 'accepted', x.raw, 'v04-' || x.clave
  from (values
    ('p1', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('p2', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('p3', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('p4', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local'), 'hubrise', '{}'),
    ('sin', (select v::uuid from _v where clave = 'propia'), (select v::uuid from _v where clave = 'local2'), 'hubrise', '{}'),
    ('c1', (select v::uuid from _v where clave = 'cedida'), (select v::uuid from _v where clave = 'local'), 'lastapp',
       '{"bills":[{"number":"LS53-9214","company":{"name":"CLOUDTOWN BRANDS SL","taxId":"B67621425","address":"Calle de Prueba, 1, 28001 Madrid"}}]}'),
    ('c2', (select v::uuid from _v where clave = 'cedida'), (select v::uuid from _v where clave = 'local'), 'lastapp', '{"bills":[]}')
  ) x(clave, marca, local, fuente, raw)
  returning id, external_tab_ref)
insert into _s select substring(external_tab_ref from 5), id from n;
do $$ begin
  if (select count(*) from _s) <> 7 then raise exception 'PRUEBA V04 · 0: no se han creado los 7 pedidos.'; end if;
end $$;

-- ── 1 · Ajustes: el código del local ───────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; l jsonb; v_msg text;
begin
  r := public.ticket_invoice_ajustes((select v::uuid from _v where clave = 'cuenta'));
  select x into l from jsonb_array_elements(r->'locales') x where x->>'location_id' = (select v from _v where clave = 'local');
  if l is null or l->>'propuesto' !~ '^[A-Z]{2}$' or l->>'codigo' is not null or jsonb_array_length(r->'marcas') = 0 then
    raise exception 'PRUEBA V04 · 1: los ajustes no dicen lo que deben (%).', l;
  end if;
  begin perform public.ticket_invoice_code_set((select v::uuid from _v where clave = 'local'), 'C1'); raise exception 'PRUEBA V04 · 1: acepta un código con números.';
  exception when check_violation then v_msg := sqlerrm; end;
  r := public.ticket_invoice_code_set((select v::uuid from _v where clave = 'local'), 'pn', 'Prueba V04');
  if r->>'codigo' <> 'PN' or r->>'serie' !~ '^PN\d{2}-000001$' then raise exception 'PRUEBA V04 · 1: el código no queda (%).', r; end if;
  begin perform public.ticket_invoice_code_set((select v::uuid from _v where clave = 'local2'), 'PN'); raise exception 'PRUEBA V04 · 1: dos locales con el mismo código.';
  exception when unique_violation then null; end;
  raise notice '1 · propuesto %, «C1» no («%»), PN elegido (serie %), y PN no se repite en otro local', l->>'propuesto', v_msg, r->>'serie';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 y 3 · Imprimir, reimprimir, cerrar y cancelar (como la tablet: anon) ──
set local role anon;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; b jsonb; c jsonb; v_aa text := to_char(now() at time zone 'Europe/Madrid', 'YY');
begin
  a := public.fiscal_for_print(t, (select id from _s where clave = 'p1'));
  if a->>'ticketNumber' <> 'PN' || v_aa || '-000001' or a->>'issuerKind' <> 'propia' or not (a->>'serie')::boolean
     or a->>'legalName' is null or a->>'taxId' is null or a ? 'address' and a->>'address' is not null then
    raise exception 'PRUEBA V04 · 2: el primer tique de una propia (%).', a;
  end if;
  perform public.reprint_order_by_token(t, (select id from _s where clave = 'p1'), 'bag');
  b := public.fiscal_for_print(t, (select id from _s where clave = 'p1'));
  if b->>'ticketNumber' <> a->>'ticketNumber' then raise exception 'PRUEBA V04 · 2: reimprimir cambia el número (% → %).', a->>'ticketNumber', b->>'ticketNumber'; end if;
  c := public.fiscal_for_print(t, (select id from _s where clave = 'p2'));
  if c->>'ticketNumber' <> 'PN' || v_aa || '-000002' then raise exception 'PRUEBA V04 · 2: el siguiente no es el 2 (%).', c; end if;
  raise notice '2 · % (%, NIF %), reimpreso igual; el siguiente, %', a->>'ticketNumber', a->>'legalName', a->>'taxId', c->>'ticketNumber';
end $$;
reset role;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; c jsonb;
begin
  -- Cerrar la venta y cancelar la otra: los caminos de siempre, sin fallar.
  perform public.close_sale((select id from _s where clave = 'p1'));
  perform public.cancel_sale((select id from _s where clave = 'p2'), 'Prueba V04');
  if (select status from public.sale where id = (select id from _s where clave = 'p1')) <> 'closed'
     or (select status from public.sale where id = (select id from _s where clave = 'p2')) <> 'cancelled' then
    raise exception 'PRUEBA V04 · 3: cerrar o cancelar no ha funcionado.';
  end if;
  a := public.fiscal_for_print(t, (select id from _s where clave = 'p1'));
  c := public.fiscal_for_print(t, (select id from _s where clave = 'p2'));
  if right(a->>'ticketNumber', 6) <> '000001' or right(c->>'ticketNumber', 6) <> '000002'
     or (select count(*) from public.ticket_invoice where sale_id in ((select id from _s where clave = 'p1'), (select id from _s where clave = 'p2'))) <> 2
     or (select last_number from public.ticket_invoice_series where location_id = (select v::uuid from _v where clave = 'local') and kind = 'F') <> 2 then
    raise exception 'PRUEBA V04 · 3: después de cerrar y cancelar, los números cambian o se borran (% y %).', a, c;
  end if;
  raise notice '3 · cerrada la % y cancelada la %: siguen con su número (la cancelada se anulará en Hacienda en el PR 2)', a->>'ticketNumber', c->>'ticketNumber';
end $$;

-- ── 4 y 5 · Cedidas y local sin código ─────────────────────────────────────
set local role anon;
do $$
declare t text := (select v from _v where clave = 'token'); a jsonb; b jsonb; s jsonb;
begin
  a := public.fiscal_for_print(t, (select id from _s where clave = 'c1'));
  if a->>'legalName' <> 'CLOUDTOWN BRANDS SL' or a->>'taxId' <> 'B67621425' or a->>'address' <> 'Calle de Prueba, 1, 28001 Madrid'
     or a->>'ticketNumber' <> 'LS53-9214' or a->>'issuerKind' <> 'cedida' or (a->>'serie')::boolean or (a->>'sinFactura')::boolean then
    raise exception 'PRUEBA V04 · 4: la cedida con factura de Last (%).', a;
  end if;
  b := public.fiscal_for_print(t, (select id from _s where clave = 'c2'));
  if not (b->>'sinFactura')::boolean or b->>'ticketNumber' is not null or b->>'issuerKind' <> 'cedida' then
    raise exception 'PRUEBA V04 · 4: la cedida sin factura de Last (%).', b;
  end if;
  s := public.fiscal_for_print(t, (select id from _s where clave = 'sin'));
  if s->>'issuerKind' <> 'propia' or (s->>'serie')::boolean or s->>'ticketNumber' is not null then
    raise exception 'PRUEBA V04 · 5: un local sin código numera (%).', s;
  end if;
  raise notice '4 · cedida: % · NIF % · %; sin factura de Last, sin la línea. 5 · sin código: como antes', a->>'legalName', a->>'taxId', a->>'ticketNumber';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.ticket_invoice where sale_id in (select id from _s where clave in ('c1', 'c2', 'sin')))
     or (select last_number from public.ticket_invoice_series where location_id = (select v::uuid from _v where clave = 'local') and kind = 'F') <> 2 then
    raise exception 'PRUEBA V04 · 4: una cedida o un local sin código entran en la serie.';
  end if;
  if not exists (select 1 from public.system_alert_queue where kind = 'tique_cedida_sin_factura'
                  and debounce_kind = 'tique_cedida_sin_factura:' || (select id from _s where clave = 'c2')::text) then
    raise exception 'PRUEBA V04 · 4: la cedida sin factura no avisa.';
  end if;
  raise notice '4 · ni las cedidas ni el local sin código gastan número; el aviso de la cedida sin factura, encolado';
end $$;

-- ── 6 · La serie no puede dar número: la impresión no falla ────────────────
update public.ticket_invoice_series set last_number = 999999 where location_id = (select v::uuid from _v where clave = 'local') and kind = 'F';
set local role anon;
do $$
declare a jsonb;
begin
  a := public.fiscal_for_print((select v from _v where clave = 'token'), (select id from _s where clave = 'p3'));
  if a is null or (a->>'serie')::boolean or a->>'legalName' is null then raise exception 'PRUEBA V04 · 6: con la serie llena (%).', a; end if;
  raise notice '6 · con la serie llena, el tique sale igual (sin número de serie) y no falla';
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.ticket_invoice where sale_id = (select id from _s where clave = 'p3'))
     or not exists (select 1 from public.system_alert_queue where kind = 'tique_sin_numero' and severity = 'alto') then
    raise exception 'PRUEBA V04 · 6: con la serie llena, numera igual o no avisa.';
  end if;
  raise notice '6 · y avisa (tique_sin_numero, alto)';
end $$;
update public.ticket_invoice_series set last_number = 2 where location_id = (select v::uuid from _v where clave = 'local') and kind = 'F';

-- ── 7 · El código no se cambia; la vista previa no gasta número; permisos ──
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_msg text;
begin
  begin perform public.ticket_invoice_code_set((select v::uuid from _v where clave = 'local'), 'PX'); raise exception 'PRUEBA V04 · 7: cambia el código con números dados.';
  exception when check_violation then v_msg := sqlerrm; end;
  r := public.fiscal_for_preview((select id from _s where clave = 'p1'));
  if right(r->>'ticketNumber', 6) <> '000001' or (r->>'pendiente')::boolean then raise exception 'PRUEBA V04 · 7: la vista previa de una impresa (%).', r; end if;
  r := public.fiscal_for_preview((select id from _s where clave = 'p4'));
  if not (r->>'pendiente')::boolean or r->>'ticketNumber' is not null then raise exception 'PRUEBA V04 · 7: la vista previa de una sin imprimir (%).', r; end if;
  r := public.ticket_invoice_ajustes((select v::uuid from _v where clave = 'cuenta'));
  if (select (x->>'ultimo')::int from jsonb_array_elements(r->'locales') x where x->>'location_id' = (select v from _v where clave = 'local')) <> 2
     or (r->>'cedidas_sin_factura_7d')::int < 1 then
    raise exception 'PRUEBA V04 · 7: los ajustes después (%).', r->'locales';
  end if;
  raise notice '7 · «%»; la vista previa no numera; los ajustes dicen el último (2) y las cedidas sin factura', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare f text;
begin
  if exists (select 1 from public.ticket_invoice where sale_id = (select id from _s where clave = 'p4')) then
    raise exception 'PRUEBA V04 · 7: la vista previa ha gastado un número.';
  end if;
  foreach f in array array['public._ticket_invoice_number(uuid,uuid,uuid,text,text,text,timestamptz)', 'public._ticket_quien_factura(uuid,uuid)',
                           'public._ticket_invoice_text(text,integer,text,integer)', 'public._ticket_codigo_propuesto(text,text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA V04 · 7: % es de cualquiera.', f; end if;
  end loop;
  foreach f in array array['public.fiscal_for_preview(uuid)', 'public.ticket_invoice_ajustes(uuid)', 'public.ticket_invoice_code_set(uuid,text,text)'] loop
    if not has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA V04 · 7: los permisos de %.', f; end if;
  end loop;
  if not has_function_privilege('anon', 'public.fiscal_for_print(text,uuid)', 'execute') then raise exception 'PRUEBA V04 · 7: la tablet ya no puede pedir el tique.'; end if;
  if has_table_privilege('authenticated', 'public.ticket_invoice', 'select') or has_table_privilege('anon', 'public.ticket_invoice_series', 'select') then
    raise exception 'PRUEBA V04 · 7: las tablas de la serie se leen directamente.';
  end if;
  raise notice '7 · permisos: 4 internas cerradas, 3 del usuario, la de la tablet abierta y las tablas cerradas';
end $$;

-- ── 8 · La vuelta atrás ────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.fiscal_for_print(text,uuid)'::regprocedure)) <> (select h from _md5) then
    raise exception 'PRUEBA V04 · 8: fiscal_for_print no vuelve a ser la de antes.';
  end if;
  if to_regclass('public.ticket_invoice') is not null or to_regclass('public.location_invoice_code') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('fiscal_for_preview', 'ticket_invoice_ajustes', 'ticket_invoice_code_set', '_ticket_invoice_number', '_ticket_quien_factura'))
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_ticket_fiscal_de_antes', '_ticket_aviso'))
     or to_regclass('public.funcion_respaldo') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_respaldar_funcion', '_restaurar_funcion'))
     or (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fiscal_for_print') <> 1 then
    raise exception 'PRUEBA V04 · 8: la vuelta atrás deja algo (o su respaldo), o hay sobrecargas (regla 2).';
  end if;
  raise notice '8 · la vuelta atrás: fiscal_for_print con el md5 del principio (el de producción, con sus \r\n), nada de la 2309 (tampoco funcion_respaldo, que queda vacío), y sin sobrecargas';
end $$;

rollback;
