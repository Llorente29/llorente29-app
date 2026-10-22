-- supabase/staging/sql/20261204_e05_releer_riders_prueba.sql
--
-- SOLO STAGING. Prueba de 20261204T0480_e05_releer_riders, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. La quincena inventada de la
-- empresa A de staging (5 facturas en revisión); las lecturas, inventadas
-- dentro de la transacción. La lectura de los PDF la prueban las unitarias
-- (tests/conta/e05/releer.test.ts); aquí, lo que guarda la base y quién puede.
--
--   (Empieza con la vuelta atrás, por si la 0480 ya estuviera.)
--   0. Lo de antes: conta_lote_pedidos_app y conta_lote_cruce_guardar son las
--      de producción (md5 7586a749… y 79a57d0b…), y el servidor no cruza.
--   1. La 0480.
--   2. Pedirla: el administrador de A sí; un usuario de B, no.
--   3. Lanzarla desde la base: un usuario no puede; sin cron_secret, falla y
--      lo dice (en staging no se llama a nada).
--   4. Empezar: una vez; la segunda, no.
--   5. Guardar la lectura: solo las que siguen en revisión (una aprobada no se
--      toca); lo de antes que no es del PDF se queda; segura si todo está bien,
--      en duda si algo del PDF falla. Una lectura que no es del PDF, o una
--      factura de otro lote, no entra. Un usuario no puede.
--   6. Cruzar como el servidor: sí; un usuario de B, no; el de A, como antes.
--   7. Apuntar lo que salió: una vez; y ya no se guarda otra lectura.
--   8. Quién lee las relecturas: A las suyas, B nada.
--   9. La vuelta atrás: con relecturas se da lo que la para; sin ellas, deja las
--      dos funciones byte a byte y nada de la 0480. Y otra vez delante.
-- No toca coste ni stock: sin los cuatro caminos de la regla 10.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05R: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261204T0480_e05_releer_riders.down.sql

-- 0 · Lo de antes.
create temp table _r (clave text primary key, id uuid) on commit drop;
grant select on _r to authenticated, service_role;
insert into _r select 'lote', b.id from public.supplier_batch b
 where b.account_id = 'c01a0000-0000-4000-8000-00000000000a' and b.provider = 'catcher' order by b.period_from limit 1;
insert into _r select 'f' || row_number() over (order by i.invoice_number), i.id from public.supplier_invoice i
 where i.batch_id = (select id from _r where clave = 'lote') and i.status = 'en_revision';
insert into _r select 'otro', b.id from public.supplier_batch b
 where b.account_id = 'c01a0000-0001-4000-8000-00000000000a' and b.provider = 'catcher' order by b.period_from limit 1;
insert into _r select 'otra_f', i.id from public.supplier_invoice i where i.batch_id = (select id from _r where clave = 'otro') order by i.invoice_number limit 1;
do $$
declare v1 text; v2 text;
begin
  if (select count(*) from _r where clave like 'f_') <> 5 or not exists (select 1 from _r where clave = 'otra_f') then
    raise exception 'PRUEBA E05R · 0: no están en staging la quincena de A con sus 5 facturas en revisión y la de B.';
  end if;
  select md5(pg_get_functiondef('public.conta_lote_pedidos_app(uuid)'::regprocedure)) into v1;
  select md5(pg_get_functiondef('public.conta_lote_cruce_guardar(uuid,jsonb,text)'::regprocedure)) into v2;
  if v1 <> '7586a749f6203ca8fc947ab4c6449d64' or v2 <> '79a57d0b9e3a3dca21197c224bdde093' then
    raise exception 'PRUEBA E05R · 0: las funciones de cruzar no son las de producción (% y %).', v1, v2;
  end if;
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    perform public.conta_lote_cruce_guardar((select id from _r where clave = 'lote'), '{"facturas":{},"porAclarar":[]}'::jsonb, 'Prueba');
    raise exception 'PRUEBA E05R · 0: el servidor ya cruza antes de la 0480: ¿está ya aplicada?';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 1 · La 0480.
