-- supabase/staging/sql/20261110_gb_pestana_mensajes_prueba.sql
--
-- SOLO STAGING. Prueba de la 1040 del GB (nº 17, C: los mensajes del portal con
-- su texto en la pestaña de Bitrix24). Necesita la 2345 (Code 3), que ya está
-- en staging; si falta, para y lo dice. Todo en ROLLBACK, datos inventados (T11).
--
--   1. Los últimos 6 mensajes, del más antiguo al más nuevo, con su texto
--      (hasta 600 letras), quién y si está leído; leerlos no los marca.
--   2. «Contestar» con la de Code 3: sale en lo leído después y lo del cliente
--      queda leído.
--   3. Una ficha sin enlazar o alguien de fuera: no enseña nada.
--   4. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role) y dentro actúa como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-1040: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_portal_bitrix_quien(text,text,text,text)') is null or to_regprocedure('public.conta_portal_bitrix_contestar(text,text,text,text,text)') is null then
    raise exception 'PRUEBA GB-1040 · 0: falta la 2345 (Code 3) en esta base.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_bitrix_pestana_mensajes(text,text,text,text)') is not null as ya_esta_la_1040 \gset
\if :ya_esta_la_1040
\i supabase/vuelta-atras/20261110T1040_gb_pestana_mensajes.down.sql
\endif

create temp table _u on commit drop as
select p.account_id as cuenta, p.user_id as usuario, lower(u.email) as correo, null::uuid as cliente
  from public.user_profiles p join auth.users u on u.id = p.user_id
 where p.active and p.role in ('admin', 'manager') and u.email is not null
 order by p.created_at limit 1;

do $$
declare a uuid := (select cuenta from _u); c1 uuid; i int;
begin
  if a is null then raise exception 'PRUEBA GB-1040 · 0: staging no tiene una persona administradora.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa) values (a, 'bitrix24', 'pruebas', 'gb-prueba-c.bitrix24.es', '{"campos":[]}')
  on conflict (account_id, crm) do update set portal = excluded.portal;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 1040, S.L.', 'B00001040') returning id into c1;
  insert into public.conta_gestoria_ficha (account_id, crm, tipo_ficha, id_externo, de_empresa, party_id, situacion, ficha)
  values (a, 'bitrix24', 'empresa', '91040', '', c1, 'activo', '{}');
  for i in 1..8 loop
    insert into public.conta_portal_mensaje (account_id, party_id, de, autor_nombre, texto, created_at)
    values (a, c1, case when i % 2 = 0 then 'cliente' else 'gestoria' end, case when i % 2 = 0 then 'Persona Prueba' else 'Gestoría Prueba' end,
            case when i = 8 then repeat('x', 700) else 'Mensaje de prueba ' || i end, now() - make_interval(mins => 100 - i));
  end loop;
  update _u set cliente = c1;
end $$;

\i supabase/migrations/20261110T1040_gb_pestana_mensajes.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record; p text := 'gb-prueba-c.bitrix24.es';
begin
  select * into u from _u;
  insert into _r values ('leer', public.conta_bitrix_pestana_mensajes(p, u.correo, 'empresa', '91040'));
  insert into _r values ('sin_enlazar', public.conta_bitrix_pestana_mensajes(p, u.correo, 'empresa', '91999'));
  insert into _r values ('de_fuera', public.conta_bitrix_pestana_mensajes(p, 'nadie.1040@gb-prueba.test', 'empresa', '91040'));
  insert into _r values ('contestar', public.conta_portal_bitrix_contestar(p, u.correo, 'empresa', '91040', 'Respuesta de prueba GB 1040'));
  insert into _r values ('despues', public.conta_bitrix_pestana_mensajes(p, u.correo, 'empresa', '91040'));
end $$;
reset role;

do $$
declare u record; l jsonb := (select x.r from _r x where x.paso = 'leer'); d jsonb := (select x.r from _r x where x.paso = 'despues');
begin
  select * into u from _u;
  -- 1 · Los últimos 6, en orden, con su texto recortado, y sin marcarlos.
  if l->>'estado' <> 'ok' or (l->>'total')::int <> 8 or jsonb_array_length(l->'mensajes') <> 6
     or l->'mensajes'->0->>'texto' <> 'Mensaje de prueba 3' or length(l->'mensajes'->5->>'texto') <> 600
     or l->'mensajes'->5->>'de' <> 'cliente' or l->'mensajes'->5->>'autor' <> 'Persona Prueba' or (l->'mensajes'->5->>'leido')::boolean then
    raise exception 'PRUEBA GB-1040 · 1: lo leído no es lo esperado (%).', l;
  end if;
  -- 2 · Contestar: sale el último y lo del cliente queda leído.
  if (select x.r->>'estado' from _r x where x.paso = 'contestar') <> 'ok' or (d->>'total')::int <> 9
     or d->'mensajes'->5->>'texto' <> 'Respuesta de prueba GB 1040' or d->'mensajes'->5->>'de' <> 'gestoria' or not (d->'mensajes'->4->>'leido')::boolean then
    raise exception 'PRUEBA GB-1040 · 2: contestar no es lo esperado (%, %).', (select x.r from _r x where x.paso = 'contestar'), d;
  end if;
  -- 3 · Sin enlazar o de fuera: nada.
  if (select x.r->>'estado' from _r x where x.paso = 'sin_enlazar') <> 'sin_enlazar' or (select x.r->>'estado' from _r x where x.paso = 'de_fuera') <> 'sin_acceso'
     or (select x.r from _r x where x.paso = 'de_fuera') ? 'mensajes' then
    raise exception 'PRUEBA GB-1040 · 3: sin enlazar o de fuera no son lo esperado.';
  end if;
  -- 4 · Solo el servidor.
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_mensajes(text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_mensajes(text,text,text,text)', 'execute') then
    raise exception 'PRUEBA GB-1040 · 4: no es solo del servidor.';
  end if;
  raise notice 'GB-1040 · 1 a 4: los últimos 6 con su texto y sin marcarlos, contestar con la de Code 3, sin enlazar y de fuera no, y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T1040_gb_pestana_mensajes.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_mensajes(text,text,text,text)') is not null then raise exception 'PRUEBA GB-1040 · 4: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-1040 · 4: la vuelta atrás la quita. OK';
end $$;

rollback;
