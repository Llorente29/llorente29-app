-- supabase/staging/sql/20261110_gb_pestana_anadir_prueba.sql
--
-- SOLO STAGING. Prueba de la 1126 del GB (nº 17, G: «+ Añadir servicio o
-- paquete» desde la pestaña de Bitrix24). Necesita la 2345 (Code 3) y la 0930
-- (G04), que ya están en staging; si falta alguna, para y lo dice. Va después
-- de la 0950: si no está, la pasa antes (y lo que pide). Todo en ROLLBACK, datos
-- inventados (T11). Nombra el objeto que cambia: public.conta_bitrix_pestana_cambio.
--
--   1. El CHECK de conta_bitrix_pestana_cambio solo amplía: las acciones de
--      antes siguen valiendo, «servicio» también y otra no.
--   2. Con ensayo, solo la frase: no añade nada ni lo apunta.
--   3. De verdad: un servicio con su nivel (conta_linea) y un paquete
--      (conta_cliente_paquete), con la función del G04; apuntado con lo que
--      necesita la función para Bitrix24.
--   4. Quien solo puede ver no lo añade; un servicio con niveles sin nivel,
--      tampoco (lo dice); con los cambios de tarifa apagados, tampoco.
--   5. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1126: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_bitrix_quien(text,text,text,text)') is null
     or to_regprocedure('public.conta_tarifa_servicio_anadir(uuid,uuid,uuid,uuid,uuid,date,jsonb,boolean)') is null then
    raise exception 'PRUEBA GB-1126 · 0: faltan la 2345 (Code 3) o la 0930 (G04) en esta base.';
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
select pg_get_constraintdef(oid) not like '%suelto%' as falta_la_0950 from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check' \gset
\if :falta_la_0950
\i supabase/migrations/20261110T0950_gb_pestana_devuelto.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_anadir(text,text,text,text,uuid,uuid,uuid,uuid,date,boolean)') is not null as ya_esta_la_1126 \gset
\if :ya_esta_la_1126
\i supabase/vuelta-atras/20261110T1126_gb_pestana_anadir.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo,
       (select c.id from public.company c where c.account_id = p.account_id and c.is_active order by c.created_at limit 1) as empresa,
       null::uuid as cliente, null::uuid as servicio, null::uuid as nivel, null::uuid as paquete
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
   and exists (select 1 from public.company c where c.account_id = p.account_id and c.is_active)
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); e uuid := (select empresa from _u); c1 uuid; s uuid; nv uuid; pq uuid; ver uuid := 'b0000000-0000-4000-8000-000000001126';
begin
  if a is null or e is null then raise exception 'PRUEBA GB-1126 · 0: staging no tiene una persona con empresa.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-g.bitrix24.es', '{"campos":[]}')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.conta_gestoria_ajustes (company_id, account_id, mitad_de_mes, cambios_de_tarifa) values (e, a, 'mes_entero', true)
  on conflict (company_id) do update set cambios_de_tarifa = true;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 1126, S.L.', 'B00001126') returning id into c1;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '91126', '', c1, 'activo', '{}');
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'gb1126_fiscal', 'Fiscal de prueba GB 1126', 'fijo_mes') returning id into s;
  insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden) values (a, e, s, 'Básica', 1) returning id into nv;
  insert into public.conta_paquete (account_id, company_id, nombre) values (a, e, 'Paquete de prueba GB 1126') returning id into pq;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', ver, 'authenticated', 'authenticated', 'solo.ver.1126@gb-prueba.test',
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.user_profiles (user_id, account_id, role, active, display_name) values (ver, a, 'worker', true, 'Solo ver GB 1126');
  update _u set cliente = c1, servicio = s, nivel = nv, paquete = pq;
end $$;

\i supabase/migrations/20261110T1126_gb_pestana_anadir.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record; p text := 'gb-prueba-g.bitrix24.es'; m date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  insert into _r values ('ensayo', public.conta_bitrix_pestana_anadir(p, u.correo, 'empresa', '91126', u.empresa, u.servicio, u.nivel, null, m, true));
  insert into _r values ('servicio', public.conta_bitrix_pestana_anadir(p, u.correo, 'empresa', '91126', u.empresa, u.servicio, u.nivel, null, m, false));
  insert into _r values ('paquete', public.conta_bitrix_pestana_anadir(p, u.correo, 'empresa', '91126', u.empresa, null, null, u.paquete, m, false));
  insert into _r values ('ver', public.conta_bitrix_pestana_anadir(p, 'solo.ver.1126@gb-prueba.test', 'empresa', '91126', u.empresa, u.servicio, u.nivel, null, m, false));
  insert into _r values ('sin_nivel', public.conta_bitrix_pestana_anadir(p, u.correo, 'empresa', '91126', u.empresa, u.servicio, null, null, m, false));
