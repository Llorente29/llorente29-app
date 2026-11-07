-- supabase/staging/sql/20261107_g01b_juntar_clientes_prueba.sql
--
-- SOLO STAGING. Prueba del G01b · juntar los clientes ya creados
-- (20261107T1336): conta_bitrix_guardar_clientes con la unión aplicada junta
-- en uno los clientes que ya eran varios. Reproduce lo de producción del 07/11
-- a las 13:02 UTC: dos fichas con el mismo NIF que ya eran dos clientes salían
-- como «ficha_no_guardada». Todo en una transacción con ROLLBACK, con datos
-- inventados (T11): no cambia staging.
--
--   1. Antes, dos fichas: dos clientes sin NIF (como las de la conexión de
--      esta mañana). Uno tiene un cliente de GoCardless casado y sus datos
--      fiscales; el otro, los suyos.
--   2. Sin la unión aplicada (clave «ficha:»), no se junta nada.
--   3. Con ella (clave «nif:»), un solo cliente, con el NIF y las dos
--      fichas; el de GoCardless, en el que queda; el otro, archivado con su
--      nota, sin fila de la gestoría y con el rastro en conta_gestoria_union.
--   4. Un cliente con contabilidad (un papel) no se junta: falla con su
--      porqué y la lectura sigue.
--   5. La vuelta atrás: la función de antes y sin la de juntar.
--
-- sin usuario: guardar los clientes y juntarlos solo lo hace el servidor (conta-bitrix-leer, con service_role); ninguna persona los llama.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G01b-J: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes on commit drop as
select md5(pg_get_functiondef('public.conta_bitrix_guardar_clientes(uuid,jsonb)'::regprocedure)) as guardar;

-- Si el ensayo ya la pasó en esta transacción, no se vuelve a pasar («antes» es entonces el respaldo).
select to_regclass('public.conta_gestoria_union') is not null as ya_esta_la_1336 \gset
\if :ya_esta_la_1336
update _antes set guardar = (select huella from public.funcion_respaldo where firma = 'public.conta_bitrix_guardar_clientes(uuid,jsonb)' and migracion = '20261107T1336_g01b_juntar_clientes');
\else
\i supabase/migrations/20261107T1336_g01b_juntar_clientes.sql
\endif

savepoint datos;

create temp table _e on commit drop as
select c.id as empresa, c.account_id as cuenta from public.company c order by c.created_at limit 1;

