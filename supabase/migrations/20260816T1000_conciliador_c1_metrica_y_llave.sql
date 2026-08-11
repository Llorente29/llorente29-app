-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ENCARGO Conciliador de liquidaciones C1 — métrica honesta + llave de Uber
-- (11/08 tarde). CORRIGE (§1 del encargo) el diagnóstico de
-- claude/folvy_conciliador_liquidaciones_estado_20260811.md: el "4,6% de
-- casado" es una métrica rota (mezcla 5.293 líneas enero-mayo, IMPOSIBLES de
-- casar porque en Folvy no existe venta anterior a junio, con el problema
-- real de junio). RECON de este fichero, hecho antes de escribir nada:
--
-- §1.1 — Dónde vive el "casado" HOY (primer punto pedido de vuelta): EN
-- NINGÚN SITIO VERSIONADO. Barrido completo: 0 triggers sobre
-- channel_settlement_order, 0 funciones que hagan `update ... matched`
-- (channel_economics_dashboard, margin_by_brand y channel_trend_monthly
-- solo LEEN), 0 edge functions con "settlement"/"match"/"casad" en el
-- nombre entre las 50+ desplegadas, y los 2 scripts de carga
-- (uber_carga_completa.sql, cargar_glovo_orders.py) no escriben matched=true
-- ni sale_id — el primero lo deja fijo en false, el segundo ni lo toca. Las
-- 304 filas de Glovo con matched=true, sale_id no nulo, HOY: confirmado por
-- MCP que sale_id apunta a una venta con
-- `co.platform_order_code = s.platform_order_code` EXACTO — alguien lo hizo
-- con una consulta suelta, en algún momento, y nunca quedó como función
-- reutilizable. Por eso "arreglar la llave" en la práctica significa
-- CREAR la función de casado por primera vez (channel_settlement_
-- match_recompute), no editar una que no existe — RECON contradice la
-- premisa de que solo hay que "tocar" algo; se avisa aquí, no se calla.
--
-- §1.2 — El "70%, 240 líneas, 3.599,69€" de la simulación del encargo
-- NO SOBREVIVE completo a la validación por MCP con nombres temporales
-- (tabla clonada, nunca la real) — dos correcciones, ambas a favor de más
-- rigor, no menos casado real:
--   a) 2 códigos de Uber ("#AA431","#F7C21") tienen 2 ventas candidatas cada
--      uno (huella exacta de los duplicados de venta que ya tienes
--      anotados — 22 grupos/578,52€/90d, frente propio del conciliador).
--      Sin guarda, el casado se queda con LA FILA QUE SEA de las dos —
--      justo el riesgo que la Tarea D pide investigar, no crear. Se exige
--      candidato ÚNICO; si hay más de uno, la línea queda sin_casar (no se
--      inventa un ganador).
--   b) MÁS GRAVE, encontrado en esta validación: sin exigir cercanía de
--      fecha, un código corto (5 caracteres, alfanumérico, ~60M
--      combinaciones) puede coincidir POR AZAR entre liquidaciones de meses
--      distintos con ~3.500 códigos en juego (paradoja del cumpleaños). Se
--      encontraron 4 "casados" de enero-marzo con ventas reales de
--      junio-julio — un pedido no puede liquidarse en enero y registrarse
--      en Folvy 6 meses después, son falsos positivos. Añadida una guarda
--      de proximidad: `abs(venta.created_at::date - liquidación.order_date)
--      <= 2 días` (verificado en los 304 casados reales de Glovo: la
--      distancia real siempre es 0 o -1 día, nunca más — pedidos de
--      madrugada que la plataforma fecha el día anterior; hipótesis 3 de la
--      Tarea D, confirmada como efecto esperable, no como bug).
--   Con las dos guardas: Uber de junio pasa de 0 a 233 casadas (67,9%,
--   no ~240/70%) — el número correcto y ya validado, ni una fila más de lo
--   que resiste comprobación.
--
-- §1.3 — TAREA D, resultado del RECON (esto SÍ contradice el encargo, y el
-- RECON manda): el "30-40% de junio que no casa" que el encargo describe
-- como "el problema real" queda, tras aplicar el criterio correcto §2
-- (frontera POR LOCAL, no por cuenta — hay locales cuya primera venta es
-- 12/06 o 22/06, no 05/06), en 21 líneas de 6.638 (42,93€) — no en
-- centenares. Desglose exacto, verificado:
--   · Uber junio: 343 líneas → 233 casables tras arreglar la llave (con las
--     2 guardas) → LAS 109 RESTANTES SON TODAS sin_origen por local (0
--     residuo sin explicar).
--   · Glovo junio: 502 líneas → 304 ya casadas → de las 198 restantes, 177
--     son sin_origen por local; de las 21 que quedan con fecha posible, 17
--     son códigos "add-XXXXX" con net_payout=0,00 en TODA la tabla (30
--     filas, 0 casadas, 0 con importe ≠ 0 — no son pedidos, son ajustes/
--     incidencias del propio export de Glovo, no deberían competir en la
--     métrica de casado); solo quedan 3 líneas con dinero real sin explicar
--     (9,90€+9,85€+8,81€≈28,56€), las 3 en el primer día de venta del local
--     (12/06) — verosímil hueco de arranque, no patrón sistémico.
--   Hipótesis descartadas por orden del encargo: (1) duplicados — CONFIRMADA
--   como causa real pero pequeña (los 2 códigos de Uber de arriba); (2)
--   cancelados/importe negativo — descartada como causa principal (1 fila
--   negativa en Uber, 4+17 en Glovo, y las 17 son las "add-" de cero); (3)
--   desfase de fecha — confirmada como efecto esperado de -1 día, ya
--   incorporado en la guarda, no es un problema a resolver; (4) Last con
--   canal mal clasificado — no evaluada (el residuo de 21 líneas es
--   demasiado pequeño para justificar más tiempo en esta pasada; si Julio
--   quiere las 3+1 líneas exactas están en el informe de vuelta).
--
-- §1.4 — ¿QUIÉN LLAMA a channel_settlement_match_recompute()/
-- channel_settlement_match_status_recompute()? Pregunta que Julio detectó
-- que faltaba en el parte de vuelta: la primera versión de este fichero
-- las creaba y las invocaba UNA VEZ en el backfill (§6), pero no dejaba
-- previsto NADA para después — exactamente el problema que describe el
-- encargo ("el conciliador sigue sin funcionar solo"). No estaba previsto,
-- lo digo en vez de callarlo. Decisión: CRON DIARIO
-- (channel-settlement-match-daily, 06:30 UTC — mismo patrón ya en
-- producción que db-health-stale-devices-daily), no un trigger. Por qué
-- cron y no trigger: un trigger en channel_settlement_order (al cargar)
-- solo resuelve un lado — si la venta de Folvy llega DESPUÉS de cargar la
-- liquidación (lo normal: liquidaciones se cargan por lotes mensuales,
-- ventas entran continuamente), haría falta OTRO trigger simétrico en
-- `sale`, y la combinación de dos triggers en dos tablas para mantenerse
-- sincronizados es más frágil que un recálculo diario completo — el coste
-- de recorrer 6.638 filas (y su crecimiento mensual) es irrelevante, y un
-- cron es más fácil de auditar en cron.job_run_details si algo falla. Se
-- añade channel_settlement_daily_recompute() (wrapper con `raise warning`
-- si algo falla, sin catch mudo) y su cron — ver §5.5 más abajo.
--
-- §1.5 — Verificación pedida por Julio antes de aplicar: ¿la guarda de
-- ±2 días (calibrada con los 304 casados reales de Glovo, distancia 0/-1)
-- rechaza casados legítimos de Uber? Comprobado por MCP (solo lectura, sin
-- tocar la tabla real): de los candidatos únicos de Uber (sin filtro de
-- fecha), 232 están a EXACTAMENTE 0 días y los otros 4 son los mismos 4
-- falsos positivos de §1.2.b (84/119/187/190 días). A diferencia de Glovo,
-- Uber no tiene NINGÚN caso a -1 día — sus pedidos de madrugada no cruzan
-- de día en el dato que informa Uber. La guarda de ±2 días no rechaza
-- ningún casado legítimo en ninguno de los dos canales; para Uber es
-- incluso más holgada de lo necesario.
--
-- §1.6 — channel_economics_dashboard (verificación pedida antes de
-- aplicar): el cambio SOLO añade el campo 'pedidos_sin_origen' dentro de
-- 'salud' y cambia el CÁLCULO (no el nombre ni el tipo) de
-- 'pct_casado_pos' — sigue siendo un number|null, misma clave. Ningún otro
-- campo de 'salud', ni 'kpis'/'waterfall'/'by_brand'/'by_channel'/
-- 'per_order' (los 5 bloques restantes del jsonb), cambia una sola línea
-- respecto a la versión en producción — se copiaron verbatim. Nada se
-- renombra, nada cambia de tipo.
--
-- ── Tarea A: match_status ────────────────────────────────────────────────
-- Columna nueva, NO se toca `matched` (compatibilidad con lo que ya lo lee).
-- Calculado por channel_settlement_match_status_recompute(): 'casada' si
-- matched; si no, 'sin_origen' cuando order_date es anterior a la primera
-- venta del LOCAL (min(sale.created_at) por location_id — con fallback a la
-- cuenta si el local no tiene ventas o la liquidación no tiene local); si
-- no, 'sin_casar'. Frontera derivada en vivo, NUNCA "junio" fijo en código —
-- verificado que varía por local (05/06 a 22/06 en los datos reales de hoy).
--
-- ── Tarea B: llave normalizada, punto único ─────────────────────────────
-- public._normalize_channel_order_code(text): hoy solo quita un '#' inicial;
-- cuando entre JustEat u otra plataforma con otro adorno, se añade AQUÍ, no
-- en un replace disperso. channel_settlement_match_recompute() la usa en
-- los dos lados de la comparación (por si el adorno cambia de sentido el
-- día de mañana) + las 2 guardas de §1.2. platform_order_code ORIGINAL no
-- se toca en ningún UPDATE — solo se lee, nunca se reescribe (verificación
-- §6.5).
--
-- ── Tarea C: julio/agosto — confirmado, NO cargado (falta el fichero) ────
-- Verificado por MCP: 982 ventas Folvy con canal Uber en julio, 222 en
-- agosto (encargo decía 220 — 2 de diferencia por dos grafías distintas de
-- "uber"/"Uber Eats" en external_channel_text, sin relevancia). NO hay
-- ninguna liquidación de julio/agosto en channel_settlement_order todavía
-- (order_date máximo hoy: 30/06) — no se puede cargar lo que no se tiene: el
-- fichero de liquidación de Uber de julio/agosto no está en este repo ni en
-- ningún sitio al que yo tenga acceso. Automatización si Julio la pide más
-- adelante (NO construida aquí, solo descrita): un script hermano de
-- cargar_glovo_orders.py que lea el export de Uber por pedido (hoy solo
-- existe el volcado agregado mensual que lee import-channel-settlements.mjs
-- para Capa B, no el detalle por pedido de Capa C) y haga upsert por
-- import_key contra channel_settlement_order — el propio uber_carga_
-- completa.sql de enero (un INSERT de 1.060 líneas escrito a mano) es la
-- prueba de que hoy la carga de Capa C de Uber es 100% manual.
--
-- Validado por MCP con nombres temporales ANTES de escribir este fichero —
-- contra una COPIA de la tabla real (create table ... as select — nunca la
-- tabla real), con JOIN de solo lectura contra `sale` real:
--   · channel_settlement_match_recompute (candidato único + guarda de
--     fecha): 233 Uber + 304 Glovo casados, 0 falsos positivos
--     (verificado explícitamente: 0 filas con matched=true y order_date
--     anterior a 01/06), exactamente 1 de los 2 códigos ambiguos de Uber
--     resuelto por la guarda de fecha (el duplicado real quedaba lejos en
--     el tiempo), el otro sigue sin_casar a propósito.
--   · channel_settlement_match_status_recompute: 537 casada + 21 sin_casar
--     + 6.080 sin_origen = 6.638 exacto (suma verificada).
--   Todo creado, probado y borrado — nada de esto ha tocado la tabla real.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='channel_settlement_order') then
    raise exception 'conciliador_c1_metrica_y_llave: falta channel_settlement_order — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='sale') then
    raise exception 'conciliador_c1_metrica_y_llave: falta sale — RECON desactualizado, parar';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'channel_economics_dashboard'
      and pg_get_function_identity_arguments(p.oid) = 'p_account uuid, p_from date, p_to date, p_channel text, p_brand uuid, p_location uuid'
  ) then
    raise exception 'conciliador_c1_metrica_y_llave: channel_economics_dashboard no tiene la firma esperada — RECON desactualizado, parar';
  end if;
