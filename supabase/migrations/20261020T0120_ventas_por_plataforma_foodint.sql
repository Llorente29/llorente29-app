-- ============================================================================
-- C04b · Respuesta 5 · DATOS: la regla de ventas de Foodint
-- ----------------------------------------------------------------------------
-- Lo que decidió Julio el 13/10, escrito para Foodint (Llorente29 Food, S.L.):
--   · Todas las plataformas igual, también Glovo (Julio, R10, 14/10): un
--     asiento por plataforma, local y día, con una línea de venta por marca
--     (7000000x), su reembolso (7080000x) y el IVA (47700010). La marca va en
--     la subcuenta y la plataforma en la 430: el resultado por marca y
--     plataforma sale de las líneas, no del número de asientos. Glovo deja de
--     ir por marca (por_marca = false, como Uber y Just Eat); la columna se
--     queda para quien la necesite.
--   · Cada marca propia, a su 7000000x y su 7080000x (conta_ventas_marca),
--     las que trajo Diez el 12/10.
--   · Las tres marcas propias sin subcuenta de reembolsos en el plan (Scandal
--     Burgers, The Urban Kebab y Dirty Burger) la reciben ahora, con el
--     nombre al estilo de las de Diez: 70800003, 70800007 y 70800008. Diez no
--     las tiene: se crean allí al enviar (diezSubcuentas.ts), con el mismo
--     código y nombre.
--
-- Anclado por id y cuenta (regla 9): los canales, las marcas y la empresa van
-- por su id; las subcuentas, por código DENTRO de la empresa. PARA sin escribir
-- nada si algo no es lo medido el 13/10 en producción (solo lectura). En una
-- base sin Foodint (staging) no hace nada y lo dice.
--
-- Solo inserta: sigue sin «autorizo». Desde aquí Foodint usa la regla nueva:
-- _journal_entry_proponer niega el día entero (el front de antes lo dirá en
-- pantalla) y el cierre del día propone por unidad.
-- Vuelta atrás: supabase/vuelta-atras/20261020T0120_ventas_por_plataforma_foodint.down.sql
-- ============================================================================

do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_quien   constant text := 'Folvy (C04b R5, regla de ventas de Julio)';
  v_mal text;
