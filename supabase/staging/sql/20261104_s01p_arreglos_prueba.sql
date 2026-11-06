-- supabase/staging/sql/20261104_s01p_arreglos_prueba.sql
--
-- SOLO STAGING. Prueba del S01p·1 (1040, 1041 y 1042). Todo en una transacción
-- con ROLLBACK, en la empresa A. Nombra lo que toca, para el analizador:
-- conta_puerta_fuentes_proponer, conta_esperadas_no_llegadas,
-- conta_esperadas_del_mes, supplier_invoice, journal_entry, recurring_contract.
--   1. Lo quincenal sin día: el texto ya no propone el 0, y «al día» corre entero.
--   2. Lo que falta del mes, el día que sea (conta_esperadas_del_mes), y el aviso
--      de Compras igual que antes: nada antes del 15, desde el 15 lo mismo.
--   3. La factura sabe su asiento: las que tienen asiento lo llevan; un asiento
--      nuevo lo pone, borrarlo lo quita, y el de otro origen (un migrado) no se pisa ni se pierde.
--   4. El préstamo de Foodint no está en staging: la 1042 no hace nada.
--   5. Otra vez las tres: no cambian nada.
--   6. La vuelta atrás deja las dos funciones con su huella de producción y quita
--      lo añadido; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·1 arreglos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); las que miran de quién es la empresa se leen con los claims del administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- El workflow aplica el manifiesto antes de esta prueba, en la misma transacción.
-- Si no llegan aplicadas (la prueba sola), se aplican aquí.
do $$ begin
  if to_regprocedure('public.conta_esperadas_del_mes(uuid,date)') is null then
    raise notice 'PRUEBA S01p·1 · 0: no llegaban aplicadas; se aplican aquí.';
  end if;
end $$;
\i supabase/migrations/20261104T1040_s01p_arreglos.sql
\i supabase/migrations/20261104T1041_s01p_factura_asiento_datos.sql
\i supabase/migrations/20261104T1042_s01p_prestamo_octubre_foodint.sql

-- Lo que usa la prueba, de la cuenta A: su empresa, un proveedor sin facturas,
-- su ejercicio de 2026 y una factura sin asiento. En staging están; en la base
-- local (scripts/staging/base-local.sh) se crean aquí si faltan.
create temp table _p (clave text primary key, v uuid) on commit drop;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; s uuid; y uuid; f uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p·1: no está la empresa de la cuenta A.'; end if;
  select x.id into s from public.supplier x where x.account_id = v_acc
     and not exists (select 1 from public.supplier_invoice i where i.supplier_id = x.id)
     and not exists (select 1 from public.supplier_expected_invoice e where e.company_id = c and e.supplier_id = x.id)
   order by x.created_at, x.id limit 1;
  if s is null then raise exception 'PRUEBA S01p·1: la cuenta A no tiene ningún proveedor sin facturas.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-27' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  select i.id into f from public.supplier_invoice i where i.account_id = v_acc and i.status <> 'anulada'
     and not exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = i.id)
   order by i.invoice_date desc nulls last, i.id limit 1;
  if f is null then
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, status)
    values (v_acc, c, s, 'PRUEBA-S01P-1', '2026-10-27', 'borrador') returning id into f;
  end if;
  insert into _p values ('empresa', c), ('proveedor', s), ('ejercicio', y), ('factura', f);
end $$;

-- 1 · Lo quincenal sin día.
do $$
declare v_def text := pg_get_functiondef('public.conta_puerta_fuentes_proponer(uuid)'::regprocedure); r jsonb;
begin
  if strpos(v_def, 'when ''quincenal'' then 0 end') > 0 or strpos(v_def, 'sin día (S01p)') = 0 then
    raise exception 'PRUEBA S01p·1 · 1: conta_puerta_fuentes_proponer sigue proponiendo el día 0 para lo quincenal.';
  end if;
  if exists (select 1 from jsonb_array_elements(public.conta_puerta_fuentes_proponer((select v from _p where clave = 'empresa'))) x
              where x->>'cadencia' = 'quincenal' and x ? 'dia' and x->>'dia' is not null) then
    raise exception 'PRUEBA S01p·1 · 1: una fuente quincenal sale con día.';
  end if;
  r := public.conta_puerta_al_dia((select v from _p where clave = 'empresa'));
  raise notice 'PRUEBA S01p·1 · 1 en verde: lo quincenal sin día; «al día» corre entero (%).', r;
end $$;