end $$;

-- ── 1) Tarea A: columna match_status ─────────────────────────────────────

alter table public.channel_settlement_order add column if not exists match_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.channel_settlement_order'::regclass
      and conname = 'channel_settlement_order_match_status_chk'
  ) then
    alter table public.channel_settlement_order
      add constraint channel_settlement_order_match_status_chk
      check (match_status is null or match_status in ('casada', 'sin_casar', 'sin_origen'));
  end if;
end $$;

comment on column public.channel_settlement_order.match_status is
  'Sustituye la lectura binaria de matched por 3 estados honestos (11/08):
   casada (hay venta y se encontró), sin_casar (hay venta posible y no se
   encontró — esto es lo investigable), sin_origen (order_date anterior a la
   primera venta del local en Folvy — limitación conocida, no un fallo).
   matched se deja intacto por compatibilidad. Recalculado por
   channel_settlement_match_status_recompute(); NULL en filas nunca
   recalculadas (p.ej. una carga nueva antes de correr la función).';

create index if not exists idx_channel_settlement_order_match_status
  on public.channel_settlement_order (match_status);

-- ── 2) Tarea B: normalización de llave, punto único ─────────────────────

CREATE OR REPLACE FUNCTION public._normalize_channel_order_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Único punto de normalización de códigos de pedido de plataforma (11/08).
  -- Hoy: quita un '#' inicial (Uber). Si mañana JustEat u otra plataforma
  -- trae otro adorno, se añade AQUÍ — no como replace() suelto en 3 sitios.
  select regexp_replace(trim(p_code), '^#', '')
