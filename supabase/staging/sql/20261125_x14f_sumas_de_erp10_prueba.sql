-- supabase/staging/sql/20261125_x14f_sumas_de_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T1533_x14f_sumas_de_erp10), que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_poner_sumas (nueva),
-- public._conta_traer_comparar, public.conta_traer_antes_de_dar_por_bueno y public.conta_traer_dar_por_bueno.
--
-- En una empresa NUEVA de la cuenta A (pymes, 8 dígitos, con 2026), como el administrador a1, con lo leído INVENTADO de 2024
-- (12 asientos de 121,00: 1.452,00 en la 43000901 y en la 70500000) y, como la conexión, un sumas y saldos CALCULADO de los
-- mismos asientos. Los caminos:
--   1. En prueba, con el calculado: no está comparado, no se puede dar por bueno y lo dice; y conta_traer_dar_por_bueno para.
--   2. Con un fichero que no cuadra (10,00 más al debe de la 43000901): 1 de 2 cuentas no queda igual, y no se da por bueno.
--   3. Con el fichero bueno: las 2 cuentas, iguales al céntimo, y se da por bueno.
--   4. Un fichero sin cuentas, o con importes que no son céntimos, no se guarda.
--   5. La vuelta atrás: la nueva fuera y las tres de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14f: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_traer_poner_sumas(uuid,jsonb,text)') is null then raise exception 'PRUEBA X14f · 0: falta la 20261125T1533 delante.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14f (k text primary key, v text) on commit drop;
grant all on _x14f to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14f where _x14f.k = $1 $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- La empresa nueva, con solo 2026, y la carga inventada de 2024.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb; d7 text; s int := 0; x int;
begin
  -- Un CIF inventado al azar con su dígito de control (como cifInventado de las e2e): el de la cuenta tiene que ser único.
  d7 := lpad(floor(random() * 1e7)::bigint::text, 7, '0');
  for i in 1..7 loop
    x := substr(d7, i, 1)::int;
    if i % 2 = 1 then x := x * 2; s := s + x / 10 + x % 10; else s := s + x; end if;
  end loop;
  insert into public.company (account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values (v_acc, 'Prueba X14f inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14F'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', '[]'::jsonb,
    'asientos', (select jsonb_agg(jsonb_build_object('clave', 'X14F-' || y || '-' || m, 'serie', '1', 'documento', (y * 100 + m)::text, 'fecha', make_date(y, m, 15)::text,
        'concepto', 'Inventado X14f ' || y || '/' || m, 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))) order by y, m)
      from generate_series(2024, 2024) y, generate_series(1, 12) m),
    'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', 'Calculado', 'debe', 145200, 'haber', 0), jsonb_build_object('cuenta', '70500000', 'nombre', 'Calculado', 'debe', 0, 'haber', 145200)), 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14f values ('empresa', c), ('datos', d::text);
end $$;
set local role authenticated;

-- 1 · En prueba, con el calculado ----------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; a jsonb; ok boolean := false;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14f');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' then raise exception 'PRUEBA X14f · 1: no ha entrado en prueba: %', r; end if;
  insert into _x14f values ('carga', v_r.id);
  a := public.conta_traer_antes_de_dar_por_bueno(v_r.id);
  if (a->>'comparado')::boolean or (a->>'puede')::boolean or a->>'texto' not like 'No se ha podido comparar con el sumas y saldos de ERP10:%' then
    raise exception 'PRUEBA X14f · 1: con el calculado dice %', a;
  end if;
  begin perform public.conta_traer_dar_por_bueno(v_r.id, 'Prueba X14f');
  exception when others then ok := sqlerrm like 'No se ha podido comparar con el sumas y saldos de ERP10:%'; end;
  if not ok then raise exception 'PRUEBA X14f · 1: conta_traer_dar_por_bueno no para sin comparar.'; end if;
  raise notice 'PRUEBA X14f · 1: con el calculado de los asientos, no comparado y no se da por bueno: «%»', a->>'texto';
end $$;

