-- supabase/staging/sql/20261113_c06b_centimo_iva_prueba.sql
--
-- SOLO STAGING. Prueba de 20261113T0100_c06b_centimo_iva
-- (public.journal_entry_validar y public.conta_propuesta_ventas_unidad), en la
-- empresa de la cuenta A de pruebas. La migración se aplica DENTRO de la
-- transacción (\i) y todo acaba en ROLLBACK: staging es compartido y no
-- cambia. Cada caso se mide con la regla de antes y con la nueva.
--
--   1. El caso real (Ventas Glovo · Foodint Carabanchel, 13/10), con datos
--      inventados iguales: un ticket de 20,40 €, base 18,55 y cuota 1,85 al
--      10 %. Antes paraba («apunte 3 (47700010)»); ahora se valida, cuadrado.
--   2. Con 0,02 € de diferencia (cuota 1,84) sigue parando, con el mismo texto.
--   3. Sin diferencia (base 18,60, cuota 1,86), igual que antes: se valida.
--   4. Un resumen de 9 facturas: 4 céntimos pasan y 5 paran, como antes.
--   5. El texto del cierre del día: «1 ticket … cuadra»; con 2, «2 tickets …
--      cuadran», como antes.

begin;
\set ON_ERROR_STOP on

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create temp table caso (k text primary key, entry uuid, antes text, despues text) on commit drop;

-- Los asientos de los casos 1–4, en borrador, en la empresa A.
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; v_iva10 uuid; c572 uuid; c700 uuid; c477 uuid; e uuid;
  r record;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026';
  select id into v_iva10 from public.tax_rate where is_system and code = 'iva_reducido' and valid_to is null;
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c700 from public.company_account where company_id = emp and code = '70000000';
  select id into c477 from public.company_account where company_id = emp and code = '47700010';
  if v_y is null or v_iva10 is null or c572 is null or c700 is null or c477 is null then
    raise exception 'PRUEBA céntimo · 0: faltan el ejercicio 2026, el IVA al 10 %% o cuentas de la empresa A en staging.';
  end if;
  for r in select * from (values
      ('1 · el caso real', 20.40, 18.55, 1.85, 1),
      ('2 · dos céntimos', 20.39, 18.55, 1.84, 1),
      ('3 · sin diferencia', 20.46, 18.60, 1.86, 1),
      ('4a · resumen de 9, 4 céntimos', 110.04, 100.00, 10.04, 9),
      ('4b · resumen de 9, 5 céntimos', 110.05, 100.00, 10.05, 9)) v(k, total, base, cuota, n)
  loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, emp, v_y, 1, '2026-10-13', 'Prueba del céntimo · ' || r.k, 'manual') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, tax_rate_id, tax_base, vat_book, tax_documents)
    values (a, emp, e, 1, c572, r.total, 0, loc, null, null, null, 1),
           (a, emp, e, 2, c700, 0, r.base, loc, null, null, null, 1),
           (a, emp, e, 3, c477, 0, r.cuota, loc, v_iva10, r.base, 'issued', r.n);
    insert into caso (k, entry) values (r.k, e);
  end loop;
end $$;

-- Lo que dice cada caso con la regla de ANTES (validar dentro de un
-- subbloque que se deshace: aquí no se valida nada).
create or replace function pg_temp.dice(p_entry uuid) returns text language plpgsql as $$
begin
  begin
    perform public.journal_entry_validar(p_entry);
    raise exception using errcode = 'P0001', message = 'VALIDA';
  exception
    when check_violation then return sqlerrm;
    when raise_exception then if sqlerrm = 'VALIDA' then return 'se valida'; end if; raise;
  end;
end $$;
update caso set antes = pg_temp.dice(entry);