$function$;

comment on function public._normalize_channel_order_code(text) is
  'Punto único de normalización de platform_order_code para comparar contra
   sale.platform_order_code (11/08, Tarea B del conciliador C1). Hoy solo
   quita un "#" inicial (Uber). Ampliar aquí, no con replace() disperso.';

revoke all on function public._normalize_channel_order_code(text) from public, anon, authenticated;

-- ── 3) Casado: candidato único + proximidad de fecha (evita los 2 fallos
-- encontrados en la validación — duplicados de venta y colisión de código
-- corto entre meses lejanos, ver cabecera §1.2) ──────────────────────────

CREATE OR REPLACE FUNCTION public.channel_settlement_match_recompute(p_account_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  with candidatos as (
    select co.id as co_id, s.id as sale_id,
           count(*) over (partition by co.id) as n_candidatos
    from public.channel_settlement_order co
    join public.sale s
      on s.account_id = co.account_id
     and public._normalize_channel_order_code(s.platform_order_code)
       = public._normalize_channel_order_code(co.platform_order_code)
     and co.order_date is not null
     -- Guarda de fecha (§1.2.b): sin esto, un código corto puede colisionar
     -- por azar entre liquidaciones de meses distintos. Verificado en los
     -- 304 casados reales de Glovo: la distancia real siempre es 0 o -1
     -- día (pedidos de madrugada, la plataforma los fecha el día anterior)
     -- — 2 días de margen es generoso sin abrir la puerta a colisiones
     -- lejanas.
     and abs(s.created_at::date - co.order_date) <= 2
    where coalesce(co.matched, false) = false
      and co.sale_id is null
      and (p_account_id is null or co.account_id = p_account_id)
  )
  -- Candidato ÚNICO (§1.2.a): si el código normalizado + fecha cercana
  -- casan con MÁS de una venta (huella de venta duplicada — ver el frente
  -- propio de duplicados de liquidación), la línea se queda sin_casar. No
  -- se elige "una cualquiera" de las dos — ese es justo el riesgo que pide
  -- investigar la Tarea D, no crear uno nuevo aquí.
  update public.channel_settlement_order co
  set sale_id = c.sale_id,
      matched = true
  from candidatos c
  where co.id = c.co_id
    and c.n_candidatos = 1;
end;
$function$;

comment on function public.channel_settlement_match_recompute(uuid) is
  'Casa channel_settlement_order.sale_id/matched contra sale por
   platform_order_code normalizado (ver _normalize_channel_order_code),
   exigiendo candidato único y proximidad de fecha ≤2 días (11/08, Tarea B
   del conciliador C1 — antes de esto NO existía ninguna función que
   escribiera matched, ver cabecera §1.1). Solo toca filas no casadas
   todavía (coalesce(matched,false)=false and sale_id is null) — no
   revierte nunca un casado previo. platform_order_code original nunca se
   modifica. Llamar tras cargar liquidaciones nuevas.';

revoke all on function public.channel_settlement_match_recompute(uuid) from public, anon, authenticated;

-- ── 4) match_status: frontera POR LOCAL (con fallback a cuenta), nunca una
-- fecha fija en código ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.channel_settlement_match_status_recompute(p_account_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  update public.channel_settlement_order co
  set match_status = case
    when coalesce(co.matched, false) then 'casada'
    when co.order_date is null then 'sin_casar'
    when co.order_date < coalesce(
      (select min(s.created_at)::date from public.sale s where s.location_id = co.location_id),
      (select min(s.created_at)::date from public.sale s where s.account_id = co.account_id)
    ) then 'sin_origen'
    else 'sin_casar'
  end
  where (p_account_id is null or co.account_id = p_account_id);
end;
$function$;

comment on function public.channel_settlement_match_status_recompute(uuid) is
  'Recalcula match_status (11/08, Tarea A del conciliador C1). Frontera de
   "hay venta posible" = min(sale.created_at) del LOCAL de la liquidación
   (fallback a la cuenta si el local no tiene ventas o la liquidación no
   tiene local) — NUNCA una fecha fija: verificado en vivo que la primera
   venta varía por local (05/06 a 22/06 en los datos de hoy). Llamar tras
   channel_settlement_match_recompute() y tras cargar liquidaciones nuevas.';

revoke all on function public.channel_settlement_match_status_recompute(uuid) from public, anon, authenticated;

-- ── 5) channel_economics_dashboard: el % casado se calcula sobre el
-- periodo CON venta disponible, no sobre el total (Tarea A) ────────────

