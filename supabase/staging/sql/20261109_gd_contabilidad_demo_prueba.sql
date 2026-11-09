-- supabase/staging/sql/20261109_gd_contabilidad_demo_prueba.sql
--
-- SOLO STAGING. La 1300 del GD (la contabilidad de «Gestoría Demo»), por sus
-- caminos, sobre la «Gestoría Demo» de staging (la 0110, sin administrador):
--   1. Sin administrador, no siembra nada y lo dice.
--   2. Con administrador: en las dos empresas, el perfil con los modelos de QBO,
--      la actividad, el ejercicio 2026 abierto, el plan de 8 cifras (con la
--      57200000, la 70500000 y la 47700021), la serie «1» (la sociedad, con el
--      formato de QBO desde la 141) y los ajustes de cobro; en la sociedad, las
--      57200002, 40000015 y 62900007, y su línea en el registro del plan.
--   3. Sembrar otra vez deja exactamente lo mismo (la huella, igual).
--   4. Los modelos no dejan nada en rojo en la regla de coherencia del agente
--      «Datos maestros» (periódico con su anual; la sociedad con el 347).
--   5. En una cuenta que no es demo, no siembra (42501).
--   6. La vuelta atrás deja las dos empresas como estaban (la huella de antes).
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la siembra la llama la plataforma; dentro actúa como el
-- administrador de la cuenta, y eso es lo que se prueba.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T1300_gd_contabilidad_demo.sql

do $$ declare v jsonb; begin
  v := public.demo_gestoria_contabilidad_sembrar('de000000-0000-4000-8000-0000000000a0');
  if v->>'frase' not like '%no tiene administrador%' then raise exception 'GD · 1: sin administrador tenía que no sembrar: %', v->>'frase'; end if;
  raise notice 'GD · 1: sin administrador, no siembra y lo dice. OK';
end $$;

-- Un administrador (un usuario de prueba de staging).
insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
select id, 'de000000-0000-4000-8000-0000000000a0', 'admin', true, 'Administración GD (prueba)', now(), now() from auth.users where email = 'p01.laura@p01-prueba.test';

create temp table _h (vuelta text, huella text) on commit drop;
create temp view _huella as
select md5(coalesce(string_agg(x, '|' order by x), '')) h from (
  select concat_ws(';', 'cuenta', company_id, code, template_code, name, kind) x from public.company_account where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'enlace', company_id, entity, role) from public.company_account_link where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'serie', company_id, code, starts_at, formato, digits, reset_yearly) from public.invoice_series where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'ejercicio', company_id, code, status) from public.fiscal_year where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'actividad', company_id, iae_code, cnae_code, kind) from public.company_activity where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'perfil', company_id, array_to_string(tax_forms, ',')) from public.company_tax_profile where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'ajustes', company_id, codigo_cliente_modo, serie_cobro, cuenta_banco, cuenta_plataforma, cuenta_ingresos, cuenta_iva) from public.conta_gestoria_ajustes where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'persona', company_id, full_name) from public.company_person where account_id = 'de000000-0000-4000-8000-0000000000a0'
  union all select concat_ws(';', 'empresa', id, legal_form_code, registry_name) from public.company where account_id = 'de000000-0000-4000-8000-0000000000a0') q;
insert into _h select 'antes', h from _huella;

-- 2 · Sembrar.
do $$
declare c constant uuid := 'de000000-0000-4000-8000-0000000000a0'; s constant uuid := 'de000000-0000-4000-8000-0000000000a9'; a constant uuid := 'de000000-0000-4000-8000-0000000000b9'; v jsonb; n int;
begin
  v := public.demo_gestoria_contabilidad_sembrar(c);
  raise notice 'GD · 2: %', v->>'frase';
  for n in select 1 from (values (s), (a)) e(emp) where not exists (select 1 from public.fiscal_year y where y.company_id = e.emp and y.code = '2026' and y.status = 'open') loop
    raise exception 'GD · 2: falta el ejercicio 2026 abierto en alguna empresa.';
  end loop;
  select count(*) into n from public.company_activity where account_id = c and cnae_code = '6920' and is_main;
  if n <> 2 then raise exception 'GD · 2: tenía que haber una actividad principal en cada empresa y hay %.', n; end if;
  select count(*) into n from public.company_account where company_id = s and code in ('57200000', '70500000', '47700021', '57200002', '40000015', '62900007');
  if n <> 6 then raise exception 'GD · 2: a la sociedad le faltan subcuentas de QBO (tiene % de 6).', n; end if;
  if exists (select 1 from public.company_account where company_id in (s, a) and length(code) <> 8) then raise exception 'GD · 2: hay subcuentas que no son de 8 cifras.'; end if;
  select count(*) into n from public.company_account where company_id = a and code in ('57200000', '70500000', '47700021');
  if n <> 3 then raise exception 'GD · 2: a la autónoma le falta el plan de serie (tiene % de 3).', n; end if;
  if not exists (select 1 from public.invoice_series where company_id = s and code = '1' and starts_at = 141 and formato = '{año}/{serie}/{número}' and reset_yearly) then
    raise exception 'GD · 2: la serie de la sociedad no es la de QBO desde la 141.';
  end if;
  if not exists (select 1 from public.conta_gestoria_ajustes where company_id = s and codigo_cliente_modo = 'sumied' and serie_cobro = '1' and cuenta_plataforma = '57200002' and cuenta_banco = '57200000') then
    raise exception 'GD · 2: los ajustes de cobro de la sociedad no están.';
  end if;
  select count(*) into n from public.company_account_log where company_id = s and que = 'subcuenta_creada' and code in ('57200002', '40000015', '62900007');
  if n <> 3 then raise exception 'GD · 2: las 3 subcuentas de GoCardless tenían que dejar su línea en el registro del plan y hay %.', n; end if;
  raise notice 'GD · 2: perfil, actividad, ejercicio, plan de 8 cifras con las de QBO, serie y ajustes en las dos empresas. OK';
