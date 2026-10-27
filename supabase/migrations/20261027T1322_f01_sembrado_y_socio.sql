-- supabase/migrations/20261027T1322_f01_sembrado_y_socio.sql
--
-- cambia: public.seed_catalog_canonical · prueba: supabase/staging/sql/20261027_f01_marcas_last_prueba.sql
-- cambia: public.ticket_invoice_ajustes · prueba: supabase/staging/sql/20261027_f01_marcas_last_prueba.sql
-- cambia: public.brand_licensing_agreement · prueba: supabase/staging/sql/20261027_f01_marcas_last_prueba.sql
--
-- F01 · PR 1 · Lo que CAMBIA lo que existe (va después de la 1320, que añade).
-- Nada en el camino del pedido.
--
--   1. CAMBIA EN CALIENTE seed_catalog_canonical (el sembrado de Integraciones,
--      solo soporte), misma firma y mismo resultado: cada marca de Last se
--      resuelve por su alta o su vínculo (o, como antes, por su nombre) y se
--      siembra con _f01_sembrar_marca (1320). Las archivadas van en
--      no_en_la_foto con 'motivo': 'archivada'.
--   2. CAMBIA EN CALIENTE ticket_invoice_ajustes (V04, Ajustes › Facturas de
--      los pedidos): el socio de una cedida sale de su ficha
--      (brand_licensing_agreement) y, si no lo tiene, como antes, de la factura
--      de su último pedido de Last.
--   3. brand_licensing_agreement.revenue_share_pct pasa a OPCIONAL: el alta sabe
--      el socio pero no el porcentaje, y un cero inventado daría márgenes
--      falsos. menu_item_economics ya lo trata como «sin porcentaje».
-- Las dos funciones se guardan antes tal cual (_respaldar_funcion) y la vuelta
-- atrás las restaura byte a byte.

-- ── respaldo: lo que se cambia en caliente, tal cual estaba ─────────────────
select public._respaldar_funcion('public.seed_catalog_canonical(uuid,boolean,interval)', '20261027T1322_f01_sembrado_y_socio');
select public._respaldar_funcion('public.ticket_invoice_ajustes(uuid)', '20261027T1322_f01_sembrado_y_socio');


-- ── 8. El porcentaje del socio, opcional ────────────────────────────────────
alter table public.brand_licensing_agreement alter column revenue_share_pct drop not null;

-- ── 3 bis. El sembrado de siempre (Integraciones, solo soporte), por marca ──
-- Misma firma y mismo resultado. Cada marca de Last se resuelve con
-- _f01_marca_vinculada (o, como antes, por su nombre) y se siembra con
-- _f01_sembrar_marca. Las archivadas van en no_en_la_foto con 'motivo': 'archivada'.
create or replace function public.seed_catalog_canonical(p_account_id uuid, p_dry_run boolean, p_margen_foto interval default '1 day'::interval)
returns table(dry_run boolean, matriculas_miradas integer, base_ya_existentes integer, productos_base_creados integer, overrides_creados integer,
              overrides_de_foto_vieja integer, productos_sin_revisar_precios integer, saltados_sin_marca integer,
              saltados_por_integracion_no_cedida integer, saltados_por_ser_propia integer, saltados_por_no_estar_en_la_foto integer,
              marcas_sin_resolver text[], marcas_de_integracion_no_cedida text[], marcas_propias_saltadas text[], no_en_la_foto jsonb, fotos jsonb)
language plpgsql security definer set search_path = public as $$
declare
  v_m        record;
  v_brand    uuid;
  v_own      text;
  v_r        jsonb;
  v_mir      integer := 0;
  v_ya       integer := 0;
  v_base     integer := 0;
  v_over     integer := 0;
  v_nomarca  integer := 0;
  v_norg     integer := 0;
  v_propia   integer := 0;
  v_vieja    integer := 0;
  v_nom      text[] := '{}';
  v_org      text[] := '{}';
  v_pro      text[] := '{}';
  v_lista    jsonb := '[]'::jsonb;
  v_fotos    jsonb;