-- 2 · Lo que falta del mes, el día que sea.
insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, cadence, typical_day, source, kind, label)
select 'c01a0000-0000-4000-8000-00000000000a', (select v from _p where clave = 'empresa'), (select v from _p where clave = 'proveedor'),
       'mensual', 5, 'a_mano', 'proveedor', 'PRUEBA S01p esperada';
do $$
declare c uuid := (select v from _p where clave = 'empresa'); n_mes int; n_14 int; n_15 int; distintas int;
begin
  select count(*) into n_mes from public.conta_esperadas_del_mes(c, date '2026-08-20') where label = 'PRUEBA S01p esperada';
  if n_mes <> 1 then raise exception 'PRUEBA S01p·1 · 2: la esperada de agosto no sale en conta_esperadas_del_mes (sale % veces).', n_mes; end if;
  select count(*) into n_14 from public.conta_esperadas_no_llegadas(c, date '2026-09-14');
  if n_14 <> 0 then raise exception 'PRUEBA S01p·1 · 2: el aviso dice % el 14/09 y antes del 15 no dice nada.', n_14; end if;
  select count(*) into n_15 from public.conta_esperadas_no_llegadas(c, date '2026-09-15');
  select count(*) into distintas from (
    (select * from public.conta_esperadas_no_llegadas(c, date '2026-09-15') except all select * from public.conta_esperadas_del_mes(c, date '2026-08-01'))
    union all
    (select * from public.conta_esperadas_del_mes(c, date '2026-08-01') except all select * from public.conta_esperadas_no_llegadas(c, date '2026-09-15'))) d;
  if distintas <> 0 or n_15 = 0 then
    raise exception 'PRUEBA S01p·1 · 2: el aviso del 15/09 (%) no es lo que le falta a agosto (% filas distintas).', n_15, distintas;
  end if;
  raise notice 'PRUEBA S01p·1 · 2 en verde: agosto, el día que sea (%); el aviso, nada el 14 y lo mismo el 15 (%).', n_mes, n_15;
end $$;

-- 3 · La factura sabe su asiento.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c constant uuid := (select v from _p where clave = 'empresa');
  f constant uuid := (select v from _p where clave = 'factura');
  y constant uuid := (select v from _p where clave = 'ejercicio');
  v_mal int; v_con int; v_e uuid; v_campo uuid; v_mig uuid;
begin
  select count(*) filter (where i.journal_entry_id is distinct from public._s01p_asiento_de_factura(i.id, i.account_id)),
         count(*) filter (where i.journal_entry_id is not null)
    into v_mal, v_con from public.supplier_invoice i where i.account_id = v_acc;
  if v_mal <> 0 then raise exception 'PRUEBA S01p·1 · 3: % facturas de A sin su asiento (con asiento: %).', v_mal, v_con; end if;

  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status)
  values (v_acc, c, y,
          2, date '2026-10-27', 'PRUEBA S01p', 'supplier_invoice', f, 'borrador')
  returning id into v_e;
  select journal_entry_id into v_campo from public.supplier_invoice where id = f;
  if v_campo is distinct from v_e then raise exception 'PRUEBA S01p·1 · 3: con su asiento nuevo, la factura dice %.', v_campo; end if;
  delete from public.journal_entry where id = v_e;
  select journal_entry_id into v_campo from public.supplier_invoice where id = f;
  if v_campo is not null then raise exception 'PRUEBA S01p·1 · 3: borrado su asiento, la factura sigue diciendo %.', v_campo; end if;

  -- Un migrado (de otro origen, sin source_id) que ya tenía: no se pierde.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (v_acc, c, y,
          2, date '2026-10-27', 'PRUEBA S01p migrado', 'manual', 'borrador')
  returning id into v_mig;
  update public.supplier_invoice set journal_entry_id = v_mig where id = f;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status)
  values (v_acc, c, y,
          2, date '2026-10-27', 'PRUEBA S01p', 'supplier_invoice', f, 'borrador')
  returning id into v_e;
  select journal_entry_id into v_campo from public.supplier_invoice where id = f;
  if v_campo is distinct from v_mig then raise exception 'PRUEBA S01p·1 · 3: un asiento propio pisó el de otro origen (dice %).', v_campo; end if;
  delete from public.journal_entry where id = v_e;
  select journal_entry_id into v_campo from public.supplier_invoice where id = f;
  if v_campo is distinct from v_mig then raise exception 'PRUEBA S01p·1 · 3: el asiento de otro origen se perdió (dice %).', v_campo; end if;
  raise notice 'PRUEBA S01p·1 · 3 en verde: % facturas de A con su asiento; uno nuevo lo pone, borrarlo lo quita, y el de otro origen se queda.', v_con;
