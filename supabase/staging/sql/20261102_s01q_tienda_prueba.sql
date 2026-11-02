-- supabase/staging/sql/20261102_s01q_tienda_prueba.sql
--
-- SOLO STAGING. Prueba del S01q (20261102T1215, 1216 y 1217): la tienda de la
-- plataforma es la unidad. Todo en una transacción con ROLLBACK. Datos
-- inventados, en la cuenta D. Prueba lo que cambia en caliente
-- (public.conta_local_de_tienda y public._conta_tienda_local_por_direccion) y lo
-- que añade (public.conta_liquidaciones_mes):
--   1. El local de una tienda: por la etiqueta de su nombre, por encima de la
--      dirección; con una etiqueta que no es de ningún local, sin local; sin
--      etiqueta, por la dirección; y lo que ya trae puesto no se toca.
--   2. La marca, por el nombre («S.L.» delante, sin la «s» del final, o el
--      principio del nombre de una sola marca).
--   3. El mes: la tienda sin local pide su local y no se compara con lo vendido;
--      Glovo se compara por las líneas de producto (la caja dice otro total, con
--      el envío); la marca cedida va en su grupo, nunca como «falta la liquidación»
--      de la plataforma.
--   4. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: prepara datos inventados de varias tablas y prueba los disparadores como el servicio; el mes se lee con el usuario de la cuenta D (sus claims).

-- El workflow ya ha pasado la tanda de la rama: se vuelve antes a lo de antes.
do $$ begin
  if to_regprocedure('public.conta_marca_de_tienda(uuid,text)') is not null then
    perform public._restaurar_funcion('public._conta_tienda_local_por_direccion()', '20261102T1215_s01q_tienda_local_marca');
    perform public._restaurar_funcion('public.conta_local_de_tienda(uuid,text)', '20261102T1215_s01q_tienda_local_marca');
  end if;
end $$;
\i supabase/migrations/20261102T1215_s01q_tienda_local_marca.sql
\i supabase/migrations/20261102T1216_s01q_motor_mes.sql
\i supabase/migrations/20261102T1217_s01q_foodint_tiendas.sql

-- Preparar (todo inventado): dos locales, una marca propia y una cedida, un canal
-- con su plataforma (quincenal, paga a los 20 días) y un socio.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_norte uuid; v_sur uuid; v_propia uuid; v_cedida uuid; v_canal uuid; v_plat uuid; v_socio uuid;
begin
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Norte S01q', 'Calle Inventada, 1') returning id into v_norte;
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Sur S01q', 'Avenida Ficticia, 2') returning id into v_sur;
  insert into public.brand (account_id, name, slug, ownership_type) values (v_acc, 'Marca Propia Uno', 'marca-propia-uno-s01q', 'own') returning id into v_propia;
  insert into public.brand (account_id, name, slug, ownership_type) values (v_acc, 'Marca Cedida Dos', 'marca-cedida-dos-s01q', 'licensed') returning id into v_cedida;
  insert into public.sales_channel (account_id, name, slug) values (v_acc, 'Glovo S01q', 'glovo-s01q') returning id into v_canal;
  insert into public.party (account_id, name) values (v_acc, 'Plataforma Inventada S01q, S.L.') returning id into v_plat;
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, payout_days_after) values (v_acc, v_plat, 'platform', v_canal, 'fortnightly', 20);
  insert into public.party (account_id, name) values (v_acc, 'Socio Inventado S01q, S.L.') returning id into v_socio;
  insert into public.party_role (account_id, party_id, role) values (v_acc, v_socio, 'brand_partner');
  insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, party_id) values (v_acc, v_cedida, 'Socio Inventado S01q, S.L.', v_socio);
  perform set_config('prueba.acc', v_acc::text, true); perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.norte', v_norte::text, true); perform set_config('prueba.sur', v_sur::text, true);
  perform set_config('prueba.propia', v_propia::text, true); perform set_config('prueba.cedida', v_cedida::text, true);
  perform set_config('prueba.canal', v_canal::text, true); perform set_config('prueba.plat', v_plat::text, true);
end $$;

create function pg_temp.tienda(p_texto text, p_local uuid default null)
returns public.platform_store language plpgsql as $$
declare v public.platform_store;
begin
  insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, location_id)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, 'glovo', p_texto, current_setting('prueba.canal')::uuid, p_local)
  returning * into v;
  return v;
