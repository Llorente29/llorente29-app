-- scripts/conta/c03_antes_despues.sql
--
-- C03 · ANTES = DESPUÉS de la tanda (0100–0160) en producción. SOLO LEE. La
-- MISMA consulta antes y después (regla 31): con «- array[...]» se quitan las
-- columnas que añade el C03, que antes no existen y después sí; lo que queda
-- es lo que había, y su huella tiene que salir IDÉNTICA.
--
-- Por cuenta (regla 9). Una fila por cuenta y tabla:
--   · supplier: entera (el C03 solo le pone un disparador; no le escribe).
--   · channel_settlement: sin las columnas nuevas. Incluye period_from/_to y
--     settlement_date: lo que leen Ventas (channel_economics_dashboard,
--     channel_pnl_by_brand, channel_trend_monthly, margin_by_brand) y el vigía
--     B59 (liquidacion_atrasada_watchdog). Misma huella = mismas lecturas.
--   · licensed_settlement y brand_licensing_agreement: sin las nuevas
--     (licensed_economics_dashboard).
-- Y, solo para el después, lo que el C03 tiene que haber hecho:
--   · proveedores sin tercero (tiene que ser 0);
--   · liquidaciones sin periodo con periodo propuesto (antes 0 o nada).
--
-- Uso (Julio, con la URL de solo lectura):
--   psql "$PROD_CONTA_RO_DB_URL" -X -A -F ' | ' -f scripts/conta/c03_antes_despues.sql > c03-antes.txt
--   … tanda real …
--   psql "$PROD_CONTA_RO_DB_URL" -X -A -F ' | ' -f scripts/conta/c03_antes_despues.sql > c03-despues.txt
--   diff c03-antes.txt c03-despues.txt   → solo pueden cambiar las dos últimas columnas.

with
huellas as (
  select account_id, 'supplier' tabla, count(*) filas,
         md5(string_agg(to_jsonb(s)::text, '|' order by s.id)) huella
    from public.supplier s group by account_id
  union all
  select account_id, 'channel_settlement', count(*),
         md5(string_agg((to_jsonb(c) - array['party_id', 'collected_on', 'collected_amount', 'collected_note', 'collected_by',
                         'collected_by_name', 'proposed_period_from', 'proposed_period_to', 'proposed_period_note',
                         'period_confirmed_at', 'period_confirmed_by'])::text, '|' order by c.id))
    from public.channel_settlement c group by account_id
  union all
  select account_id, 'licensed_settlement', count(*),
         md5(string_agg((to_jsonb(l) - array['party_id', 'status', 'purchases_amount', 'contributions_amount', 'brand_sales_base',
                         'commission_pct', 'commission_amount', 'amount', 'detail', 'updated_at', 'created_by', 'created_by_name',
                         'confirmed_at', 'confirmed_by', 'confirmed_by_name'])::text, '|' order by l.id))
    from public.licensed_settlement l group by account_id
  union all
  select account_id, 'brand_licensing_agreement', count(*),
         md5(string_agg((to_jsonb(b) - array['party_id', 'commission_base'])::text, '|' order by b.id))
    from public.brand_licensing_agreement b group by account_id
)
select a.name cuenta, h.account_id, h.tabla, h.filas, h.huella,
       case h.tabla
         when 'supplier' then case when to_regclass('public.party_role') is null then 'sin C03'
           -- Dinámica: antes del C03 party_role no existe y no se puede nombrar en la consulta.
           else (xpath('/row/n/text()', query_to_xml(format(
                  'select count(*) n from public.supplier s where s.account_id = %L
                     and not exists (select 1 from public.party_role r where r.supplier_id = s.id)', h.account_id), false, true, '')))[1]::text
                || ' sin tercero' end
         when 'channel_settlement' then
           (select count(*) filter (where c.period_from is null)::text || ' sin periodo · '
                || count(*) filter (where c.period_from is null and (to_jsonb(c)->>'proposed_period_from') is not null)::text || ' con periodo propuesto'
              from public.channel_settlement c where c.account_id = h.account_id)
         else ''
       end c03
  from huellas h join public.accounts a on a.id = h.account_id
 order by a.name, h.tabla;