\i supabase/migrations/20261204T0480_e05_releer_riders.sql

-- 2 · Pedirla.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('e05r.pedida', public.conta_lote_releer_pedir((select id from _r where clave = 'lote'), 'Prueba E05R')::text, true) is not null as pedida;
reset role;
do $$ begin
  if not exists (select 1 from public.conta_lote_relectura r where r.id = current_setting('e05r.pedida')::uuid
                  and r.batch_id = (select id from _r where clave = 'lote') and r.pedida_por = 'c01a0000-0000-4000-8000-0000000000a1' and r.pedida_por_nombre = 'Prueba E05R' and r.empezada_en is null) then
    raise exception 'PRUEBA E05R · 2: la relectura pedida no queda apuntada con quién la pide.';
  end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_lote_releer_pedir((select id from _r where clave = 'lote'), null);
    raise exception 'PRUEBA E05R · 2: un usuario de B pide releer un lote de A.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;

-- 3 · Lanzarla desde la base.
do $$ begin
  begin
    perform public.conta_lote_releer_lanzar((select id from _r where clave = 'lote'), 'x');
    raise exception 'PRUEBA E05R · 3: un usuario lanza la relectura desde la base.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    raise notice 'PRUEBA E05R · 3: staging tiene cron_secret: no se lanza (llamaría a la función de producción).';
    return;
  end if;
  begin
    perform public.conta_lote_releer_lanzar((select id from _r where clave = 'lote'), 'Prueba E05R');
    raise exception 'PRUEBA E05R · 3: sin cron_secret, lanzar no falla.';
  exception when sqlstate '55000' then null;
  end;
end $$;

-- 4 · Empezar.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v jsonb;
begin
  v := public.conta_lote_relectura_empezar(current_setting('e05r.pedida')::uuid);
  if (v->>'lote')::uuid <> (select id from _r where clave = 'lote') or v->>'quien' <> 'Prueba E05R' then raise exception 'PRUEBA E05R · 4: empezar no dice el lote y quién.'; end if;
  begin
    perform public.conta_lote_relectura_empezar(current_setting('e05r.pedida')::uuid);
    raise exception 'PRUEBA E05R · 4: una relectura empieza dos veces.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 5 · Guardar la lectura. Una de las cinco, aprobada por una persona (como postgres: preparación).
update public.supplier_invoice set status = 'aprobada' where id = (select id from _r where clave = 'f1');
select set_config('e05r.antes_f1', (select reading::text from public.supplier_invoice where id = (select id from _r where clave = 'f1')), true) is not null as guardada;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  bien constant jsonb := '[{"id":"pdf_numero","ok":true,"texto":"x"},{"id":"pdf_pedidos","ok":true,"texto":"x"}]';
  mal constant jsonb := '[{"id":"pdf_numero","ok":true,"texto":"x"},{"id":"pdf_pedidos","ok":false,"texto":"x"}]';
  v jsonb; v_f2 jsonb; v_f3 jsonb;
