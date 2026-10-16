-- supabase/staging/sql/20261116_c06b_promociones_envios_vuelta_atras_prueba.sql
--
-- SOLO STAGING. Las dos vueltas atrás de la tanda de promociones y envíos,
-- ejecutadas de verdad (A, 16/10: regla 8, ninguna prueba las corría):
--   supabase/vuelta-atras/20261116T0110_c06b_promociones_envios_datos.down.sql
--   supabase/vuelta-atras/20261116T0100_c06b_promociones_envios.down.sql
--
-- La 0110 y su vuelta atrás están ancladas a la cuenta y la empresa de Foodint
-- (regla 9) y, en una base sin Foodint, no hacen nada. Para que corran de
-- verdad, DENTRO de la transacción se monta un doble de Foodint con sus ids y
-- los datos de la cuenta A: su plan de plantillas, sus tres canales (con el
-- nombre que la 0110 espera: Uber, Glovo, JustEat) y la regla por plataforma.
-- Así se aplican los ficheros tal cual, con \i, sin tocar una letra.
--
--   1. Lo de antes: las subcuentas del doble y de A, la regla por plataforma
--      y las dos funciones (huella de prosrc y de la definición entera).
--   2. \i 0100 y \i 0110: el doble tiene sus 4 subcuentas y sus 6 enlaces; A,
--      nada nuevo.
--   3. \i 0110.down y \i 0100.down, en ese orden (el inverso).
--   4. Todo como antes, parte por parte; lo de la 0100 ya no existe.
--
-- Todo acaba en ROLLBACK: staging es compartido y no cambia.
-- sin usuario: aplica migraciones y vueltas atrás, que en producción corren
-- como dueño de la base; aquí se comprueba lo que dejan, no lo que ve un usuario.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA vuelta atrás promociones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · El doble de Foodint, con los datos de la cuenta A.
do $$
declare
  v_a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_f  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_ef constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  n int;
begin
  insert into public.accounts
  select (jsonb_populate_record(null::public.accounts, to_jsonb(a) || jsonb_build_object(
    'id', v_f, 'slug', 'prueba-c06b-vuelta-atras', 'stripe_customer_id', null, 'created_by', null))).*
    from public.accounts a where a.id = v_a;
  insert into public.company
  select (jsonb_populate_record(null::public.company, to_jsonb(c) || jsonb_build_object('id', v_ef, 'account_id', v_f))).*
    from public.company c where c.id = v_ea;
  -- Las plantillas de A, de la madre a la hija (el disparador de la madre la busca).
  insert into public.company_account
  select (jsonb_populate_record(null::public.company_account, to_jsonb(x) || jsonb_build_object(
    'id', gen_random_uuid(), 'account_id', v_f, 'company_id', v_ef, 'import_id', null, 'import_run_id', null))).*
    from public.company_account x where x.company_id = v_ea and x.kind = 'template'
   order by length(x.template_code), x.template_code, x.code;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'PRUEBA vuelta atrás: la cuenta A no tiene plantillas.'; end if;
  -- Los tres canales, con los ids y los nombres de Foodint que mide la 0110.
  insert into public.sales_channel
  select (jsonb_populate_record(null::public.sales_channel, to_jsonb(s) || jsonb_build_object('id', m.id, 'account_id', v_f, 'name', m.nombre))).*
    from (values ('uber', '16ed2c7e-294b-4652-9a80-e5d3a241d2be'::uuid, 'Uber'),
                 ('glovo', 'f98fcf5b-7ee3-4995-9a29-e755d2bd29f3'::uuid, 'Glovo'),
                 ('justeat', '60c822c8-e768-4290-8463-74e947564bcd'::uuid, 'JustEat')) m(slug, id, nombre)
    join public.sales_channel s on s.account_id = v_a and s.slug = m.slug;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'PRUEBA vuelta atrás: la cuenta A no tiene sus tres canales (uber, glovo, justeat): %.', n; end if;
  -- La regla por plataforma en los tres (copiada de una de A).
  insert into public.conta_ventas_canal
  select (jsonb_populate_record(null::public.conta_ventas_canal, to_jsonb(r) || jsonb_build_object('company_id', v_ef, 'account_id', v_f, 'channel_id', ch.id))).*
    from public.sales_channel ch
    cross join lateral (select * from public.conta_ventas_canal where company_id = v_ea limit 1) r
   where ch.account_id = v_f;
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'PRUEBA vuelta atrás: la regla por plataforma del doble: % de 3.', n; end if;
  raise notice 'PRUEBA vuelta atrás · 1: el doble de Foodint montado con los datos de A.';
end $$;

