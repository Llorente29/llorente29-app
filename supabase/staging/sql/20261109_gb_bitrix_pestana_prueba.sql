-- supabase/staging/sql/20261109_gb_bitrix_pestana_prueba.sql
--
-- SOLO STAGING. Prueba de la 1905 del GB (la pestaña «Sumied» en la ficha de
-- Bitrix24). Todo en una transacción con ROLLBACK, con datos inventados (T11):
-- no cambia staging.
--
--   1. Quien es de la cuenta, con su correo y su portal: ve el cliente de la
--      ficha de la empresa, con lo mismo que le daría la ficha del G04
--      (conta_pantalla_ficha y conta_pantalla_clientes como esa persona).
--   2. La ficha de una persona de contacto de esa empresa: el mismo cliente.
--   3. Nadie ve lo que no debe:
--      · un correo que no es de nadie de la cuenta: «sin_acceso», sin datos;
--      · una persona de la cuenta, pero dada de baja: «sin_acceso»;
--      · otro portal: «portal_desconocido»;
--      · una ficha de OTRA cuenta (con su número) desde este portal: «sin_enlazar»;
--      · la persona de esta cuenta con el portal de la otra: «sin_acceso»;
--      · una ficha que no existe: «sin_enlazar»; una ficha rara: «ficha_rara».
--   4. Solo el servidor: authenticated y anon no la pueden llamar (42501).
--   5. Solo lee: las huellas de las tablas de la ficha, igual antes y después.
--   6. La vuelta atrás: fuera la función.
--
-- sin usuario: sembrar lo inventado lo hace el servidor; la función la llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1905: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- Si la 1905 ya está (el aplicar de staging la pasa antes que esta prueba), primero su vuelta atrás.
select to_regprocedure('public.conta_bitrix_pestana_leer(text,text,text,text)') is not null as ya_esta_la_1905 \gset
\if :ya_esta_la_1905
\i supabase/vuelta-atras/20261109T1905_gb_bitrix_pestana.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       (select a.id from public.accounts a where a.id <> p.account_id order by a.created_at limit 1) as otra,
       null::uuid as cliente, null::uuid as cliente_otra
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); b uuid := (select otra from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; baja uuid := 'b0000000-0000-4000-8000-0000000019b1';
begin
  if a is null or e is null or b is null then raise exception 'PRUEBA GB-1905 · 0: staging no tiene una persona con empresa y otra cuenta.'; end if;
  -- Los dos portales inventados, uno por cuenta.
  insert into public.conta_crm (account_id, crm, entorno, portal) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.conta_crm (account_id, crm, entorno, portal) values (b, 'bitrix24', 'pruebas', 'gb-prueba-b.bitrix24.es')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  -- El cliente de la cuenta A, con su ficha de empresa (9001), una persona de contacto (9002) y su cobro.
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 1905, S.L.', 'B00001905') returning id into c1;
  insert into public.conta_gestoria_cliente (account_id, party_id, situacion, ficha, crm, tipo_ficha, id_externo)
  values (a, c1, 'activo', '{"telefonos":[],"correos":[]}', 'bitrix24', 'empresa', '99001');
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '99001', '', c1, 'activo', '{}'), (a, 'bitrix24', 'contacto', '99002', '99001', c1, null, '{}');
  insert into public.conta_cobro_cliente (account_id, company_id, party_id, forma_cobro, gc_cliente_id) values (a, e, c1, 'gocardless', 'CU1905PRUEBA') on conflict do nothing;
  insert into public.conta_gc_mandato (account_id, company_id, gc_id, gc_cliente_id, estado, creado) values (a, e, 'MD1905PRUEBA', 'CU1905PRUEBA', 'active', now());
  insert into public.conta_gc_cobro (account_id, company_id, gc_id, mandato_gc_id, estado, fecha, importe)
  values (a, e, 'PM1905PRUEBA', 'MD1905PRUEBA', 'paid_out', current_date - 3, 60.50);
  -- Un cliente de la cuenta B con su ficha 99100.
  insert into public.party (account_id, name, tax_id) values (b, 'Cliente Prueba GB 1905 Otra, S.L.', 'B00001906') returning id into c2;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (b, 'bitrix24', 'empresa', '99100', '', c2, 'activo', '{}');
  -- Una persona de la cuenta A, dada de baja.
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', baja, 'authenticated', 'authenticated', 'baja.prueba@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (baja, a, 'manager', false, 'Baja de prueba GB');
  update _u set cliente = c1, cliente_otra = c2;