begin
  begin
    perform public.conta_lote_relectura_guardar(current_setting('e05r.pedida')::uuid, jsonb_build_array(jsonb_build_object('factura', (select id from _r where clave = 'f2'), 'contraPdf', '[{"id":"numero","ok":true,"texto":"x"}]'::jsonb)));
    raise exception 'PRUEBA E05R · 5: entra una lectura que no es del PDF.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_lote_relectura_guardar(current_setting('e05r.pedida')::uuid, jsonb_build_array(jsonb_build_object('factura', (select id from _r where clave = 'otra_f'), 'contraPdf', bien)));
    raise exception 'PRUEBA E05R · 5: entra la factura de otro lote.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_lote_relectura_guardar(current_setting('e05r.pedida')::uuid, jsonb_build_array(
    jsonb_build_object('factura', (select id from _r where clave = 'f1'), 'contraPdf', bien, 'sha256', 'h1'),
    jsonb_build_object('factura', (select id from _r where clave = 'f2'), 'contraPdf', bien, 'sha256', 'h2'),
    jsonb_build_object('factura', (select id from _r where clave = 'f3'), 'contraPdf', mal, 'sha256', 'h3'),
    jsonb_build_object('factura', (select id from _r where clave = 'f4'), 'contraPdf', bien, 'sha256', 'h4'),
    jsonb_build_object('factura', (select id from _r where clave = 'f5'), 'contraPdf', bien, 'sha256', 'h5')));
  if (v->>'releidas')::int <> 4 or (v->>'sin_tocar')::int <> 1 then raise exception 'PRUEBA E05R · 5: no son 4 releídas y 1 sin tocar (%).', v; end if;
  if (select reading::text from public.supplier_invoice where id = (select id from _r where clave = 'f1')) <> current_setting('e05r.antes_f1') then
    raise exception 'PRUEBA E05R · 5: se ha tocado la lectura de una factura aprobada.';
  end if;
  select reading into v_f2 from public.supplier_invoice where id = (select id from _r where clave = 'f2');
  select reading into v_f3 from public.supplier_invoice where id = (select id from _r where clave = 'f3');
  if (select count(*) from jsonb_array_elements(v_f2->'comprobaciones') c where c->>'id' like 'pdf\_%') <> 2
     or exists (select 1 from jsonb_array_elements(v_f2->'comprobaciones') c where c->>'id' = 'pdf_pedidos' and (c->>'ok')::boolean is not true) then
    raise exception 'PRUEBA E05R · 5: las comprobaciones del PDF no son las nuevas.';
  end if;
  if (select count(*) from jsonb_array_elements(v_f2->'comprobaciones') c where c->>'id' not like 'pdf\_%')
     <> (select count(*) from public.supplier_invoice i, jsonb_array_elements(i.reading->'comprobaciones') c where i.id = (select id from _r where clave = 'f4') and c->>'id' not like 'pdf\_%') then
    raise exception 'PRUEBA E05R · 5: lo de antes que no es del PDF no se queda igual.';
  end if;
  if v_f3->>'confianza' <> 'duda' then raise exception 'PRUEBA E05R · 5: con algo del PDF mal, queda segura.'; end if;
  if v_f2->'relectura'->>'sha256' <> 'h2' or (v_f2->'relectura'->>'id')::uuid <> current_setting('e05r.pedida')::uuid then raise exception 'PRUEBA E05R · 5: no queda dicha la relectura.'; end if;
  -- Segura con la regla de registrar: todo bien, PDF, proveedor y locales.
  if v_f2->>'confianza' <> (select case when not exists (select 1 from jsonb_array_elements(i.reading->'comprobaciones') c where (c->>'ok')::boolean is not true)
                                           and i.raw_document_url is not null and i.supplier_id is not null
                                           and (i.location_id is not null or (jsonb_array_length(coalesce(i.reading->'lote'->'reparto', '[]'::jsonb)) > 0
                                                and not exists (select 1 from jsonb_array_elements(i.reading->'lote'->'reparto') r where coalesce(r->>'localId', '') = '')))
                                         then 'seguro' else 'duda' end from public.supplier_invoice i where i.id = (select id from _r where clave = 'f2')) then
    raise exception 'PRUEBA E05R · 5: la confianza no sigue la regla de registrar.';
  end if;
  if (select releidas from public.conta_lote_relectura where id = current_setting('e05r.pedida')::uuid) <> 4 then raise exception 'PRUEBA E05R · 5: la relectura no cuenta lo releído.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_lote_relectura_guardar(current_setting('e05r.pedida')::uuid, '[]'::jsonb);
    raise exception 'PRUEBA E05R · 5: un usuario guarda lecturas por la puerta del servidor.';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6 · Cruzar: el de A como antes; B no; y el servidor.
