-- supabase/staging/sql/20261201_c07_diez_todo_prueba.sql
--
-- SOLO STAGING. Prueba de 20261201T0430_c07_diez_todo, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Datos de la empresa A de staging
-- (inventados); la conexión con Diez, inventada dentro de la transacción.
--
--   (Empieza con la vuelta atrás: staging vuelve a pasar el manifiesto entero.)
--   0. Lo de antes: lo que conta_resumen_ventas devuelve a A de su venta
--      validada, y que sin sesión (servidor) no la lee.
--   1. La 0430.
--   2. El interruptor: sin conexión no se enciende; con ella sí, y dice qué ha
--      hecho; apagado, también. Un usuario de B no toca la empresa de A.
--   3. Lo que falta por mandar: lo validado de A desde «desde» (el manual y la
--      nómina como asiento, la venta como factura); ni la apertura, ni lo
--      propuesto, ni un contraasiento de algo que no llegó a Diez. Apagado,
--      nada.
--   4. Reclamar: cada uno con su fila y su reintento a 10 minutos; otra pasada
--      no coge nada. Con el reintento vencido vuelve; con 3 intentos, no.
--   5. Un contraasiento sale cuando lo que anula está en Diez.
--   6. conta_asiento_envio: cuadra, de A sí, de B no, y el servidor sí.
--   7. conta_resumen_ventas y conta_recibida_envio: A lee lo mismo que antes,
--      B nada, y el servidor ahora sí.
--   8. La vuelta atrás, byte a byte (md5 de producción del 22/10), y otra vez
--      delante.
-- No toca coste ni stock: sin los cuatro caminos de la regla 10.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C07: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Staging vuelve a pasar el manifiesto entero: si la 0430 ya está, se quita
-- aquí dentro (ROLLBACK) para medir el antes.
\i supabase/vuelta-atras/20261201T0430_c07_diez_todo.down.sql

-- 0 · Lo de antes.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_c uuid; v_venta uuid; v_val uuid; v_rec uuid;
begin
  select company_id into v_c from public.journal_entry where account_id = a limit 1;
  -- La venta de una plataforma (la que lee conta_resumen_ventas; propuesta, como las de A) y una venta validada.
  select je.id into v_venta from public.journal_entry je join public.sales_day_summary d on d.entry_id = je.id and d.channel_id is not null
   where je.account_id = a order by je.created_at limit 1;
  select je.id into v_val from public.journal_entry je where je.account_id = a and je.source_type = 'sales_day' and je.status = 'validado' order by je.created_at limit 1;
  select je.id into v_rec from public.journal_entry je where je.account_id = a and je.source_type = 'supplier_invoice' order by je.created_at limit 1;
  if v_c is null or v_venta is null or v_val is null or v_rec is null then raise exception 'PRUEBA C07 · 0: la empresa A no tiene su venta de plataforma, su venta validada o su recibida en staging.'; end if;
  perform set_config('c07.venta_val', v_val::text, true);
  perform set_config('c07.empresa', v_c::text, true);
  perform set_config('c07.venta', v_venta::text, true);
  perform set_config('c07.recibida', v_rec::text, true);
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
-- Sin pintarlo en el registro: solo si se ha leído.
select set_config('c07.venta_antes', public.conta_resumen_ventas(current_setting('c07.venta')::uuid)::text, true) is not null as venta_leida;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  begin
    perform public.conta_resumen_ventas(current_setting('c07.venta')::uuid);
    raise exception 'PRUEBA C07 · 0: el servidor ya lee la venta antes de la 0430: ¿está ya aplicada?';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 1 · La 0430.
\i supabase/migrations/20261201T0430_c07_diez_todo.sql

-- 2 · El interruptor.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_diez_envio_poner(current_setting('c07.empresa')::uuid, true, 'Prueba C07');
    raise exception 'PRUEBA C07 · 2: se ha encendido sin conexión con Diez.';
  exception when sqlstate '23514' then null;
  end;
end $$;
reset role;
-- La conexión, inventada (como postgres: es la preparación).
insert into public.account_connector (account_id, connector_id, status, scope, company_id, external_account_id, config)
select 'c01a0000-0000-4000-8000-00000000000a', k.id, 'connected', 'company', current_setting('c07.empresa')::uuid, 'C0009', '{}'::jsonb
  from public.connector k where k.code = 'diez'
on conflict do nothing;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_diez_envio_poner(current_setting('c07.empresa')::uuid, true, 'Prueba C07');
  if (r->>'enviar')::boolean is not true or r->>'texto' not like 'Encendido: todo lo que se valide sale solo a Diez.%' then
    raise exception 'PRUEBA C07 · 2: al encender dice %', r;
  end if;
  if not exists (select 1 from public.conta_diez_envio_empresa where company_id = current_setting('c07.empresa')::uuid and enviar and desde = current_date) then
    raise exception 'PRUEBA C07 · 2: A no ve su interruptor encendido desde hoy.';
  end if;
