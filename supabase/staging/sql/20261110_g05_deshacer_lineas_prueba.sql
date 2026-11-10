-- supabase/staging/sql/20261110_g05_deshacer_lineas_prueba.sql
--
-- SOLO STAGING. La 0010 (G05 · nº 69: deshacer un alta, una baja o un cambio de
-- nivel del mismo día), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 0010, dos veces.
--   2. Un cliente con su gestoría por niveles y su laboral por trabajador; como la
--      persona: un alta, una baja y un cambio de nivel (cada uno con su hora de hoy:
--      dentro de una transacción todo lleva la misma, y en la de verdad cada
--      llamada es la suya).
--   3. Las de hoy: las tres, la más reciente primero, con su frase; otra cuenta no.
--   4. Deshacer el cambio de nivel (la línea vuelve a como estaba y la nueva se
--      va); otra vez, no; con un recibo enviado después de la baja, la baja no se
--      deshace y lo dice; el alta sí; una de ayer, no.
--   5. La vuelta atrás de la 0010, y otra vez la 0010.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 DESHACER: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 0010, dos veces.
\i supabase/migrations/20261110T0010_g05_deshacer_lineas.sql
\i supabase/migrations/20261110T0010_g05_deshacer_lineas.sql
do $$ begin
  if to_regprocedure('public.conta_linea_deshacer(uuid,uuid,timestamptz)') is null or to_regprocedure('public.conta_linea_operaciones_hoy(uuid,uuid)') is null
     or to_regclass('public.conta_linea_deshecha') is null then
    raise exception 'G05 DESHACER · 1: falta algo de la 0010.';
  end if;
  raise notice 'G05 DESHACER · 1: la 0010 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado (como el servidor), y las tres operaciones como la persona.
create temp table _g (clave text primary key, v text) on commit drop;
grant select, insert, update on _g to authenticated;
-- La hora de cada operación: hoy (Madrid) a las 12:00, más n segundos.
create or replace function pg_temp.a_las(p_n int, p_desde timestamptz) returns void language sql as $f$
  update public.conta_gestoria_cambio set cuando = ((now() at time zone 'Europe/Madrid')::date + time '12:00' + make_interval(secs => p_n)) at time zone 'Europe/Madrid'
   where tabla = 'conta_linea' and cuando = p_desde
$f$;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; sg uuid; sl uuid; nb uuid; ne uuid; l uuid; w uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 DESHACER · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Deshacer, S.L.', 'B00000951') returning id into c;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g05_deshacer_gestoria', 'Gestoría Prueba Deshacer', 'fijo_mes') returning id into sg;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g05_deshacer_laboral', 'Laboral Prueba Deshacer', 'por_empleado') returning id into sl;
  insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden) values (a, e, sg, 'Básica', 1) returning id into nb;
  insert into public.conta_servicio_nivel (account_id, company_id, servicio_id, nombre, orden) values (a, e, sg, 'Premium', 2) returning id into ne;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, nivel_id, tipo, origen, periodo, desde) values (a, e, c, sg, nb, 'cuota', 'manual', 'mes', '2026-01-01') returning id into l;
  insert into public.conta_linea (account_id, company_id, party_id, servicio_id, tipo, origen, periodo, desde, empleado_nombre) values (a, e, c, sl, 'cuota', 'manual', 'mes', '2026-01-01', 'PERSONA PRUEBA DOS') returning id into w;
  insert into public.conta_gestoria_ajustes (company_id, account_id, cambios_de_tarifa) values (e, a, true) on conflict (company_id) do update set cambios_de_tarifa = true;
  insert into _g values ('e', e), ('c', c), ('sg', sg), ('sl', sl), ('nb', nb), ('ne', ne), ('l', l), ('w', w);