select (public.conta_lote_cruce_guardar((select id from _r where clave = 'lote'), '{"facturas":{},"porAclarar":[]}'::jsonb, 'Prueba E05R') ->> 'texto') like 'Cruzada%' as cruza_el_de_a;
select jsonb_typeof(public.conta_lote_pedidos_app((select id from _r where clave = 'lote'))) = 'array' as lee_el_de_a;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_lote_cruce_guardar((select id from _r where clave = 'lote'), '{"facturas":{},"porAclarar":[]}'::jsonb, null);
    raise exception 'PRUEBA E05R · 6: un usuario de B cruza un lote de A.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.conta_lote_pedidos_app((select id from _r where clave = 'lote'));
    raise exception 'PRUEBA E05R · 6: un usuario de B lee los pedidos de un lote de A.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select (public.conta_lote_cruce_guardar((select id from _r where clave = 'lote'), '{"facturas":{},"porAclarar":[]}'::jsonb, 'Prueba E05R') ->> 'texto') like 'Cruzada%' as cruza_el_servidor;
select jsonb_typeof(public.conta_lote_pedidos_app((select id from _r where clave = 'lote'))) = 'array' as lee_el_servidor;

-- 7 · Apuntar lo que salió.
do $$ begin
  perform public.conta_lote_relectura_hecha(current_setting('e05r.pedida')::uuid, '{"releidas":4}'::jsonb, null);
  if (select hecha_en from public.conta_lote_relectura where id = current_setting('e05r.pedida')::uuid) is null then raise exception 'PRUEBA E05R · 7: no queda hecha.'; end if;
  begin
    perform public.conta_lote_relectura_hecha(current_setting('e05r.pedida')::uuid, null, 'otra vez');
    raise exception 'PRUEBA E05R · 7: se apunta dos veces.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.conta_lote_relectura_guardar(current_setting('e05r.pedida')::uuid, '[]'::jsonb);
    raise exception 'PRUEBA E05R · 7: hecha, se guarda otra lectura.';
  exception when sqlstate '23505' then null;
  end;
end $$;
reset role;

-- 8 · Quién lee las relecturas.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.conta_lote_relectura where id = current_setting('e05r.pedida')::uuid) then raise exception 'PRUEBA E05R · 8: A no lee su relectura.'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_lote_relectura where account_id = 'c01a0000-0000-4000-8000-00000000000a') then raise exception 'PRUEBA E05R · 8: B lee las relecturas de A.'; end if;
end $$;
reset role;

-- 9 · La vuelta atrás. Con relecturas se da lo que la para (no se ejecuta aquí:
-- pararía la transacción entera); sin ellas, se ejecuta.
do $$ begin
  if (select count(*) from public.conta_lote_relectura) < 1 then raise exception 'PRUEBA E05R · 9: no hay relecturas con las que pararía la vuelta atrás.'; end if;
end $$;
delete from public.conta_lote_relectura;
\i supabase/vuelta-atras/20261204T0480_e05_releer_riders.down.sql
do $$
declare v1 text; v2 text;
begin
  select md5(pg_get_functiondef('public.conta_lote_pedidos_app(uuid)'::regprocedure)) into v1;
  select md5(pg_get_functiondef('public.conta_lote_cruce_guardar(uuid,jsonb,text)'::regprocedure)) into v2;
  if v1 <> '7586a749f6203ca8fc947ab4c6449d64' or v2 <> '79a57d0b9e3a3dca21197c224bdde093' then
    raise exception 'PRUEBA E05R · 9: la vuelta atrás no deja las funciones de producción (% y %).', v1, v2;
  end if;
  if to_regclass('public.conta_lote_relectura') is not null or to_regprocedure('public.conta_lote_releer_pedir(uuid,text)') is not null
     or to_regprocedure('public.conta_lote_relectura_guardar(uuid,jsonb)') is not null or to_regprocedure('public.conta_lote_releer_lanzar(uuid,text)') is not null then
    raise exception 'PRUEBA E05R · 9: la vuelta atrás deja cosas de la 0480.';
  end if;
end $$;
\i supabase/migrations/20261204T0480_e05_releer_riders.sql

select 'PRUEBA E05R · todo bien' as resultado;
rollback;
