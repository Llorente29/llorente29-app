-- ENCARGO Conciliador C1 — metrica honesta + llave de Uber (11/08).
--
-- CORRIGE el diagnostico del doc de estado: el "4,6% de casado" mezclaba 5.293
-- lineas de enero-mayo IMPOSIBLES de casar (en Folvy no hay venta anterior a
-- junio) con el problema real. Frontera correcta: POR LOCAL (varia del 05/06 al
-- 22/06), nunca una fecha fija.
--
-- HALLAZGOS DE CODE QUE CORRIGEN EL ENCARGO:
--  · No existia NINGUNA funcion que escribiera `matched`. Las 304 filas de Glovo
--    casadas vienen de una consulta suelta nunca versionada. La funcion de casado
--    se CREA por primera vez.
--  · Sin guarda de fecha, un codigo corto de 5 caracteres colisiona POR AZAR entre
--    meses distintos: 4 falsos positivos (enero-marzo casando con ventas de
--    junio-julio). Guarda de +-2 dias, calibrada con los 304 casados reales de
--    Glovo (distancia 0 o -1 dia) y verificada en Uber (232 a 0 dias exactos, sin
--    ningun caso a -1).
--  · 2 codigos de Uber tienen 2 ventas candidatas (huella de los duplicados de
--    venta). Se exige candidato UNICO; si hay ambiguedad, queda sin_casar.
--  · El residuo real no es el 30-40% estimado: son 21 lineas de 6.638 (42,93 EUR),
--    y 17 de ellas son ajustes "add-XXXXX" con importe cero del export de Glovo.
--
-- APLICACION (Claude, 11/08): las partes nuevas van completas; el
-- channel_economics_dashboard se modifica por SUSTITUCION QUIRURGICA sobre la
-- definicion VIVA (no se transcribe), porque es una funcion en produccion que
-- consume la interfaz y el pegado llego truncado. Mismo patron que la 0901/0905.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='channel_settlement_order') then
    raise exception 'conciliador_c1: falta channel_settlement_order — parar';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'channel_economics_dashboard'
  ) then
    raise exception 'conciliador_c1: falta channel_economics_dashboard — parar';
  end if;
end $$;

-- 1) Tarea A: columna match_status
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
  'Tres estados honestos (11/08): casada · sin_casar (hay venta posible y no se '
  'encontro — esto es lo investigable) · sin_origen (order_date anterior a la '
  'primera venta del local: limitacion conocida, no un fallo). `matched` se deja '
  'intacto por compatibilidad.';
create index if not exists idx_channel_settlement_order_match_status
  on public.channel_settlement_order (match_status);

-- 2) Tarea B: normalizacion de llave, punto unico
CREATE OR REPLACE FUNCTION public._normalize_channel_order_code(p_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  select regexp_replace(trim(p_code), '^#', '')
$function$;
comment on function public._normalize_channel_order_code(text) is
  'Punto UNICO de normalizacion de platform_order_code (11/08). Hoy solo quita un '
  '"#" inicial (Uber). Ampliar AQUI, no con replace() disperso.';
revoke all on function public._normalize_channel_order_code(text) from public, anon, authenticated;

-- 3) Casado: candidato unico + proximidad de fecha
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
     -- Guarda de fecha: sin esto un codigo corto colisiona por azar entre meses
     -- distintos. Verificado: Glovo 0/-1 dia, Uber 0 dias exactos.
     and abs(s.created_at::date - co.order_date) <= 2
    where coalesce(co.matched, false) = false
      and co.sale_id is null
      and (p_account_id is null or co.account_id = p_account_id)
  )
  -- Candidato UNICO: si casan 2 ventas (venta duplicada), se queda sin_casar.
  -- No se elige "una cualquiera".
  update public.channel_settlement_order co
  set sale_id = c.sale_id,
      matched = true
  from candidatos c
  where co.id = c.co_id
    and c.n_candidatos = 1;
end;
$function$;
comment on function public.channel_settlement_match_recompute(uuid) is
  'Casa channel_settlement_order contra sale por codigo normalizado, exigiendo '
  'candidato UNICO y proximidad de fecha <=2 dias (11/08). Antes de esto NO existia '
  'ninguna funcion que escribiera matched. Solo toca filas no casadas — nunca '
  'revierte un casado previo. El platform_order_code original nunca se modifica.';
revoke all on function public.channel_settlement_match_recompute(uuid) from public, anon, authenticated;

-- 4) match_status: frontera POR LOCAL, nunca una fecha fija en codigo
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
  'Recalcula match_status (11/08). Frontera = min(sale.created_at) del LOCAL, con '
  'fallback a la cuenta. NUNCA una fecha fija: la primera venta varia por local '
  '(05/06 a 22/06 en los datos de hoy).';
revoke all on function public.channel_settlement_match_status_recompute(uuid) from public, anon, authenticated;

-- 5) Dashboard: SUSTITUCION QUIRURGICA sobre la definicion viva.
-- Solo cambia el bloque 'salud': anade pedidos_sin_origen y cambia el CALCULO
-- (no el nombre ni el tipo) de pct_casado_pos. Todo lo demas queda intacto por
-- construccion, no por transcripcion.
do $mig$
declare
  v_oid  oid;
  v_def  text;
  v_new  text;
  c_old  constant text := '''casados_pos'', (select count(*) from o where matched),
     ''pct_casado_pos'', (select round((100.0*count(*) filter (where matched)/nullif(count(*),0))::numeric,1) from o)';
  c_new  constant text := '''pedidos_sin_origen'', (select count(*) from o where coalesce(match_status,''sin_casar'') = ''sin_origen''),
     ''casados_pos'', (select count(*) from o where matched),
     ''pct_casado_pos'', (select round((100.0*count(*) filter (where matched)/nullif(count(*) filter (where coalesce(match_status,''sin_casar'') <> ''sin_origen''),0))::numeric,1) from o)';
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'channel_economics_dashboard';

  v_def := pg_get_functiondef(v_oid);

  if (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 then
    raise exception 'dashboard: el fragmento de salud no aparece exactamente 1 vez — parar sin tocar nada';
  end if;

  v_new := replace(v_def, c_old, c_new);
  execute v_new;
end;
$mig$;

-- 6) Quien llama: cron diario (respuesta a "la funcion existe pero nadie la invoca")
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
  raise warning 'channel_settlement_daily_recompute: excepcion: %', sqlerrm;
  raise;
end;
$function$;
comment on function public.channel_settlement_daily_recompute() is
  'Cron diario (channel-settlement-match-daily, 06:30 UTC): reintenta el casado '
  'sobre lo que siga sin casar (venta que llego tarde, ambiguedad resuelta) y '
  'refresca match_status. Cron y no trigger: cargar liquidacion y crear venta '
  'pasan en momentos distintos, un trigger solo resuelve un lado.';
revoke all on function public.channel_settlement_daily_recompute() from public, anon, authenticated;

select cron.schedule(
  'channel-settlement-match-daily',
  '30 6 * * *',
  $cron$select public.channel_settlement_daily_recompute()$cron$
);

-- 7) Backfill: primero casar, luego status (usa el matched ya actualizado)
select public.channel_settlement_match_recompute(null);
select public.channel_settlement_match_status_recompute(null);

notify pgrst, 'reload schema';