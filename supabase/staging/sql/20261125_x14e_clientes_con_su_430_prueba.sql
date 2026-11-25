-- supabase/staging/sql/20261125_x14e_clientes_con_su_430_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T1415_x14e_clientes_con_su_430 y 20261125T1649_x14e_ajustar_a_erp10), que el ensayo de staging pone delante en la misma sesión.
-- Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_cargar y
-- public.conta_traer_deshacer; y las nuevas public._conta_traer_como_erp10, public._conta_traer_como_erp10_deshacer y
-- public._conta_traer_ajustar_a_erp10.
--
-- Regla (Julio, 25/11): la carga de ERP10 es una foto fiel y exacta: gana ERP10 y Sumied se ajusta; nunca al revés.
-- En una empresa NUEVA de la cuenta A (pymes, 8 dígitos, con 2026), como el administrador a1, con lo leído INVENTADO (NIF al
-- azar con su letra). Una primera carga (solo cuentas y terceros, dada por buena) deja en Sumied: el cliente «829» con la
-- 43000999 («VIEJO») y el código 999, y el cliente «830» con la 43000830 y el código 830. Lo de ERP10 (la segunda carga, de
-- 2024): el «829» es la 43000829; la 43000830 es de un cliente nuevo; y la 43000999 se llama «NUEVO». Los caminos:
--   1. Traer: el «829» pasa a la 43000829 y al código 829; la 43000830 pasa al nuevo (el «830» se queda sin ella), pero el
--      código 830 no: el nuevo no tiene fila en el cobro, y no se crean filas (Julio, 25/11); la 43000999 se llama «NUEVO» y
--      la 43000830, como el nuevo; y lo dice, los 5 cambios, en lo que hay que mirar.
--   2. Deshacer: todo como estaba (enlaces, códigos y nombre).
--   3. Lo ya traído (_conta_traer_ajustar_a_erp10): la misma carga en prueba con lo de Sumied puesto a mano se ajusta a
--      ERP10 igual (1 enlace movido, 1 quitado, 1 nuevo, 1 código, 1 nombre), una sola vez; deshacer la carga devuelve
--      también el ajuste; y la vuelta atrás de la
--      20261125T1649 la devuelve.
--   4. La vuelta atrás de la 20261125T1415: las dos funciones de antes y las nuevas, fuera.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14e: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_traer_ajustar_a_erp10(uuid,text)') is null then raise exception 'PRUEBA X14e · 0: falta la 20261125T1415 delante.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14e (k text primary key, v text) on commit drop;
grant all on _x14e to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14e where _x14e.k = $1 $$;
create function pg_temp.nif() returns text language sql volatile as $$
  select n || substr('TRWAGMYFPDXBNJZSQVHLCKE', (n::bigint % 23)::int + 1, 1) from (select lpad(floor(random() * 1e8)::bigint::text, 8, '0') n) x
$$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d7 text; s int := 0; x int;
  n29 text := pg_temp.nif(); n30 text := pg_temp.nif(); n31 text := pg_temp.nif();
  cli jsonb; a jsonb; b jsonb; vacio jsonb := '{"facturas": [], "aprendido": [], "pendientesNoExactos": [], "raros": [], "sumas": [], "inmovilizado": null, "frases": []}';
