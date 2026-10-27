-- supabase/migrations/20261027T1321_f01_socios_y_el_delicioso.sql
--
-- F01 · PR 1 · Lo que cambia datos que existen (va después de la 1320 y la
-- 1322). El analizador la da por «sigue»: lo de la parte 2 lo escriben
-- funciones de la 1320, que no ve. Lo que cambia lo dice la cuenta de la tanda
-- (scripts/conta/produccion/cuentas/f01-marcas-last.sql), antes y después.
--
--   1. EL SOCIO DE LAS CEDIDAS QUE YA EXISTEN, en su ficha
--      (brand_licensing_agreement), con lo que dicen sus facturas de Last: el
--      emisor de la factura de sus pedidos de los últimos 90 días, SOLO si es
--      uno (si una marca tiene dos emisores, no se elige: se queda sin ficha y
--      se dice). Nunca una empresa de la propia cuenta. Sin porcentaje: no se
--      sabe y no se inventa. En toda la base, cuenta a cuenta (regla 9: el
--      socio de cada marca sale de los pedidos de SU cuenta).
--      Medido en producción (27/10, solo lectura): Foodint, 8 cedidas activas
--      con un solo emisor (todas el mismo, Cloudtown), El Delicioso sin pedidos
--      y Lobbers apagada. 0 fichas en toda la base.
--   2. EL DELICIOSO, TERMINADO SIN DUPLICAR (Foodint), con el alta de la 1320:
--      cedida, con el socio que propone su cuenta de Last (el de las otras
--      marcas de esa cuenta), en sus locales ACTIVOS (Alcalá y Carabanchel; su
--      tienda de Plaza Castilla está cerrada) y con su carta: 19 matrículas, 18
--      platos («CACHAPA QUESUDA (DL)» y «CACHAPA QUESUDA DL» son uno), 10 que
--      enlazan con lo que ya hay en el almacén (bebidas y postres) y 8 platos
--      sin receta. Los 9 que ya existían se reutilizan; se crean 10.
--      Lo vendido antes: El Delicioso no tiene ni una venta (medido).
--
-- Lo que crea lleva su firma (created_by_name / notes = 'F01 · tanda'), y la
-- vuelta atrás quita solo eso.

-- ── 1. El socio de las cedidas, de sus facturas de Last ─────────────────────
insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, revenue_share_pct, is_active, created_by_name, notes)
select x.account_id, x.brand_id, x.emisor, null, true, 'F01 · tanda',
       'Socio sacado de las facturas de sus pedidos de Last (F01). Falta el porcentaje.'
  from (select b.account_id, b.id as brand_id,
               min(btrim(public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name')) as emisor,
               count(distinct upper(btrim(public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name'))) as emisores
          from public.brand b
          join public.sale s on s.account_id = b.account_id and s.brand_id = b.id and s.source = 'lastapp'
                            and s.sold_at > now() - interval '90 days'
                            and nullif(btrim(public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name'), '') is not null
         where b.ownership_type = 'licensed' and b.is_active and b.archived_at is null
           and not exists (select 1 from public.brand_licensing_agreement a where a.brand_id = b.id)
         group by b.account_id, b.id) x
 where x.emisores = 1
   and not exists (select 1 from public.company c where c.account_id = x.account_id
                    and upper(btrim(coalesce(c.legal_name, c.trade_name, ''))) = upper(x.emisor));

-- ── 2. El Delicioso, en Foodint ─────────────────────────────────────────────
do $$
declare
  v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint
  v_marca  constant text := 'El Delicioso Latin Food';
  v_org    uuid;
  v_ficha  jsonb;
  v_r      jsonb;
begin
  -- La cuenta de Last de El Delicioso: tiene que ser UNA.
  select min(e.external_org_id::text)::uuid into v_org from public.external_catalog_product e
   where e.account_id = v_cuenta and btrim(e.external_brand_name) = v_marca
  having count(distinct e.external_org_id) = 1;
  if v_org is null then
    raise notice 'F01: El Delicioso no está (o está en más de una cuenta de Last) en esta base: no se da de alta.';
    return;
  end if;

  select x into v_ficha from jsonb_array_elements(public._f01_marcas_last(v_cuenta)) x
   where x->>'nombre' = v_marca and (x->>'org')::uuid = v_org;
  if v_ficha is null then raise exception 'F01: El Delicioso no sale entre las marcas de Last de Foodint.'; end if;
  if v_ficha->>'estado' not in ('sin_vincular', 'nueva') then
    raise notice 'F01: El Delicioso ya está %: no se toca.', v_ficha->>'estado';
    return;
  end if;
  if nullif(v_ficha->'propuesta'->>'socio', '') is null then
    raise exception 'F01: no hay socio que proponer para El Delicioso (¿falta la parte 1?).';
  end if;

  v_r := public._f01_alta_marca(v_cuenta, v_org, v_marca, v_marca, false, v_ficha->'propuesta'->>'socio', false, null, 'F01 · tanda');
  raise notice 'F01 · El Delicioso: %', v_r::text;
  if (v_r->'carta'->>'platos')::integer < 1 then raise exception 'F01: El Delicioso se ha quedado sin carta: %', v_r::text; end if;
end $$;
