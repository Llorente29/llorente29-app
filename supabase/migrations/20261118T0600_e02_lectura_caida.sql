-- supabase/migrations/20261118T0600_e02_lectura_caida.sql
--
-- E02 · La lectura caída se ve y se avisa (encargo E02, respuesta E01 · 1, 18/11).
-- cambia: public.document_inbox · prueba: supabase/staging/sql/20261118_e02_lectura_caida_prueba.sql
--   (los dos CHECK de las columnas nuevas toma un instante el cierre exclusivo de
--   document_inbox, que existe: no es del camino del pedido y solo mira columnas
--   que añade este fichero, todas nulas al crearlo.)
--
-- Solo AÑADE: tres columnas que admiten nulos en document_inbox (con dos CHECK,
-- que solo miran esas columnas), dos índices pequeños, una tabla de un solo
-- estado, cuatro funciones nuevas y un cron. No cambia ninguna función que
-- exista: ni _queue_system_alert (regla 2: no se le añade nada), ni
-- conta_factura_desde_lectura, ni la lista de documentos.
--
--   document_inbox.read_failure / read_failure_cause / read_failure_at
--     La clase del fallo de una llegada que no se ha podido leer: 'caida' (la
--     lectura no funcionaba: tope de gasto, clave, 429, proveedor, tiempo) o
--     'documento' (este documento: cortada, sin JSON, sin lo mínimo, rechazo,
--     fichero). La pone conta-facturas-entrada (_shared/lecturaFallo.ts). Las
--     que ya estaban en 'error' se quedan sin clase.
--   _conta_lectura_caida() → jsonb (interna, solo lee)
--     ¿Está caída la lectura, para todos? Cuenta las llegadas de TODAS las
--     cuentas que siguen en 'error' por una caída después de la última lectura
--     que salió bien (de facturas o de albaranes: goods_receipt_ai_session que
--     no es 'failed'), en las últimas 24 horas. Está caída si entre ellas hay
--     una de tope de gasto (a la primera: mientras dure no se lee nada de
--     nadie) o tres o más en 15 minutos. Vuelve sola con la primera lectura
--     buena. No dice de quién son.
--   conta_lectura_estado(empresa) → jsonb (solo lee)
--     Lo que pinta la franja de arriba: si está caída (común a todos) y cuántas
--     de ESTA empresa esperan (solo las suyas: regla 9 y su RLS).
--   _conta_lectura_vigia() (el cron, cada 10 minutos)
--     Encola el aviso con _queue_system_alert cuando se cae (una vez por
--     caída, con su ventana) y el de «ha vuelto» cuando vuelve.
--
-- Se puede pasar dos veces (if not exists, create or replace, firmas nuevas).
-- Prueba: supabase/staging/sql/20261118_e02_lectura_caida_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261118T0600_e02_lectura_caida.down.sql