end $$;
select pg_temp.a_las(0, now());
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ begin
  insert into _g values ('alta', public.conta_gestoria_alta_empleado((select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c'),
    (select v::uuid from _g where clave = 'sl'), 'Persona Prueba Uno', '2026-12-01')->>'id');
end $$;
reset role; select pg_temp.a_las(1, now()); set local role authenticated;
do $$ begin perform public.conta_gestoria_baja_linea((select v::uuid from _g where clave = 'w'), '2026-11-01'); end $$;
reset role; select pg_temp.a_las(2, now()); set local role authenticated;
do $$ begin
  insert into _g values ('nivel', public.conta_tarifa_nivel_cambiar((select v::uuid from _g where clave = 'l'), (select v::uuid from _g where clave = 'ne'), '2026-12-01', false)->>'id');
end $$;
reset role; select pg_temp.a_las(3, now()); set local role authenticated;

-- 3 · Las de hoy.
do $$
declare r jsonb := public.conta_linea_operaciones_hoy((select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c'));
begin
  if jsonb_array_length(r) <> 3 or (select string_agg(x->>'tipo', ',') from jsonb_array_elements(r) x) <> 'nivel,baja,alta'
     or exists (select 1 from jsonb_array_elements(r) x where (x->>'puede')::boolean is not true) then
    raise exception 'G05 DESHACER · 3: las de hoy son %.', r;
  end if;
  if r->0->>'frase' <> 'Cliente Prueba Deshacer, S.L. pasa de Gestoría Prueba Deshacer · Básica a Gestoría Prueba Deshacer · Premium desde diciembre.'
     or r->1->>'frase' <> 'Baja de PERSONA PRUEBA DOS en laboral prueba deshacer de Cliente Prueba Deshacer, S.L. desde diciembre.'
     or r->2->>'frase' <> 'Alta de PERSONA PRUEBA UNO en laboral prueba deshacer de Cliente Prueba Deshacer, S.L. desde diciembre.' then
    raise exception 'G05 DESHACER · 3: las frases son %.', r;
  end if;
  insert into _g values ('hoy', r::text);
end $$;
-- Otra cuenta (B) no.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ declare v_n int := 0; begin
  begin perform public.conta_linea_operaciones_hoy((select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c')); exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform public.conta_linea_deshacer((select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c'), ((select v::jsonb from _g where clave = 'hoy')->0->>'cuando')::timestamptz);
  exception when insufficient_privilege then v_n := v_n + 1; end;
  if v_n <> 2 then raise exception 'G05 DESHACER · 3: otra cuenta ha podido ver o deshacer (% de 2 paradas).', v_n; end if;
  raise notice 'G05 DESHACER · 3: las tres de hoy (nivel, baja, alta) con su frase; otra cuenta no. OK';
end $$;
reset role;

-- 4 · Deshacer.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); h jsonb := (select v::jsonb from _g where clave = 'hoy'); r jsonb; v_err text;
begin
  -- El cambio de nivel.
  r := public.conta_linea_deshacer(e, c, (h->0->>'cuando')::timestamptz);
  if r->>'frase' <> 'Deshecho: Cliente Prueba Deshacer, S.L. pasa de Gestoría Prueba Deshacer · Básica a Gestoría Prueba Deshacer · Premium desde diciembre.' then
    raise exception 'G05 DESHACER · 4: deshacer el nivel dijo %.', r;
  end if;
  if (select hasta from public.conta_linea where id = (select v::uuid from _g where clave = 'l')) is not null
     or exists (select 1 from public.conta_linea where id = (select v::uuid from _g where clave = 'nivel')) then
    raise exception 'G05 DESHACER · 4: el cambio de nivel no ha vuelto a como estaba.';
  end if;
  begin perform public.conta_linea_deshacer(e, c, (h->0->>'cuando')::timestamptz); exception when unique_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Eso ya está deshecho.' then raise exception 'G05 DESHACER · 4: deshacer otra vez dijo «%».', v_err; end if;
  -- Lo que escribe el deshacer no sale como una operación: quedan la baja y el alta.
  if (select string_agg(x->>'tipo', ',') from jsonb_array_elements(public.conta_linea_operaciones_hoy(e, c)) x) <> 'baja,alta' then
    raise exception 'G05 DESHACER · 4: después de deshacer el nivel, las de hoy son %.', public.conta_linea_operaciones_hoy(e, c);
  end if;
end $$;
-- Un recibo enviado a GoCardless después de la baja (como el servidor).
reset role;
insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado, enviado_at)
select 'c01a0000-0000-4000-8000-00000000000a', (select v::uuid from _g where clave = 'e'), (select v::uuid from _g where clave = 'c'), '2026-12',
       'recibo:' || (select v from _g where clave = 'e') || ':' || (select v from _g where clave = 'c') || ':2026-12', 1000, 'enviado', ((select v::jsonb from _g where clave = 'hoy')->1->>'cuando')::timestamptz + interval '1 second';
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); h jsonb := (select v::jsonb from _g where clave = 'hoy'); r jsonb; v_err text;
begin
  r := public.conta_linea_operaciones_hoy(e, c);
  if (r->0->>'puede')::boolean or r->0->>'porque' <> 'Ya se ha enviado a GoCardless un recibo con este cambio: no se deshace aquí.' then
    raise exception 'G05 DESHACER · 4: con el recibo enviado, la baja dice %.', r->0;
  end if;
  begin perform public.conta_linea_deshacer(e, c, (h->1->>'cuando')::timestamptz); exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Ya se ha enviado a GoCardless un recibo con este cambio: no se deshace aquí.' then raise exception 'G05 DESHACER · 4: deshacer la baja dijo «%».', v_err; end if;
  if (select hasta from public.conta_linea where id = (select v::uuid from _g where clave = 'w')) is distinct from '2026-11-01' then raise exception 'G05 DESHACER · 4: la baja se ha tocado.'; end if;
