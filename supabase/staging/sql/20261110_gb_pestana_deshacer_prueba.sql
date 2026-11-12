-- supabase/staging/sql/20261110_gb_pestana_deshacer_prueba.sql
--
-- SOLO STAGING. Prueba de la 0070 del GB («Deshacer» en la pestaña de Bitrix24,
-- con las funciones de Code 1). Va después de la 2235, la 2250, la 2300 y la
-- 0010 (#562): si no están, las pasa antes. Todo en ROLLBACK, datos inventados (T11).
--
--   1. Un alta desde la pestaña; lo hecho hoy, con «se puede deshacer».
--   2. Deshacer: la línea ya no está y queda apuntado («deshacer»), con lo que
--      necesita la función para Bitrix24. Otra vez: «Eso ya está deshecho.»
--   3. Quien solo puede ver no deshace; una empresa de otra cuenta, tampoco.
--   4. Solo el servidor; las acciones de antes siguen; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-0070: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select pg_get_constraintdef(oid) not like '%tarifa%' as falta_la_2250 from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check' \gset
\if :falta_la_2250
\i supabase/migrations/20261109T2250_gb_pestana_tarifa.sql
\endif
select to_regprocedure('public._conta_bitrix_pestana_bitrix_de(uuid,text,text)') is null as falta_la_2300 \gset
\if :falta_la_2300
\i supabase/migrations/20261109T2300_gb_pestana_portal.sql
\endif
select to_regprocedure('public.conta_linea_deshacer(uuid,uuid,timestamptz)') is null as falta_la_0010 \gset
\if :falta_la_0010
\i supabase/migrations/20261110T0010_g05_deshacer_lineas.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)') is not null as ya_esta_la_0070 \gset
\if :ya_esta_la_0070
\i supabase/vuelta-atras/20261110T0070_gb_pestana_deshacer.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       (select c.id from public.company c where c.account_id <> p.account_id order by c.created_at limit 1) as otra_empresa,
       null::uuid as cliente, null::uuid as servicio
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; s uuid; ver uuid := 'b0000000-0000-4000-8000-000000000070';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-0070 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es',
    '{"campos":[{"codigo":"UF_CRM_CUOTA_PRUEBA","campo":"cuota_referencia","etiqueta":"Cuota mensual"}]}')
  on conflict (account_id, crm) do update set portal = excluded.portal, mapa = excluded.mapa;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 0070, S.L.', 'B00000070') returning id into c1;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '90070', '', c1, 'activo', '{"cuotasReferencia":[{"etiqueta":"Cuota mensual","importeCent":22500,"texto":"225,00"}]}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'laboral gb 0070', 'Laboral de prueba GB 0070', 'por_empleado') returning id into s;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.0070@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 0070');
  update _u set cliente = c1, servicio = s;
end $$;

\i supabase/migrations/20261110T0070_gb_pestana_deshacer.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record; r jsonb; ops jsonb; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  -- 1 · Un alta y lo hecho hoy.
  r := public.conta_bitrix_pestana_hacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90070', 'alta',
         jsonb_build_object('empresa', u.empresa, 'servicio', u.servicio, 'nombre', 'Ana Prueba Deshacer', 'desde', mes));
  insert into _r values ('alta', r);
  if r->>'estado' <> 'ok' then raise exception 'PRUEBA GB-0070 · 1: el alta no se ha hecho (%).', r; end if;
  r := public.conta_bitrix_pestana_deshacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90070', u.empresa);
  ops := r->'operaciones';
  if r->>'estado' <> 'ok' or jsonb_array_length(ops) <> 1 or ops->0->>'tipo' <> 'alta' or (ops->0->>'puede')::boolean is not true then
    raise exception 'PRUEBA GB-0070 · 1: lo hecho hoy no es lo esperado (%).', r;
  end if;
  insert into _r values ('ops', r);
  -- 3 · Solo ver, y una empresa de otra cuenta.
  r := public.conta_bitrix_pestana_deshacer('gb-prueba-a.bitrix24.es', 'solo.ver.0070@gb-prueba.test', 'empresa', '90070', u.empresa, (ops->0->>'cuando')::timestamptz);
  if r->>'estado' <> 'sin_permiso' then raise exception 'PRUEBA GB-0070 · 3: solo ver tenía que dar sin_permiso (%).', r; end if;
  if u.otra_empresa is not null then
    r := public.conta_bitrix_pestana_deshacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90070', u.otra_empresa, (ops->0->>'cuando')::timestamptz);
    if r->>'estado' <> 'no_se_pudo' then raise exception 'PRUEBA GB-0070 · 3: la empresa de otra cuenta tenía que fallar (%).', r; end if;
  end if;
  -- 2 · Deshacer, y otra vez.
  r := public.conta_bitrix_pestana_deshacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90070', u.empresa, (ops->0->>'cuando')::timestamptz);
  insert into _r values ('deshacer', r);
  if r->>'estado' <> 'ok' or r->>'frase' not like 'Deshecho: %' or r->>'tipo' <> 'alta'
     or r->'bitrix' <> jsonb_build_object('campo', 'UF_CRM_CUOTA_PRUEBA', 'conocida', '225,00', 'escrita', null) then
    raise exception 'PRUEBA GB-0070 · 2: deshacer no es lo esperado (%).', r;
  end if;
  r := public.conta_bitrix_pestana_deshacer('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90070', u.empresa, (ops->0->>'cuando')::timestamptz);
  if r->>'estado' <> 'no_se_pudo' or r->>'frase' <> 'Eso ya está deshecho.' then raise exception 'PRUEBA GB-0070 · 2: dos veces no (%).', r; end if;
end $$;
reset role;
do $$
declare u record; l uuid := (select (x.r->>'id')::uuid from _r x where x.paso = 'alta');
begin
  select * into u from _u;
  if exists (select 1 from public.conta_linea where id = l) then raise exception 'PRUEBA GB-0070 · 2: la línea del alta sigue ahí.'; end if;
  if not exists (select 1 from public.conta_bitrix_pestana_cambio where party_id = u.cliente and accion = 'deshacer' and datos->>'tipo' = 'alta' and frase like 'Deshecho: %') then
    raise exception 'PRUEBA GB-0070 · 2: no ha quedado apuntado.';
  end if;
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)', 'execute') then
    raise exception 'PRUEBA GB-0070 · 4: no es solo del servidor.';
  end if;
  raise notice 'GB-0070 · 1 a 4: lo hecho hoy, deshacer con la función de Code 1 (una vez), solo ver y otra empresa no, apuntado y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T0070_gb_pestana_deshacer.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)') is not null
     or exists (select 1 from public.conta_bitrix_pestana_cambio where accion = 'deshacer') then
    raise exception 'PRUEBA GB-0070 · 4: la vuelta atrás no lo quita.';
  end if;
  raise notice 'GB-0070 · 4: la vuelta atrás lo quita. OK';
end $$;

rollback;
