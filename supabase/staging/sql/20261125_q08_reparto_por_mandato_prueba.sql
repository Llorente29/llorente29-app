-- supabase/staging/sql/20261125_q08_reparto_por_mandato_prueba.sql
--
-- SOLO STAGING. Prueba de la 20261125T1207 (Q08 · el reparto por la cuenta del mandato), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A de staging, con fichas, clientes de GoCardless y mandatos
-- INVENTADOS (T11), que llevan los mismos ids de GoCardless y nº de Bitrix24 que nombra la 1207.
--
--   0. Lo de antes: la 0938 y la 1110 del G06 (si esta base no las tiene, se aplican aquí). Los tres clientes de
--      GoCardless con el mismo correo, atados los tres por correo a la ficha 1487, como en producción el 25/11.
--   1. La guarda: con un mandato que no acaba en lo que dijo Julio, PARA sin tocar nada.
--   2. La 1207: cada uno a su ficha, por una persona, con «Julio · por la cuenta del mandato (25/11)»; su decisión
--      (lo que lee la lectura de cada noche); los dos enlaces de antes; los mandatos de Sumied.
--   3. La lectura de la noche: lo que haría con lo de ahora (enlaces de una persona) no lo vuelve a atar por correo.
--   4. La vuelta atrás: todo como en el paso 0.
--
-- sin usuario: la 1207 es un cambio de datos que se aplica una vez, como la tanda (no crea ninguna función que llame
-- un usuario); lo que lee y escribe después una persona lo prueban las del G06 y el Q08.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q08 · 1207: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

select to_regclass('public.conta_gc_enlace') is null as falta_0938 \gset
\if :falta_0938
\i supabase/migrations/20261112T0938_g06_enlace_gocardless.sql
\endif
select to_regprocedure('public.conta_gc_enlace_confirmar(uuid,text,uuid)') is null as falta_1110 \gset
\if :falta_1110
\i supabase/migrations/20261112T1110_g06_confirmar_enlace.sql
\endif

create temp table _v (clave text primary key, v text) on commit drop;
insert into _v values ('empresa', (select id::text from public.company
    where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by (id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') desc, id limit 1));

-- 0 · Como en producción el 25/11, con datos inventados.
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_id uuid;
        r record;
begin
  if v_e is null then raise exception 'PRUEBA 1207 · 0: la cuenta A no tiene ninguna empresa.'; end if;
  if exists (select 1 from public.conta_gestoria_cliente where account_id = v_acc and bitrix_id in ('1485', '1486', '1487'))
     or exists (select 1 from public.conta_gc_cliente where gc_id in ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', 'CU01MJ0GXMMY41SNZT9GRAV1BRA0', 'CU01MJ0H0ND1DSWM043Q99FTV1VK')) then
    raise exception 'PRUEBA 1207 · 0: esta base ya tiene las fichas o los clientes de GoCardless de la prueba.';
  end if;
  for r in select * from (values ('1485', 'Sociedad de Prueba Uno, S.L.'), ('1486', 'Sociedad de Prueba Dos, S.L.'), ('1487', 'Sociedad de Prueba Tres, S.L.')) x(bitrix, nombre) loop
    insert into public.party (account_id, name) values (v_acc, r.nombre) returning id into v_id;
    insert into public.conta_gestoria_cliente (party_id, account_id, bitrix_id) values (v_id, v_acc, r.bitrix);
    insert into _v values ('P' || r.bitrix, v_id::text);
  end loop;
  for r in select * from (values ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', '53', 'MDPRUEBA53'), ('CU01MJ0GXMMY41SNZT9GRAV1BRA0', '56', 'MDPRUEBA56'),
                                  ('CU01MJ0H0ND1DSWM043Q99FTV1VK', '49', 'MDPRUEBA49')) x(gc, final, md) loop
    insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, correo, party_id, casado_por, mandatos_vivos, suscripciones_activas)
    values (v_e, r.gc, v_acc, 'PERSONA DE PRUEBA', 'comun@ejemplo.test', (select v::uuid from _v where clave = 'P1487'), 'correo', 1, 1);
    insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado, referencia, cuenta_final, banco)
    values (v_e, r.md, v_acc, r.gc, 'pending_submission', 'PRUEBA-' || r.final, r.final, 'Banco Ejemplo');
    insert into public.conta_mandato (account_id, company_id, party_id, ref, status, origen, gc_mandato_id, created_by_name)
    values (v_acc, v_e, (select v::uuid from _v where clave = 'P1487'), 'PRUEBA-' || r.final, 'firmado', 'gocardless', r.md, 'GoCardless');
    insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque, updated_at)
    values (v_e, r.gc, v_acc, (select v::uuid from _v where clave = 'P1487'), 'correo', 'atado', '{}', null, now());
  end loop;
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, forma_cobro, gc_cliente_id, gc_casado_por, updated_by_name)
  values (v_e, (select v::uuid from _v where clave = 'P1487'), v_acc, 'gocardless', 'CU01MJ0GT1D0GGKCZEYG04ZK8NGY', 'correo', 'GoCardless');
  raise notice '0 · los tres atados por correo a la ficha 1487; su conta_cobro_cliente dice ··53';