-- 1 · La clase del fallo en la llegada -----------------------------------------------------
alter table public.document_inbox add column if not exists read_failure text;
alter table public.document_inbox add column if not exists read_failure_cause text;
alter table public.document_inbox add column if not exists read_failure_at timestamptz;
-- Dos CHECK cortos que solo miran las columnas nuevas (W05: así van de verdad a staging
-- desde la rama): clase y causa van las dos o ninguna, y la clase es una de las dos.
-- Que la causa case con su clase lo garantiza _shared/lecturaFallo.ts (falloDeLlamada solo
-- acepta el par si casa; lo prueban tests/conta/e02): en un CHECK no cabe en lo que el
-- analizador de staging lee de cada restricción (120 caracteres).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'document_inbox_e02_par') then
    alter table public.document_inbox add constraint document_inbox_e02_par check ((read_failure is null) = (read_failure_cause is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'document_inbox_e02_clase') then
    alter table public.document_inbox add constraint document_inbox_e02_clase check (read_failure in ('caida', 'documento'));
  end if;
end $$;
comment on column public.document_inbox.read_failure is
  'E02: por qué no se ha leído esta llegada: caida (la lectura no funcionaba, para todos) o documento (este documento). Null si se leyó o si es de antes del E02.';
comment on column public.document_inbox.read_failure_cause is 'E02: la causa corta (tope_gasto, clave, limite, proveedor, tiempo | cortada, no_json, sin_minimo, rechazo, fichero).';
comment on column public.document_inbox.read_failure_at is 'E02: cuándo falló la lectura.';

create index if not exists document_inbox_lectura_caida_idx on public.document_inbox (read_failure_at desc)
  where read_failure = 'caida' and status = 'error';
create index if not exists goods_receipt_ai_session_buena_idx on public.goods_receipt_ai_session (created_at desc)
  where status <> 'failed';

-- 2 · El estado del vigía (una fila) ---------------------------------------------------------
create table if not exists public.conta_lectura_estado (
  id          integer primary key default 1 constraint conta_lectura_estado_una check (id = 1),
  caida_desde timestamptz,
  causa       text,
  avisada_en  timestamptz,
  vuelta_en   timestamptz,
  updated_at  timestamptz not null default now()
);
comment on table public.conta_lectura_estado is 'E02: si el vigía de la lectura ha avisado de una caída que aún no ha vuelto. Una sola fila. Solo la escribe _conta_lectura_vigia.';
alter table public.conta_lectura_estado enable row level security;
revoke all on public.conta_lectura_estado from public, anon, authenticated;
grant all on public.conta_lectura_estado to service_role;

-- 3 · ¿Está caída la lectura? -----------------------------------------------------------------
create or replace function public._conta_lectura_caida()
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  with buena as (
    select max(created_at) as en from public.goods_receipt_ai_session where status <> 'failed' and created_at > now() - interval '24 hours'
  ), fallos as (
    select d.read_failure_at as en, d.read_failure_cause as causa
      from public.document_inbox d, buena b
     where d.read_failure = 'caida' and d.status = 'error'
       and d.read_failure_at > greatest(coalesce(b.en, '-infinity'::timestamptz), now() - interval '24 hours')
  ), r as (
    select exists (select 1 from fallos where causa = 'tope_gasto') as tope,
           exists (select 1 from fallos f1 where (select count(*) from fallos f2 where f2.en >= f1.en and f2.en < f1.en + interval '15 minutes') >= 3) as rafaga,
           (select count(*) from fallos) as n,
           (select min(en) from fallos) as desde,
           (select max(en) from fallos) as ultima,
           (select causa from fallos group by causa order by (causa = 'tope_gasto') desc, count(*) desc, causa limit 1) as causa
  )
  select jsonb_build_object('caida', r.tope or r.rafaga, 'causa', case when r.tope or r.rafaga then r.causa end,
                            'fallos', r.n, 'desde', r.desde, 'ultima', r.ultima)
    from r
$function$;

-- 4 · Lo que pinta la franja ------------------------------------------------------------------
create or replace function public.conta_lectura_estado(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare v_acc uuid; v_c jsonb; v_n int;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  v_c := public._conta_lectura_caida();
  -- Las suyas que esperan: las de esta empresa que no se han leído porque la lectura no funcionaba.
  select count(*) into v_n from public.document_inbox
   where account_id = v_acc and company_id = p_company and status = 'error' and read_failure = 'caida';
  return jsonb_build_object('caida', coalesce((v_c ->> 'caida')::boolean, false), 'esperando', v_n);
end
$function$;

-- 5 · El vigía ---------------------------------------------------------------------------------
create or replace function public._conta_lectura_vigia()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare v_c jsonb; v_e public.conta_lectura_estado; v_caida boolean; v_causa text; v_hecho text := 'nada';
  v_que constant jsonb := '{"tope_gasto": "se ha alcanzado el tope de gasto de la clave de lectura", "clave": "la clave de lectura no vale (401/403)", "limite": "demasiadas peticiones (429)", "proveedor": "el proveedor de la lectura falla (5xx/529)", "tiempo": "la lectura no contesta a tiempo"}';
begin
  insert into public.conta_lectura_estado (id) values (1) on conflict (id) do nothing;
  select * into v_e from public.conta_lectura_estado where id = 1 for update;
  v_c := public._conta_lectura_caida();
  v_caida := coalesce((v_c ->> 'caida')::boolean, false);
  v_causa := v_c ->> 'causa';
  if v_caida and v_e.caida_desde is null then
    perform public._queue_system_alert(
      'conta_lectura_caida',
      'Sumied no puede leer facturas',
      format('Desde las %s (hora de Madrid) no se lee ninguna factura de ninguna cuenta: %s. Llevan %s sin leer por esto. Las llegadas están guardadas; cuando vuelva, se leen con «Leerla».',
             to_char((v_c ->> 'desde')::timestamptz at time zone 'Europe/Madrid', 'DD/MM HH24:MI'), coalesce(v_que ->> v_causa, v_causa), v_c ->> 'fallos'),
      'conta_lectura_caida', interval '6 hours');
    update public.conta_lectura_estado set caida_desde = (v_c ->> 'desde')::timestamptz, causa = v_causa, avisada_en = now(), vuelta_en = null, updated_at = now() where id = 1;
    v_hecho := 'aviso de caída';
  elsif not v_caida and v_e.caida_desde is not null then
    perform public._queue_system_alert(
      'conta_lectura_vuelta',
      'Sumied vuelve a leer facturas',
      format('La lectura de facturas vuelve a funcionar (estaba caída desde las %s, hora de Madrid: %s). Las que llegaron mientras tanto siguen sin leer: se leen con «Leerla».',
             to_char(v_e.caida_desde at time zone 'Europe/Madrid', 'DD/MM HH24:MI'), coalesce(v_que ->> v_e.causa, v_e.causa)),
      'conta_lectura_vuelta', interval '1 hour');
    update public.conta_lectura_estado set caida_desde = null, causa = null, vuelta_en = now(), updated_at = now() where id = 1;
    v_hecho := 'aviso de vuelta';
  end if;
  return v_c || jsonb_build_object('hecho', v_hecho);
end
$function$;

comment on function public._conta_lectura_caida() is 'E02: si la lectura de facturas está caída para todos (tope de gasto a la primera; otra caída, 3 en 15 minutos), hasta la primera lectura buena. Interna, solo lee.';
comment on function public.conta_lectura_estado(uuid) is 'E02: la franja de arriba de Documentos y Facturas recibidas: si la lectura está caída (común) y cuántas de esta empresa esperan. Solo lee.';
comment on function public._conta_lectura_vigia() is 'E02: el vigía de la lectura (cron cada 10 minutos): avisa de la caída una vez y de la vuelta.';

revoke all on function public._conta_lectura_caida() from public, anon, authenticated;
revoke all on function public._conta_lectura_vigia() from public, anon, authenticated;
grant execute on function public._conta_lectura_caida() to service_role;
grant execute on function public._conta_lectura_vigia() to service_role;
revoke all on function public.conta_lectura_estado(uuid) from public, anon;
grant execute on function public.conta_lectura_estado(uuid) to authenticated, service_role;

-- 6 · El cron, cada 10 minutos -----------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'e02-lectura-vigia') then perform cron.unschedule('e02-lectura-vigia'); end if;
    perform cron.schedule('e02-lectura-vigia', '3,13,23,33,43,53 * * * *', 'select public._conta_lectura_vigia()');
  end if;
end $$;
