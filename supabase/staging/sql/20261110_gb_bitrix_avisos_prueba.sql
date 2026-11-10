-- supabase/staging/sql/20261110_gb_bitrix_avisos_prueba.sql
--
-- SOLO STAGING. Prueba de la 0060 del GB (nº 13, punto 4: tareas en Bitrix24
-- a partir de lo que pasa en Sumied). Todo en ROLLBACK, con datos inventados (T11).
--
--   1. Por abrir, con la ficha del cliente: el recibo devuelto (y no uno ya
--      cobrado después), el mandato sin firmar desde hace 8 días (y no uno de
--      3 días) y el alta pedida en el portal (a Laboral).
--   2. Una cuenta con su CRM REAL no sale: solo las conexiones de pruebas.
--   3. Apuntadas, no vuelven a salir; resueltas (cobro posterior cobrado,
--      mandato firmado, petición hecha), salen para cerrar; y cerradas, no.
--   4. Solo el servidor (el despertador no se puede llamar desde fuera); y la
--      vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-0060: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regclass('public.conta_bitrix_pestana_aviso') is not null as ya_esta_la_0060 \gset
\if :ya_esta_la_0060
\i supabase/vuelta-atras/20261110T0060_gb_bitrix_avisos.down.sql
\endif

create temp table _u (cuenta uuid, empresa uuid, cliente uuid, real_cuenta uuid, pedida uuid) on commit drop;
do $$
declare a uuid; e uuid; cl uuid; ar uuid; er uuid; clr uuid; q uuid; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select c.account_id, c.id into a, e from public.company c where c.is_active order by c.created_at limit 1;
  select c.account_id, c.id into ar, er from public.company c where c.is_active and c.account_id <> a order by c.created_at limit 1;
  if a is null or ar is null then raise exception 'PRUEBA GB-0060 · 0: staging no tiene dos cuentas con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, url_ref) values (a, 'bitrix24', 'pruebas', 'gb-prueba-0060.bitrix24.es', gen_random_uuid())
  on conflict (account_id, crm) do update set entorno = 'pruebas', url_ref = excluded.url_ref;
  insert into public.conta_crm (account_id, crm, entorno, portal, url_ref) values (ar, 'bitrix24', 'real', 'gb-prueba-real.bitrix24.es', gen_random_uuid())
  on conflict (account_id, crm) do update set entorno = 'real', url_ref = excluded.url_ref;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 0060, S.L.', 'B00000060') returning id into cl;
  insert into public.party (account_id, name, tax_id) values (ar, 'Cliente Real Prueba GB 0060, S.L.', 'B00000061') returning id into clr;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, ficha) values
    (a, 'bitrix24', 'contacto', '70060', '90060', cl, '{}'), (a, 'bitrix24', 'empresa', '90060', '', cl, '{}'), (ar, 'bitrix24', 'empresa', '90061', '', clr, '{}');
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values (e, 'CU-GB60', a, 'Cliente Prueba GB 0060', cl), (er, 'CU-GB61', ar, 'Real', clr);
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado, creado) values
    (e, 'MD-GB60', a, 'CU-GB60', 'active', now() - interval '60 days'),
    (e, 'MD-GB60-PEND', a, 'CU-GB60', 'pending_customer_approval', now() - interval '8 days'),
    (e, 'MD-GB60-NUEVO', a, 'CU-GB60', 'pending_customer_approval', now() - interval '3 days'),
    (er, 'MD-GB61', ar, 'CU-GB61', 'pending_customer_approval', now() - interval '20 days');
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values
    (e, 'PM-GB60-VIEJO', a, 'MD-GB60', 'failed', current_date - 25, 120.50),
    (e, 'PM-GB60-COBRADO', a, 'MD-GB60', 'paid_out', current_date - 20, 120.50),
    (e, 'PM-GB60-DEV', a, 'MD-GB60', 'failed', current_date - 5, 225.00),
    (er, 'PM-GB61-DEV', ar, 'MD-GB61', 'failed', current_date - 5, 99.00);
  insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, fecha_efecto, estado) values
    (a, e, cl, 'alta', 'Diego Prueba Ferrer', mes, mes + 15, 'pedida') returning id into q;
  insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, estado) values (ar, er, clr, 'alta', 'Real Prueba', mes, 'pedida');
  insert into _u values (a, e, cl, ar, q);
end $$;

\i supabase/migrations/20261110T0060_gb_bitrix_avisos.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
insert into _r select 'uno', public.conta_bitrix_pestana_avisos_por_hacer(500);
reset role;