-- 2 · Un fichero que no cuadra -----------------------------------------------------------------------------------------------
do $$
declare c jsonb; a jsonb;
begin
  c := public.conta_traer_poner_sumas(pg_temp.p('carga')::uuid, '[{"cuenta": "43000901", "nombre": "Inventado", "debe": 146200, "haber": 0},
                                                              {"cuenta": "70500000", "nombre": "Inventado", "debe": 0, "haber": 145200}]', 'Prueba X14f');
  if not (c->>'comparado')::boolean or (c->>'cuentas')::int <> 2 or jsonb_array_length(c->'diferencias') <> 1 or c->'diferencias'->0->>'cuenta' <> '43000901' then
    raise exception 'PRUEBA X14f · 2: con el fichero que no cuadra dice %', c;
  end if;
  a := public.conta_traer_antes_de_dar_por_bueno(pg_temp.p('carga')::uuid);
  if (a->>'puede')::boolean then raise exception 'PRUEBA X14f · 2: se podría dar por bueno sin cuadrar: %', a; end if;
  raise notice 'PRUEBA X14f · 2: «%»', c->>'texto';
end $$;

-- 3 · El fichero bueno ---------------------------------------------------------------------------------------------------------
do $$
declare c jsonb; a jsonb;
begin
  c := public.conta_traer_poner_sumas(pg_temp.p('carga')::uuid, '[{"cuenta": "43000901", "nombre": "Inventado", "debe": 145200, "haber": 0},
                                                              {"cuenta": "70500000", "nombre": "Inventado", "debe": 0, "haber": 145200}]', 'Prueba X14f');
  if c->>'texto' is distinct from 'Comparado con el sumas y saldos de ERP10: las 2 cuentas, iguales al céntimo en el debe y en el haber.' then
    raise exception 'PRUEBA X14f · 3: con el fichero bueno dice %', c;
  end if;
  a := public.conta_traer_antes_de_dar_por_bueno(pg_temp.p('carga')::uuid);
  if not (a->>'puede')::boolean or (a->>'cuentas')::int <> 2 then raise exception 'PRUEBA X14f · 3: no se puede dar por bueno: %', a; end if;
  perform public.conta_traer_dar_por_bueno(pg_temp.p('carga')::uuid, 'Prueba X14f');
  if (select status from public.import_run where id = pg_temp.p('carga')::uuid) <> 'dada_por_buena' then raise exception 'PRUEBA X14f · 3: no se ha dado por buena.'; end if;
  raise notice 'PRUEBA X14f · 3: «%», y dada por buena.', c->>'texto';
end $$;

-- 4 · Un fichero sin cuentas, o con importes que no son céntimos ----------------------------------------------------------------
do $$
declare v_r uuid; ok1 boolean := false; ok2 boolean := false;
begin
  -- Otra carga en prueba de la misma empresa (la de arriba ya está dada por buena).
  v_r := (public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', jsonb_set(pg_temp.p('datos')::jsonb, '{asientos}', '[]'), 'Prueba X14f')->>'carga')::uuid;
  begin perform public.conta_traer_poner_sumas(v_r, '[]', 'Prueba X14f'); exception when others then ok1 := sqlerrm like 'El fichero no trae ninguna cuenta%'; end;
  begin perform public.conta_traer_poner_sumas(v_r, '[{"cuenta": "43000901", "debe": "12,5", "haber": 0}]', 'Prueba X14f');
  exception when others then ok2 := sqlerrm like 'El sumas y saldos trae 1 fila sin cuenta o sin importe en céntimos%'; end;
  if not (ok1 and ok2) then raise exception 'PRUEBA X14f · 4: un fichero vacío o con importes mal se ha guardado (% %).', ok1, ok2; end if;
  raise notice 'PRUEBA X14f · 4: un fichero vacío, o con un importe que no son céntimos, no se guarda.';
end $$;
reset role;

-- 5 · La vuelta atrás -----------------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T1533_x14f_sumas_de_erp10.down.sql
do $$ begin
  if to_regprocedure('public.conta_traer_poner_sumas(uuid,jsonb,text)') is not null
     or strpos(pg_get_functiondef('public._conta_traer_comparar(uuid)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_traer_antes_de_dar_por_bueno(uuid)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_traer_dar_por_bueno(uuid,text)'::regprocedure), 'X14 · 2') > 0 then
    raise exception 'PRUEBA X14f · 5: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14f · 5: la vuelta atrás quita la nueva y deja las tres de antes.';
  raise notice 'PRUEBA X14f: 5 de 5 bien.';
end $$;

rollback;