end $$;

-- 4 · El préstamo de Foodint no está aquí.
do $$ begin
  if to_regclass('public.conta_s01p_prestamo_antes') is null then raise exception 'PRUEBA S01p·1 · 4: falta la copia del préstamo.'; end if;
  if exists (select 1 from public.conta_s01p_prestamo_antes) then raise exception 'PRUEBA S01p·1 · 4: en staging no hay préstamo de Foodint y la 1042 guardó algo.'; end if;
  raise notice 'PRUEBA S01p·1 · 4 en verde: sin el préstamo de Foodint, la 1042 no hace nada.';
end $$;

-- 5 · Otra vez: nada.
create temp table _huella (que text primary key, h text) on commit drop;
insert into _huella values
  ('proponer', md5(pg_get_functiondef('public.conta_puerta_fuentes_proponer(uuid)'::regprocedure))),
  ('aviso', md5(pg_get_functiondef('public.conta_esperadas_no_llegadas(uuid,date)'::regprocedure))),
  ('facturas', (select md5(string_agg(id::text || coalesce(journal_entry_id::text, '-'), ',' order by id)) from public.supplier_invoice));
\i supabase/migrations/20261104T1040_s01p_arreglos.sql
\i supabase/migrations/20261104T1041_s01p_factura_asiento_datos.sql
\i supabase/migrations/20261104T1042_s01p_prestamo_octubre_foodint.sql
do $$ begin
  if (select h from _huella where que = 'proponer') <> md5(pg_get_functiondef('public.conta_puerta_fuentes_proponer(uuid)'::regprocedure))
     or (select h from _huella where que = 'aviso') <> md5(pg_get_functiondef('public.conta_esperadas_no_llegadas(uuid,date)'::regprocedure))
     or (select h from _huella where que = 'facturas') <> (select md5(string_agg(id::text || coalesce(journal_entry_id::text, '-'), ',' order by id)) from public.supplier_invoice) then
    raise exception 'PRUEBA S01p·1 · 5: pasarlas otra vez cambió algo.';
  end if;
  raise notice 'PRUEBA S01p·1 · 5 en verde: otra vez, nada cambia.';
end $$;

-- 6 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261104T1042_s01p_prestamo_octubre_foodint.down.sql
\i supabase/vuelta-atras/20261104T1041_s01p_factura_asiento_datos.down.sql
\i supabase/vuelta-atras/20261104T1040_s01p_arreglos.down.sql
do $$ begin
  -- Las huellas de producción del 04/11 (iguales en staging antes de la 1040).
  if md5(pg_get_functiondef('public.conta_esperadas_no_llegadas(uuid,date)'::regprocedure)) <> '02533ec6697861cd58260f0aaea50057'
     or md5(pg_get_functiondef('public.conta_puerta_fuentes_proponer(uuid)'::regprocedure)) <> 'dec4e7e6dc143f24292a802cfab9bd3e' then
    raise exception 'PRUEBA S01p·1 · 6: la vuelta atrás no deja las dos funciones como en producción.';
  end if;
  if to_regprocedure('public.conta_esperadas_del_mes(uuid,date)') is not null
     or exists (select 1 from pg_trigger where tgname = 's01p_factura_su_asiento')
     or to_regclass('public.conta_s01p_factura_antes') is not null or to_regclass('public.conta_s01p_prestamo_antes') is not null then
    raise exception 'PRUEBA S01p·1 · 6: la vuelta atrás deja algo de lo añadido.';
  end if;
  raise notice 'PRUEBA S01p·1 · 6 en verde: la vuelta atrás, con las huellas de producción y sin nada de lo añadido.';
end $$;
\i supabase/migrations/20261104T1040_s01p_arreglos.sql
\i supabase/migrations/20261104T1041_s01p_factura_asiento_datos.sql
\i supabase/migrations/20261104T1042_s01p_prestamo_octubre_foodint.sql
do $$ begin
  if to_regprocedure('public.conta_esperadas_del_mes(uuid,date)') is null then raise exception 'PRUEBA S01p·1 · 6: otra vez delante, no está.'; end if;
  raise notice 'PRUEBA S01p·1 · 6 en verde: y otra vez delante.';
end $$;

rollback;