end $$;

-- 1 y 2 · El local y la marca de cada tienda.
do $$
declare a public.platform_store; b public.platform_store; c public.platform_store; d public.platform_store;
begin
  a := pg_temp.tienda('Marca Propia Uno - MAD - Calle Inventada 1 (Avenida Ficticia 2)');
  if a.location_id is distinct from current_setting('prueba.norte')::uuid then
    raise exception 'PRUEBA S01q · 1: la etiqueta «Calle Inventada 1» no manda sobre la dirección (es de Sur): %', a.location_id;
  end if;
  if a.brand_id is distinct from current_setting('prueba.propia')::uuid then raise exception 'PRUEBA S01q · 2: no saca la marca de «Marca Propia Uno - MAD - …».'; end if;
  b := pg_temp.tienda('S.L.  Marca Propia Uno - MAD - Sitio Desconocido (Avenida Ficticia 2)');
  if b.location_id is not null then raise exception 'PRUEBA S01q · 1: una etiqueta que no es de ningún local tenía que dejarla sin local, y la puso en %', b.location_id; end if;
  if b.brand_id is distinct from current_setting('prueba.propia')::uuid then raise exception 'PRUEBA S01q · 2: no quita el «S.L.» de delante para sacar la marca.'; end if;
  c := pg_temp.tienda('Marca Propia Uno (Avenida Ficticia 2)');
  if c.location_id is distinct from current_setting('prueba.sur')::uuid then raise exception 'PRUEBA S01q · 1: sin etiqueta, la dirección tenía que dar Sur.'; end if;
  d := pg_temp.tienda('Marca Propia - MAD - Calle Inventada 1 (Calle Inventada 1)', current_setting('prueba.sur')::uuid);
  if d.location_id is distinct from current_setting('prueba.sur')::uuid then raise exception 'PRUEBA S01q · 1: lo que ya trae puesto (Sur) se ha cambiado.'; end if;
  if d.brand_id is distinct from current_setting('prueba.propia')::uuid then raise exception 'PRUEBA S01q · 2: «Marca Propia» no lleva a la única marca que empieza así.'; end if;
  perform set_config('prueba.ta', a.id::text, true); perform set_config('prueba.tb', b.id::text, true);
  raise notice 'PRUEBA S01q · 1 y 2: etiqueta → Norte, etiqueta desconocida → sin local, dirección → Sur, lo puesto se queda; la marca, por el nombre.';
end $$;

-- 3 · El mes (septiembre de 2026, ya pasado): lo vendido, las liquidaciones y la cedida.
do $$
declare v_s uuid; i int;
begin
  -- Dos pedidos de la marca propia en Norte: 10 € de productos cada uno, 12 € cobrados (con el envío).
  for i in 1..2 loop
    insert into public.sale (account_id, sold_at, status, location_id, brand_id, channel_id, total, source)
    values (current_setting('prueba.acc')::uuid, timestamptz '2026-09-03 13:00+02' + (i || ' hours')::interval, 'closed',
            current_setting('prueba.norte')::uuid, current_setting('prueba.propia')::uuid, current_setting('prueba.canal')::uuid, 12, 'import')
    returning id into v_s;
    insert into public.sale_line (account_id, sale_id, raw_text, product_name, quantity, unit_price) values (current_setting('prueba.acc')::uuid, v_s, 'Plato inventado', 'Plato inventado', 1, 10);
  end loop;
  -- Un pedido de la marca cedida en Norte.
  insert into public.sale (account_id, sold_at, status, location_id, brand_id, channel_id, total, source)
  values (current_setting('prueba.acc')::uuid, timestamptz '2026-09-05 13:00+02', 'closed', current_setting('prueba.norte')::uuid,
          current_setting('prueba.cedida')::uuid, current_setting('prueba.canal')::uuid, 30, 'import');
  -- La liquidación de Glovo de la tienda de Norte (20 € de productos, 2 pedidos) y la de la tienda sin local.
  insert into public.channel_settlement (account_id, channel_id, party_id, store_id, brand_id, location_id, period_from, period_to, settlement_date,
                                          orders_count, gross_sales, commission, net_payout, source, import_key, raw)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.canal')::uuid, current_setting('prueba.plat')::uuid, current_setting('prueba.ta')::uuid,
          current_setting('prueba.propia')::uuid, current_setting('prueba.norte')::uuid, date '2026-09-01', date '2026-09-15', date '2026-10-05',
          2, 20, -5, 15, 'excel_glovo', 'prueba-s01q-a', '{"promociones_local": 0}'::jsonb),
         (current_setting('prueba.acc')::uuid, current_setting('prueba.canal')::uuid, current_setting('prueba.plat')::uuid, current_setting('prueba.tb')::uuid,
          current_setting('prueba.propia')::uuid, null, date '2026-09-01', date '2026-09-15', date '2026-10-05',
          3, 40, -8, 32, 'excel_glovo', 'prueba-s01q-b', '{}'::jsonb);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