begin
  d7 := lpad(floor(random() * 1e7)::bigint::text, 7, '0');
  for i in 1..7 loop
    x := substr(d7, i, 1)::int;
    if i % 2 = 1 then x := x * 2; s := s + x / 10 + x % 10; else s := s + x; end if;
  end loop;
  insert into public.company (account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values (v_acc, 'Prueba X14e inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  cli := jsonb_build_object('n29', n29, 'n30', n30, 'n31', n31);
  -- A · Lo que hay en Sumied: solo cuentas y terceros.
  a := vacio || jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb, 'asientos', '[]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000999', 'nombre', 'VIEJO'), jsonb_build_object('codigo', '43000830', 'nombre', 'CLIENTE X14E 830')),
    'terceros', jsonb_build_array(jsonb_build_object('clase', 'cliente', 'codigo', '43000999', 'nombre', 'CLIENTE X14E 829', 'nombreComercial', '', 'nif', n29),
                                  jsonb_build_object('clase', 'cliente', 'codigo', '43000830', 'nombre', 'CLIENTE X14E 830', 'nombreComercial', '', 'nif', n30)));
  -- B · Lo de ERP10, de 2024.
  b := vacio || jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000829', 'nombre', 'CLIENTE X14E 829'), jsonb_build_object('codigo', '43000830', 'nombre', 'CLIENTE X14E 831'),
                                 jsonb_build_object('codigo', '43000999', 'nombre', 'NUEVO'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', jsonb_build_array(jsonb_build_object('clase', 'cliente', 'codigo', '43000829', 'nombre', 'CLIENTE X14E 829', 'nombreComercial', '', 'nif', n29),
                                  jsonb_build_object('clase', 'cliente', 'codigo', '43000830', 'nombre', 'CLIENTE X14E 831', 'nombreComercial', '', 'nif', n31)),
    'asientos', jsonb_build_array(
      jsonb_build_object('clave', 'X14E-1', 'serie', '1', 'documento', '1', 'fecha', '2024-03-15', 'concepto', 'Inventado X14e', 'apuntesLeidos', 3,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000829', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '43000830', 'nombre', '', 'concepto', 'Inventado', 'debe', 5000, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 17100)))));
  insert into _x14e values ('empresa', c), ('a', a::text), ('b', b::text), ('cli', cli::text);
end $$;
-- Cómo está: «cliente → su cuenta principal · su código», y el nombre de la 43000999.
create function pg_temp.estado() returns text language sql as $$
  select string_agg(p.name || '→' || coalesce(ca.code, '—') || '·' || coalesce(cc.codigo_cliente::text, '—'), ' ' order by p.name)
         || ' | 43000999=' || coalesce((select name from public.company_account where company_id = pg_temp.p('empresa')::uuid and code = '43000999'), '—')
    from public.party p
    left join public.company_account_link l on l.company_id = pg_temp.p('empresa')::uuid and l.entity = 'customer' and l.entity_id = p.id::text and l.role = 'principal'
    left join public.company_account ca on ca.id = l.company_account_id
    left join public.conta_cobro_cliente cc on cc.company_id = pg_temp.p('empresa')::uuid and cc.party_id = p.id
   where p.account_id = 'c01a0000-0000-4000-8000-00000000000a'
     and p.tax_id in (select value from jsonb_each_text(pg_temp.p('cli')::jsonb))
$$;
grant execute on function pg_temp.estado() to authenticated;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, null, pg_temp.p('a')::jsonb, 'Prueba X14e');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  insert into _x14e values ('cargaA', r->>'carga');
end $$;
reset role;
update public.import_run set status = 'dada_por_buena', finished_at = now() where id = pg_temp.p('cargaA')::uuid;   -- como si se hubiera dado por buena
-- Sus fichas del cobro, con su código de Sumied (el cobro las crea; Traer, ya no).
insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente)
select pg_temp.p('empresa')::uuid, p.id, p.account_id, case p.tax_id when pg_temp.p('cli')::jsonb->>'n29' then 999 else 830 end
  from public.party p where p.account_id = 'c01a0000-0000-4000-8000-00000000000a' and p.tax_id in (pg_temp.p('cli')::jsonb->>'n29', pg_temp.p('cli')::jsonb->>'n30')
on conflict (company_id, party_id) do update set codigo_cliente = excluded.codigo_cliente;
insert into _x14e select 'antes', pg_temp.estado();
do $$ begin
  if pg_temp.p('antes') is distinct from 'CLIENTE X14E 829→43000999·999 CLIENTE X14E 830→43000830·830 | 43000999=VIEJO' then
    raise exception 'PRUEBA X14e · 0: lo de Sumied no ha quedado como se quería: %', pg_temp.p('antes');
  end if;
