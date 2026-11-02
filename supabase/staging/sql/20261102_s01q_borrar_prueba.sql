-- supabase/staging/sql/20261102_s01q_borrar_prueba.sql
--
-- SOLO STAGING. Prueba del S01q · borrar asientos (20261102T1837 y 1838). Todo
-- en una transacción con ROLLBACK. Datos inventados, en la cuenta D. Añade
-- public._conta_asientos_borrar, public._conta_asientos_borrado_deshacer y
-- public._conta_cadena_rota; la 1838 es de Foodint y en staging no hace nada.
--   1. Cinco asientos validados seguidos de la serie 2; la cadena, íntegra.
--   2. Se borran el 2.º y el 4.º: el 3.º y el 5.º se RENUMERAN (la serie sigue
--      seguida), la cadena se RECALCULA desde el primer borrado y sigue íntegra,
--      y lo borrado queda en el respaldo con su motivo.
--   3. El siguiente que se valida coge el número siguiente, sin hueco.
--   4. Deshacer el lote: todo vuelve, con su número y su cadena de antes.
--   5. Un asiento de antes del corte no se borra, y lo dice.
--   6. Nadie de fuera puede llamar al borrado.
--   7. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q borrar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: el borrado solo lo llama una tanda (como propietaria); el punto 6 prueba que un usuario no puede.

\i supabase/migrations/20261102T1837_s01q_borrar_asientos.sql
\i supabase/migrations/20261102T1838_s01q_foodint_duplicados.sql

create temp table _p (k text primary key, v text) on commit drop;
grant select on _p to authenticated;

-- 1 · Cinco asientos validados de la serie 2 (inventados), con la cadena íntegra.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  r jsonb; i int;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-11-02' between starts_on and ends_on);
  if public._conta_corte(v_e) is not null and public._conta_corte(v_e) > date '2026-11-02' then
    raise exception 'PRUEBA S01q borrar: el corte de la cuenta D (%) no deja probar.', public._conta_corte(v_e);
  end if;
  if public._conta_cadena_rota(v_e) <> 0 then raise exception 'PRUEBA S01q borrar · 1: la cadena de la cuenta D ya venía rota.'; end if;
  for i in 1..5 loop
    r := public._journal_entry_proponer(v_e,
      jsonb_build_object('series', 2, 'fecha', date '2026-11-02', 'concepto', 'Asiento inventado S01q ' || i, 'source_type', 'manual',
                         'confianza', 'seguro', 'porque', 'Prueba del borrado.'),
      jsonb_build_array(jsonb_build_object('cuenta', '62300000', 'debe', 10 * i, 'haber', 0, 'comun', true),
                        jsonb_build_object('cuenta', '62900000', 'debe', 0, 'haber', 10 * i, 'comun', true)), null, 'Prueba S01q', null);
    r := public._journal_entry_validar((r->>'id')::uuid, 'Prueba S01q');
    insert into _p values ('e' || i, r->>'id'), ('n' || i, r->>'numero');
  end loop;
  insert into _p select 'seq' || substr(k, 2), (select chain_seq::text from public.journal_entry where id = v::uuid) from _p where k like 'e%';
  if public._conta_cadena_rota(v_e) <> 0 then raise exception 'PRUEBA S01q borrar · 1: la cadena no cuadra después de validar.'; end if;
  raise notice 'PRUEBA S01q borrar · 1: cinco asientos, del % al %; la cadena, íntegra.', (select v from _p where k = 'n1'), (select v from _p where k = 'n5');
end $$;

-- 2 · Se borran el 2.º y el 4.º: renumerados el 3.º y el 5.º, la cadena recalculada.
do $$
declare v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2'; r jsonb; n1 int; v_seq bigint;
begin
  n1 := (select v from _p where k = 'n1')::int;
  r := public._conta_asientos_borrar(v_e, array[(select v from _p where k = 'e2')::uuid, (select v from _p where k = 'e4')::uuid],
                                     'Prueba: asiento duplicado inventado.', 'Prueba S01q');
  insert into _p values ('lote', r->>'lote');
  if (r->>'borrados')::int <> 2 or exists (select 1 from public.journal_entry where id in ((select v from _p where k = 'e2')::uuid, (select v from _p where k = 'e4')::uuid)) then
    raise exception 'PRUEBA S01q borrar · 2: no se han borrado los dos: %', r;
  end if;
  if (select number from public.journal_entry where id = (select v from _p where k = 'e3')::uuid) <> n1 + 1
     or (select number from public.journal_entry where id = (select v from _p where k = 'e5')::uuid) <> n1 + 2 then
    raise exception 'PRUEBA S01q borrar · 2: la serie no queda seguida (el 3.º es el %, el 5.º el %).',
      (select number from public.journal_entry where id = (select v from _p where k = 'e3')::uuid), (select number from public.journal_entry where id = (select v from _p where k = 'e5')::uuid);
  end if;
  v_seq := (select v from _p where k = 'seq2')::bigint;
  if (select chain_seq from public.journal_entry where id = (select v from _p where k = 'e3')::uuid) <> v_seq
     or (select chain_seq from public.journal_entry where id = (select v from _p where k = 'e5')::uuid) <> v_seq + 1 then
    raise exception 'PRUEBA S01q borrar · 2: la cadena no se ha recalculado desde el primer borrado.';
  end if;
  if public._conta_cadena_rota(v_e) <> 0 then raise exception 'PRUEBA S01q borrar · 2: la cadena no cuadra después de borrar.'; end if;
  if (select count(*) from public.conta_asiento_borrado where lote = (r->>'lote')::uuid and que = 'asiento' and jsonb_array_length(lineas) = 2) <> 2 then
    raise exception 'PRUEBA S01q borrar · 2: el respaldo no guarda los dos asientos con sus líneas.';
  end if;
  raise notice 'PRUEBA S01q borrar · 2: %', r->>'texto';