end $$;
reset role;
-- Un usuario de B no ve ni toca el de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_diez_envio_empresa where company_id = current_setting('c07.empresa')::uuid) then
    raise exception 'PRUEBA C07 · 2: B ve el interruptor de A.';
  end if;
  begin
    perform public.conta_diez_envio_poner(current_setting('c07.empresa')::uuid, false, 'B');
    raise exception 'PRUEBA C07 · 2: B ha apagado el de A.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 3 · Lo que falta por mandar. «desde», atrás, para que entre lo que A ya tiene validado.
update public.conta_diez_envio_empresa set desde = date '2000-01-01' where company_id = current_setting('c07.empresa')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_n int; v_mal int;
begin
  create temp table _c07_ver on commit drop as select * from public.conta_diez_por_enviar(50) where account_id = a;
  select count(*) into v_n from _c07_ver;
  if v_n = 0 then raise exception 'PRUEBA C07 · 3: no sale nada de A.'; end if;
  if not exists (select 1 from _c07_ver where origen = 'manual' and kind = 'asiento') then raise exception 'PRUEBA C07 · 3: el manual validado no sale como asiento.'; end if;
  if not exists (select 1 from _c07_ver where origen = 'payroll' and kind = 'asiento') then raise exception 'PRUEBA C07 · 3: la nómina validada no sale como asiento.'; end if;
  if not exists (select 1 from _c07_ver where entry_id = current_setting('c07.venta_val')::uuid and kind = 'factura') then raise exception 'PRUEBA C07 · 3: la venta validada no sale como factura.'; end if;
  select count(*) into v_mal from _c07_ver v join public.journal_entry e on e.id = v.entry_id
   where e.status <> 'validado' or e.source_type in ('opening', 'migrated') or (e.source_type = 'reversal');
  if v_mal > 0 then raise exception 'PRUEBA C07 · 3: salen % que no deben (apertura, no validados o contraasientos de algo que no está en Diez).', v_mal; end if;