begin
  if not (public.current_user_is_admin() or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'seed_catalog_canonical: sin acceso a la cuenta %', p_account_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('org', t.external_org_id, 'nombre', t.nombre, 'tipo', t.tipo, 'ultima_foto', t.ultima_foto,
           'horas', round(extract(epoch from (now() - t.ultima_foto)) / 3600.0, 1), 'filas', t.filas) order by t.ultima_foto desc), '[]'::jsonb)
    into v_fotos
    from (select ecp.external_org_id, max(ei.organization_name) as nombre, max(ei.ownership_type) as tipo,
                 max(ecp.seen_in_catalog_at) as ultima_foto, count(*) as filas
            from public.external_catalog_product ecp
            left join public.external_integration ei on ei.account_id = ecp.account_id and ei.source = 'lastapp' and ei.external_org_id = ecp.external_org_id
           where ecp.account_id = p_account_id
           group by ecp.external_org_id) t;

  for v_m in
    with fotos as (
      select x.external_org_id as org, max(x.seen_in_catalog_at) as ultima
        from public.external_catalog_product x where x.account_id = p_account_id group by x.external_org_id
    ),
    -- Cada matrícula de cada marca, con si estaba en la última foto de su cuenta de Last.
    por_matricula as (
      select ecp.external_org_id as org, btrim(ecp.external_brand_name) as nombre, ecp.organization_product_id as m,
             bool_or(ei.ownership_type = 'licensed' and ei.is_active) as de_cedida,
             bool_or(ecp.seen_in_catalog_at >= fo.ultima - p_margen_foto) as en_foto
        from public.external_catalog_product ecp
        join fotos fo on fo.org = ecp.external_org_id
        left join public.external_integration ei on ei.account_id = ecp.account_id and ei.source = 'lastapp' and ei.external_org_id = ecp.external_org_id
       where ecp.account_id = p_account_id and ecp.organization_product_id is not null
         and nullif(btrim(ecp.external_brand_name), '') is not null and btrim(ecp.external_brand_name) <> 'FOODINT'
       group by 1, 2, 3
    )
    select org, nombre, count(*) as matriculas, bool_or(de_cedida) as de_cedida, count(*) filter (where not en_foto) as viejas
      from por_matricula group by org, nombre
  loop
    v_brand := coalesce(public._f01_marca_vinculada(p_account_id, v_m.org, v_m.nombre), public._f01_marca_por_nombre(p_account_id, v_m.nombre));
    if v_brand is null then
      v_nomarca := v_nomarca + v_m.matriculas;
      if not (v_m.nombre = any (v_nom)) then v_nom := v_nom || v_m.nombre; end if;
      continue;
    end if;
    -- Solo se siembra de una cuenta de Last CEDIDA y encendida (la guarda de origen de siempre).
    if not coalesce(v_m.de_cedida, false) then
      v_norg := v_norg + v_m.matriculas;
      if not (v_m.nombre = any (v_org)) then v_org := v_org || v_m.nombre; end if;
      continue;
    end if;
    select b.ownership_type into v_own from public.brand b where b.id = v_brand;
    if v_own is distinct from 'licensed' then
      v_propia := v_propia + v_m.matriculas;
      if not (v_m.nombre = any (v_pro)) then v_pro := v_pro || v_m.nombre; end if;
      continue;
    end if;
    v_r := public._f01_sembrar_marca(p_account_id, v_brand, v_m.org, v_m.nombre, p_dry_run, 'Sembrado de Last');
    v_mir  := v_mir + (v_r->>'matriculas')::integer;
    v_ya   := v_ya + (v_r->>'ya_estaban')::integer;
    v_base := v_base + (v_r->>'creados')::integer;
    v_over := v_over + (v_r->>'precios_por_plataforma')::integer;
    v_vieja := v_vieja + v_m.viejas;
    v_lista := v_lista || coalesce((select jsonb_agg(a || jsonb_build_object('marca', v_m.nombre, 'motivo', 'archivada'))
                                      from jsonb_array_elements(v_r->'archivadas') a), '[]'::jsonb);
  end loop;

  dry_run := p_dry_run;
  matriculas_miradas := v_mir;
  base_ya_existentes := v_ya;
  productos_base_creados := v_base;
  overrides_creados := v_over;
  overrides_de_foto_vieja := 0;
  productos_sin_revisar_precios := v_norg;
  saltados_sin_marca := v_nomarca;
  saltados_por_integracion_no_cedida := v_norg;
  saltados_por_ser_propia := v_propia;
  saltados_por_no_estar_en_la_foto := v_vieja;
  marcas_sin_resolver := v_nom;
  marcas_de_integracion_no_cedida := v_org;
  marcas_propias_saltadas := v_pro;
  no_en_la_foto := v_lista;
  fotos := v_fotos;
  return next;
end $$;