end $$;

create temp table _foto on commit drop as
select 'enlace' t, gc_cliente_id k, party_id::text || '|' || por || '|' || estado || '|' || coalesce(quien_name, '') v from public.conta_gc_enlace
 where gc_cliente_id like 'CU01MJ0%'
union all select 'gc_cliente', gc_id, coalesce(party_id::text, '') || '|' || coalesce(casado_por, '') from public.conta_gc_cliente where gc_id like 'CU01MJ0%'
union all select 'cobro', party_id::text, gc_cliente_id || '|' || coalesce(gc_casado_por, '') || '|' || coalesce(updated_by_name, '') from public.conta_cobro_cliente
 where company_id = (select v::uuid from _v where clave = 'empresa') and party_id in (select v::uuid from _v where clave like 'P14%')
union all select 'mandato', gc_mandato_id, party_id::text from public.conta_mandato where gc_mandato_id like 'MDPRUEBA%'
union all select 'decision', gc_cliente_id, count(*)::text from public.conta_gestoria_decision where gc_cliente_id like 'CU01MJ0%' group by gc_cliente_id;

-- 1 · La guarda: si un mandato no acaba en lo que dijo Julio, PARA y no toca nada.
savepoint guarda;
update public.conta_gc_mandato set cuenta_final = '99' where gc_id = 'MDPRUEBA56';
\set ON_ERROR_STOP 0
\i supabase/migrations/20261125T1207_q08_reparto_por_mandato.sql
\set ON_ERROR_STOP 1
\if :ERROR
\else
select 1/0 as la_1207_no_ha_parado_con_un_mandato_que_no_casa;
\endif
rollback to savepoint guarda;
do $$ begin
  if exists (select 1 from public.conta_gc_enlace where gc_cliente_id like 'CU01MJ0%' and por = 'persona') then
    raise exception 'PRUEBA 1207 · 1: con un mandato que no casa, ha escrito algo.';
  end if;
  raise notice '1 · con un mandato que no acaba en lo dicho, PARA sin tocar nada';
end $$;

