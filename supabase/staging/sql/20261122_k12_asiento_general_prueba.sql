-- supabase/staging/sql/20261122_k12_asiento_general_prueba.sql
--
-- SOLO STAGING. Prueba del K12 (20261122T1100_k12_asiento_general y 20261122T1101_k12_justificante), que el ensayo de
-- staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra lo que
-- cambia: public.journal_entry_document (su CHECK de la clase, que solo amplía con «justificante»). Y lo nuevo:
-- public.journal_entry.notes, public.conta_user_pref.reparto_documento, public.conta_asiento_modificado,
-- public.conta_asiento_se_puede_modificar(uuid), public.conta_asiento_modificar(uuid,jsonb,jsonb,text) y
-- public.conta_documento_justificante_guardar(uuid,text,text,text,integer,text).
--
-- En la gestoría de la cuenta del núcleo (semilla K02), como su usuario. Los asientos son inventados, dentro de la
-- transacción (T11). Por sus CAMINOS:
--   1. Un asiento general escrito a mano, por el camino de la pantalla (las filas y journal_entry_validar), con sus
--      observaciones y la marca y la plataforma en una línea; y otro detrás, para la cadena. Regla 31: la huella de un
--      asiento no depende de sus observaciones (la misma con y sin ellas).
--   2. Cambiarlo validado: el concepto, las observaciones, el importe, la cuenta de una línea y su plataforma. El mismo
--      número; la cadena íntegra (también el de detrás, vuelto a encadenar); su respaldo; el libro con lo nuevo.
--   3. Sin cambios: no toca la huella ni deja historial.
--   4. Lo que no se puede: un descuadre (y no cambia nada), una línea a los dos lados, una cuenta que no es de apunte,
--      un asiento que no es a mano, y con el trimestre presentado, con su frase.
--   5. El justificante: se guarda en el asiento a mano; el mismo otra vez no falla; otro distinto, no; el CHECK lo
--      admite y las tres clases de antes siguen.
--   6. El ancho del documento de cada persona: se guarda y se lee; 1 (plegado) vale; 1,5 no.
--   7. La vuelta atrás: quita lo nuevo; la de la 1101 para si hay un justificante guardado; sin él, devuelve el CHECK.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K12: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_asiento_modificar(uuid,jsonb,jsonb,text)') is null
     or to_regprocedure('public.conta_documento_justificante_guardar(uuid,text,text,text,integer,text)') is null then
    raise exception 'PRUEBA K12 · 0: faltan la 1100 y la 1101 delante.';
  end if;
  if not exists (select 1 from public.company where id = 'c0e20000-0000-4000-8000-0000000000e3') then
    raise exception 'PRUEBA K12 · 0: falta la gestoría del núcleo (seed_k02_nucleo_staging.sql).';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _k12 (clave text primary key, valor text) on commit drop;
grant all on _k12 to authenticated;

-- Las cuentas de la prueba, inventadas (un banco y un acreedor de apunte de la gestoría, que existen en la semilla).
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  if (select count(*) from public.company_account where company_id = emp and code in ('57200001', '41000001', '62800000')) <> 3 then
    raise exception 'PRUEBA K12 · 0: la gestoría no tiene la 57200001, la 41000001 y la 62800000.';
  end if;
end $$;

