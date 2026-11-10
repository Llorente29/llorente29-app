-- supabase/staging/sql/20261110_g05_trabajo_suelto_prueba.sql
--
-- SOLO STAGING. La 0700 (G05 · nº 71, punto 3: un trabajo suelto sumado al
-- recibo), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 0700, dos veces.
--   2. Un servicio «cada vez» con su precio de tarifa y un cliente.
--   3. Como la persona: la lista con el precio de la tarifa; poner uno sin importe
--      (el de la tarifa, este mes) y otro con su importe y su concepto; con el
--      cobro de este mes preparado, avisa de volver a prepararlo; con el de este
--      mes ya enviado, va al que viene; con un precio propio del cliente, ese.
--   4. Lo que no: sin precio y sin importe, un importe de cero, otra cuenta.
--   5. La vuelta atrás de la 0700, y otra vez la 0700.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 SUELTO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 0700, dos veces.
\i supabase/migrations/20261110T0700_g05_trabajo_suelto.sql
\i supabase/migrations/20261110T0700_g05_trabajo_suelto.sql
do $$ begin
  if to_regprocedure('public.conta_trabajo_suelto_poner(uuid,uuid,uuid,text,numeric)') is null or to_regprocedure('public.conta_trabajos_sueltos(uuid,uuid)') is null then
    raise exception 'G05 SUELTO · 1: falta algo de la 0700.';
  end if;
  raise notice 'G05 SUELTO · 1: la 0700 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado.
create temp table _g (clave text primary key, v text) on commit drop;
grant select on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; s uuid; sn uuid; m text := to_char((now() at time zone 'Europe/Madrid')::date, 'YYYY-MM');
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 SUELTO · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Suelto, S.L.', 'B00000953') returning id into c;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g05_suelto_renta', 'Declaración de la renta prueba', 'fijo_mes') returning id into s;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g05_suelto_sin_precio', 'Servicio sin precio prueba', 'fijo_mes') returning id into sn;
  insert into public.conta_precio (account_id, company_id, servicio_id, forma, periodo, importe, desde) values (a, e, s, 'fijo', 'vez', 80, '2026-01-01');
  insert into _g values ('e', e), ('c', c), ('s', s), ('sn', sn), ('m', m);
end $$;

-- 3 · Como la persona (administradora de la cuenta A).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); s uuid := (select v::uuid from _g where clave = 's');
        m text := (select v from _g where clave = 'm'); x jsonb; r jsonb;
begin
  x := public.conta_trabajos_sueltos(e, c);
  if x->>'mes' <> m or not exists (select 1 from jsonb_array_elements(x->'servicios') j where j->>'servicio_id' = s::text and (j->>'importe')::numeric = 80 and j->>'de' = 'tarifa') then
    raise exception 'G05 SUELTO · 3: la lista: %', x;
  end if;
  if exists (select 1 from jsonb_array_elements(x->'servicios') j where j->>'nombre' = 'Servicio sin precio prueba') then
    raise exception 'G05 SUELTO · 3: un servicio sin precio «cada vez» no se ofrece.';
  end if;
  r := public.conta_trabajo_suelto_poner(e, c, s);
  if (r->>'importe')::numeric <> 80 or r->>'mes' <> m or r->>'concepto' <> 'Declaración de la renta prueba' or r->>'frase' not like 'Sumado al recibo de % de Cliente Prueba Suelto, S.L.: Declaración de la renta prueba, 80,00 €.' then
    raise exception 'G05 SUELTO · 3: sin importe: %', r;
  end if;
  r := public.conta_trabajo_suelto_poner(e, c, s, '  Renta 2025 de la administradora ', 95.5);
  if (r->>'importe')::numeric <> 95.5 or r->>'concepto' <> 'Renta 2025 de la administradora' then raise exception 'G05 SUELTO · 3: con importe: %', r; end if;
  if (select count(*) from public.conta_linea where party_id = c and tipo = 'suelto' and desde = (m || '-01')::date and hasta = desde) <> 2 then
    raise exception 'G05 SUELTO · 3: las líneas no están como un suelto de su mes.';
  end if;
  if jsonb_array_length(public.conta_trabajos_sueltos(e, c)->'hechos') <> 2 then raise exception 'G05 SUELTO · 3: los hechos.'; end if;
  raise notice 'G05 SUELTO · 3: la lista con el precio de la tarifa, y sumado al recibo de este mes, con y sin importe. OK';