create or replace function pg_temp.ficha(p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('bitrixId', p_id, 'nombre', 'CLIENTE PRUEBA G01BJ ' || p_id, 'nif', p_nif, 'situacion', p_sit, 'situacionTexto', upper(coalesce(p_sit, '')),
    'calle', 'Calle Inventada ' || p_id, 'cp', '28000', 'poblacion', null, 'provincia', null, 'servicios', '[]'::jsonb, 'formaPago', null, 'emisorSegunBitrix', null)
$$;
create or replace function pg_temp.sola(p_id text, p_nif text, p_sit text) returns jsonb language sql as $$
  select jsonb_build_object('clave', 'ficha:' || p_id, 'nif', p_nif, 'situacion', p_sit, 'motivo', null, 'principal', pg_temp.ficha(p_id, p_nif, p_sit),
    'fichas', jsonb_build_array(pg_temp.ficha(p_id, p_nif, p_sit)))
$$;
create or replace function pg_temp.unidos(p_a text, p_b text, p_nif text) returns jsonb language sql as $$
  select jsonb_build_object('clave', 'nif:' || p_nif, 'nif', p_nif, 'situacion', 'activo', 'motivo', 'repetidas',
    'principal', pg_temp.ficha(p_b, p_nif, 'activo'), 'fichas', jsonb_build_array(pg_temp.ficha(p_a, p_nif, 'baja'), pg_temp.ficha(p_b, p_nif, 'activo')))
$$;

do $$
declare e uuid := (select empresa from _e); a uuid := (select cuenta from _e); r jsonb; pa uuid; pb uuid; v_queda uuid; n int;
begin
  if a is null then raise exception 'PRUEBA G01b-J · 0: staging no tiene ninguna empresa.'; end if;
  -- 1 · Dos fichas, dos clientes sin NIF.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(pg_temp.sola('G01BJ-A', null, 'baja'), pg_temp.sola('G01BJ-B', null, 'activo')));
  if (r->>'nuevos')::int <> 2 then raise exception 'PRUEBA G01b-J · 1: no salen dos clientes (%).', r; end if;
  select party_id into pa from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01BJ-A';
  select party_id into pb from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01BJ-B';
  -- El de la ficha A tiene un cliente de GoCardless casado.
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, mandatos_vivos, suscripciones_activas, leido_at, party_id)
  values (e, 'CU-G01BJ', a, 'CLIENTE PRUEBA G01BJ', 1, 1, now(), pa);
  raise notice 'G01b-J · 1: dos fichas, dos clientes. OK';

  -- 2 · Sin la unión aplicada, no se junta: la de B choca y sale con su porqué.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(pg_temp.sola('G01BJ-A', '00000000T', 'baja'), pg_temp.sola('G01BJ-B', '00000000T', 'activo')));
  if jsonb_array_length(r->'errores') <> 1 or (select archived_at from public.party where id = pa) is not null or (select archived_at from public.party where id = pb) is not null then
    raise exception 'PRUEBA G01b-J · 2: sin la unión se ha juntado algo (%).', r;
  end if;
  raise notice 'G01b-J · 2: sin la unión, no se junta nada. OK';

  -- 3 · Con la unión: lo de producción del 07/11 (antes salía «sus 2 fichas de Bitrix24 ya son 2 clientes distintos en Sumied»).
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(pg_temp.unidos('G01BJ-A', 'G01BJ-B', '00000000T')));
  if jsonb_array_length(r->'errores') <> 0 or (r->>'juntados')::int <> 1 then raise exception 'PRUEBA G01b-J · 3: no se juntan (%).', r; end if;
  select party_id into v_queda from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01BJ-B';
  if v_queda is distinct from pb then raise exception 'PRUEBA G01b-J · 3: no queda el que ya tenía la ficha principal.'; end if;
  select count(*) into n from public.conta_gestoria_ficha where party_id = v_queda and bitrix_id in ('G01BJ-A', 'G01BJ-B');
  if n <> 2 or (select tax_id from public.party where id = v_queda) <> '00000000T'
     or (select party_id from public.conta_gc_cliente where company_id = e and gc_id = 'CU-G01BJ') <> v_queda
     or exists (select 1 from public.conta_gestoria_cliente where party_id = pa)
     or (select archived_at from public.party where id = pa) is null
     or (select archived_note from public.party where id = pa) not like 'Unido con %el mismo NIF en Bitrix24%'
     or not exists (select 1 from public.customer_fiscal where party_id = pa) then
    raise exception 'PRUEBA G01b-J · 3: no queda un cliente con sus dos fichas, su NIF y lo de GoCardless, y el otro archivado (fichas %).', n;
  end if;
  if not exists (select 1 from public.conta_gestoria_union u where u.kept_party_id = pb and u.gone_party_id = pa
                  and jsonb_array_length(u.moved->'conta_gc_cliente') = 1 and u.kept_on_gone ? 'datos_fiscales') then
    raise exception 'PRUEBA G01b-J · 3: no queda el rastro de lo que se movió.';
  end if;
  raise notice 'G01b-J · 3: con la unión, un cliente con sus dos fichas; el otro, archivado y con su rastro. OK';

  -- 4 · Uno con contabilidad (un papel) no se junta: falla con su porqué.
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(pg_temp.sola('G01BJ-C', null, 'activo'), pg_temp.sola('G01BJ-D', null, 'activo')));
  insert into public.party_role (account_id, party_id, role) select a, party_id, 'customer' from public.conta_gestoria_cliente where account_id = a and bitrix_id = 'G01BJ-C';
  r := public.conta_bitrix_guardar_clientes(a, jsonb_build_array(pg_temp.unidos('G01BJ-C', 'G01BJ-D', '00000000R')));
  if jsonb_array_length(r->'errores') <> 1 or r->'errores'->0->>'porque' not like '%de contabilidad: se juntan a mano%' then
    raise exception 'PRUEBA G01b-J · 4: uno con contabilidad se junta o no dice por qué (%).', r;
  end if;
  raise notice 'G01b-J · 4: con contabilidad no se junta, y lo dice. OK';
end $$;

-- 5 · La vuelta atrás (con un cliente ya juntado: el rastro se queda).
\i supabase/vuelta-atras/20261107T1336_g01b_juntar_clientes.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_bitrix_guardar_clientes(uuid,jsonb)'::regprocedure)) is distinct from (select guardar from _antes) then
    raise exception 'PRUEBA G01b-J · 5: guardar los clientes no vuelve a ser la de antes.';
  end if;
  if to_regprocedure('public._conta_gestoria_juntar(uuid,uuid,uuid,text)') is not null then raise exception 'PRUEBA G01b-J · 5: queda la función de juntar.'; end if;
  if to_regclass('public.conta_gestoria_union') is null then raise exception 'PRUEBA G01b-J · 5: se ha llevado el rastro de lo ya juntado.'; end if;
  raise notice 'G01b-J · 5: la vuelta atrás deja la función de antes y el rastro. OK';
end $$;
-- Sin nada juntado, la tabla del rastro se va.
rollback to savepoint datos;
\i supabase/vuelta-atras/20261107T1336_g01b_juntar_clientes.down.sql
do $$ begin
  if to_regclass('public.conta_gestoria_union') is not null then raise exception 'PRUEBA G01b-J · 5: sin nada juntado, queda la tabla del rastro.'; end if;
  raise notice 'G01b-J · 5: sin nada juntado, la tabla del rastro se va. OK';
end $$;

rollback;