end $$;

-- La huella de lo que se lee, antes (solo lee: tiene que salir igual después).
create temp table _antes on commit drop as
select (select md5(string_agg(to_jsonb(f)::text, '' order by f.account_id, f.tipo_ficha, f.id_externo, f.de_empresa)) from public.conta_gestoria_ficha f) as fichas,
       (select md5(string_agg(to_jsonb(g)::text, '' order by g.party_id)) from public.conta_gestoria_cliente g) as clientes,
       (select md5(string_agg(to_jsonb(c)::text, '' order by c.account_id, c.crm)) from public.conta_crm c) as crm;

\i supabase/migrations/20261109T1905_gb_bitrix_pestana.sql

grant select on _u to service_role, authenticated, anon;
set local role service_role;

-- 1 y 2 · Quien es de la cuenta.
do $$
declare u record; r jsonb; g jsonb;
begin
  select * into u from _u;
  r := public.conta_bitrix_pestana_leer('GB-Prueba-A.bitrix24.es', upper(u.correo), 'empresa', '99001');
  if r->>'estado' <> 'ok' or (r->>'cliente')::uuid <> u.cliente or (r->>'cuenta')::uuid <> u.cuenta then
    raise exception 'PRUEBA GB-1905 · 1: la persona de la cuenta no ve su cliente (%).', left(r::text, 300);
  end if;
  if jsonb_array_length(r->'ficha'->'cobros') <> 1 or r->'ficha'->'cobros'->0->>'gc_id' <> 'PM1905PRUEBA' then
    raise exception 'PRUEBA GB-1905 · 1: no salen los cobros de la ficha (%).', left((r->'ficha')::text, 300);
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'clientes'->'clientes') x where x->>'cliente_id' = u.cliente::text or x->>'party_id' = u.cliente::text or x->>'cliente' = 'Cliente Prueba GB 1905, S.L.') then
    raise exception 'PRUEBA GB-1905 · 1: el cliente no está en lo de Clientes.';
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'empresas') x where (x->>'id')::uuid = u.empresa) then
    raise exception 'PRUEBA GB-1905 · 1: faltan las empresas de la cuenta.';
  end if;
  -- Lo mismo que la ficha del G04 a esa persona.
  perform set_config('request.jwt.claims', json_build_object('sub', u.usuario, 'role', 'authenticated')::text, true);
  g := public.conta_pantalla_ficha(u.cuenta, u.cliente);
  perform set_config('request.jwt.claims', '', true);
  if g is distinct from r->'ficha' then raise exception 'PRUEBA GB-1905 · 1: la ficha no es la del G04.'; end if;
  raise notice 'GB-1905 · 1: la persona de la cuenta ve su cliente, con lo mismo que la ficha del G04. OK';

  r := public.conta_bitrix_pestana_leer('gb-prueba-a.bitrix24.es', u.correo, 'contacto', '99002');
  if r->>'estado' <> 'ok' or (r->>'cliente')::uuid <> u.cliente or r->>'de_empresa' <> '99001' then
    raise exception 'PRUEBA GB-1905 · 2: la persona de contacto no lleva a su empresa (%).', left(r::text, 300);
  end if;
  raise notice 'GB-1905 · 2: la persona de contacto lleva al cliente de su empresa. OK';
end $$;