end $$;
reset role;
update public.conta_diez_envio_empresa set enviar = false where company_id = current_setting('c07.empresa')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if exists (select 1 from public.conta_diez_por_enviar(50) where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA C07 · 3: apagado, sigue saliendo algo de A.';
  end if;
end $$;
reset role;
update public.conta_diez_envio_empresa set enviar = true where company_id = current_setting('c07.empresa')::uuid;

-- 4 · Reclamar.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_r int; v_sin int; v_otra int;
begin
  -- Todo lo de A (puede haber de otras cuentas encendidas en staging: no se cuentan).
  create temp table _c07_cogidos on commit drop as select * from public.conta_diez_reclamar(50) where account_id = a;
  select count(*) into v_r from _c07_cogidos;
  if v_r = 0 then raise exception 'PRUEBA C07 · 4: no se ha cogido nada de A.'; end if;
  select count(*) into v_sin from _c07_cogidos c
   where not exists (select 1 from public.external_send s where s.entry_id = c.entry_id and s.status = 'pendiente'
                      and s.next_try_at between now() + interval '9 minutes' and now() + interval '11 minutes');
  if v_sin > 0 then raise exception 'PRUEBA C07 · 4: % cogidos sin su fila y su reintento a 10 minutos.', v_sin; end if;
  select count(*) into v_otra from public.conta_diez_reclamar(50) where account_id = a;
  if v_otra > 0 then raise exception 'PRUEBA C07 · 4: otra pasada vuelve a coger % de A.', v_otra; end if;
  perform set_config('c07.cogido', (select entry_id::text from _c07_cogidos order by entry_id limit 1), true);
end $$;
reset role;
-- Con el reintento vencido (y quieto), vuelve; con 3 intentos, no.
update public.external_send set next_try_at = now() - interval '1 minute', updated_at = now() - interval '5 minutes'
 where entry_id = current_setting('c07.cogido')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if not exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c07.cogido')::uuid) then
    raise exception 'PRUEBA C07 · 4: con el reintento vencido no vuelve.';
  end if;
end $$;
reset role;
update public.external_send set attempts = 3 where entry_id = current_setting('c07.cogido')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c07.cogido')::uuid) then
    raise exception 'PRUEBA C07 · 4: con 3 intentos vuelve a salir solo.';
  end if;
end $$;
reset role;

-- 5 · El contraasiento sale cuando lo que anula está en Diez.
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_o uuid; v_r uuid;
begin
  select o.id, o.voided_by_entry_id into v_o, v_r from public.journal_entry o
   where o.account_id = a and o.status = 'anulado' and o.source_type = 'manual' order by o.created_at limit 1;
  if v_o is null then raise exception 'PRUEBA C07 · 5: A no tiene un manual anulado.'; end if;
  perform set_config('c07.anulado', v_o::text, true);
  perform set_config('c07.contra', v_r::text, true);
  insert into public.external_send (entry_id, account_id, company_id, kind, payload_hash, status, attempts, ext_year, ext_series, ext_number, sent_at)
  select o.id, o.account_id, o.company_id, 'asiento', 'prueba', 'enviado', 1, '2099', '4', 990001, now()
    from public.journal_entry o where o.id = v_o;
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if not exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c07.contra')::uuid and kind = 'asiento') then
    raise exception 'PRUEBA C07 · 5: el contraasiento de lo que está en Diez no sale.';
  end if;
end $$;

-- 6 · conta_asiento_envio (el servidor).
do $$
declare v jsonb := public.conta_asiento_envio(current_setting('c07.contra')::uuid);
  d numeric; h numeric;
begin
  if v->>'origen' <> 'reversal' or v->>'anula' <> current_setting('c07.anulado') or v->>'anulaOrigen' <> 'manual' then
    raise exception 'PRUEBA C07 · 6: el contraasiento no dice qué anula: %', v - 'lineas';
  end if;
  select sum((x->>'debe')::numeric), sum((x->>'haber')::numeric) into d, h from jsonb_array_elements(v->'lineas') x;
  if jsonb_array_length(v->'lineas') = 0 or d <> h or exists (select 1 from jsonb_array_elements(v->'lineas') x where coalesce(x->>'cuenta', '') = '') then
    raise exception 'PRUEBA C07 · 6: las líneas no cuadran o les falta la cuenta.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if (public.conta_asiento_envio(current_setting('c07.contra')::uuid)->>'id') <> current_setting('c07.contra') then
    raise exception 'PRUEBA C07 · 6: A no lee su asiento.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0001-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_asiento_envio(current_setting('c07.contra')::uuid);
    raise exception 'PRUEBA C07 · 6: B lee el asiento de A.';
  exception when sqlstate 'P0002' then null;
  end;
  -- 7 · B tampoco lee la venta ni la recibida de A.
  begin
    perform public.conta_resumen_ventas(current_setting('c07.venta')::uuid);
    raise exception 'PRUEBA C07 · 7: B lee la venta de A.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.conta_recibida_envio(current_setting('c07.recibida')::uuid);
    raise exception 'PRUEBA C07 · 7: B lee la recibida de A.';
  exception when sqlstate 'P0002' then null;
  end;
end $$;
reset role;

-- 7 · A lee lo mismo que antes; el servidor, ahora sí.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if public.conta_resumen_ventas(current_setting('c07.venta')::uuid) <> current_setting('c07.venta_antes')::jsonb then
    raise exception 'PRUEBA C07 · 7: A no lee lo mismo que antes de la 0430.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if public.conta_resumen_ventas(current_setting('c07.venta')::uuid) <> current_setting('c07.venta_antes')::jsonb then
    raise exception 'PRUEBA C07 · 7: el servidor no lee la venta como A.';
  end if;
  begin
    perform public.conta_recibida_envio(current_setting('c07.recibida')::uuid);
  exception when sqlstate 'P0002' then raise exception 'PRUEBA C07 · 7: el servidor no lee la recibida.';
            when sqlstate '22023' then null; -- una de comisión sin número: la lee y lo dice, que es lo de antes
  end;
end $$;
reset role;

-- 2 (fin) · Apagar dice qué ha hecho.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb := public.conta_diez_envio_poner(current_setting('c07.empresa')::uuid, false, 'Prueba C07');
begin
  if (r->>'enviar')::boolean is not false or r->>'texto' not like 'Apagado: no se envía nada a Diez.%' then
    raise exception 'PRUEBA C07 · 2: al apagar dice %', r;
  end if;
end $$;
reset role;

-- 8 · La vuelta atrás, byte a byte, y otra vez delante.
delete from public.external_send where kind = 'asiento' and payload_hash = 'prueba';
\i supabase/vuelta-atras/20261201T0430_c07_diez_todo.down.sql
do $$
declare v1 text; v2 text;
begin
  select md5(prosrc) into v1 from pg_proc where proname = 'conta_resumen_ventas' and pronamespace = 'public'::regnamespace;
  select md5(prosrc) into v2 from pg_proc where proname = 'conta_recibida_envio' and pronamespace = 'public'::regnamespace;
  if v1 <> '62ba30b970c7c61849dc2f96e8a8cfb1' or v2 <> 'e3c57e29abd43a52c2c95790e2cc494a' then
    raise exception 'PRUEBA C07 · 8: la vuelta atrás no deja los cuerpos de producción (% y %).', v1, v2;
  end if;
  if to_regclass('public.conta_diez_envio_empresa') is not null or to_regprocedure('public.conta_diez_reclamar(integer)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'external_send' and column_name = 'next_try_at') then
    raise exception 'PRUEBA C07 · 8: la vuelta atrás deja cosas de la 0430.';
  end if;
end $$;
\i supabase/migrations/20261201T0430_c07_diez_todo.sql

select 'PRUEBA C07 · todo bien' as resultado;
rollback;