CREATE OR REPLACE FUNCTION public.channel_economics_dashboard(p_account uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_channel text DEFAULT NULL::text, p_brand uuid DEFAULT NULL::uuid, p_location uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with s as (
  select cs.*,
    case when cs.brand_id is not null then b.name
         when cs.external_brand_text ilike 'LLORENTE29%' then 'Llorente29 (cuenta, sin desglose)'
         else coalesce(cs.external_brand_text,'(sin marca)') end as brand_label
  from public.channel_settlement cs
  left join public.brand b on b.id = cs.brand_id
  where cs.account_id = p_account
    and (p_from is null or cs.settlement_date >= p_from)
    and (p_to   is null or cs.settlement_date <= p_to)
    and (p_channel  is null or cs.source = p_channel)
    and (p_brand    is null or cs.brand_id = p_brand)
    and (p_location is null or cs.location_id = p_location)
),
o as (
  select co.* from public.channel_settlement_order co
  where co.account_id = p_account and co.net_reliable
    and (p_from is null or co.order_date >= p_from)
    and (p_to   is null or co.order_date <= p_to)
    and (p_brand    is null or co.brand_id = p_brand)
    and (p_location is null or co.location_id = p_location)
)
select jsonb_build_object(
  'kpis', (select jsonb_build_object(
     'venta', round(coalesce(sum(gross_sales),0)::numeric,2),
     'venta_con_coste', round(coalesce(sum(gross_sales) filter (where net_payout is not null),0)::numeric,2),
     'liquidacion', round(coalesce(sum(net_payout),0)::numeric,2),
     'coste_canal', round(coalesce(sum(gross_sales) filter (where net_payout is not null),0)::numeric - coalesce(sum(net_payout),0)::numeric,2),
     'pct_efectivo', round((coalesce(sum(net_payout),0)/nullif(sum(gross_sales) filter (where net_payout is not null),0)*100)::numeric,1),
     'pedidos', coalesce(sum(orders_count),0)) from s),
  'salud', (select jsonb_build_object(
     'periodo_desde', min(settlement_date), 'periodo_hasta', max(settlement_date),
     'n_liquidaciones', count(*),
     'canales_con_coste', (select coalesce(jsonb_agg(distinct case source when 'import_csv_glovo' then 'Glovo' when 'import_csv_uber' then 'Uber' when 'import_csv_je' then 'JustEat' else source end),'[]'::jsonb) from s where net_payout is not null),
     'canales_solo_venta', (select coalesce(jsonb_agg(distinct case source when 'import_csv_glovo' then 'Glovo' when 'import_csv_uber' then 'Uber' when 'import_csv_je' then 'JustEat' else source end),'[]'::jsonb) from s ss where net_payout is null and not exists (select 1 from s s2 where s2.source=ss.source and s2.net_payout is not null)),
     'pedidos_capa_c', (select count(*) from o),
     -- Tarea A (11/08): las líneas sin_origen (order_date anterior a la
     -- primera venta del local) son imposibles de casar por definición —
     -- contarlas en el % de casado pinta el problema peor de lo que es y
     -- esconde el problema real. coalesce(match_status,'sin_casar') trata
     -- una fila aún sin recalcular como sin_casar (dentro del denominador,
     -- señala "hace falta recalcular"), nunca como excluida en silencio.
     'pedidos_sin_origen', (select count(*) from o where coalesce(match_status,'sin_casar') = 'sin_origen'),
     'casados_pos', (select count(*) from o where matched),
     'pct_casado_pos', (select round((100.0*count(*) filter (where matched)/nullif(count(*) filter (where coalesce(match_status,'sin_casar') <> 'sin_origen'),0))::numeric,1) from o)
   ) from s),
  'waterfall', (select jsonb_build_array(
     jsonb_build_object('concept','Comision','amount',round(-coalesce(sum(commission),0)::numeric,2)),
     jsonb_build_object('concept','Transporte','amount',round(coalesce(sum(delivery_transport),0)::numeric,2)),
     jsonb_build_object('concept','Promo producto','amount',round(coalesce(sum(promo_product),0)::numeric,2)),
     jsonb_build_object('concept','Promo flash','amount',round(coalesce(sum(promo_flash),0)::numeric,2)),
     jsonb_build_object('concept','Oferta flash (credito)','amount',round(-coalesce(sum(offer_flash_credit),0)::numeric,2)),
     jsonb_build_object('concept','Tasa de acceso','amount',round(-coalesce(sum(access_fee),0)::numeric,2)),
     jsonb_build_object('concept','Prime','amount',round(-coalesce(sum(prime_fee),0)::numeric,2)),
     jsonb_build_object('concept','Tarifa recurrente','amount',round(-coalesce(sum(recurring_fee),0)::numeric,2)),
     jsonb_build_object('concept','Incidencias','amount',round(coalesce(sum(incidents_cost),0)::numeric,2))
   ) from s where net_payout is not null),
  'by_brand', (select coalesce(jsonb_agg(r order by (r->>'venta')::numeric desc),'[]'::jsonb) from (
     select jsonb_build_object('brand', brand_label,
        'venta', round(sum(gross_sales)::numeric,2),
        'liquidacion', round(sum(net_payout)::numeric,2),
        'pct_efectivo', round((sum(net_payout)/nullif(sum(gross_sales) filter (where net_payout is not null),0)*100)::numeric,1),
        'promos', round(sum(promo_product+promo_flash)::numeric,2),
        'es_deuda', bool_or(is_debt_settlement)) r
     from s group by brand_label) q),
  'by_channel', (select coalesce(jsonb_agg(r),'[]'::jsonb) from (
     select jsonb_build_object('channel',
        case source when 'import_csv_glovo' then 'Glovo' when 'import_csv_uber' then 'Uber' when 'import_csv_je' then 'JustEat' else source end,
        'venta', round(sum(gross_sales)::numeric,2),
        'liquidacion', round(sum(net_payout)::numeric,2),
        'tiene_coste', bool_or(net_payout is not null),
        'pedidos', coalesce(sum(orders_count),0)) r
     from s group by source) q),
  'per_order', (select jsonb_build_object(
     'pedidos', count(*), 'con_pos', count(*) filter (where matched),
     'neto_medio', round(avg(net_payout)::numeric,2),
     'by_brand', (select coalesce(jsonb_agg(r order by (r->>'pedidos')::int desc),'[]'::jsonb) from (
        select jsonb_build_object('brand', b.name, 'pedidos', count(*),
           'neto_medio', round(avg(o.net_payout)::numeric,2),
           'pct_efectivo', round((sum(o.net_payout)/nullif(sum(o.products),0)*100)::numeric,1),
           'con_pos', count(*) filter (where o.matched)) r
        from o join public.brand b on b.id=o.brand_id
        where o.net_payout is not null group by b.name) q)
   ) from o where net_payout is not null)
);
$function$;

comment on function public.channel_economics_dashboard(uuid, date, date, text, uuid, uuid) is
  'RPC única fuente de Economía de Plataforma. salud.pct_casado_pos (11/08,
   Tarea A del conciliador C1): se calcula sobre pedidos con match_status
   <> sin_origen — antes se calculaba sobre TODOS los pedidos del periodo,
   mezclando líneas imposibles de casar (sin venta disponible en Folvy) con
   las que sí deberían casar. salud.pedidos_sin_origen (nuevo) muestra
   cuántas se excluyeron, para que el porcentaje no parezca inflado sin
   explicación.';