-- ── 7. V04 · Ajustes › Facturas de los pedidos: el socio, de su ficha ───────
create or replace function public.ticket_invoice_ajustes(p_account uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_a public.accounts; v_year integer := extract(year from (now() at time zone 'Europe/Madrid'))::integer;
begin
  if p_account is null or not public.belongs_to_account(p_account) then raise exception 'No eres de esta cuenta.' using errcode = '42501'; end if;
  select * into v_a from public.accounts where id = p_account;
  return jsonb_build_object(
    'año', v_year,
    -- Sin el fabricante de Sumied no se pasa a real (verifactu_modo): se avisa aquí.
    'fabricante_falta', not public.verifactu_sistema_completo(),
    'empresas', (select coalesce(jsonb_agg(jsonb_build_object('company_id', c.id, 'nombre', coalesce(c.legal_name, c.trade_name),
                    'nif', c.tax_id, 'verifactu', coalesce(e.modo, 'apagado'), 'real_desde', e.real_desde,
                    'conexion_probada', coalesce(public.verifactu_conexion_probada(case when e.modo = 'real' then 'real' else 'pruebas' end,
                                                   regexp_replace(upper(coalesce(c.tax_id, '')), '^ES', '')), false))
                    order by coalesce(c.legal_name, c.trade_name)), '[]'::jsonb)
                   from public.company c left join public.verifactu_empresa e on e.company_id = c.id
                  where c.account_id = p_account and coalesce(c.is_active, true)),
    'locales', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'nombre', l.name, 'activo', l.active,
                    'codigo', lic.code, 'propuesto', public._ticket_codigo_propuesto(l.name, v_a.name),
                    'empresa', (select coalesce(c.legal_name, c.trade_name) from public.location_company lc join public.company c on c.id = lc.company_id
                                 where lc.location_id = l.id and lc.account_id = p_account),
                    'tramo', x.tramo,
                    'serie', case when lic.code is not null then public._ticket_numero_texto(lic.code, v_year, x.tramo, 'F', 1) end,
                    'ultimo', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id
                                 and s.year = v_year and s.kind = 'F' and s.tramo is not distinct from x.tramo),
                    'ultimo_at', (select max(t.issued_at) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id and t.kind = 'F'),
                    'rectificativas', case when lic.code is not null then public._ticket_numero_texto(lic.code, v_year, x.tramo_r, 'R', 1) end,
                    'ultimo_r', (select last_number from public.ticket_invoice_series s where s.account_id = p_account and s.location_id = l.id
                                   and s.year = v_year and s.kind = 'R' and s.tramo is not distinct from x.tramo_r),
                    'numeros', (select count(*) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id),
                    'verifactu_pendientes', (select count(*) from public.ticket_invoice t where t.account_id = p_account and t.location_id = l.id
                                               and t.verifactu_estado in ('pendiente', 'anulacion_pendiente')))
                    order by l.active desc, l.name), '[]'::jsonb)
                  from public.locations l left join public.location_invoice_code lic on lic.location_id = l.id and lic.account_id = p_account
                  cross join lateral (select public._ticket_tramo(p_account, l.id, v_year, 'F') as tramo,
                                             public._ticket_tramo(p_account, l.id, v_year, 'R') as tramo_r) x
                 where l.account_id = p_account),
    'marcas', (select coalesce(jsonb_agg(jsonb_build_object('brand_id', b.id, 'nombre', b.name, 'propia', coalesce(b.ownership_type, 'own') <> 'licensed',
                    -- F01: quién emite la de una cedida, de su ficha (brand_licensing_agreement);
                    -- si no lo tiene, como antes, la factura de su último pedido de Last (30 días).
                    'emisor', case when b.ownership_type = 'licensed' then coalesce(
                       (select nullif(btrim(a.owner_name), '') from public.brand_licensing_agreement a
                         where a.account_id = p_account and a.brand_id = b.id and a.is_active and a.archived_at is null),
                       (select public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' from public.sale s
                         where s.account_id = p_account and s.brand_id = b.id and s.sold_at > now() - interval '30 days'
                           and public.safe_jsonb(s.raw_tab)->'bills'->0->'company'->>'name' is not null
                         order by s.sold_at desc limit 1)) end,
                    'emisor_de', case when b.ownership_type = 'licensed' then
                       case when exists (select 1 from public.brand_licensing_agreement a where a.account_id = p_account and a.brand_id = b.id
                                           and a.is_active and a.archived_at is null and nullif(btrim(a.owner_name), '') is not null)
                            then 'ficha' else 'factura' end end)
                    order by (coalesce(b.ownership_type, 'own') = 'licensed'), b.name), '[]'::jsonb)
                 from public.brand b where b.account_id = p_account and b.is_active and b.archived_at is null),
    -- Pedidos de cedidas de los últimos 7 días sin la factura de Last (sus tiques salen sin la línea).
    'cedidas_sin_factura_7d', (select count(*) from public.sale s join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
                                 where s.account_id = p_account and b.ownership_type = 'licensed' and s.sold_at > now() - interval '7 days'
                                   and nullif(btrim(public.safe_jsonb(s.raw_tab)->'bills'->0->>'number'), '') is null));
end $$;
revoke all on function public.ticket_invoice_ajustes(uuid) from public, anon;
grant execute on function public.ticket_invoice_ajustes(uuid) to authenticated;