begin
  if not exists (select 1 from public.company where id = v_empresa and account_id = v_cuenta) then
    raise notice 'Regla de ventas de Foodint: esta base no tiene Foodint; no se hace nada.';
    return;
  end if;

  create temp table _canal (id uuid, nombre text, por_marca boolean) on commit drop;
  insert into _canal values
    ('f98fcf5b-7ee3-4995-9a29-e755d2bd29f3', 'Glovo',   false),
    ('16ed2c7e-294b-4652-9a80-e5d3a241d2be', 'Uber',    false),
    ('60c822c8-e768-4290-8463-74e947564bcd', 'JustEat', false);

  create temp table _marca (id uuid, nombre text, ventas text, devoluciones text, nombre_dev text) on commit drop;
  insert into _marca values
    ('501ffd59-19e1-4d75-81dd-70c5a1a2b1de', 'Milanesa House',         '70000001', '70800001', null),
    ('cc89c6eb-afb8-4308-884e-9aac83986b22', 'Meraki Pita',            '70000002', '70800002', null),
    ('2b160122-c763-4ca5-8fd5-b74d06c910c5', 'Scandal Burgers',        '70000003', '70800003', 'DEVOL. VENTAS SCANDAL BURGER'),
    ('43d305cd-6b48-4a8d-b292-7d3aa09e9657', 'Smash Brothers Burgers', '70000004', '70800004', null),
    ('0229a52b-bfc6-4c6b-b29b-22b7288138e5', 'Mila''s Sandwiches',     '70000005', '70800005', null),
    ('95635ce3-055f-4333-b3ec-1b4e9b2a0170', 'Bendito Burrito',        '70000006', '70800006', null),
    ('5a230c99-1de4-47ca-82fb-65d4af589176', 'The Urban Kebab',        '70000007', '70800007', 'DEVOL. VENTAS THE URBAN KEBAB'),
    ('ca05894b-6d3c-466b-8064-04cc0c70a578', 'Dirty Burger',           '70000008', '70800008', 'DEVOL. VENTAS DIRTY BURGER'),
    ('99dff23e-98a8-46ab-af54-0cc19d036b72', 'Lovers Burgers',         '70000011', '70800011', null);

  -- Lo medido: los canales y las marcas son de Foodint, con ese nombre; las marcas, propias.
  select string_agg(c.nombre, ', ') into v_mal from _canal c
   where not exists (select 1 from public.sales_channel ch where ch.id = c.id and ch.account_id = v_cuenta and ch.name = c.nombre);
  if v_mal is not null then raise exception 'Regla de ventas de Foodint: canales que no son los medidos: %. No se toca nada.', v_mal; end if;
  select string_agg(m.nombre, ', ') into v_mal from _marca m
   where not exists (select 1 from public.brand b where b.id = m.id and b.account_id = v_cuenta and b.name = m.nombre and b.ownership_type = 'own');
  if v_mal is not null then raise exception 'Regla de ventas de Foodint: marcas que no son las medidas (o no son propias): %. No se toca nada.', v_mal; end if;
  -- Las 7000000x y las 7080000x que ya están, y las tres que faltan, que no estén.
  select string_agg(x.code, ', ') into v_mal from (
    select m.ventas as code from _marca m union all select m.devoluciones from _marca m where m.nombre_dev is null) x
   where not exists (select 1 from public.company_account a where a.company_id = v_empresa and a.code = x.code and a.status = 'activa');
  if v_mal is not null then raise exception 'Regla de ventas de Foodint: subcuentas que no están (o no están activas): %. No se toca nada.', v_mal; end if;
  select string_agg(m.devoluciones, ', ') into v_mal from _marca m
   where m.nombre_dev is not null and exists (select 1 from public.company_account a where a.company_id = v_empresa and a.code = m.devoluciones);
  if v_mal is not null then raise exception 'Regla de ventas de Foodint: % ya existen; alguien las ha creado. No se toca nada.', v_mal; end if;
  if exists (select 1 from public.conta_ventas_canal where company_id = v_empresa) or exists (select 1 from public.conta_ventas_marca where company_id = v_empresa) then
    raise exception 'Regla de ventas de Foodint: ya tiene regla escrita; no se pisa.';
  end if;

  insert into public.company_account (account_id, company_id, code, name, name_source, kind, template_code, plan, source, status, is_common, created_by_name)
  select v_cuenta, v_empresa, m.devoluciones, m.nombre_dev, m.nombre_dev, 'own', '7080', 'pymes', 'manual', 'activa', false, v_quien
    from _marca m where m.nombre_dev is not null;

  insert into public.conta_ventas_canal (company_id, account_id, channel_id, por_marca, created_by_name)
  select v_empresa, v_cuenta, c.id, c.por_marca, v_quien from _canal c;

  insert into public.conta_ventas_marca (company_id, account_id, brand_id, papel, company_account_id, created_by_name)
  select v_empresa, v_cuenta, m.id, p.papel, a.id, v_quien
    from _marca m cross join (values ('ventas'), ('devoluciones')) p(papel)
    join public.company_account a on a.company_id = v_empresa and a.code = case p.papel when 'ventas' then m.ventas else m.devoluciones end;

  raise notice 'Regla de ventas de Foodint: % canales, % enlaces de marca, % subcuentas nuevas (70800003, 70800007, 70800008).',
    (select count(*) from public.conta_ventas_canal where company_id = v_empresa),
    (select count(*) from public.conta_ventas_marca where company_id = v_empresa),
    (select count(*) from _marca where nombre_dev is not null);
end $$;