-- 3 · Nadie ve lo que no debe.
do $$
declare u record; r jsonb; c record;
begin
  select * into u from _u;
  for c in select * from (values
      ('nadie',        'gb-prueba-a.bitrix24.es', 'nadie@gb-prueba.test',      'empresa', '99001', 'sin_acceso'),
      ('baja',         'gb-prueba-a.bitrix24.es', 'baja.prueba@gb-prueba.test', 'empresa', '99001', 'sin_acceso'),
      ('sin correo',   'gb-prueba-a.bitrix24.es', '',                           'empresa', '99001', 'sin_acceso'),
      ('otro portal',  'otro-portal.bitrix24.es', u.correo,                     'empresa', '99001', 'portal_desconocido'),
      ('ficha de B',   'gb-prueba-a.bitrix24.es', u.correo,                     'empresa', '99100', 'sin_enlazar'),
      ('portal de B',  'gb-prueba-b.bitrix24.es', u.correo,                     'empresa', '99100', 'sin_acceso'),
      ('no existe',    'gb-prueba-a.bitrix24.es', u.correo,                     'empresa', '99999', 'sin_enlazar'),
      ('tipo raro',    'gb-prueba-a.bitrix24.es', u.correo,                     'trato',   '99001', 'ficha_rara'),
      ('número raro',  'gb-prueba-a.bitrix24.es', u.correo,                     'empresa', '1 or 1=1', 'ficha_rara')
    ) x(caso, portal, correo, tipo, id, espera) loop
    r := public.conta_bitrix_pestana_leer(c.portal, c.correo, c.tipo, c.id);
    if r->>'estado' is distinct from c.espera then
      raise exception 'PRUEBA GB-1905 · 3 (%): esperaba «%» y sale «%».', c.caso, c.espera, r->>'estado';
    end if;
    if r ? 'ficha' or r ? 'clientes' or r ? 'cliente' then
      raise exception 'PRUEBA GB-1905 · 3 (%): sin acceso no puede salir ningún dato (%).', c.caso, left(r::text, 200);
    end if;
  end loop;
  -- Un «sin_acceso» detrás de un «ok» en la misma transacción tampoco lee nada.
  r := public.conta_bitrix_pestana_leer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '99001');
  r := public.conta_bitrix_pestana_leer('gb-prueba-a.bitrix24.es', 'nadie@gb-prueba.test', 'empresa', '99001');
  if r->>'estado' <> 'sin_acceso' or r ? 'ficha' then raise exception 'PRUEBA GB-1905 · 3: detrás de un «ok», un desconocido ve algo.'; end if;
  raise notice 'GB-1905 · 3: sin acceso, de otro portal o de otra cuenta, no sale nada (9 casos). OK';
end $$;

reset role;

-- 4 · Solo el servidor.
do $$
declare rol text;
begin
  foreach rol in array array['authenticated', 'anon'] loop
    if has_function_privilege(rol, 'public.conta_bitrix_pestana_leer(text,text,text,text)', 'execute') then
      raise exception 'PRUEBA GB-1905 · 4: % puede llamar a la función de la pestaña.', rol;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.conta_bitrix_pestana_leer(text,text,text,text)', 'execute') then
    raise exception 'PRUEBA GB-1905 · 4: el servidor no la puede llamar.';
  end if;
  raise notice 'GB-1905 · 4: solo el servidor la llama. OK';
end $$;

-- 5 · Solo lee.
do $$
declare x record;
begin
  select (select md5(string_agg(to_jsonb(f)::text, '' order by f.account_id, f.tipo_ficha, f.id_externo, f.de_empresa)) from public.conta_gestoria_ficha f) as fichas,
         (select md5(string_agg(to_jsonb(g)::text, '' order by g.party_id)) from public.conta_gestoria_cliente g) as clientes,
         (select md5(string_agg(to_jsonb(c)::text, '' order by c.account_id, c.crm)) from public.conta_crm c) as crm into x;
  if (x.fichas, x.clientes, x.crm) is distinct from (select (fichas, clientes, crm) from _antes) then
    raise exception 'PRUEBA GB-1905 · 5: algo ha cambiado al leer.';
  end if;
  raise notice 'GB-1905 · 5: las fichas, los clientes y la conexión, igual antes y después. OK';
end $$;

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261109T1905_gb_bitrix_pestana.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_leer(text,text,text,text)') is not null then raise exception 'PRUEBA GB-1905 · 6: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-1905 · 6: la vuelta atrás la quita. OK';
end $$;

rollback;
