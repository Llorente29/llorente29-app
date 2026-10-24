-- N6 · La puerta v1: lo que Sumied lee de Folvy, por funciones con versión (paso 9 de la auditoría C09).
--
-- SOLO AÑADE: siete funciones nuevas, todas de LECTURA. No cambia ninguna tabla,
-- ninguna función que exista ni ninguna pantalla: todavía nadie las llama
-- (pasar Sumied a ellas es otra tanda, a la vista de Julio).
--
-- Las cinco de la puerta (la de nóminas, fuente_nominas_mes_v1, va con
-- Laboral, en su PR, porque necesita columnas nuevas en payroll_cost):
--   fuente_recepciones_v1, fuente_recepcion_lineas_v1, fuente_ventas_dia_v1,
--   fuente_pedidos_v1, fuente_productos_v1.
-- Las liquidaciones de plataforma (channel_settlement) y de licencia
-- (licensed_settlement) NO van por la puerta: son de Sumied (Julio, 24/10, a la
-- vista del N8), y Sumied no se lee a sí mismo por una puerta.
-- Y dos de apoyo, internas (no se ejecutan desde la API):
--   fuente__cuenta(empresa): la cuenta de la empresa, o para (42501) si quien
--     pregunta es un usuario que no puede verla (conta_impuesto_puede_ver: sus
--     cuentas y su asesoría con consentimiento). Sin usuario (el servidor, el
--     cron) pasa.
--   fuente__locales(empresa): los locales de la empresa. Si existe
--     location_company (N3), los suyos, y un local sin fila solo si su cuenta
--     tiene una sola empresa; si no existe todavía, los de su cuenta (hoy, en
--     producción, 1 empresa en 1 cuenta).
--
-- El contrato, igual en las cinco: SECURITY DEFINER con search_path fijo,
-- comprueban la empresa, importes en numeric(14,2), horas en UTC y el día en
-- Madrid. Last o Revo implementarían las mismas firmas desde su importador.
-- Ejecutan authenticated y service_role; anon y public, no.
--
-- Se puede pasar dos veces (create or replace, firmas nuevas).
-- Prueba: supabase/staging/sql/20261024_n6_puerta_v1_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T0714_n6_puerta_v1.down.sql

create or replace function public.fuente__cuenta(p_empresa uuid)
 returns uuid
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v uuid;
begin
  select c.account_id into v from public.company c where c.id = p_empresa;
  if v is null then
    raise exception 'La empresa % no existe.', p_empresa using errcode = 'P0002';
  end if;
  if auth.uid() is not null and not public.conta_impuesto_puede_ver(p_empresa) then
    raise exception 'No puedes leer los datos de esa empresa.' using errcode = '42501';
  end if;
  return v;
end
$function$;

create or replace function public.fuente__locales(p_empresa uuid)
 returns setof uuid
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_cuenta uuid := public.fuente__cuenta(p_empresa); v_una boolean;
begin
  select count(*) = 1 into v_una from public.company c where c.account_id = v_cuenta;
  if to_regclass('public.location_company') is null then
    return query select l.id from public.locations l where l.account_id = v_cuenta;
    return;
  end if;
  -- Con el maestro del N3: los suyos, y los sin fila solo si la cuenta tiene una sola empresa.
  return query execute
    'select l.id from public.locations l
       left join public.location_company lc on lc.location_id = l.id
      where l.account_id = $1 and (lc.company_id = $2 or (lc.location_id is null and $3))'
    using v_cuenta, p_empresa, v_una;
end
$function$;