-- 2 · La 1207.
\i supabase/migrations/20261125T1207_q08_reparto_por_mandato.sql
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record; v_party uuid; x record;
begin
  for r in select * from (values ('CU01MJ0GT1D0GGKCZEYG04ZK8NGY', '1486', 'MDPRUEBA53'), ('CU01MJ0GXMMY41SNZT9GRAV1BRA0', '1485', 'MDPRUEBA56'),
                                  ('CU01MJ0H0ND1DSWM043Q99FTV1VK', '1487', 'MDPRUEBA49')) y(gc, bitrix, md) loop
    v_party := (select v::uuid from _v where clave = 'P' || r.bitrix);
    select * into x from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = r.gc;
    if x.party_id is distinct from v_party or x.por <> 'persona' or x.estado <> 'atado' or x.quien_name <> 'Julio · por la cuenta del mandato (25/11)'
       or x.antes->>'tanda' <> '20261125T1207_q08_reparto_por_mandato' then
      raise exception 'PRUEBA 1207 · 2: el enlace de % no es el de la ficha % por una persona: %', r.gc, r.bitrix, row_to_json(x);
    end if;
    if (select count(*) from public.conta_gestoria_decision where company_id = v_e and gc_cliente_id = r.gc and tipo = 'enlace' and party_id = v_party
          and quien_name = 'Julio · por la cuenta del mandato (25/11)') <> 1 then
      raise exception 'PRUEBA 1207 · 2: % no tiene su decisión (la que lee la lectura de la noche).', r.gc;
    end if;
    if not exists (select 1 from public.conta_gc_cliente where company_id = v_e and gc_id = r.gc and party_id = v_party and casado_por = 'persona') then
      raise exception 'PRUEBA 1207 · 2: conta_gc_cliente de % no dice la ficha %.', r.gc, r.bitrix;
    end if;
    if not exists (select 1 from public.conta_cobro_cliente where company_id = v_e and party_id = v_party and gc_cliente_id = r.gc and gc_casado_por = 'persona') then
      raise exception 'PRUEBA 1207 · 2: conta_cobro_cliente de la ficha % no dice %.', r.bitrix, r.gc;
    end if;
    if (select party_id from public.conta_mandato where gc_mandato_id = r.md) is distinct from v_party then
      raise exception 'PRUEBA 1207 · 2: el mandato % no es de la ficha %.', r.md, r.bitrix;
    end if;
  end loop;
  raise notice '2 · cada uno a su ficha, por una persona, con su decisión, los dos enlaces de antes y sus mandatos';
end $$;

-- 3 · La lectura de la noche escribe por _conta_gc_enlace_guardar: lo de una persona lo escribe como de una persona
--     (de su decisión), y lo de correo que traería no pisa lo de una persona.
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_n int;
begin
  v_n := public._conta_gc_enlace_guardar(jsonb_build_array(jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'CU01MJ0GT1D0GGKCZEYG04ZK8NGY',
    'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'party_id', (select v from _v where clave = 'P1487'), 'por', 'correo', 'estado', 'atado')));
  if v_n <> 0 or (select party_id from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'CU01MJ0GT1D0GGKCZEYG04ZK8NGY') is distinct from (select v::uuid from _v where clave = 'P1486') then
    raise exception 'PRUEBA 1207 · 3: lo atado por correo ha pisado lo que decidió Julio.';
  end if;
  raise notice '3 · lo que traería la lectura por correo no pisa lo que decidió Julio';
end $$;

-- 4 · La vuelta atrás: todo como en el paso 0.
\i supabase/vuelta-atras/20261125T1207_q08_reparto_por_mandato.down.sql
do $$
declare v_dif text;
begin
  select string_agg(coalesce(a.t, b.t) || ' ' || coalesce(a.k, b.k) || ': ' || coalesce(a.v, '∅') || ' → ' || coalesce(b.v, '∅'), '; ') into v_dif
    from _foto a full join (
      select 'enlace' t, gc_cliente_id k, party_id::text || '|' || por || '|' || estado || '|' || coalesce(quien_name, '') v from public.conta_gc_enlace where gc_cliente_id like 'CU01MJ0%'
      union all select 'gc_cliente', gc_id, coalesce(party_id::text, '') || '|' || coalesce(casado_por, '') from public.conta_gc_cliente where gc_id like 'CU01MJ0%'
      union all select 'cobro', party_id::text, gc_cliente_id || '|' || coalesce(gc_casado_por, '') || '|' || coalesce(updated_by_name, '') from public.conta_cobro_cliente
       where company_id = (select v::uuid from _v where clave = 'empresa') and party_id in (select v::uuid from _v where clave like 'P14%')
      union all select 'mandato', gc_mandato_id, party_id::text from public.conta_mandato where gc_mandato_id like 'MDPRUEBA%'
      union all select 'decision', gc_cliente_id, count(*)::text from public.conta_gestoria_decision where gc_cliente_id like 'CU01MJ0%' group by gc_cliente_id
    ) b on a.t = b.t and a.k = b.k
   where a.v is distinct from b.v;
  if v_dif is not null then raise exception 'PRUEBA 1207 · 4: la vuelta atrás no deja lo de antes: %', v_dif; end if;
  raise notice '4 · la vuelta atrás deja los tres como estaban';
end $$;

rollback;