-- 1 · Un asiento a mano, por el camino de la pantalla ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid; v_e2 uuid; v_marca uuid; v_canal uuid; v_h1 text; v_h2 text;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-12' between starts_on and ends_on;
  select id into v_marca from public.brand where account_id = a order by id limit 1;
  select id into v_canal from public.sales_channel where account_id = a order by id limit 1;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, notes, created_by_name)
  values (a, emp, v_y, 4, '2026-11-12', 'K12 pago de prueba', 'manual', 'borrador', 'Observación de prueba K12', 'Prueba K12')
  returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common, brand_id, channel_id)
  select a, emp, v_e, x.p, c.id, x.d, x.h, 'K12 pago de prueba', false, case when x.p = 1 then v_marca end, case when x.p = 1 then v_canal end
    from (values (1, '41000001', 63.60, 0), (2, '57200001', 0, 63.60)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  perform public.journal_entry_validar(v_e, 'Prueba K12');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA K12 · 1: no ha quedado validado'; end if;
  if (select notes from public.journal_entry where id = v_e) <> 'Observación de prueba K12' then raise exception 'PRUEBA K12 · 1: sin observaciones'; end if;
  if v_canal is not null and (select channel_id from public.journal_line where entry_id = v_e and position = 1) is distinct from v_canal then
    raise exception 'PRUEBA K12 · 1: la plataforma no ha llegado a la línea';
  end if;
  -- El de detrás, para la cadena.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (a, emp, v_y, 4, '2026-11-13', 'K12 detrás', 'manual', 'borrador', 'Prueba K12') returning id into v_e2;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select a, emp, v_e2, x.p, c.id, x.d, x.h, false
    from (values (1, '62800000', 10, 0), (2, '57200001', 0, 10)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  perform public.journal_entry_validar(v_e2, 'Prueba K12');
  insert into _k12 values ('asiento', v_e::text), ('detras', v_e2::text), ('marca', coalesce(v_marca::text, '')), ('canal', coalesce(v_canal::text, ''));
  -- Regla 31: la huella no lee las observaciones.
  v_h1 := public.journal_entry_canonico(v_e);
  insert into _k12 values ('canon', v_h1);
  raise notice 'PRUEBA K12 · 1: asiento % validado con observaciones, marca y plataforma; huella %', (select number from public.journal_entry where id = v_e), (select hash from public.journal_entry where id = v_e);
end $$;
reset role;
-- Lo validado, en firme (su comprobación del PDF va al final de la transacción) antes de quitar un candado.
set constraints all immediate;
do $$
declare v_e uuid := (select valor::uuid from _k12 where clave = 'asiento'); v_c text;
begin
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  update public.journal_entry set notes = null where id = v_e;
  v_c := public.journal_entry_canonico(v_e);
  update public.journal_entry set notes = 'Observación de prueba K12' where id = v_e;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  if v_c <> (select valor from _k12 where clave = 'canon') then raise exception 'PRUEBA K12 · 1 · regla 31: la huella cambia con las observaciones'; end if;
  raise notice 'PRUEBA K12 · 1 · regla 31: la huella del asiento es la misma con y sin observaciones (md5 %).', left(md5(v_c), 8);
end $$;
insert into _k12 select 'numero', number::text from public.journal_entry where id = (select valor::uuid from _k12 where clave = 'asiento');
insert into _k12 select 'huella_detras', hash from public.journal_entry where id = (select valor::uuid from _k12 where clave = 'detras');

-- 2 · Cambiarlo validado ------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_se jsonb; v_e uuid := (select valor::uuid from _k12 where clave = 'asiento'); v_canal text := (select valor from _k12 where clave = 'canal');
begin
  v_se := public.conta_asiento_se_puede_modificar(v_e);
  if not (v_se->>'puede')::boolean then raise exception 'PRUEBA K12 · 2: debería poderse cambiar (%)', v_se; end if;
  r := public.conta_asiento_modificar(v_e,
         jsonb_build_object('concepto', 'K12 pago cambiado', 'notas', 'Otra observación', 'documento', 'DOC-K12', 'fecha_documento', '2026-11-11'),
         jsonb_build_array(
           jsonb_build_object('cuenta', '62800000', 'concepto', 'K12 cambiado', 'debe', 70, 'plataforma', v_canal),
           jsonb_build_object('cuenta', '57200001', 'concepto', 'K12 cambiado', 'haber', 70)), 'Prueba K12');
  if (r->>'numero')::int <> (select valor::int from _k12 where clave = 'numero') then raise exception 'PRUEBA K12 · 2: ha cambiado el número (%)', r; end if;
  raise notice 'PRUEBA K12 · 2: «%»', r->>'texto';
end $$;
reset role;
do $$
declare v_e uuid := (select valor::uuid from _k12 where clave = 'asiento'); e public.journal_entry; v_canal text := (select valor from _k12 where clave = 'canal');
begin
  select * into e from public.journal_entry where id = v_e;
  if e.number <> (select valor::int from _k12 where clave = 'numero') or e.status <> 'validado' or e.concept <> 'K12 pago cambiado'
     or e.notes <> 'Otra observación' or e.document_ref <> 'DOC-K12' or e.document_date <> date '2026-11-11' then
    raise exception 'PRUEBA K12 · 2: la cabecera no es la cambiada (%)', to_jsonb(e);
  end if;
  if (select string_agg(c.code || ':' || l.debit || ':' || l.credit, ' ' order by l.position) from public.journal_line l
        join public.company_account c on c.id = l.company_account_id where l.entry_id = v_e) <> '62800000:70.00:0.00 57200001:0.00:70.00' then
    raise exception 'PRUEBA K12 · 2: las líneas no son las cambiadas';
  end if;
  if v_canal <> '' and (select channel_id::text from public.journal_line where entry_id = v_e and position = 1) <> v_canal then
    raise exception 'PRUEBA K12 · 2: la plataforma no ha llegado a la línea cambiada';
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA K12 · 2: la cadena no cuadra'; end if;
  if (select hash from public.journal_entry where id = (select valor::uuid from _k12 where clave = 'detras')) = (select valor from _k12 where clave = 'huella_detras') then
    raise exception 'PRUEBA K12 · 2: el de detrás no se ha vuelto a encadenar';
  end if;
  if (select count(*) from public.conta_asiento_modificado where entry_id = v_e) <> 1 then raise exception 'PRUEBA K12 · 2: falta su respaldo'; end if;
  if (select coalesce(sum(debit), 0) from public.journal_ledger where entry_id = v_e) <> 70 then raise exception 'PRUEBA K12 · 2: el libro no lleva lo cambiado'; end if;
  raise notice 'PRUEBA K12 · 2: el mismo número (%), la cabecera y las líneas nuevas, la plataforma en la línea, la cadena íntegra (el de detrás, vuelto a encadenar), su respaldo y el libro con 70.', e.number;
end $$;

-- 3 · Sin cambios --------------------------------------------------------------------------------------------------------
insert into _k12 select 'huella2', hash from public.journal_entry where id = (select valor::uuid from _k12 where clave = 'asiento');
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_e uuid := (select valor::uuid from _k12 where clave = 'asiento'); v_canal text := (select valor from _k12 where clave = 'canal');
begin
  r := public.conta_asiento_modificar(v_e, jsonb_build_object('concepto', 'K12 pago cambiado', 'notas', 'Otra observación'),
         jsonb_build_array(
           jsonb_build_object('cuenta', '62800000', 'concepto', 'K12 cambiado', 'debe', 70, 'plataforma', v_canal),
           jsonb_build_object('cuenta', '57200001', 'concepto', 'K12 cambiado', 'haber', 70)), 'Prueba K12');
  if (r->>'apuntes')::int <> 0 then raise exception 'PRUEBA K12 · 3: sin cambios ha cambiado algo (%)', r; end if;
  raise notice 'PRUEBA K12 · 3: «%»', r->>'texto';
end $$;
reset role;
do $$ begin
  if (select hash from public.journal_entry where id = (select valor::uuid from _k12 where clave = 'asiento')) <> (select valor from _k12 where clave = 'huella2')
     or (select count(*) from public.conta_asiento_modificado where entry_id = (select valor::uuid from _k12 where clave = 'asiento')) <> 1 then
    raise exception 'PRUEBA K12 · 3: sin cambios ha tocado la huella o ha dejado historial';
  end if;
end $$;

-- 4 · Lo que no se puede -------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_msg text; v_e uuid := (select valor::uuid from _k12 where clave = 'asiento'); v_otro uuid; v_se jsonb;
begin
  begin perform public.conta_asiento_modificar(v_e, '{}', '[{"cuenta": "62800000", "debe": 70}, {"cuenta": "57200001", "haber": 69}]', 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^No cuadra' then raise exception 'PRUEBA K12 · 4: el descuadre (%)', v_msg; end if;
  v_msg := null;
  begin perform public.conta_asiento_modificar(v_e, '{}', '[{"cuenta": "62800000", "debe": 70, "haber": 70}, {"cuenta": "57200001", "haber": 0}]', 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ 'un importe, al debe o al haber' then raise exception 'PRUEBA K12 · 4: a los dos lados (%)', v_msg; end if;
  v_msg := null;
  begin perform public.conta_asiento_modificar(v_e, '{}', '[{"cuenta": "572", "debe": 70}, {"cuenta": "57200001", "haber": 70}]', 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '(tiene subcuentas|no está en el plan)' then raise exception 'PRUEBA K12 · 4: una cuenta que no es de apunte (%)', v_msg; end if;
  if (select concept from public.journal_entry where id = v_e) <> 'K12 pago cambiado' then raise exception 'PRUEBA K12 · 4: un intento fallido ha cambiado algo'; end if;
  -- Uno que no es a mano: un pago a proveedor, inventado, validado por el mismo camino.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  select account_id, company_id, fiscal_year_id, 4, '2026-11-12', 'K12 pago de proveedor', 'supplier_payment', 'borrador', 'Prueba K12'
    from public.journal_entry where id = v_e returning id into v_otro;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select l.account_id, l.company_id, v_otro, l.position, l.company_account_id, l.debit, l.credit, false from public.journal_line l where l.entry_id = v_e;
  perform public.journal_entry_validar(v_otro, 'Prueba K12');
  v_se := public.conta_asiento_se_puede_modificar(v_otro);
  if (v_se->>'puede')::boolean or v_se->>'porque' <> 'No es un asiento a mano: se cambia en su ficha.' then raise exception 'PRUEBA K12 · 4: uno que no es a mano (%)', v_se; end if;
  v_msg := null;
  begin perform public.conta_asiento_modificar(v_otro, '{}', '[{"cuenta": "62800000", "debe": 70}, {"cuenta": "57200001", "haber": 70}]', 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'porque' then raise exception 'PRUEBA K12 · 4: uno que no es a mano, cambiar (%)', v_msg; end if;
  raise notice 'PRUEBA K12 · 4: el descuadre, una línea a los dos lados y una cuenta que no es de apunte, no (y no cambian nada); un pago a proveedor, «%».', v_msg;
end $$;
reset role;
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', '303', 2026, 'quarterly', '4T', date '2027-01-30', 'filed', 'zero', 0, now(), 'outside', 'PRUEBAK12CSV0000');
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_se jsonb; v_msg text; v_e uuid := (select valor::uuid from _k12 where clave = 'asiento');
begin
  v_se := public.conta_asiento_se_puede_modificar(v_e);
  if (v_se->>'puede')::boolean or v_se->>'porque' <> 'El IVA del 4T ya está presentado: este asiento no se cambia.' then
    raise exception 'PRUEBA K12 · 4: con el 4T presentado (%)', v_se;
  end if;
  begin perform public.conta_asiento_modificar(v_e, '{}', '[{"cuenta": "62800000", "debe": 1}, {"cuenta": "57200001", "haber": 1}]', 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'porque' then raise exception 'PRUEBA K12 · 4: con el 4T presentado, cambiar (%)', v_msg; end if;
  raise notice 'PRUEBA K12 · 4: con el 4T presentado, «%»', v_msg;
end $$;
reset role;
delete from public.tax_return where aeat_csv = 'PRUEBAK12CSV0000';

-- 5 · El justificante ----------------------------------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, metadata)
select 'conta-documentos', 'c0e20000-0000-4000-8000-0000000000e0/' || valor || '/' || repeat('c', 64) || '.pdf', '{"size": 4321, "mimetype": "application/pdf"}'
  from _k12 where clave = 'asiento';
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_msg text; v_e uuid := (select valor::uuid from _k12 where clave = 'asiento');
  v_ruta text := 'c0e20000-0000-4000-8000-0000000000e0/' || (select valor from _k12 where clave = 'asiento') || '/' || repeat('c', 64) || '.pdf';
begin
  r := public.conta_documento_justificante_guardar(v_e, v_ruta, 'justificante-k12.pdf', repeat('c', 64), 4321, 'Prueba K12');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA K12 · 5: el primero no debería estar (%)', r; end if;
  r := public.conta_documento_justificante_guardar(v_e, v_ruta, 'justificante-k12.pdf', repeat('c', 64), 4321, 'Prueba K12');
  if not (r->>'ya_estaba')::boolean then raise exception 'PRUEBA K12 · 5: el mismo otra vez debería decir que ya estaba (%)', r; end if;
  begin perform public.conta_documento_justificante_guardar(v_e, v_ruta, 'otro.pdf', repeat('d', 64), 4321, 'Prueba K12');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null or v_msg !~ '^Ese asiento ya tiene su justificante' then raise exception 'PRUEBA K12 · 5: otro distinto (%)', v_msg; end if;
  raise notice 'PRUEBA K12 · 5: el justificante se guarda; el mismo otra vez, «ya estaba»; otro distinto, «%».', v_msg;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.journal_entry_document where entry_id = (select valor::uuid from _k12 where clave = 'asiento') and kind = 'justificante') <> 1 then
    raise exception 'PRUEBA K12 · 5: no hay un justificante';
  end if;
  if exists (select 1 from public.journal_entry_document where kind not in ('resumen_ventas', 'factura_recibida', 'factura_expedida', 'justificante')) then
    raise exception 'PRUEBA K12 · 5: hay clases fuera del CHECK';
  end if;
end $$;

-- 6 · El ancho del documento de cada persona -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_msg text; a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; u constant uuid := 'c0e20000-0000-4000-8000-0000000000e1';
begin
  insert into public.conta_user_pref (account_id, user_id, reparto_documento) values (a, u, 0.62)
  on conflict (account_id, user_id) do update set reparto_documento = excluded.reparto_documento;
  if (select reparto_documento from public.conta_user_pref where account_id = a and user_id = u) <> 0.62 then raise exception 'PRUEBA K12 · 6: no se lee lo guardado'; end if;
  update public.conta_user_pref set reparto_documento = 1 where account_id = a and user_id = u;
  begin update public.conta_user_pref set reparto_documento = 1.5 where account_id = a and user_id = u;
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'PRUEBA K12 · 6: 1,5 no debería caber'; end if;
  raise notice 'PRUEBA K12 · 6: 0,62 se guarda y se lee; 1 (plegado) vale; 1,5 no.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · La vuelta atrás ---------------------------------------------------------------------------------------------------------
do $$
declare v_msg text;
begin
  begin
    perform 1 from public.journal_entry_document where kind = 'justificante';
    if found then raise exception 'K12 · vuelta atrás: hay % justificantes guardados; el CHECK no se devuelve sin decidir qué se hace con ellos.',
      (select count(*) from public.journal_entry_document where kind = 'justificante'); end if;
  exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'PRUEBA K12 · 7: la vuelta atrás de la 1101 no para con un justificante guardado'; end if;
  raise notice 'PRUEBA K12 · 7: con un justificante guardado, la vuelta atrás de la 1101 para: «%»', v_msg;
end $$;
delete from public.journal_entry_document where kind = 'justificante' and entry_id = (select valor::uuid from _k12 where clave = 'asiento');
\i supabase/vuelta-atras/20261122T1101_k12_justificante.down.sql
\i supabase/vuelta-atras/20261122T1100_k12_asiento_general.down.sql
do $$ begin
  if to_regprocedure('public.conta_asiento_modificar(uuid,jsonb,jsonb,text)') is not null
     or to_regprocedure('public.conta_documento_justificante_guardar(uuid,text,text,text,integer,text)') is not null
     or to_regclass('public.conta_asiento_modificado') is not null then
    raise exception 'PRUEBA K12 · 7: la vuelta atrás no quita lo nuevo';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_document_kind_check')) ~ 'justificante' then
    raise exception 'PRUEBA K12 · 7: el CHECK sigue admitiendo el justificante';
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA K12 · 7: la cadena no cuadra después'; end if;
  raise notice 'PRUEBA K12 · 7: la vuelta atrás quita las funciones y la tabla, devuelve el CHECK, y deja las columnas con lo escrito; la cadena, íntegra.';
end $$;

rollback;