end $$;
insert into _h select 'sembrada', h from _huella;

-- 3 · Otra vez: lo mismo.
select public.demo_gestoria_contabilidad_sembrar('de000000-0000-4000-8000-0000000000a0') is not null as otra_vez;
insert into _h select 'otra_vez', h from _huella;
do $$ begin
  if (select huella from _h where vuelta = 'sembrada') <> (select huella from _h where vuelta = 'otra_vez') then raise exception 'GD · 3: sembrar otra vez no deja lo mismo.'; end if;
  raise notice 'GD · 3: sembrar otra vez deja exactamente lo mismo. OK';
end $$;

-- 4 · La regla de los modelos del agente (scripts/conta/lib/coherencia.mjs, coherenciaModelos), con tax_form de la base.
do $$
declare r record; f record; fallos text[] := '{}';
begin
  for r in select c.entity_kind, p.tax_forms, coalesce(p.sii, false) sii, c.legal_name from public.company c join public.company_tax_profile p on p.company_id = c.id
            where c.account_id = 'de000000-0000-4000-8000-0000000000a0' loop
    for f in select * from public.tax_form loop
      if f.annual_form_code is not null and f.code = any (r.tax_forms) and not (f.annual_form_code = any (r.tax_forms)) and not (r.sii and f.annual_form_code = '390') then
        fallos := fallos || format('%s: %s sin su anual %s', r.legal_name, f.code, f.annual_form_code);
      end if;
      if f.annual_form_code is not null and f.annual_form_code = any (r.tax_forms) and not (f.code = any (r.tax_forms)) then
        fallos := fallos || format('%s: %s sin su periódico %s', r.legal_name, f.annual_form_code, f.code);
      end if;
      if f.default_for = 'company_not_sii' and r.entity_kind = 'company' and not r.sii and not (f.code = any (r.tax_forms)) then
        fallos := fallos || format('%s: sociedad fuera del SII sin el %s', r.legal_name, f.code);
      end if;
    end loop;
  end loop;
  if cardinality(fallos) > 0 then raise exception 'GD · 4: los modelos saldrían en rojo: %', array_to_string(fallos, '; '); end if;
  raise notice 'GD · 4: los modelos de las dos empresas no dejan nada en rojo. OK';
end $$;

-- 5 · En una cuenta que no es demo, no.
do $$ begin
  begin
    perform public.demo_gestoria_contabilidad_sembrar('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'GD · 5: en una cuenta que no es demo tenía que negarse.';
  exception when insufficient_privilege then raise notice 'GD · 5: en una cuenta que no es demo, no siembra. OK';
  end;
end $$;

-- 6 · La vuelta atrás: como antes.
\i supabase/vuelta-atras/20261109T1300_gd_contabilidad_demo.down.sql
insert into _h select 'deshecha', h from _huella;
do $$ begin
  if to_regprocedure('public.demo_gestoria_contabilidad_sembrar(uuid)') is not null then raise exception 'GD · 6: la función sigue.'; end if;
  if (select huella from _h where vuelta = 'antes') <> (select huella from _h where vuelta = 'deshecha') then raise exception 'GD · 6: la vuelta atrás no deja las empresas como estaban.'; end if;
  raise notice 'GD · 6: la vuelta atrás deja las dos empresas como estaban. OK';
end $$;

rollback;