end $$;
reset role;
-- El cobro de este mes, preparado y después enviado.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); m text := (select v from _g where clave = 'm');
begin
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent) values (a, e, c, m, 'recibo:' || e || ':' || c || ':' || m, 9680);
end $$;
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); s uuid := (select v::uuid from _g where clave = 's'); r jsonb;
begin
  r := public.conta_trabajo_suelto_poner(e, c, s);
  if r->>'frase' not like '%Ya habías preparado el cobro de ese mes: vuelve a prepararlo.' then raise exception 'G05 SUELTO · 3: con el cobro preparado: %', r; end if;
  raise notice 'G05 SUELTO · 3: con el cobro preparado, avisa de volver a prepararlo. OK';
end $$;
reset role;
update public.conta_recibo set estado = 'enviado' where party_id = (select v::uuid from _g where clave = 'c');
insert into public.conta_precio (account_id, company_id, servicio_id, party_id, forma, periodo, importe, desde)
values ('c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 's'), (select v::uuid from _g where clave = 'c'), 'fijo', 'vez', 70, '2026-01-01');
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); s uuid := (select v::uuid from _g where clave = 's');
        siguiente text := to_char(date_trunc('month', (now() at time zone 'Europe/Madrid')::date) + interval '1 month', 'YYYY-MM'); r jsonb;
begin
  r := public.conta_trabajo_suelto_poner(e, c, s);
  if r->>'mes' <> siguiente or (r->>'importe')::numeric <> 70 or r->>'frase' like '%vuelve a prepararlo%' then raise exception 'G05 SUELTO · 3: con el de este mes enviado: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(public.conta_trabajos_sueltos(e, c)->'servicios') j where (j->>'importe')::numeric = 70 and j->>'de' = 'su_precio') then
    raise exception 'G05 SUELTO · 3: el precio propio no sale en la lista.';
  end if;
  raise notice 'G05 SUELTO · 3: con el recibo de este mes enviado, al que viene; con su precio propio, ese. OK';
end $$;

-- 4 · Lo que no.
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); s uuid := (select v::uuid from _g where clave = 's'); sn uuid := (select v::uuid from _g where clave = 'sn');
begin
  begin perform public.conta_trabajo_suelto_poner(e, c, sn); raise exception 'G05 SUELTO · 4: sin precio ni importe se ha puesto.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_trabajo_suelto_poner(e, c, s, null, 0); raise exception 'G05 SUELTO · 4: con importe cero se ha puesto.';
  exception when sqlstate '22023' then null; end;
  begin perform public.conta_trabajo_suelto_poner(e, c, s, null, 10.555); raise exception 'G05 SUELTO · 4: con tres decimales se ha puesto.';
  exception when sqlstate '22023' then null; end;
  raise notice 'G05 SUELTO · 4: sin precio ni importe, a cero o con tres decimales, no. OK';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_trabajo_suelto_poner((select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c'), (select v::uuid from _g where clave = 's'));
    raise exception 'G05 SUELTO · 4: otra cuenta ha puesto un suelto.';
  exception when sqlstate '42501' then raise notice 'G05 SUELTO · 4: otra cuenta, no. OK';
  end;
end $$;
reset role;

-- 5 · La vuelta atrás, y otra vez la 0700.
\i supabase/vuelta-atras/20261110T0700_g05_trabajo_suelto.down.sql
do $$ begin
  if to_regprocedure('public.conta_trabajo_suelto_poner(uuid,uuid,uuid,text,numeric)') is not null or to_regprocedure('public._conta_suelto_mes(uuid,uuid)') is not null then
    raise exception 'G05 SUELTO · 5: la vuelta atrás ha dejado algo.';
  end if;
end $$;
\i supabase/migrations/20261110T0700_g05_trabajo_suelto.sql
do $$ begin raise notice 'G05 SUELTO · 5: vuelta atrás y otra vez la 0700. OK'; end $$;

rollback;
