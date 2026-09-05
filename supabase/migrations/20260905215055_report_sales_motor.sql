-- ── MOTOR del generador de informes. SIN guarda de usuario, a propósito ──────
--
-- Frontera única (principio 5 del proyecto): autoriza el BORDE, calcula el
-- motor. `report_sales` es la frontera y comprueba la cuenta; esta función solo
-- mide. Además así se puede probar desde SQL con CUALQUIER cuenta, que es
-- justo lo que exige la prueba de inquilino: se prueba, no se razona.
--
-- No se concede a anon ni a authenticated. Solo la llama la frontera.
--
-- ── LAS TRES COLUMNAS ───────────────────────────────────────────────────────
-- BRUTO := neto + descuentos, del CABECERO. Es la única definición con la que
-- bruto − descuentos = neto en todos los canales. La suma de `sale_line` NO se
-- usa: diverge del cabecero en 271 de 575 pedidos de la última semana completa
-- y la desviación tiene forma de porte, distinta según la pasarela (B75).
--
-- CONVENIO DE SIGNO, fijado aquí para que nadie concluya nada al revés:
--   desviación := cabecero − líneas  =  (neto + descuentos) − Σ line_total
-- Negativa = las líneas suman MÁS que el cabecero. Con este convenio,
-- lastapp·glovo de la semana 24→30/08 da −992,71 €.
create or replace function public._report_sales_rows(
  p_account        uuid,
  p_from           timestamptz,
  p_to             timestamptz,
  p_ejes           text[],
  p_location_ids   uuid[] default null,
  p_brand_ids      uuid[] default null,
  p_ownership      text   default null,
  p_channel_ids    uuid[] default null,
  p_service_types  text[] default null
)
returns table (
  dims               jsonb,
  pedidos            bigint,
  bruto              numeric,
  descuentos         numeric,
  neto               numeric,
  ticket_medio       numeric,
  coste              numeric,
  pedidos_costeados  bigint,
  neto_costeado      numeric,
  pedidos_sin_hueco  bigint,
  neto_sin_hueco     numeric,
  pedidos_mod_sin_impacto bigint
)
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_tz text;
begin
  select coalesce(a.timezone, 'Europe/Madrid') into v_tz from accounts a where a.id = p_account;

  return query
  with base as (
    select
      s.id,
      coalesce(s.total, 0)                    as neto,
      coalesce(s.discount_amount, 0)          as dto,
      -- Los ejes: cada uno solo aparece si se ha pedido. `jsonb_strip_nulls`
      -- quita las claves no pedidas; por eso el valor ausente se etiqueta
      -- «(sin …)» ANTES — una fila sin marca es una fila, no un agujero
      -- (regla 7: el eje ordena y etiqueta, no decide la existencia).
      jsonb_strip_nulls(jsonb_build_object(
        'local',     case when 'local'     = any(p_ejes) then coalesce(l.name, '(sin local)') end,
        'marca',     case when 'marca'     = any(p_ejes) then coalesce(b.name, '(sin marca)') end,
        'propiedad', case when 'propiedad' = any(p_ejes) then
                            case b.ownership_type when 'own'      then 'propia'
                                                  when 'licensed' then 'cedida'
                                                  else '(sin propiedad)' end end,
        'canal',     case when 'canal'     = any(p_ejes) then coalesce(sc.name, '(sin canal)') end,
        'servicio',  case when 'servicio'  = any(p_ejes) then coalesce(s.service_type, '(sin servicio)') end,
        'dia',       case when 'dia'       = any(p_ejes) then
                            to_char((s.sold_at at time zone v_tz)::date, 'YYYY-MM-DD') end
      )) as dims,
      -- COSTE: solo de las líneas `product`. Las `combo_item` y `modifier`
      -- tienen `computed_cost` NULL SIEMPRE y a propósito — el motor cuelga
      -- todo el coste de la línea padre. Medido en la semana 24→30/08:
      -- 0 de 327 combo_item y 0 de 280 modifier con coste, cero ignoradas.
      -- Contarlas como «sin coste» hunde la cobertura del 85 % al 49 % y no
      -- describe nada real: son huecos por diseño, no huecos por rellenar.
      (select sum(sl.computed_cost) from sale_line sl
        where sl.sale_id = s.id and sl.line_type = 'product' and sl.ignored_at is null) as coste,
      coalesce((select bool_and(sl.computed_cost is not null) from sale_line sl
        where sl.sale_id = s.id and sl.line_type = 'product' and sl.ignored_at is null), false) as completo,
      -- EL HUECO QUE LA COBERTURA NO VE. Que la línea padre tenga coste no
      -- prueba que ese coste esté COMPLETO: un modificador que se cobra y no
      -- tiene impacto confirmado mete su comida en el precio y no en el coste.
      -- El pedido cuenta como costeado y el margen sale mejor de lo que es.
      exists (
        select 1 from sale_line m
        where m.sale_id = s.id and m.line_type = 'modifier' and m.ignored_at is null
          and coalesce(m.line_total, 0) > 0
          and not exists (select 1 from modifier_recipe_impact mri
                          where mri.modifier_option_id = m.modifier_option_id
                            and mri.status = 'confirmed')
      ) as hueco_modificador
    from sale s
    -- LEFT JOIN y unión por ID, nunca por nombre: `Foodint Alcalá` existe en
    -- DOS cuentas y `slug='uber'` en TRES. Unir por nombre mezcla inquilinos y
    -- no se nota — la fila de más parece un local nuevo.
    left join locations     l  on l.id  = s.location_id and l.account_id  = s.account_id
    left join brand         b  on b.id  = s.brand_id    and b.account_id  = s.account_id
    left join sales_channel sc on sc.id = s.channel_id  and sc.account_id = s.account_id
    where s.account_id = p_account
      and s.is_active = true
      and coalesce(s.status, '') <> 'cancelled'
      and s.sold_at >= p_from
      and s.sold_at <  p_to
      and (p_location_ids  is null or s.location_id  = any(p_location_ids))
      and (p_brand_ids     is null or s.brand_id     = any(p_brand_ids))
      and (p_ownership     is null or b.ownership_type = p_ownership)
      and (p_channel_ids   is null or s.channel_id   = any(p_channel_ids))
      and (p_service_types is null or s.service_type = any(p_service_types))
  )
  select
    base.dims,
    count(*)::bigint,
    round(sum(base.neto + base.dto), 2),
    round(sum(base.dto), 2),
    round(sum(base.neto), 2),
    case when count(*) > 0 then round(sum(base.neto) / count(*), 2) else 0 end,
    round(sum(base.coste) filter (where base.completo), 2),
    count(*) filter (where base.completo)::bigint,
    round(sum(base.neto) filter (where base.completo), 2),
    count(*) filter (where base.completo and not base.hueco_modificador)::bigint,
    round(sum(base.neto) filter (where base.completo and not base.hueco_modificador), 2),
    count(*) filter (where base.hueco_modificador)::bigint
  from base
  group by base.dims;
end;
$fn$;

revoke all on function public._report_sales_rows(uuid, timestamptz, timestamptz, text[], uuid[], uuid[], text, uuid[], text[]) from public, anon, authenticated;

comment on function public._report_sales_rows(uuid, timestamptz, timestamptz, text[], uuid[], uuid[], text, uuid[], text[]) is
  'Motor del generador de informes. Sin guarda (frontera unica): autoriza report_sales. Bruto = neto + descuentos del cabecero; coste solo de lineas product.';
