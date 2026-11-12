-- supabase/staging/sql/20261110_gb_pestana_devuelto_prueba.sql
--
-- SOLO STAGING. Prueba de la 0950 del GB (nº 17, A: el recibo devuelto en la
-- pestaña de Bitrix24). Necesita la 2345 (Code 3) y la 0055 (Code 1), que ya
-- están en staging; si falta alguna, para y lo dice. Va después de la 0070:
-- si no está, la pasa antes. Todo en ROLLBACK, con datos inventados (T11).
--
--   1. Los devueltos del cliente de la ficha (no los cobrados ni los de otro
--      cliente), con lo que se puede hacer con cada uno y por qué no, y si la
--      persona puede (administradora o encargada); quien solo puede ver, no.
--   2. Lo hecho (después de conta-cobro) queda apuntado con lo que necesita la
--      función para Bitrix24; un recibo de otro cliente, no.
--   3. Las acciones de antes siguen; solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-0950: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_bitrix_quien(text,text,text,text)') is null or to_regprocedure('public._conta_recibo_devuelto_opciones(uuid)') is null then
    raise exception 'PRUEBA GB-0950 · 0: faltan la 2345 (Code 3) o la 0055 (Code 1) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select to_regprocedure('public._conta_bitrix_pestana_bitrix_de(uuid,text,text)') is null as falta_la_2300 \gset
\if :falta_la_2300
\i supabase/migrations/20261109T2300_gb_pestana_portal.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)') is null as falta_la_0070 \gset
\if :falta_la_0070
\i supabase/migrations/20261110T0070_gb_pestana_deshacer.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_devueltos(text,text,text,text)') is not null as ya_esta_la_0950 \gset
\if :ya_esta_la_0950
\i supabase/vuelta-atras/20261110T0950_gb_pestana_devuelto.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as otro, null::uuid as dev, null::uuid as de_otro
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; r1 uuid; r2 uuid;
        ver uuid := 'b0000000-0000-4000-8000-000000000950';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-0950 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es', '{"campos":[]}')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 0950, S.L.', 'B00000950') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Otro Cliente Prueba GB 0950, S.L.', 'B00000951') returning id into c2;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '90950', '', c1, 'activo', '{}');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado) values
    (a, e, c1, '2026-10', 'recibo:' || e || ':' || c1 || ':2026-10', 22500, 'devuelto') returning id into r1;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado) values
    (a, e, c1, '2026-09', 'recibo:' || e || ':' || c1 || ':2026-09', 22500, 'cobrado');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado) values
    (a, e, c2, '2026-10', 'recibo:' || e || ':' || c2 || ':2026-10', 9900, 'devuelto') returning id into r2;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.0950@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 0950');
  update _u set cliente = c1, otro = c2, dev = r1, de_otro = r2;
end $$;

\i supabase/migrations/20261110T0950_gb_pestana_devuelto.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record;
begin
  select * into u from _u;
  insert into _r values ('ver', public.conta_bitrix_pestana_devueltos('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90950'));
  insert into _r values ('solo_ver', public.conta_bitrix_pestana_devueltos('gb-prueba-a.bitrix24.es', 'solo.ver.0950@gb-prueba.test', 'empresa', '90950'));
  insert into _r values ('hecho', public.conta_bitrix_pestana_devuelto_hecho('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90950', u.dev, 'enlace', 'Enviado el enlace para pagar a prueba.'));
  insert into _r values ('de_otro', public.conta_bitrix_pestana_devuelto_hecho('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90950', u.de_otro, 'enlace', 'x'));
  insert into _r values ('raro', public.conta_bitrix_pestana_devuelto_hecho('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '90950', u.dev, 'borrar', 'x'));
end $$;
reset role;

do $$
declare u record; v jsonb := (select x.r from _r x where x.paso = 'ver'); s jsonb := (select x.r from _r x where x.paso = 'solo_ver');
        h jsonb := (select x.r from _r x where x.paso = 'hecho');
begin
  select * into u from _u;
  -- 1 · Solo el devuelto de este cliente, con lo que se puede hacer y por qué no.
  if v->>'estado' <> 'ok' or (v->>'puede')::boolean is not true or jsonb_array_length(v->'devueltos') <> 1
     or v->'devueltos'->0->>'recibo_id' <> u.dev::text or (v->'devueltos'->0->'enlace'->>'puede')::boolean
     or v->'devueltos'->0->'enlace'->>'porque' <> 'Nadie de este cliente puede pagar en su espacio: invítalo primero.'
     or (v->'devueltos'->0->'pasar'->>'puede')::boolean or v->>'usuario' <> u.usuario::text then
    raise exception 'PRUEBA GB-0950 · 1: los devueltos no son los esperados (%).', v;
  end if;
  if s->>'estado' <> 'ok' or (s->>'puede')::boolean then raise exception 'PRUEBA GB-0950 · 1: quien solo puede ver no puede (%).', s; end if;
  -- 2 · Lo hecho, apuntado; otro cliente o una acción rara, no.
  if h->>'estado' <> 'ok' or h->>'cliente' <> u.cliente::text or h->>'empresa' <> u.empresa::text or not (h ? 'bitrix') then
    raise exception 'PRUEBA GB-0950 · 2: lo hecho no es lo esperado (%).', h;
  end if;
  if not exists (select 1 from public.conta_bitrix_pestana_cambio where id = (h->>'cambio')::uuid and accion = 'devuelto' and datos->>'que' = 'enlace'
                   and datos->>'recibo' = u.dev::text and frase = 'Enviado el enlace para pagar a prueba.') then
    raise exception 'PRUEBA GB-0950 · 2: no ha quedado apuntado.';
  end if;
  if (select x.r->>'estado' from _r x where x.paso = 'de_otro') <> 'no_se_pudo' or (select x.r->>'estado' from _r x where x.paso = 'raro') <> 'no_se_pudo' then
    raise exception 'PRUEBA GB-0950 · 2: otro cliente o una acción rara tenían que fallar.';
  end if;
  -- 3 · Las de antes siguen; solo el servidor.
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, frase, hecho_por)
  values (u.cuenta, u.cliente, 'empresa', '90950', 'deshacer', 'Sigue', u.usuario);
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_devueltos(text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_devuelto_hecho(text,text,text,text,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.conta_bitrix_pestana_devuelto_hecho(text,text,text,text,uuid,text,text)', 'execute') then
    raise exception 'PRUEBA GB-0950 · 3: no es solo del servidor.';
  end if;
  raise notice 'GB-0950 · 1 a 3: los devueltos de la ficha con lo que se puede hacer, quién puede, lo hecho apuntado, otro cliente no, las acciones de antes y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T0950_gb_pestana_devuelto.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_devueltos(text,text,text,text)') is not null
     or exists (select 1 from public.conta_bitrix_pestana_cambio where accion in ('devuelto', 'suelto')) then
    raise exception 'PRUEBA GB-0950 · 3: la vuelta atrás no lo quita.';
  end if;
  raise notice 'GB-0950 · 3: la vuelta atrás lo quita. OK';
end $$;

rollback;