end $$;
-- El alta: el recibo también es posterior a ella; sin el recibo, se deshace.
reset role;
delete from public.conta_recibo where clave = 'recibo:' || (select v from _g where clave = 'e') || ':' || (select v from _g where clave = 'c') || ':2026-12';
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); h jsonb := (select v::jsonb from _g where clave = 'hoy'); r jsonb;
begin
  r := public.conta_linea_deshacer(e, c, (h->2->>'cuando')::timestamptz);
  if r->>'frase' <> 'Deshecho: Alta de PERSONA PRUEBA UNO en laboral prueba deshacer de Cliente Prueba Deshacer, S.L. desde diciembre.'
     or exists (select 1 from public.conta_linea where id = (select v::uuid from _g where clave = 'alta')) then
    raise exception 'G05 DESHACER · 4: deshacer el alta dijo % (o la línea sigue).', r;
  end if;
end $$;
-- Una de ayer, no.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
update public.conta_gestoria_cambio set cuando = cuando - interval '1 day'
 where tabla = 'conta_linea' and cuando = ((select v::jsonb from _g where clave = 'hoy')->1->>'cuando')::timestamptz;
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); v_err text;
begin
  if jsonb_array_length(public.conta_linea_operaciones_hoy(e, c)) <> 0 then raise exception 'G05 DESHACER · 4: una de ayer sale en las de hoy.'; end if;
  begin perform public.conta_linea_deshacer(e, c, ((select v::jsonb from _g where clave = 'hoy')->1->>'cuando')::timestamptz - interval '1 day');
  exception when check_violation then v_err := sqlerrm; end;
  if v_err is distinct from 'Solo se deshace lo hecho hoy.' then raise exception 'G05 DESHACER · 4: deshacer una de ayer dijo «%».', v_err; end if;
  raise notice 'G05 DESHACER · 4: el nivel se deshace (la línea como estaba, la nueva fuera) y una vez; con un recibo enviado después, la baja no y lo dice; el alta sí; una de ayer, no. OK';
end $$;
reset role;

-- 5 · La vuelta atrás de la 0010, y otra vez la 0010.
\i supabase/vuelta-atras/20261110T0010_g05_deshacer_lineas.down.sql
do $$ begin
  if to_regprocedure('public.conta_linea_deshacer(uuid,uuid,timestamptz)') is not null or to_regclass('public.conta_linea_deshecha') is not null then
    raise exception 'G05 DESHACER · 5: la vuelta atrás de la 0010 no la quita.';
  end if;
end $$;
\i supabase/migrations/20261110T0010_g05_deshacer_lineas.sql
\echo 'G05 DESHACER · 5: la vuelta atrás de la 0010, y otra vez la 0010. OK'

rollback;