do $$
declare r jsonb; f jsonb; n int;
begin
  r := public.conta_liquidaciones_mes(current_setting('prueba.e')::uuid, date '2026-09-01');
  -- La de Norte: Glovo por productos (20 = 20), aunque la caja diga 24 €.
  select x into f from jsonb_array_elements(r->'filas') x where x->>'local_id' = current_setting('prueba.norte') and x->>'desde' = '2026-09-01';
  if f is null or f->>'estado' = 'no_cuadra' or (f->'comparado'->>'vendido')::numeric <> 20 or (f->'comparado'->>'liquidacion')::numeric <> 20 then
    raise exception 'PRUEBA S01q · 3: la tienda de Norte no se compara por productos (20 € y 20 €): %', f;
  end if;
  if jsonb_array_length(f->'tiendas') <> 1 or f->'tiendas'->0->>'nombre' not like 'Marca Propia Uno - MAD - Calle Inventada 1%' then
    raise exception 'PRUEBA S01q · 3: la fila de Norte no dice su tienda con el nombre de la plataforma: %', f->'tiendas';
  end if;
  -- La tienda sin local: pide su local, sin compararse con lo vendido.
  select x into f from jsonb_array_elements(r->'filas') x where (x->>'sin_local')::boolean;
  if f is null or f->>'estado' <> 'te_necesita' or f->>'accion' <> 'elige_local' then
    raise exception 'PRUEBA S01q · 3: la tienda sin local no pide su local: %', f;
  end if;
  -- La cedida: en su grupo, con su socio; ninguna fila de la plataforma para ella.
  select count(*) into n from jsonb_array_elements(r->'filas') x where x->>'marca_id' = current_setting('prueba.cedida');
  if n <> 0 then raise exception 'PRUEBA S01q · 3: la marca cedida sale entre las de la plataforma (% filas).', n; end if;
  select x into f from jsonb_array_elements(r->'cedidas') x where x->>'local_id' = current_setting('prueba.norte');
  if f is null or f->>'socio' <> 'Socio Inventado S01q, S.L.' or (f->'vendido'->>'total')::numeric <> 30 or f->>'estado' = 'completa' then
    raise exception 'PRUEBA S01q · 3: la cedida no va en su grupo con su socio y lo vendido (30 €): %', f;
  end if;
  if (r->'resumen'->>'total')::int <> jsonb_array_length(r->'filas') then raise exception 'PRUEBA S01q · 3: el resumen no cuenta las filas.'; end if;
  raise notice 'PRUEBA S01q · 3: Norte, por productos y no «no cuadra»; la tienda sin local pide su local; la cedida, en su grupo: «%»', f->>'frase';
end $$;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 4 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T1217_s01q_foodint_tiendas.down.sql
\i supabase/vuelta-atras/20261102T1216_s01q_motor_mes.down.sql
\i supabase/vuelta-atras/20261102T1215_s01q_tienda_local_marca.down.sql
do $$ begin
  if to_regprocedure('public.conta_liquidaciones_mes(uuid,date)') is not null or to_regprocedure('public.conta_marca_de_tienda(uuid,text)') is not null
     or position('_conta_tienda_etiqueta' in pg_get_functiondef('public.conta_local_de_tienda(uuid,text)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01q · 4: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA S01q · 4: la vuelta atrás quita la vista del mes y devuelve el local por la dirección.';
end $$;
\i supabase/migrations/20261102T1215_s01q_tienda_local_marca.sql
\i supabase/migrations/20261102T1216_s01q_motor_mes.sql

rollback;