end $$;

-- 3 · El siguiente coge el número siguiente: sin hueco.
do $$
declare v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2'; r jsonb;
begin
  r := public._journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', date '2026-11-02', 'concepto', 'Asiento inventado S01q 6', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba del borrado.'),
    jsonb_build_array(jsonb_build_object('cuenta', '62300000', 'debe', 60, 'haber', 0, 'comun', true),
                      jsonb_build_object('cuenta', '62900000', 'debe', 0, 'haber', 60, 'comun', true)), null, 'Prueba S01q', null);
  r := public._journal_entry_validar((r->>'id')::uuid, 'Prueba S01q');
  if (r->>'numero')::int <> (select v from _p where k = 'n1')::int + 3 then raise exception 'PRUEBA S01q borrar · 3: el siguiente sale con el %.', r->>'numero'; end if;
  if public._conta_cadena_rota(v_e) <> 0 then raise exception 'PRUEBA S01q borrar · 3: la cadena no cuadra con el siguiente.'; end if;
  insert into _p values ('e6', r->>'id');
  raise notice 'PRUEBA S01q borrar · 3: el siguiente es el %, sin hueco.', r->>'numero';
end $$;

-- 4 · Deshacer: se quita antes el 6.º (no es del lote), y todo vuelve como estaba.
do $$
declare v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2'; r jsonb;
begin
  perform public._conta_asientos_borrar(v_e, array[(select v from _p where k = 'e6')::uuid], 'Prueba: el 6.º, para deshacer el lote.', 'Prueba S01q');
  r := public._conta_asientos_borrado_deshacer((select v from _p where k = 'lote')::uuid);
  if (select count(*) from _p p join public.journal_entry e on e.id = p.v::uuid
       where p.k in ('e1', 'e2', 'e3', 'e4', 'e5') and e.number = (select v from _p where k = 'n' || substr(p.k, 2))::int
         and e.chain_seq = (select v from _p where k = 'seq' || substr(p.k, 2))::bigint) <> 5 then
    raise exception 'PRUEBA S01q borrar · 4: al deshacer, los cinco no vuelven con su número y su eslabón de antes.';
  end if;
  if public._conta_cadena_rota(v_e) <> 0 then raise exception 'PRUEBA S01q borrar · 4: la cadena no cuadra al deshacer.'; end if;
  raise notice 'PRUEBA S01q borrar · 4: %', r->>'texto';
end $$;

-- 5 · Antes del corte: no se borra.
do $$
declare v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2'; v_ok boolean := false;
begin
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, 'c01d0000-0000-4000-8000-00000000000d', date '2026-11-03')
  on conflict (company_id) do update set cutover_date = date '2026-11-03';
  begin
    perform public._conta_asientos_borrar(v_e, array[(select v from _p where k = 'e1')::uuid], 'Prueba: antes del corte.', 'Prueba S01q');
  exception when others then
    v_ok := sqlerrm like '%antes del corte%';
    raise notice 'PRUEBA S01q borrar · 5: «%»', sqlerrm;
  end;
  if not v_ok then raise exception 'PRUEBA S01q borrar · 5: un asiento de antes del corte se ha borrado, o no lo dice.'; end if;
end $$;

-- 6 · Nadie de fuera puede llamarlo.
do $$
begin
  if has_function_privilege('authenticated', 'public._conta_asientos_borrar(uuid,uuid[],text,text)', 'execute')
     or has_function_privilege('service_role', 'public._conta_asientos_borrar(uuid,uuid[],text,text)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_asientos_borrado_deshacer(uuid)', 'execute') then
    raise exception 'PRUEBA S01q borrar · 6: un usuario o el servicio pueden llamar al borrado.';
  end if;
  raise notice 'PRUEBA S01q borrar · 6: solo una tanda puede borrar.';
end $$;

-- 7 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T1838_s01q_foodint_duplicados.down.sql
\i supabase/vuelta-atras/20261102T1837_s01q_borrar_asientos.down.sql
do $$ begin
  if to_regprocedure('public._conta_asientos_borrar(uuid,uuid[],text,text)') is not null then
    raise exception 'PRUEBA S01q borrar · 7: la vuelta atrás no quita el borrado.';
  end if;
  raise notice 'PRUEBA S01q borrar · 7: la vuelta atrás quita el borrado (el registro se queda si guarda algo).';
end $$;
\i supabase/migrations/20261102T1837_s01q_borrar_asientos.sql

rollback;