-- 1 · Recepciones (albaranes) de la empresa entre dos fechas.
create or replace function public.fuente_recepciones_v1(p_empresa uuid, p_desde date, p_hasta date)
 returns table(recepcion_id uuid, local_id uuid, proveedor_id uuid, proveedor text, fecha date, albaran text,
               estado text, base numeric(14,2), iva numeric(14,2), total numeric(14,2), iva_completo boolean,
               papel text, recibida_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with l as (
    select gl.goods_receipt_id,
           coalesce(gl.doc_amount, gl.qty_received * gl.unit_cost) as base,
           (select r.rate from public.vat_rate_for(ri.vat_category_id, g.receipt_date) r) as tipo
      from public.goods_receipt g
      join public.goods_receipt_line gl on gl.goods_receipt_id = g.id
      left join public.recipe_item ri on ri.id = gl.recipe_item_id
     where g.account_id = public.fuente__cuenta(p_empresa)
       and g.location_id in (select public.fuente__locales(p_empresa))
       and g.receipt_date between p_desde and p_hasta
       and not coalesce(gl.not_goods, false)
  ), s as (
    select goods_receipt_id, sum(base) base, sum(base * tipo / 100) iva, bool_and(tipo is not null) completo
      from l group by goods_receipt_id
  )
  select g.id, g.location_id, g.supplier_id, sp.name, g.receipt_date, g.supplier_doc_number, g.status,
         coalesce(s.base, 0)::numeric(14,2), coalesce(s.iva, 0)::numeric(14,2),
         (coalesce(s.base, 0) + coalesce(s.iva, 0))::numeric(14,2), coalesce(s.completo, true),
         g.raw_document_url, g.received_at
    from public.goods_receipt g
    left join s on s.goods_receipt_id = g.id
    left join public.supplier sp on sp.id = g.supplier_id
   where g.account_id = public.fuente__cuenta(p_empresa)
     and g.location_id in (select public.fuente__locales(p_empresa))
     and g.receipt_date between p_desde and p_hasta
     and coalesce(g.is_active, true)
   order by g.receipt_date, g.id
$function$;

-- 2 · Las líneas de una recepción.
create or replace function public.fuente_recepcion_lineas_v1(p_recepcion uuid)
 returns table(linea_id uuid, articulo_id uuid, articulo text, cantidad numeric, unidad text,
               precio numeric, base numeric(14,2), tipo_iva numeric, no_es_mercancia boolean)
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_cuenta uuid; v_empresa uuid;
begin
  select g.account_id into v_cuenta from public.goods_receipt g where g.id = p_recepcion;
  if v_cuenta is null then raise exception 'La recepción % no existe.', p_recepcion using errcode = 'P0002'; end if;
  -- Se comprueba contra una empresa de su cuenta (la de su local, si el N3 lo dice).
  select c.id into v_empresa from public.company c where c.account_id = v_cuenta order by c.created_at limit 1;
  perform public.fuente__cuenta(v_empresa);
  return query
    select gl.id, gl.recipe_item_id, coalesce(ri.name, gl.product_name), gl.qty_received,
           coalesce(ku.abbreviation, ku.name), gl.unit_cost,
           coalesce(gl.doc_amount, gl.qty_received * gl.unit_cost)::numeric(14,2),
           (select r.rate from public.vat_rate_for(ri.vat_category_id, g.receipt_date) r),
           coalesce(gl.not_goods, false)
      from public.goods_receipt_line gl
      join public.goods_receipt g on g.id = gl.goods_receipt_id
      left join public.recipe_item ri on ri.id = gl.recipe_item_id
      left join public.kitchen_unit ku on ku.id = gl.purchase_unit_id
     where gl.goods_receipt_id = p_recepcion
     order by gl.position nulls last, gl.id;
end
$function$;

-- 3 · Las ventas de un día de la empresa, por local, marca y canal. El día es
-- el de su cierre (sold_at en Madrid, menos la hora de cierre: a las 02:00 de
-- serie, lo de la 01:30 es del día anterior).
create or replace function public.fuente_ventas_dia_v1(p_empresa uuid, p_dia date)
 returns table(local_id uuid, marca_id uuid, canal_id uuid, pedidos integer, base numeric(14,2), iva numeric(14,2),
               total numeric(14,2), devoluciones numeric(14,2), no_confirmados integer)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with h as (
    select coalesce((select t.sales_day_close_time from public.company_tax_profile t where t.company_id = p_empresa), time '02:00') as hora
  )
  select s.location_id, s.brand_id, s.channel_id, count(*)::integer,
         sum(coalesce(s.taxable_base, 0))::numeric(14,2), sum(coalesce(s.tax, 0))::numeric(14,2),
         sum(coalesce(s.total, 0))::numeric(14,2), sum(coalesce(s.refund_amount, 0))::numeric(14,2),
         count(*) filter (where exists (select 1 from public.sales_day_close_log g
                                         where g.sale_id = s.id and g.accion = 'cerrado_sin_confirmar'))::integer
    from public.sale s, h
   where s.account_id = public.fuente__cuenta(p_empresa)
     and s.location_id in (select public.fuente__locales(p_empresa))
     and s.status = 'closed'
     and ((s.sold_at at time zone 'Europe/Madrid') - h.hora)::date = p_dia
   group by s.location_id, s.brand_id, s.channel_id
   order by s.location_id, s.brand_id, s.channel_id
$function$;

-- 4 · Los pedidos de la empresa entre dos instantes (para Catcher y los riders).
create or replace function public.fuente_pedidos_v1(p_empresa uuid, p_desde timestamptz, p_hasta timestamptz, p_canal text default null)
 returns table(pedido_id uuid, local_id uuid, marca_id uuid, canal_id uuid, canal text, referencia text,
               sold_at timestamptz, dia_madrid date, estado text, estado_plataforma text, total numeric(14,2),
               quien_reparte text, con_rider boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select s.id, s.location_id, s.brand_id, s.channel_id, ch.slug,
         coalesce(s.platform_order_code, s.external_ref), s.sold_at, (s.sold_at at time zone 'Europe/Madrid')::date,
         s.status, s.order_status, coalesce(s.total, 0)::numeric(14,2), s.dispatch_mode, s.has_courier
    from public.sale s
    left join public.sales_channel ch on ch.id = s.channel_id
   where s.account_id = public.fuente__cuenta(p_empresa)
     and s.location_id in (select public.fuente__locales(p_empresa))
     and s.sold_at >= p_desde and s.sold_at < p_hasta
     and (p_canal is null or ch.slug = p_canal)
   order by s.sold_at, s.id
$function$;

-- 5 · Los productos de la cuenta de la empresa.
create or replace function public.fuente_productos_v1(p_empresa uuid, p_tipo text default null)
 returns table(producto_id uuid, nombre text, tipo text, unidad text, activo boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select ri.id, ri.name, ri.type, coalesce(ku.abbreviation, ku.name), coalesce(ri.is_active, true) and ri.archived_at is null
    from public.recipe_item ri
    left join public.kitchen_unit ku on ku.id = ri.base_unit_id
   where ri.account_id = public.fuente__cuenta(p_empresa)
     and (p_tipo is null or ri.type = p_tipo)
   order by ri.name, ri.id
$function$;

-- Quién ejecuta: las dos de apoyo, nadie desde la API (las llaman las otras,
-- que son del mismo dueño); las cinco, authenticated y service_role.
do $$
declare f text;
begin
  foreach f in array array['public.fuente__cuenta(uuid)', 'public.fuente__locales(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.fuente_recepciones_v1(uuid, date, date)', 'public.fuente_recepcion_lineas_v1(uuid)',
    'public.fuente_ventas_dia_v1(uuid, date)', 'public.fuente_pedidos_v1(uuid, timestamptz, timestamptz, text)',
    'public.fuente_productos_v1(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
    execute format('comment on function %s is %L', f,
      'N6 (24/10). Puerta v1 de Sumied hacia Folvy: solo lectura, comprueba la empresa (fuente__cuenta), importes numeric(14,2), horas UTC y día en Madrid.');
  end loop;
end $$;