-- ── 5.5) Quién llama: cron diario propio (§1.4) ──────────────────────────
-- Sin esto, las dos funciones de arriba existen pero nadie las invoca tras
-- el backfill inicial — el conciliador seguiría sin funcionar solo.

CREATE OR REPLACE FUNCTION public.channel_settlement_daily_recompute()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  perform public.channel_settlement_match_recompute(null);
  perform public.channel_settlement_match_status_recompute(null);
exception when others then
  -- Sin catch mudo. No se encola un aviso por correo aquí a propósito: esa
  -- infraestructura (system_alert_queue) vive en la rama
  -- fix/system-alert-cola-reintento, independiente de esta — no se crea una
  -- dependencia entre ramas que se aplican por separado. raise warning
  -- basta para este caso: un día de match_status desactualizado no es un
  -- incidente, es mantenimiento de frescura de un dato de conciliación.
  raise warning 'channel_settlement_daily_recompute: excepción: %', sqlerrm;
  raise;
end;
$function$;

comment on function public.channel_settlement_daily_recompute() is
  'Cron diario (channel-settlement-match-daily, 06:30 UTC) que mantiene el
   casado al día sin intervención manual (11/08, respuesta a "¿quién la
   llama?"): re-intenta channel_settlement_match_recompute() sobre lo que
   siga sin casar (venta que llegó tarde, ambigüedad de duplicado que se
   resolvió) y refresca match_status. No escala a email — ver comentario en
   el cuerpo de la función.';

revoke all on function public.channel_settlement_daily_recompute() from public, anon, authenticated;

select cron.schedule(
  'channel-settlement-match-daily',
  '30 6 * * *',
  $cron$select public.channel_settlement_daily_recompute()$cron$
);

-- ── 6) Backfill: recalcula sobre los datos ya cargados ──────────────────
-- Orden obligatorio: primero casar (puede convertir sin_casar en casada),
-- luego status (usa el matched ya actualizado). El cron diario de arriba
-- ya cubriría esto en su primera ejecución, pero no se espera a mañana:
-- el backfill corre YA, al aplicar esta migración.

select public.channel_settlement_match_recompute(null);
select public.channel_settlement_match_status_recompute(null);

notify pgrst, 'reload schema';

-- ── 7) Verificación (§6 del encargo) — QUERIES INDEPENDIENTES ────────────
--
-- 1) match_status reparte las 6.638 líneas en 3 grupos, suman el total:
--   select match_status, count(*) from channel_settlement_order group by match_status;
--   -- esperado (validado en copia antes de aplicar): casada 537, sin_casar 21,
--   -- sin_origen 6080 → suma 6638.
--
-- 3) Uber de junio, de 0 a ~233 casadas:
--   select count(*) from channel_settlement_order
--   where source='uber_emea' and order_date >= '2026-06-01' and matched;
--
-- 4) Ninguna línea borrada:
--   select count(*) from channel_settlement_order; -- 6638 o más (+ lo que se cargue después)
--
-- 5) platform_order_code original intacto (el '#' sigue ahí):
--   select count(*) from channel_settlement_order
--   where source='uber_emea' and platform_order_code like '#%'; -- 3575 (todas)
