-- supabase/staging/sql/20261125_x14e_clientes_con_su_430_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T1415_x14e_clientes_con_su_430), que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_cargar (pone el código de cada cliente en
-- conta_cobro_cliente.codigo_cliente) y public.conta_traer_deshacer (lo quita).
--
-- En una empresa NUEVA de la cuenta A (pymes, 8 dígitos, con 2026), como el administrador a1, con lo leído INVENTADO de
-- 2024: cuatro clientes con su 430 y NIF inventados al azar (con su letra). Antes de traer, en Sumied: el de la 43000829 ya
-- es cliente de la empresa sin código; el de la 43000830 ya tiene el código 900; y otro cliente ya tiene el 828. Los caminos:
--   1. Traer: la 43000827 (nuevo) queda con el código 827; la 43000829 (sin código) se rellena con el 829; la 43000830 se
--      queda con su 900 y la 43000828 sin código, las dos en lo que hay que mirar con su porqué. 2 códigos puestos.
--   2. Deshacer: la fila del 827 se va, la del 829 vuelve a no tener código, el 900 y el 828 de antes siguen.
--   3. La vuelta atrás: las dos funciones de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14e: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14 · 2 (Julio, 25/11) · El código del cliente') = 0 then
    raise exception 'PRUEBA X14e · 0: falta la 20261125T1415 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14e (k text primary key, v text) on commit drop;
grant all on _x14e to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14e where _x14e.k = $1 $$;
-- Un NIF de persona inventado al azar, con su letra.
create function pg_temp.nif() returns text language sql volatile as $$
  select n || substr('TRWAGMYFPDXBNJZSQVHLCKE', (n::bigint % 23)::int + 1, 1) from (select lpad(floor(random() * 1e8)::bigint::text, 8, '0') n) x
$$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb; d7 text; s int := 0; x int;
  n27 text := pg_temp.nif(); n28 text := pg_temp.nif(); n29 text := pg_temp.nif(); n30 text := pg_temp.nif(); nOtro text := pg_temp.nif();
  p29 uuid; p30 uuid; pOtro uuid;
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
  -- Lo que ya hay en Sumied.
  insert into public.party (account_id, name, tax_id, source) values (v_acc, 'Cliente X14e sin código', n29, 'manual') returning id into p29;
  insert into public.party (account_id, name, tax_id, source) values (v_acc, 'Cliente X14e con su 900', n30, 'manual') returning id into p30;
  insert into public.party (account_id, name, tax_id, source) values (v_acc, 'Cliente X14e con el 828', nOtro, 'manual') returning id into pOtro;
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente) values (c, p29, v_acc, null), (c, p30, v_acc, 900), (c, pOtro, v_acc, 828);
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000827', 'nombre', 'CLIENTE X14E 827'), jsonb_build_object('codigo', '43000828', 'nombre', 'CLIENTE X14E 828'),
                                 jsonb_build_object('codigo', '43000829', 'nombre', 'CLIENTE X14E 829'), jsonb_build_object('codigo', '43000830', 'nombre', 'CLIENTE X14E 830'),
                                 jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', (select jsonb_agg(jsonb_build_object('clase', 'cliente', 'codigo', '430008' || k, 'nombre', 'CLIENTE X14E ' || k, 'nombreComercial', '', 'nif', n) order by k)
                   from (values ('27', n27), ('28', n28), ('29', n29), ('30', n30)) v(k, n)),
    'asientos', jsonb_build_array(jsonb_build_object('clave', 'X14E-1', 'serie', '1', 'documento', '1', 'fecha', '2024-03-15', 'concepto', 'Inventado X14e', 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000827', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100)))),
    'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', '[]'::jsonb, 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14e values ('empresa', c), ('datos', d::text), ('p29', p29), ('p30', p30), ('pOtro', pOtro), ('n27', n27), ('n28', n28);
end $$;
-- Los códigos de la empresa, por NIF del cliente: «nif=código», en orden.
create function pg_temp.codigos() returns text language sql as $$
  select string_agg(coalesce(case p.tax_id when pg_temp.p('n27') then '827?' when pg_temp.p('n28') then '828?' end, p.name) || '=' || coalesce(c.codigo_cliente::text, '—'), ' · ' order by p.name)
    from public.conta_cobro_cliente c join public.party p on p.id = c.party_id where c.company_id = pg_temp.p('empresa')::uuid
$$;
grant execute on function pg_temp.codigos() to authenticated;
insert into _x14e select 'antes', pg_temp.codigos();
set local role authenticated;

-- 1 · Traer ------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; v_frases text;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14e');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' then raise exception 'PRUEBA X14e · 1: no ha entrado en prueba: %', r; end if;
  if pg_temp.codigos() is distinct from '827?=827 · Cliente X14e con el 828=828 · Cliente X14e con su 900=900 · Cliente X14e sin código=829' then
    raise exception 'PRUEBA X14e · 1: los códigos quedan «%».', pg_temp.codigos();
  end if;
  select string_agg(m->>'frase', ' | ' order by m->>'cuenta') into v_frases from jsonb_array_elements(v_r.detail->'mirar') m where m->>'que' = 'codigo_cliente';
  if v_frases is distinct from 'El código de cliente 828 (la 43000828 de ERP10) ya es de otro cliente en Sumied: CLIENTE X14E 28 se queda sin código.'
       || ' | CLIENTE X14E 30 ya tiene el código de cliente 900 en Sumied y en ERP10 es la 43000830: se queda el de Sumied.' then
    raise exception 'PRUEBA X14e · 1: lo que hay que mirar dice «%».', v_frases;
  end if;
  insert into _x14e values ('carga', v_r.id);
  raise notice 'PRUEBA X14e · 1: el 827 nuevo y el 829 rellenado; el 900 y el 828 de antes no se pisan, y se dice: «%».', v_frases;
end $$;

-- 2 · Deshacer -----------------------------------------------------------------------------------------------------------
do $$ begin
  perform public.conta_traer_deshacer(pg_temp.p('carga')::uuid, 'Prueba X14e');
  if pg_temp.codigos() is distinct from pg_temp.p('antes') then
    raise exception 'PRUEBA X14e · 2: deshacer no deja los códigos como estaban: «%» (antes «%»).', pg_temp.codigos(), pg_temp.p('antes');
  end if;
  raise notice 'PRUEBA X14e · 2: deshecha, los códigos vuelven a «%».', pg_temp.codigos();
end $$;
reset role;

-- 3 · La vuelta atrás -------------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T1415_x14e_clientes_con_su_430.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'El código del cliente') > 0
     or strpos(pg_get_functiondef('public.conta_traer_deshacer(uuid,text)'::regprocedure), 'Los códigos de cliente que puso') > 0 then
    raise exception 'PRUEBA X14e · 3: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14e · 3: la vuelta atrás deja las dos funciones de antes.';
  raise notice 'PRUEBA X14e: 3 de 3 bien.';
end $$;

rollback;