end $$;
reset role;
update public.conta_gestoria_ajustes set cambios_de_tarifa = false where company_id = (select empresa from _u);
set local role service_role;
do $$
declare u record; m date := (date_trunc('month', current_date) + interval '1 month')::date;
begin
  select * into u from _u;
  insert into _r values ('apagado', public.conta_bitrix_pestana_anadir('gb-prueba-g.bitrix24.es', u.correo, 'empresa', '91126', u.empresa, u.servicio, u.nivel, null, m, false));
end $$;
reset role;

do $$
declare u record; en jsonb := (select x.r from _r x where x.paso = 'ensayo'); sv jsonb := (select x.r from _r x where x.paso = 'servicio');
        pq jsonb := (select x.r from _r x where x.paso = 'paquete'); def text;
begin
  select * into u from _u;
  -- 1 · El CHECK solo amplía.
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check';
  if def not like '%''alta''%' or def not like '%''deshacer''%' or def not like '%''suelto''%' or def not like '%''servicio''%' then
    raise exception 'PRUEBA GB-1126 · 1: el CHECK no tiene lo de antes y «servicio» (%).', def;
  end if;
  begin
    insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, datos, frase, hecho_por, hecho_por_nombre)
    values (u.cuenta, u.cliente, 'empresa', '91126', 'otra', '{}', 'x', u.usuario, 'Prueba');
    raise exception 'PRUEBA GB-1126 · 1: el CHECK deja pasar otra acción.';
  exception when check_violation then null;
  end;
  -- 2 · Con ensayo, solo la frase.
  if en->>'estado' <> 'ok' or not (en->>'ensayo')::boolean or en->>'frase' not like 'Se añadirá Fiscal de prueba GB 1126%Cliente Prueba GB 1126, S.L.%a precio de tarifa.' then
    raise exception 'PRUEBA GB-1126 · 2: el ensayo no es lo esperado (%).', en;
  end if;
  -- 3 · De verdad: el servicio con su nivel y el paquete, apuntados.
  if sv->>'estado' <> 'ok' or sv->>'frase' not like 'Añadido Fiscal de prueba GB 1126%' or not (sv ? 'bitrix') or sv->>'cliente' <> u.cliente::text
     or not exists (select 1 from public.conta_linea where id = (sv->>'id')::uuid and party_id = u.cliente and servicio_id = u.servicio and nivel_id = u.nivel)
     or not exists (select 1 from public.conta_bitrix_pestana_cambio where id = (sv->>'cambio')::uuid and accion = 'servicio' and resultado_id = (sv->>'id')::uuid) then
    raise exception 'PRUEBA GB-1126 · 3: el servicio no es lo esperado (%).', sv;
  end if;
  if pq->>'estado' <> 'ok' or not exists (select 1 from public.conta_cliente_paquete where id = (pq->>'id')::uuid and party_id = u.cliente and paquete_id = u.paquete) then
    raise exception 'PRUEBA GB-1126 · 3: el paquete no es lo esperado (%).', pq;
  end if;
  if (select count(*) from public.conta_bitrix_pestana_cambio where party_id = u.cliente and accion = 'servicio') <> 2 then
    raise exception 'PRUEBA GB-1126 · 2/3: el ensayo ha apuntado algo, o falta algo por apuntar.';
  end if;
  -- 4 · Solo ver, sin nivel y apagado.
  if (select x.r->>'estado' from _r x where x.paso = 'ver') <> 'sin_permiso'
     or (select x.r->>'frase' from _r x where x.paso = 'sin_nivel') <> 'Ese servicio tiene niveles: elige uno.'
     or (select x.r->>'estado' from _r x where x.paso = 'apagado') <> 'sin_permiso'
     or (select x.r->>'frase' from _r x where x.paso = 'apagado') not like 'Los cambios de precios y de servicios aún no están encendidos%' then
    raise exception 'PRUEBA GB-1126 · 4: solo ver, sin nivel o apagado no son lo esperado (%).', (select jsonb_object_agg(x.paso, x.r) from _r x where x.paso in ('ver', 'sin_nivel', 'apagado'));
  end if;
  -- 5 · Solo el servidor.
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_anadir(text,text,text,text,uuid,uuid,uuid,uuid,date,boolean)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_anadir(text,text,text,text,uuid,uuid,uuid,uuid,date,boolean)', 'execute') then
    raise exception 'PRUEBA GB-1126 · 5: no es solo del servidor.';
  end if;
  raise notice 'GB-1126 · 1 a 5: el CHECK solo amplía, el ensayo solo dice, el servicio con su nivel y el paquete con la función del G04 y apuntados, solo ver, sin nivel y apagado no, y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T1126_gb_pestana_anadir.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_anadir(text,text,text,text,uuid,uuid,uuid,uuid,date,boolean)') is not null
     or (select pg_get_constraintdef(oid) like '%servicio%' from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check') then
    raise exception 'PRUEBA GB-1126 · 5: la vuelta atrás no lo quita.';
  end if;
  raise notice 'GB-1126 · 5: la vuelta atrás lo quita. OK';
end $$;

rollback;