end $$;
set local role authenticated;

-- 1 · Traer lo de ERP10 ------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; v_frases text;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('b')::jsonb, 'Prueba X14e');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' then raise exception 'PRUEBA X14e · 1: no ha entrado en prueba: %', r; end if;
  if pg_temp.estado() is distinct from 'CLIENTE X14E 829→43000829·829 CLIENTE X14E 830→—·830 CLIENTE X14E 831→43000830·— | 43000999=NUEVO' then
    raise exception 'PRUEBA X14e · 1: no queda como en ERP10: %', pg_temp.estado();
  end if;
  select string_agg(m->>'frase', ' | ' order by m->>'frase') into v_frases from jsonb_array_elements(v_r.detail->'mirar') m
   where m->>'que' in ('tercero', 'codigo_cliente', 'cuenta') and m->>'frase' ~ '(pasa|se queda así)';
  if (select count(*) from regexp_matches(v_frases, '\|', 'g')) <> 4 then raise exception 'PRUEBA X14e · 1: lo que hay que mirar no dice los 5 cambios: %', v_frases; end if;
  insert into _x14e values ('cargaB', v_r.id);
  raise notice 'PRUEBA X14e · 1: como en ERP10 (%), y lo dice: «%».', pg_temp.estado(), v_frases;
end $$;

-- 2 · Deshacer -------------------------------------------------------------------------------------------------------------------
do $$ begin
  perform public.conta_traer_deshacer(pg_temp.p('cargaB')::uuid, 'Prueba X14e');
  if pg_temp.estado() is distinct from pg_temp.p('antes') then raise exception 'PRUEBA X14e · 2: deshacer no lo deja como estaba: % (antes %)', pg_temp.estado(), pg_temp.p('antes'); end if;
  raise notice 'PRUEBA X14e · 2: deshecha, todo vuelve a «%».', pg_temp.estado();
end $$;

-- 3 · Lo ya traído, ajustado a ERP10 ----------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('b')::jsonb, 'Prueba X14e');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  insert into _x14e values ('cargaC', r->>'carga');
end $$;
reset role;
-- Como si se hubiera traído con la regla de antes: lo de Sumied, puesto a mano otra vez; en prueba, con el sumas y saldos de
-- su fichero (la 43000999 se llama «NUEVO» en ERP10).
do $$
declare c uuid := pg_temp.p('empresa')::uuid; v_r public.import_run;
begin
  select * into v_r from public.import_run where id = pg_temp.p('cargaC')::uuid;
  perform public._conta_traer_como_erp10_deshacer(v_r.detail->'deshacer'->'enlaces_erp10');
  update public.company_account a set name = y->>'name' from jsonb_array_elements(coalesce(v_r.detail->'deshacer'->'nombres', '[]')) y where a.id = (y->>'id')::uuid;
  delete from public.conta_cobro_cliente where company_id = c and party_id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_r.detail->'deshacer'->'codigos_nuevos', '[]')));
  update public.conta_cobro_cliente cc set codigo_cliente = (x->>'antes')::int from jsonb_array_elements(coalesce(v_r.detail->'deshacer'->'codigos_cambiados', '[]')) x where cc.company_id = c and cc.party_id = (x->>'party')::uuid;
  update public.conta_cobro_cliente cc set codigo_cliente = (x->>'codigo')::int from jsonb_array_elements(coalesce(v_r.detail->'deshacer'->'codigos_quitados', '[]')) x where cc.company_id = c and cc.party_id = (x->>'party')::uuid;
  update public.import_run set detail = detail || jsonb_build_object('sumas_de', 'fichero', 'sumas', '[{"cuenta": "43000999", "nombre": "NUEVO", "debe": 0, "haber": 0}]'::jsonb)
   where id = v_r.id;   -- en prueba, como el 2024 de QBO cuando se ajusta
  -- El cliente nuevo de ERP10 sigue en Sumied (lo creó la carga), sin cuenta ni código: como con la regla de antes.
  insert into _x14e values ('antesC', 'CLIENTE X14E 829→43000999·999 CLIENTE X14E 830→43000830·830 CLIENTE X14E 831→—·— | 43000999=VIEJO');
  if pg_temp.estado() is distinct from pg_temp.p('antesC') then raise exception 'PRUEBA X14e · 3: no ha quedado como lo de antes de la regla: %', pg_temp.estado(); end if;
