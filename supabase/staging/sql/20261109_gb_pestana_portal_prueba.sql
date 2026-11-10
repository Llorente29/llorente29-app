-- supabase/staging/sql/20261109_gb_pestana_portal_prueba.sql
--
-- SOLO STAGING. Prueba de la 2300 del GB (nº 9, punto 5: «Su portal» en la
-- pestaña de Bitrix24). Va después de la 2235 (#549): si no está, la pasa antes.
-- Todo en ROLLBACK, con datos inventados (T11).
--
--   1. Leer: quién entra (sin los que se quitaron), lo que pide el cliente
--      (solo lo pedido) y los mensajes sin leer, con la función de Code 3.
--   2. «Hacerla»: un alta pedida desde el portal se hace con la función de
--      Code 3 (la línea con origen «solicitud») y queda apuntada, con lo que
--      necesita la función para la cuota de Bitrix24.
--   3. Quien solo puede ver no la hace; una petición de otro cliente, tampoco.
--   4. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-2300: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_portal(text,text,text,text,uuid,uuid)') is not null as ya_esta_la_2300 \gset
\if :ya_esta_la_2300
\i supabase/vuelta-atras/20261109T2300_gb_pestana_portal.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as servicio, null::uuid as pedida, null::uuid as de_otro
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; c2 uuid; s uuid; q1 uuid; q2 uuid;
        ver uuid := 'b0000000-0000-4000-8000-000000002300'; mes date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  if a is null or e is null then raise exception 'PRUEBA GB-2300 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-a.bitrix24.es',
    '{"campos":[{"codigo":"UF_CRM_CUOTA_PRUEBA","campo":"cuota_referencia","etiqueta":"Cuota mensual"}]}')
  on conflict (account_id, crm) do update set portal = excluded.portal, mapa = excluded.mapa;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 2300, S.L.', 'B00002300') returning id into c1;
  insert into public.party (account_id, name, tax_id) values (a, 'Otro Cliente Prueba GB 2300, S.L.', 'B00002301') returning id into c2;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '92300', '', c1, 'activo', '{"cuotasReferencia":[{"etiqueta":"Cuota mensual","importeCent":22500,"texto":"225,00"}]}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'laboral gb 2300', 'Laboral de prueba GB 2300', 'por_empleado') returning id into s;
  insert into public.conta_portal_acceso (account_id, party_id, correo, nombre, permiso, invitado_at) values
    (a, c1, 'cliente.prueba@gb-prueba.test', 'Persona Prueba Portal', 'todo', now()),
    (a, c1, 'quitado.prueba@gb-prueba.test', 'Persona Quitada Prueba', 'todo', now());
  update public.conta_portal_acceso set revocado_at = now(), revocado_por_name = 'Prueba' where correo = 'quitado.prueba@gb-prueba.test';
  insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, estado, pedida_at)
  values (a, e, c1, 'alta', 'Diego Prueba Ferrer', mes, 'pedida', now()) returning id into q1;
  insert into public.conta_solicitud (account_id, company_id, party_id, tipo, empleado_nombre, mes, estado, pedida_at)
  values (a, e, c2, 'alta', 'De Otro Prueba', mes, 'pedida', now()) returning id into q2;
  insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto) values (a, c1, 'cliente', 'Persona Prueba Portal', '¿Me mandáis el modelo de prueba?');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.2300@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 2300');
  update _u set cliente = c1, servicio = s, pedida = q1, de_otro = q2;
end $$;

\i supabase/migrations/20261109T2300_gb_pestana_portal.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;

do $$
declare u record; r jsonb;
begin
  select * into u from _u;
  -- 1 · Leer.
  r := public.conta_bitrix_pestana_portal('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92300');
  if r->>'estado' <> 'ok' or jsonb_array_length(r->'accesos') <> 1 or r->'accesos'->0->>'nombre' <> 'Persona Prueba Portal'
     or jsonb_array_length(r->'solicitudes') <> 1 or r->'solicitudes'->0->>'nombre' <> 'Diego Prueba Ferrer' or (r->>'mensajes_sin_leer')::int <> 1 then
    raise exception 'PRUEBA GB-2300 · 1: lo leído no es lo esperado (%).', r;
  end if;
  -- 3 · Solo ver, y la petición de otro cliente.
  r := public.conta_bitrix_pestana_portal('gb-prueba-a.bitrix24.es', 'solo.ver.2300@gb-prueba.test', 'empresa', '92300', u.pedida, u.servicio);
  if r->>'estado' <> 'sin_permiso' then raise exception 'PRUEBA GB-2300 · 3: solo ver tenía que dar sin_permiso (%).', r; end if;
  r := public.conta_bitrix_pestana_portal('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92300', u.de_otro, u.servicio);
  if r->>'estado' <> 'no_se_pudo' then raise exception 'PRUEBA GB-2300 · 3: la petición de otro cliente tenía que fallar (%).', r; end if;
  -- 2 · Hacerla.
  r := public.conta_bitrix_pestana_portal('gb-prueba-a.bitrix24.es', u.correo, 'empresa', '92300', u.pedida, u.servicio);
  insert into _r values ('hacer', r);
  if r->>'estado' <> 'ok' or r->>'frase' not like 'Alta de DIEGO PRUEBA FERRER%Al cliente le sale como hecha en su portal.' or r->>'tipo' <> 'alta'
     or r->'bitrix' <> jsonb_build_object('campo', 'UF_CRM_CUOTA_PRUEBA', 'conocida', '225,00', 'escrita', null) then
    raise exception 'PRUEBA GB-2300 · 2: «Hacerla» no es lo esperado (%).', r;
  end if;
end $$;
reset role;
do $$
declare u record; l uuid := (select (r->>'id')::uuid from _r where paso = 'hacer');
begin
  select * into u from _u;
  if not exists (select 1 from public.conta_linea where id = l and party_id = u.cliente and origen = 'solicitud' and empleado_nombre = 'DIEGO PRUEBA FERRER') then
    raise exception 'PRUEBA GB-2300 · 2: no está la línea de la petición.';
  end if;
  if (select estado from public.conta_solicitud where id = u.pedida) <> 'hecha' or (select estado from public.conta_solicitud where id = u.de_otro) <> 'pedida' then
    raise exception 'PRUEBA GB-2300 · 2-3: las peticiones no están como deben.';
  end if;
  if not exists (select 1 from public.conta_bitrix_pestana_cambio where party_id = u.cliente and accion = 'alta' and datos->>'solicitud' = u.pedida::text) then
    raise exception 'PRUEBA GB-2300 · 2: no ha quedado apuntado.';
  end if;
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_portal(text,text,text,text,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_portal(text,text,text,text,uuid,uuid)', 'execute') then
    raise exception 'PRUEBA GB-2300 · 4: no es solo del servidor.';
  end if;
  raise notice 'GB-2300 · 1 a 4: leer el portal, «Hacerla» con la función de Code 3, solo ver y otro cliente no, solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261109T2300_gb_pestana_portal.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_portal(text,text,text,text,uuid,uuid)') is not null then raise exception 'PRUEBA GB-2300 · 4: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-2300 · 4: la vuelta atrás la quita. OK';
end $$;

rollback;
