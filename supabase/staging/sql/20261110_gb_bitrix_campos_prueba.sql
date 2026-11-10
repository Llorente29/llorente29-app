-- supabase/staging/sql/20261110_gb_bitrix_campos_prueba.sql
--
-- SOLO STAGING. Prueba de la 0040 del GB (nº 13, punto 1: «Trabajadores» y
-- «Estado del cobro» en la ficha de Bitrix24). Va después de la 2235: si no
-- está, la pasa antes. Todo en ROLLBACK, con datos inventados (T11).
--
--   1. Sin nada escrito: el campo, del mapa; si el mapa no lo tiene, el medido
--      que se llama así; si no hay ninguno, null.
--   2. Lo último que escribió la pestaña en cada campo, de esa ficha y no de otra.
--   3. Solo el servidor; y la vuelta atrás.
--
-- sin usuario: lo llama el servidor (service_role).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GB-0040: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regclass('public.conta_bitrix_pestana_cambio') is null as falta_la_2235 \gset
\if :falta_la_2235
\i supabase/migrations/20261109T2235_gb_pestana_alta_baja.sql
\endif
select to_regprocedure('public.conta_bitrix_pestana_campos(uuid)') is not null as ya_esta_la_0040 \gset
\if :ya_esta_la_0040
\i supabase/vuelta-atras/20261110T0040_gb_bitrix_campos.down.sql
\endif

create temp table _u (cuenta uuid, cliente uuid, c1 uuid, c2 uuid, c3 uuid) on commit drop;
do $$
declare a uuid := (select p.account_id from public.user_profiles p where p.active order by p.created_at limit 1);
        u uuid := (select p.user_id from public.user_profiles p where p.active order by p.created_at limit 1);
        cl uuid; x1 uuid; x2 uuid; x3 uuid;
begin
  if a is null then raise exception 'PRUEBA GB-0040 · 0: staging no tiene ninguna persona.'; end if;
  insert into public.conta_crm (account_id, crm, entorno, portal, mapa, campos_medidos) values (a, 'bitrix24', 'pruebas', 'gb-prueba-0040.bitrix24.es',
    '{"campos":[{"codigo":"UF_CRM_CUOTA_PRUEBA","campo":"cuota_referencia","etiqueta":"Cuota mensual"},{"codigo":"UF_CRM_TRAB_PRUEBA","campo":"trabajadores"}]}',
    '{"UF_CRM_TRAB_PRUEBA":{"formLabel":"Trabajadores"},"UF_CRM_EST_PRUEBA":{"formLabel":"Estado del cobro"},"UF_CRM_OTRO":{"formLabel":"Comercial"}}')
  on conflict (account_id, crm) do update set portal = excluded.portal, mapa = excluded.mapa, campos_medidos = excluded.campos_medidos;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba GB 0040, S.L.', 'B00000040') returning id into cl;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, frase, hecho_por) values
    (a, cl, 'empresa', '90040', 'alta', 'Alta de prueba 1', u) returning id into x1;
  update public.conta_bitrix_pestana_cambio set bitrix_at = now() - interval '2 minutes',
    bitrix = '{"hecho":"escrito","escrito":"250,00","campos":{"trabajadores":{"hecho":"escrito","escrito":"18"},"estado_cobro":{"hecho":"escrito","escrito":"Cobrado"}}}' where id = x1;
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, frase, hecho_por) values
    (a, cl, 'empresa', '90040', 'alta', 'Alta de prueba 2', u) returning id into x2;
  update public.conta_bitrix_pestana_cambio set bitrix_at = now() - interval '1 minute',
    bitrix = '{"hecho":"escrito","campos":{"trabajadores":{"hecho":"escrito","escrito":"19"},"estado_cobro":{"hecho":"choque","en_bitrix":"Al día","sumied":"Cobrado"}}}' where id = x2;
  -- Otra ficha: lo suyo no cuenta para la 90040.
  insert into public.conta_bitrix_pestana_cambio (account_id, party_id, tipo_ficha, id_externo, accion, frase, hecho_por, bitrix, bitrix_at) values
    (a, cl, 'empresa', '90041', 'alta', 'De otra ficha', u, '{"campos":{"trabajadores":{"escrito":"99"}}}', now()) returning id into x3;
  insert into _u values (a, cl, x1, x2, x3);
end $$;

\i supabase/migrations/20261110T0040_gb_bitrix_campos.sql

create temp table _r (paso text, r jsonb) on commit drop;
grant all on _r to service_role;
grant select on _u to service_role;
set local role service_role;
do $$
declare u record;
begin
  select * into u from _u;
  insert into _r values ('ficha', public.conta_bitrix_pestana_campos(u.c2)), ('otra', public.conta_bitrix_pestana_campos(u.c3)),
                        ('nada', public.conta_bitrix_pestana_campos('00000000-0000-4000-8000-000000000040'));
end $$;
reset role;
do $$
declare r jsonb := (select x.r from _r x where x.paso = 'ficha'); o jsonb := (select x.r from _r x where x.paso = 'otra');
begin
  -- 1 y 2 · Trabajadores, del mapa; Estado del cobro, del medido (el mapa no lo tiene). Lo último escrito: 19, y «Cobrado» (el choque no es escrito).
  if r <> '{"trabajadores":{"campo":"UF_CRM_TRAB_PRUEBA","escrita":"19"},"estado_cobro":{"campo":"UF_CRM_EST_PRUEBA","escrita":"Cobrado"}}'::jsonb then
    raise exception 'PRUEBA GB-0040 · 1-2: no es lo esperado (%).', r;
  end if;
  if o->'trabajadores'->>'escrita' <> '99' or o->'estado_cobro'->>'escrita' is not null then
    raise exception 'PRUEBA GB-0040 · 2: la otra ficha no es la suya (%).', o;
  end if;
  if (select x.r from _r x where x.paso = 'nada') <> '{}'::jsonb then raise exception 'PRUEBA GB-0040 · 1: un cambio que no existe tenía que dar nada.'; end if;
  -- 1 · Sin campo en el mapa ni medido: null.
  update public.conta_crm set mapa = '{"campos":[]}', campos_medidos = '{}' where account_id = (select cuenta from _u) and crm = 'bitrix24';
  if public.conta_bitrix_pestana_campos((select c2 from _u))->'trabajadores'->>'campo' is not null then
    raise exception 'PRUEBA GB-0040 · 1: sin campo tenía que dar null.';
  end if;
  -- 3 · Solo el servidor.
  if has_function_privilege('authenticated', 'public.conta_bitrix_pestana_campos(uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_bitrix_pestana_campos(uuid)', 'execute') then
    raise exception 'PRUEBA GB-0040 · 3: no es solo del servidor.';
  end if;
  raise notice 'GB-0040 · 1 a 3: el campo del mapa o el medido, lo último escrito de esa ficha y solo el servidor. OK';
end $$;

\i supabase/vuelta-atras/20261110T0040_gb_bitrix_campos.down.sql
do $$ begin
  if to_regprocedure('public.conta_bitrix_pestana_campos(uuid)') is not null then raise exception 'PRUEBA GB-0040 · 3: la vuelta atrás no la quita.'; end if;
  raise notice 'GB-0040 · 3: la vuelta atrás la quita. OK';
end $$;

rollback;