end $$;
do $$
declare r jsonb; r2 jsonb;
begin
  r := public._conta_traer_ajustar_a_erp10(pg_temp.p('cargaC')::uuid, 'Prueba X14e');
  if r is distinct from '{"codigos": 1, "nombres": 1, "enlaces_nuevos": 1, "enlaces_movidos": 1, "enlaces_quitados": 1}'::jsonb then raise exception 'PRUEBA X14e · 3: el ajuste dice %', r; end if;
  if pg_temp.estado() is distinct from 'CLIENTE X14E 829→43000829·829 CLIENTE X14E 830→—·830 CLIENTE X14E 831→43000830·— | 43000999=NUEVO' then
    raise exception 'PRUEBA X14e · 3: lo ya traído no queda como en ERP10: %', pg_temp.estado();
  end if;
  r2 := public._conta_traer_ajustar_a_erp10(pg_temp.p('cargaC')::uuid, 'Prueba X14e');
  if r2 is distinct from r then raise exception 'PRUEBA X14e · 3: la segunda vez no dice lo mismo: %', r2; end if;
  raise notice 'PRUEBA X14e · 3: lo ya traído, ajustado a ERP10 (%), una sola vez.', r;
end $$;
\i supabase/vuelta-atras/20261125T1649_x14e_ajustar_a_erp10.down.sql
do $$ begin
  if pg_temp.estado() is distinct from pg_temp.p('antesC') then raise exception 'PRUEBA X14e · 3: la vuelta atrás de la 20261125T1649 no lo devuelve: %', pg_temp.estado(); end if;
  raise notice 'PRUEBA X14e · 3: y la vuelta atrás de la 20261125T1649 lo devuelve a «%».', pg_temp.estado();
end $$;
-- Ajustada otra vez (como la migración) y deshecha la carga (como el administrador, en la pantalla): deshacerla devuelve
-- también el ajuste, y todo queda como antes de traerla.
select public._conta_traer_ajustar_a_erp10(pg_temp.p('cargaC')::uuid, 'Prueba X14e');
set local role authenticated;
do $$ begin
  perform public.conta_traer_deshacer(pg_temp.p('cargaC')::uuid, 'Prueba X14e');
  if pg_temp.estado() is distinct from pg_temp.p('antes') then raise exception 'PRUEBA X14e · 3: deshacer la carga ajustada no lo deja como estaba: %', pg_temp.estado(); end if;
  raise notice 'PRUEBA X14e · 3: ajustada en prueba y deshecha la carga, todo vuelve a «%».', pg_temp.estado();
end $$;
reset role;

-- 4 · La vuelta atrás de la 20261125T1415 -----------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T1415_x14e_clientes_con_su_430.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'El código del cliente') > 0
     or strpos(pg_get_functiondef('public.conta_traer_deshacer(uuid,text)'::regprocedure), 'Los códigos de cliente que puso') > 0
     or to_regprocedure('public._conta_traer_ajustar_a_erp10(uuid,text)') is not null or to_regprocedure('public._conta_traer_como_erp10_deshacer(jsonb)') is not null then
    raise exception 'PRUEBA X14e · 4: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14e · 4: la vuelta atrás deja las dos funciones de antes, sin las nuevas.';
  raise notice 'PRUEBA X14e: 4 de 4 bien.';
end $$;

rollback;
