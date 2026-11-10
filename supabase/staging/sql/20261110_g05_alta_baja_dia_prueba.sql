-- supabase/staging/sql/20261110_g05_alta_baja_dia_prueba.sql
--
-- SOLO STAGING. La 1108 (G05 · nº 77, punto 1: alta y baja con su día y su DNI o
-- NIE), con datos inventados (T11), en una transacción con ROLLBACK:
--   1. La 1108, dos veces.
--   2. La letra de control: un DNI y un NIE inventados que valen, y otros que no.
--   3. Como la persona: alta con día y documento (con espacios y guion, que se
--      quitan); el mismo documento otra vez, no; uno mal, no; sin documento, sí.
--   4. Baja con su día; antes del alta, no; otra cuenta, no.
--   5. La vuelta atrás de la 1108, y otra vez la 1108.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 ALTA DÍA: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1108, dos veces.
\i supabase/migrations/20261110T1108_g05_alta_baja_dia.sql
\i supabase/migrations/20261110T1108_g05_alta_baja_dia.sql
do $$ begin
  if to_regprocedure('public.conta_gestoria_alta_trabajador(uuid,uuid,uuid,text,date,text)') is null or to_regprocedure('public.conta_gestoria_baja_trabajador(uuid,date)') is null then
    raise exception 'G05 ALTA DÍA · 1: falta algo de la 1108.';
  end if;
  raise notice 'G05 ALTA DÍA · 1: la 1108 carga, y dos veces. OK';
end $$;

-- 2 · La letra de control.
do $$ begin
  if not (public._conta_dni_nie_valido('12345678Z') and public._conta_dni_nie_valido('X0000000T') and public._conta_dni_nie_valido('00000000T'))
     or public._conta_dni_nie_valido('12345678A') or public._conta_dni_nie_valido('X0000000A') or public._conta_dni_nie_valido('1234567Z') then
    raise exception 'G05 ALTA DÍA · 2: la letra de control no se comprueba bien.';
  end if;
  raise notice 'G05 ALTA DÍA · 2: la letra de control. OK';
end $$;

-- 3 · Lo de antes, inventado, y el alta como la persona.
create temp table _g (clave text primary key, v text) on commit drop;
grant select, insert on _g to authenticated;
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid; c uuid; s uuid;
begin
  select id into e from public.company where account_id = a order by created_at limit 1;
  if e is null then raise exception 'PRUEBA G05 ALTA DÍA · 0: la cuenta A no tiene empresa.'; end if;
  insert into public.party (account_id, name, tax_id) values (a, 'Cliente Prueba Alta Día, S.L.', 'B00000954') returning id into c;
  insert into public.conta_servicio (account_id, company_id, clave, nombre, forma) values (a, e, 'g05_alta_dia_laboral', 'Laboral Prueba Día', 'por_empleado') returning id into s;
  insert into _g values ('e', e), ('c', c), ('s', s);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _g where clave = 'e'); c uuid := (select v::uuid from _g where clave = 'c'); s uuid := (select v::uuid from _g where clave = 's');
        r jsonb; l public.conta_linea;
begin
  r := public.conta_gestoria_alta_trabajador(e, c, s, 'Persona Prueba Uno', date '2026-12-15', '1234 5678-z');
  select * into l from public.conta_linea where id = (r->>'id')::uuid;
  if l.desde <> date '2026-12-01' or l.alta_el <> date '2026-12-15' or l.empleado_documento <> '12345678Z' or l.empleado_nombre <> 'PERSONA PRUEBA UNO' then
    raise exception 'G05 ALTA DÍA · 3: la línea del alta: %', row_to_json(l);
  end if;
  if r->>'frase' not like 'Alta de PERSONA PRUEBA UNO (12345678Z) en laboral prueba día de Cliente Prueba Alta Día, S.L. el 15/12/2026: %' then
    raise exception 'G05 ALTA DÍA · 3: la frase: %', r->>'frase';
  end if;
  insert into _g values ('l', l.id);
  begin
    perform public.conta_gestoria_alta_trabajador(e, c, s, 'Otro Nombre Prueba', date '2026-12-20', '12345678Z');
    raise exception 'G05 ALTA DÍA · 3: el mismo documento dos veces.';
  exception when sqlstate '23505' then null; end;
  begin
    perform public.conta_gestoria_alta_trabajador(e, c, s, 'Persona Prueba Dos', date '2026-12-20', '12345678A');
    raise exception 'G05 ALTA DÍA · 3: un documento mal.';
  exception when sqlstate '22023' then null; end;
  r := public.conta_gestoria_alta_trabajador(e, c, s, 'Persona Prueba Tres', date '2027-01-01', null);
  if (select empleado_documento from public.conta_linea where id = (r->>'id')::uuid) is not null then raise exception 'G05 ALTA DÍA · 3: sin documento.'; end if;
  r := public.conta_gestoria_alta_trabajador(e, c, s, 'Persona Prueba Cuatro', date '2027-01-10', 'X0000000T');
  raise notice 'G05 ALTA DÍA · 3: alta con día y documento; repetido o mal, no; sin documento, sí. OK';
end $$;

-- 4 · La baja con su día.
do $$
declare l uuid := (select v::uuid from _g where clave = 'l'); r jsonb; x public.conta_linea;
begin
  begin
    perform public.conta_gestoria_baja_trabajador(l, date '2026-12-10');
    raise exception 'G05 ALTA DÍA · 4: la baja antes del alta.';
  exception when sqlstate '22023' then null; end;
  r := public.conta_gestoria_baja_trabajador(l, date '2027-02-20');
  select * into x from public.conta_linea where id = l;
  if x.hasta <> date '2027-02-01' or x.baja_el <> date '2027-02-20' or r->>'frase' not like 'Baja de PERSONA PRUEBA UNO % el 20/02/2027: ya no se cobra desde marzo%' then
    raise exception 'G05 ALTA DÍA · 4: %', r;
  end if;
  raise notice 'G05 ALTA DÍA · 4: baja con su día; antes del alta, no. OK';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_gestoria_baja_trabajador((select v::uuid from _g where clave = 'l'), date '2027-03-01');
    raise exception 'G05 ALTA DÍA · 4: otra cuenta ha dado una baja.';
  exception when sqlstate '42501' then raise notice 'G05 ALTA DÍA · 4: otra cuenta, no. OK';
  end;
end $$;
reset role;

-- 5 · La vuelta atrás, y otra vez la 1108.
\i supabase/vuelta-atras/20261110T1108_g05_alta_baja_dia.down.sql
do $$ begin
  if to_regprocedure('public.conta_gestoria_alta_trabajador(uuid,uuid,uuid,text,date,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_linea' and column_name = 'empleado_documento') then
    raise exception 'G05 ALTA DÍA · 5: la vuelta atrás ha dejado algo.';
  end if;
end $$;
\i supabase/migrations/20261110T1108_g05_alta_baja_dia.sql
do $$ begin raise notice 'G05 ALTA DÍA · 5: vuelta atrás y otra vez la 1108. OK'; end $$;

rollback;