-- El texto del cierre del día con la función de antes: el día de Glovo de 1
-- ticket y el de 2 de la semilla de la empresa A.
create temp table texto (k text primary key, antes text, despues text) on commit drop;
insert into texto (k, antes)
select x.k, public.conta_propuesta_ventas_unidad('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', x.dia,
                                                  'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque'
  from (values ('1 ticket', date '2026-09-25'), ('2 tickets', date '2026-09-24')) x(k, dia);

-- La migración, la misma que irá a producción.
\i supabase/migrations/20261113T0100_c06b_centimo_iva.sql

update caso set despues = pg_temp.dice(entry);
update texto t set despues = public.conta_propuesta_ventas_unidad('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', x.dia,
                                                  'e0200000-0000-4000-8000-00000000a0c1', null) -> 'entrada' ->> 'porque'
  from (values ('1 ticket', date '2026-09-25'), ('2 tickets', date '2026-09-24')) x(k, dia) where x.k = t.k;

\pset format aligned
select k, antes, despues from caso order by k;
select k, antes, despues from texto order by k;

do $$
declare c record; t record; v_n int;
begin
  for c in select * from caso loop
    raise notice '%: antes «%», ahora «%»', c.k, c.antes, c.despues;
  end loop;
  select * into c from caso where k = '1 · el caso real';
  if c.antes not like 'No se valida: apunte 3 (47700010): la cuota 1.85 no es la base 18.55 × %' then
    raise exception 'PRUEBA céntimo · 1: con la regla de antes tenía que parar en el apunte 3, y dice «%».', c.antes;
  end if;
  if c.despues <> 'se valida' then raise exception 'PRUEBA céntimo · 1: el caso real sigue parando: «%».', c.despues; end if;

  select * into c from caso where k = '2 · dos céntimos';
  if c.antes is distinct from c.despues or c.despues not like 'No se valida: apunte 3 (47700010): la cuota 1.84 %' then
    raise exception 'PRUEBA céntimo · 2: con 0,02 € tenía que parar igual que antes: antes «%», ahora «%».', c.antes, c.despues;
  end if;

  select * into c from caso where k = '3 · sin diferencia';
  if c.antes <> 'se valida' or c.despues <> 'se valida' then
    raise exception 'PRUEBA céntimo · 3: sin diferencia tenía que validarse antes y ahora: «%» / «%».', c.antes, c.despues;
  end if;

  select * into c from caso where k = '4a · resumen de 9, 4 céntimos';
  if c.antes <> 'se valida' or c.despues <> 'se valida' then
    raise exception 'PRUEBA céntimo · 4a: «%» / «%».', c.antes, c.despues;
  end if;
  select * into c from caso where k = '4b · resumen de 9, 5 céntimos';
  if c.antes is distinct from c.despues or c.despues not like 'No se valida: apunte 3 (47700010)%' then
    raise exception 'PRUEBA céntimo · 4b: un resumen de 9 con 5 céntimos tenía que parar igual que antes: «%» / «%».', c.antes, c.despues;
  end if;

  -- El asiento sigue cuadrando: la regla 1 no ha cambiado.
  select count(*) into v_n from public.journal_line l join caso k on k.entry = l.entry_id group by l.entry_id having sum(l.debit) <> sum(l.credit) limit 1;
  if v_n is not null then raise exception 'PRUEBA céntimo · 1: un asiento de la prueba no cuadra.'; end if;

  select * into t from texto where k = '1 ticket';
  if t.antes not like '1 tickets de tus marcas en Glovo cuadran con lo que cobra, al céntimo%' then
    raise exception 'PRUEBA céntimo · 5: el día de 1 ticket no es el de la semilla: «%».', t.antes;
  end if;
  if t.despues <> replace(replace(t.antes, '1 tickets', '1 ticket'), 'cuadran', 'cuadra') then
    raise exception 'PRUEBA céntimo · 5: con 1 ticket dice «%».', t.despues;
  end if;
  select * into t from texto where k = '2 tickets';
  if t.antes not like '2 tickets de tus marcas en Glovo cuadran %' or t.despues is distinct from t.antes then
    raise exception 'PRUEBA céntimo · 5: con 2 tickets cambió: «%» / «%».', t.antes, t.despues;
  end if;

  raise notice 'PRUEBA céntimo: el caso real se valida, 0,02 € sigue parando, sin diferencia igual que antes, el resumen igual, y «1 ticket … cuadra».';
end $$;

\echo '>>> Prueba del céntimo de redondeo en el IVA en verde. ROLLBACK: no queda nada.'
rollback;