-- Lo de antes, parte por parte (en la configuración local de la transacción).
create temp table _foto (cuando text, parte text, huella text) on commit drop;
create or replace function pg_temp.foto(p_cuando text) returns void language plpgsql as $f$
begin
  insert into _foto
  select p_cuando, 'subcuentas del doble', md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.code), ''))
    from public.company_account a where a.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
  union all
  select p_cuando, 'subcuentas de A', md5(coalesce(string_agg(to_jsonb(a)::text, '|' order by a.code), ''))
    from public.company_account a where a.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc'
  union all
  select p_cuando, 'regla por plataforma', md5(coalesce(string_agg(to_jsonb(v)::text, '|' order by v.company_id, v.channel_id), ''))
    from public.conta_ventas_canal v where v.company_id in ('658728c0-fcd7-46ef-a860-d4e5e6eb21d9', '3b34403a-a7d6-4a48-a8d7-737e8cababdc')
  union all
  select p_cuando, 'enlaces (conta_ventas_canal_cuenta)', coalesce(to_regclass('public.conta_ventas_canal_cuenta')::text, 'no existe')
  union all
  select p_cuando, 'conta_envio_aclarado', coalesce(to_regclass('public.conta_envio_aclarado')::text, 'no existe')
  union all
  select p_cuando, 'conta_cargos_de_pedidos', coalesce(to_regprocedure('public.conta_cargos_de_pedidos(uuid,uuid[])')::text, 'no existe')
  union all
  select p_cuando, 'conta_envio_aclarar', coalesce(to_regprocedure('public.conta_envio_aclarar(uuid,text,text,text)')::text, 'no existe')
  union all
  select p_cuando, 'freno al validar', coalesce((select string_agg(tgname, ',') from pg_trigger where tgrelid = 'public.journal_entry'::regclass and tgname like '%envio_por_aclarar%'), 'no existe')
  union all
  select p_cuando, 'unidad · prosrc', md5(p.prosrc) from pg_proc p where p.oid = 'public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)'::regprocedure
  union all
  select p_cuando, 'unidad · definición', md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = 'public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)'::regprocedure
  union all
  select p_cuando, 'resumen · prosrc', md5(p.prosrc) from pg_proc p where p.oid = 'public.conta_resumen_ventas(uuid)'::regprocedure
  union all
  select p_cuando, 'resumen · definición', md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = 'public.conta_resumen_ventas(uuid)'::regprocedure;
end $f$;
select pg_temp.foto('antes');

-- 2 · La tanda, tal cual.
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\i supabase/migrations/20261116T0110_c06b_promociones_envios_datos.sql

do $$
declare n int;
begin
  select count(*) into n from public.company_account
   where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and kind = 'own' and code in ('70009001', '70009002', '70009003', '70500001');
  if n <> 4 then raise exception 'PRUEBA vuelta atrás · 2: la 0110 dejó % subcuentas de 4.', n; end if;
  select count(*) into n from public.conta_ventas_canal_cuenta where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  if n <> 6 then raise exception 'PRUEBA vuelta atrás · 2: la 0110 dejó % enlaces de 6.', n; end if;
  select count(*) into n from public.conta_ventas_canal_cuenta where company_id <> '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  if n <> 0 then raise exception 'PRUEBA vuelta atrás · 2: hay % enlaces fuera del doble.', n; end if;
  raise notice 'PRUEBA vuelta atrás · 2: aplicadas la 0100 y la 0110: 4 subcuentas y 6 enlaces en el doble, nada en A.';
end $$;

-- 3 · Las dos vueltas atrás, en orden inverso, tal cual.
\i supabase/vuelta-atras/20261116T0110_c06b_promociones_envios_datos.down.sql
\i supabase/vuelta-atras/20261116T0100_c06b_promociones_envios.down.sql

-- 4 · Todo como antes, parte por parte.
select pg_temp.foto('después');
do $$
declare r record; mal text := '';
begin
  for r in select a.parte, a.huella as antes, d.huella as despues
             from _foto a join _foto d on d.parte = a.parte and d.cuando = 'después'
            where a.cuando = 'antes' order by a.parte loop
    raise notice 'PRUEBA vuelta atrás · 4 · %: %', r.parte, case when r.antes = r.despues then 'igual' else 'DISTINTO (antes ' || left(r.antes, 8) || '…, después ' || left(r.despues, 8) || '…)' end;
    if r.antes is distinct from r.despues then mal := mal || r.parte || '; '; end if;
  end loop;
  if (select count(*) from _foto where cuando = 'antes') <> (select count(*) from _foto where cuando = 'después') then
    mal := mal || 'faltan partes; ';
  end if;
  if mal <> '' then raise exception 'PRUEBA vuelta atrás · 4: no queda como antes: %', mal; end if;
  raise notice 'PRUEBA vuelta atrás · 4: todo como antes.';
end $$;

rollback;
