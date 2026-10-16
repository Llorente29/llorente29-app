-- supabase/migrations/20261116T0110_c06b_promociones_envios_datos.sql
--
-- C06b · DATOS: las subcuentas de promociones y de envíos de Foodint en Folvy,
-- con los mismos números y nombres que en Diez (Julio, 16/10):
--   · 70009001 PROMOCIONES UBER EATS, 70009002 PROMOCIONES GLOVO y 70009003
--     PROMOCIONES JUST EAT, colgadas de la 700 (Julio las creó en Diez el 16/10);
--   · 70500001 ENVÍOS COBRADOS, colgada de la 705 (la crea Julio en Diez antes
--     del primer envío).
-- Y cada plataforma, a la suya (conta_ventas_canal_cuenta, de la 0100): su
-- 7000900x para las promociones y la 70500001 para los envíos.
--
-- Anclado por id y cuenta (regla 9): la empresa y los canales por su id, con
-- el nombre medido en producción el 16/10 (solo lectura); las subcuentas, por
-- código DENTRO de la empresa. PARA sin escribir nada si algo no es lo medido:
-- los canales no son esos, las cuatro subcuentas ya existen (alguien las ha
-- creado), o ya hay subcuentas enlazadas. En una base sin Foodint (staging) no
-- hace nada y lo dice.
--
-- Solo inserta. Los asientos ya validados no se tocan; desde aquí, el cierre
-- del día propone con promociones y envíos.
-- Vuelta atrás: supabase/vuelta-atras/20261116T0110_c06b_promociones_envios_datos.down.sql

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_quien   constant text := 'Folvy (C06b, promociones y envíos de Julio)';
  v_plan text; v_mal text; n int;
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise notice 'C06b promociones y envíos: esta base no tiene Foodint; no se hace nada.';
    return;
  end if;

  create temp table _canal (id uuid, nombre text, promo text) on commit drop;
  insert into _canal values
    ('16ed2c7e-294b-4652-9a80-e5d3a241d2be', 'Uber',    '70009001'),
    ('f98fcf5b-7ee3-4995-9a29-e755d2bd29f3', 'Glovo',   '70009002'),
    ('60c822c8-e768-4290-8463-74e947564bcd', 'JustEat', '70009003');
  create temp table _sub (code text, plantilla text, nombre text) on commit drop;
  insert into _sub values
    ('70009001', '700', 'PROMOCIONES UBER EATS'),
    ('70009002', '700', 'PROMOCIONES GLOVO'),
    ('70009003', '700', 'PROMOCIONES JUST EAT'),
    ('70500001', '705', 'ENVÍOS COBRADOS');

  -- Lo medido: los tres canales son de Foodint, con ese nombre, y van por la regla por plataforma.
  select string_agg(c.nombre, ', ') into v_mal from _canal c
   where not exists (select 1 from public.sales_channel ch where ch.id = c.id and ch.account_id = v_cuenta and ch.name = c.nombre)
      or not exists (select 1 from public.conta_ventas_canal v where v.company_id = v_empresa and v.account_id = v_cuenta and v.channel_id = c.id);
  if v_mal is not null then raise exception 'C06b promociones y envíos: canales que no son los medidos: %. No se toca nada.', v_mal; end if;
  -- Las plantillas de las que cuelgan (70000000 y 70500000), activas.
  select string_agg(x.t, ', ') into v_mal from (values ('70000000'), ('70500000')) x(t)
   where not exists (select 1 from public.company_account a where a.account_id = v_cuenta and a.company_id = v_empresa and a.code = x.t and a.kind = 'template' and a.status = 'activa');
  if v_mal is not null then raise exception 'C06b promociones y envíos: no están las plantillas %. No se toca nada.', v_mal; end if;
  select plan into v_plan from public.company_account where account_id = v_cuenta and company_id = v_empresa and code = '70000000';
  -- Las cuatro, libres; y nada enlazado todavía.
  select string_agg(s.code, ', ') into v_mal from _sub s
   where exists (select 1 from public.company_account a where a.account_id = v_cuenta and a.company_id = v_empresa and a.code = s.code);
  if v_mal is not null then raise exception 'C06b promociones y envíos: % ya existen; alguien las ha creado. No se toca nada.', v_mal; end if;
  if exists (select 1 from public.conta_ventas_canal_cuenta where company_id = v_empresa) then
    raise exception 'C06b promociones y envíos: Foodint ya tiene subcuentas de promociones o envíos enlazadas; no se pisa.';
  end if;

  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_cuenta, v_empresa, v_plan, s.code, s.plantilla, s.nombre, 'own', 'manual', v_quien from _sub s;
  get diagnostics n = row_count;
  if n <> 4 then raise exception 'C06b promociones y envíos: esperaba crear 4 subcuentas y han sido %.', n; end if;

  insert into public.conta_ventas_canal_cuenta (company_id, account_id, channel_id, papel, company_account_id, created_by_name)
  select v_empresa, v_cuenta, c.id, 'promociones', a.id, v_quien
    from _canal c join public.company_account a on a.account_id = v_cuenta and a.company_id = v_empresa and a.code = c.promo
  union all
  select v_empresa, v_cuenta, c.id, 'envios', a.id, v_quien
    from _canal c join public.company_account a on a.account_id = v_cuenta and a.company_id = v_empresa and a.code = '70500001';
  get diagnostics n = row_count;
  if n <> 6 then raise exception 'C06b promociones y envíos: esperaba 6 enlaces (3 de promociones y 3 de envíos) y han sido %.', n; end if;

  raise notice 'C06b promociones y envíos: 4 subcuentas (70009001–70009003 y 70500001) y 6 enlaces en Foodint.';
end $$;