do $$
declare u record; r jsonb := (select x.r from _r x where x.paso = 'uno'); mios jsonb; t text[];
begin
  select * into u from _u;
  select jsonb_agg(x order by x->>'tipo') into mios from jsonb_array_elements(r->'abrir') x where (x->>'cuenta')::uuid = u.cuenta;
  -- 1 · Los tres, con la ficha de la empresa (no la del contacto).
  select array_agg(x->>'tipo' order by x->>'tipo') into t from jsonb_array_elements(mios) x;
  if t is distinct from array['devuelto', 'mandato_sin_firmar', 'peticion_portal'] then raise exception 'PRUEBA GB-0060 · 1: por abrir no es lo esperado (%).', mios; end if;
  if exists (select 1 from jsonb_array_elements(mios) x where x->>'tipo_ficha' <> 'empresa' or x->>'id_externo' <> '90060' or (x->>'cliente')::uuid <> u.cliente) then
    raise exception 'PRUEBA GB-0060 · 1: no va a la ficha de la empresa (%).', mios;
  end if;
  if (select x->>'titulo' from jsonb_array_elements(mios) x where x->>'tipo' = 'devuelto') <> format('Recibo devuelto · %s · 225,00 €', to_char(current_date - 5, 'DD/MM/YYYY'))
     or (select x->>'ref' from jsonb_array_elements(mios) x where x->>'tipo' = 'devuelto') <> u.empresa::text || ':PM-GB60-DEV'
     or (select x->>'titulo' from jsonb_array_elements(mios) x where x->>'tipo' = 'mandato_sin_firmar') <> 'Mandato sin firmar desde hace 8 días'
     or (select x->>'titulo' from jsonb_array_elements(mios) x where x->>'tipo' = 'peticion_portal') not like 'Alta pedida en el portal: Diego Prueba Ferrer, desde el __/__'
     or (select (x->>'laboral')::boolean from jsonb_array_elements(mios) x where x->>'tipo' = 'peticion_portal') is not true then
    raise exception 'PRUEBA GB-0060 · 1: los títulos o a quién no son los esperados (%).', mios;
  end if;
  -- 2 · La cuenta con su CRM real, nada.
  if exists (select 1 from jsonb_array_elements(r->'abrir') x where (x->>'cuenta')::uuid = u.real_cuenta) then
    raise exception 'PRUEBA GB-0060 · 2: una cuenta con su CRM real no puede salir.';
  end if;
  update _r set r = mios where paso = 'uno';
end $$;

-- 3 · Apuntadas (como la función), no vuelven a salir.
set local role service_role;
do $$ declare x jsonb; begin
  for x in select jsonb_array_elements(r) from _r where paso = 'uno' loop
    perform public.conta_bitrix_pestana_aviso_apuntar(x || jsonb_build_object('estado', 'abierta', 'bitrix_id', '9' || length(x->>'ref')));
  end loop;
  insert into _r select 'dos', public.conta_bitrix_pestana_avisos_por_hacer(500);
end $$;
reset role;
do $$
declare u record; r jsonb := (select x.r from _r x where x.paso = 'dos');
begin
  select * into u from _u;
  if exists (select 1 from jsonb_array_elements(r->'abrir') x where (x->>'cuenta')::uuid = u.cuenta)
     or exists (select 1 from jsonb_array_elements(r->'cerrar') x where (x->>'cuenta')::uuid = u.cuenta) then
    raise exception 'PRUEBA GB-0060 · 3: apuntadas y sin resolver, no tenían que salir (%).', r;
  end if;
  -- Se resuelven las tres.
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe) values (u.empresa, 'PM-GB60-OTRA', u.cuenta, 'MD-GB60', 'paid_out', current_date - 1, 225.00);
  update public.conta_gc_mandato set estado = 'active' where gc_id = 'MD-GB60-PEND';
  update public.conta_solicitud set estado = 'hecha', resuelta_at = now() where id = u.pedida;
end $$;
set local role service_role;
insert into _r select 'tres', public.conta_bitrix_pestana_avisos_por_hacer(500);
reset role;
do $$
declare u record; r jsonb := (select x.r from _r x where x.paso = 'tres'); n int;
begin
  select * into u from _u;
  select count(*) into n from jsonb_array_elements(r->'cerrar') x where (x->>'cuenta')::uuid = u.cuenta;
  if n <> 3 then raise exception 'PRUEBA GB-0060 · 3: resueltas, tenían que salir las 3 para cerrar (%).', r->'cerrar'; end if;
  perform public.conta_bitrix_pestana_aviso_apuntar(jsonb_build_object('id', x->>'id', 'estado', 'cerrada'))
     from jsonb_array_elements(r->'cerrar') x where (x->>'cuenta')::uuid = u.cuenta;
  if exists (select 1 from jsonb_array_elements(public.conta_bitrix_pestana_avisos_por_hacer(500)->'cerrar') x where (x->>'cuenta')::uuid = u.cuenta)
     or (select count(*) from public.conta_bitrix_pestana_aviso where account_id = u.cuenta and estado = 'cerrada' and cerrada_at is not null) <> 3 then
    raise exception 'PRUEBA GB-0060 · 3: cerradas, no tenían que volver a salir.';
  end if;
  -- 4 · Solo el servidor.
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_avisos_por_hacer(int)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_pestana_aviso_apuntar(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_pestana_avisos_despertar()', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_avisos_por_hacer(int)', 'execute') then
    raise exception 'PRUEBA GB-0060 · 4: no es solo del servidor.';
  end if;
  raise notice 'GB-0060 · 1 a 4: devuelto, mandato sin firmar a los 7 días y alta pedida, solo de pruebas, una vez, se cierran al resolverse, solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T0060_gb_bitrix_avisos.down.sql
do $$ begin
  if to_regclass('public.conta_bitrix_pestana_aviso') is not null or to_regprocedure('public.conta_bitrix_pestana_avisos_por_hacer(int)') is not null then
    raise exception 'PRUEBA GB-0060 · 4: la vuelta atrás no lo quita.';
  end if;
  raise notice 'GB-0060 · 4: la vuelta atrás lo quita. OK';
end $$;

rollback;
