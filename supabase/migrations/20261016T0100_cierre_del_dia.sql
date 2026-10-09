-- ============================================================================
-- El día se cierra a las 6:00, y lo que sigue abierto no es venta — 1 · LA BASE
-- ----------------------------------------------------------------------------
-- Encargo del 09/10. Reglas de Julio:
--   1. Cada día se cierra a una hora fija de la madrugada siguiente: las 6:00
--      de serie, ajuste de cada empresa (company_tax_profile), no un número
--      del código.
--   2. No se propone el asiento de ventas de un día antes de su cierre
--      (eso va en la 0120).
--   3. Al cierre, un pedido de marca propia que siga abierto se cierra como
--      «no confirmado por la plataforma»: no entra en las ventas del día y
--      queda a la vista con su código y su importe.
--   5. El stock NO vuelve: lo cocinado, cocinado está (eso va en la 0110).
-- El día de cada pedido sigue siendo el día natural de `sold_at` en Madrid,
-- como en conta_dias_por_asentar y conta_pedidos_del_dia: lo que cambia es
-- CUÁNDO se da por cerrado.
--
-- Qué hace el cierre, y qué NO:
--   · status 'open' → 'cancelled', con unconfirmed_at (la marca nueva),
--     cancelled_at, cancel_reason («No confirmado por la plataforma al cierre
--     del día (6:00)») y updated_at. NADA MÁS: los disparadores de sale que
--     imprimen, despachan, avisan o empujan a HubRise miran order_status y
--     delivery_state, y esos no se tocan (T1, informe del PR).
--   · Ni llamadas fuera, ni avisos, ni devolución de stock.
--   · Deja rastro, una fila por pedido, en sales_day_close_log: qué, cuándo y
--     con qué regla (la hora de cierre de ese momento).
--   · Idempotente: solo mira lo que sigue 'open'. Volver a pasar no cierra
--     nada dos veces ni escribe rastro de más.
--   · El atraso de agosto, septiembre y octubre lo cierra esta misma función
--     en su primera pasada (la lista de lo que cerraría, en el PR).
--
-- Cada hora (cron en la 0140) corre conta_cierre_del_dia_todas(): un
-- procedimiento que confirma (COMMIT) empresa a empresa, así que lo que falla
-- en una no deshace ni frena a las demás, y si alguna ha fallado termina con
-- ERROR —no con un aviso—, para que pg_cron lo cuente como fallido.
--
-- Solo añade: columnas que admiten vacío, una tabla y funciones nuevas.
-- Vuelta atrás: supabase/vuelta-atras/20261016T0100_cierre_del_dia.down.sql
-- ============================================================================

-- ── 1 · La marca del pedido no confirmado ──────────────────────────────────
alter table public.sale add column if not exists unconfirmed_at timestamptz;
comment on column public.sale.unconfirmed_at is
  'Cierre del día: cuándo se cerró este pedido como «no confirmado por la plataforma» (seguía abierto a la hora de cierre del día). Va con status = cancelled, pero NO es una anulación: no entra en las ventas del día y su consumo se queda (lo cocinado, cocinado está). Nulo en todo lo demás.';

-- ── 2 · La hora de cierre, ajuste de cada empresa ──────────────────────────
-- Admite vacío a propósito (vacío = la de serie, 6:00): hacerla obligatoria
-- sería «destruir» para el analizador, y no hace falta.
alter table public.company_tax_profile add column if not exists sales_day_close_time time default '06:00';
comment on column public.company_tax_profile.sales_day_close_time is
  'Cierre del día: a esta hora (de Madrid) se dan por terminadas las ventas del día anterior. Un pedido de marca propia que siga abierto se cierra como no confirmado. Vacío = 6:00.';

-- ── 3 · El rastro: una fila por pedido cerrado ─────────────────────────────
create table if not exists public.sales_day_close_log (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  sale_id          uuid not null references public.sale(id) on delete cascade,
  location_id      uuid,
  sales_day        date not null,           -- el día del pedido (sold_at en Madrid)
  closed_through   date not null,           -- el último día cerrado en esa pasada
  close_time       time not null,           -- la regla: la hora de cierre de ese momento
  order_code       text,
  total            numeric,
  order_status     text,                    -- cómo estaba el pedido al cerrarlo
  delivery_state   text,
  closed_at        timestamptz not null default now()
);
comment on table public.sales_day_close_log is
  'Cierre del día: qué pedido se cerró como no confirmado, cuándo y con qué regla (hora de cierre). Lo escribe solo conta_cerrar_dias.';
create unique index if not exists sales_day_close_log_sale on public.sales_day_close_log (sale_id);
create index if not exists sales_day_close_log_company_day on public.sales_day_close_log (company_id, sales_day);

alter table public.sales_day_close_log enable row level security;
drop policy if exists sales_day_close_log_select on public.sales_day_close_log;
create policy sales_day_close_log_select on public.sales_day_close_log for select to authenticated
  using (account_id = any ((select public.current_user_account_ids())::uuid[]));
-- Sin políticas de escritura: solo la escribe conta_cerrar_dias (security definer).
revoke all on table public.sales_day_close_log from anon;

-- ── 4 · Qué día está cerrado ───────────────────────────────────────────────
-- La misma cuenta que src/modules/conta/lib/cierreDelDia.ts (ultimoDiaCerrado):
-- la hora de la PARED en Madrid. Un día D se cierra a la hora de cierre del
-- día D + 1, así que el cambio de hora de octubre y de marzo no mueve nada.
create or replace function public.conta_ultimo_dia_cerrado(p_company uuid, p_ahora timestamptz default now())
returns date
language sql stable
set search_path = public
as $$
  select case when (p_ahora at time zone 'Europe/Madrid')::time >= coalesce(t.sales_day_close_time, time '06:00')
              then (p_ahora at time zone 'Europe/Madrid')::date - 1
              else (p_ahora at time zone 'Europe/Madrid')::date - 2 end
    from public.company c
    left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company
$$;
comment on function public.conta_ultimo_dia_cerrado(uuid, timestamptz) is
  'Cierre del día: el último día ya cerrado de la empresa a esta hora (Madrid). A las 17:16 del 09/10 con cierre a las 6:00 → 08/10; a las 5:30 del 09/10 → 07/10.';

-- El instante en que empieza el primer día SIN cerrar: lo vendido antes es de
-- días cerrados. Para filtrar sold_at sin convertir fila a fila.
create or replace function public.conta_cerrado_hasta(p_company uuid, p_ahora timestamptz default now())
returns timestamptz
language sql stable
set search_path = public
as $$
  select ((public.conta_ultimo_dia_cerrado(p_company, p_ahora) + 1)::timestamp at time zone 'Europe/Madrid')
$$;
comment on function public.conta_cerrado_hasta(uuid, timestamptz) is
  'Cierre del día: el instante en que empieza el primer día sin cerrar (medianoche de Madrid). sold_at < esto = venta de un día cerrado.';

-- ── 5 · Lo que cerraría, sin cerrar nada ───────────────────────────────────
-- Es la MISMA selección que usa conta_cerrar_dias (la llama), para que la
-- lista que se enseña antes de aplicar y lo que se cierra no puedan diferir.
-- Security invoker: quien la llame ve solo lo suyo (sale_read).
create or replace function public.conta_por_cerrar(p_company uuid, p_ahora timestamptz default now())
returns table (sale_id uuid, location_id uuid, sales_day date, sold_at timestamptz, order_code text,
               total numeric, order_status text, delivery_state text)
language sql stable
set search_path = public
as $$
  select s.id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, s.sold_at,
         coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.total, s.order_status, s.delivery_state
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
   where s.status = 'open' and s.is_active and coalesce(b.ownership_type, 'own') = 'own'
     and s.sold_at < public.conta_cerrado_hasta(p_company, p_ahora)
   order by s.sold_at
$$;
comment on function public.conta_por_cerrar(uuid, timestamptz) is
  'Cierre del día: los pedidos de marca propia que siguen abiertos en días ya cerrados. Lo que cerraría conta_cerrar_dias, sin tocar nada.';

-- ── 6 · El cierre de una empresa ───────────────────────────────────────────
-- Sin manejo de errores a propósito: si algo falla, falla entero (y la
-- empresa queda como estaba). El procedimiento de abajo lo recoge y lo cuenta.
create or replace function public.conta_cerrar_dias(p_company uuid, p_ahora timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_hora    time;
  v_hasta   date;
  v_n       int;
  v_importe numeric;
begin
  select c.account_id, coalesce(t.sales_day_close_time, time '06:00')
    into v_account, v_hora
    from public.company c left join public.company_tax_profile t on t.company_id = c.id
   where c.id = p_company;
  if v_account is null then
    raise exception 'Cierre del día: la empresa % no existe.', p_company;
  end if;
  v_hasta := public.conta_ultimo_dia_cerrado(p_company, p_ahora);

  with cand as (
    -- skip locked: un pedido que en este mismo instante está moviendo la
    -- plataforma no se pisa; lo coge la pasada de la hora siguiente.
    select s.id from public.sale s
     where s.id in (select x.sale_id from public.conta_por_cerrar(p_company, p_ahora) x)
       and s.status = 'open'
     for update of s skip locked
  ),
  cerrados as (
    update public.sale s
       set status = 'cancelled',
           unconfirmed_at = now(),
           cancelled_at = now(),
           cancel_reason = format('No confirmado por la plataforma al cierre del día (%s)', to_char(v_hora, 'FMHH24:MI')),
           updated_at = now()
      from cand
     where s.id = cand.id
    returning s.id, s.account_id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date as dia,
              coalesce(s.platform_order_code, s.pos_short_code, s.external_ref) as codigo, s.total, s.order_status, s.delivery_state
  ),
  rastro as (
    insert into public.sales_day_close_log
      (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state)
    select account_id, p_company, id, location_id, dia, v_hasta, v_hora, codigo, total, order_status, delivery_state
      from cerrados
    on conflict (sale_id) do nothing
    returning total
  )
  select count(*), coalesce(sum(total), 0) into v_n, v_importe from rastro;

  return jsonb_build_object('company_id', p_company, 'cerrado_hasta', v_hasta, 'hora', to_char(v_hora, 'HH24:MI'),
                            'cerrados', v_n, 'importe', v_importe);
end
$$;
comment on function public.conta_cerrar_dias(uuid, timestamptz) is
  'Cierre del día: cierra como no confirmados los pedidos de marca propia que siguen abiertos en días ya cerrados de la empresa. Sin efectos fuera, sin devolver stock, con rastro en sales_day_close_log. Idempotente.';
revoke execute on function public.conta_cerrar_dias(uuid, timestamptz) from public, anon, authenticated;

-- ── 7 · Cada hora, todas las empresas ──────────────────────────────────────
-- PROCEDIMIENTO, no función, para poder confirmar empresa a empresa: lo que
-- se cerró en una queda cerrado aunque falle la siguiente. Security invoker
-- y sin «set», porque un procedimiento con cualquiera de las dos no puede
-- hacer COMMIT: lo corre el dueño del cron (postgres), y todo va con esquema.
-- Si alguna falla, ERROR al final con cuáles y por qué: pg_cron lo apunta
-- como fallido (lo contrario del cron_autoclose_daily_counts, que lo bajaba
-- a «warning» y contaba 185 «succeeded» con cero movimientos).
create or replace procedure public.conta_cierre_del_dia_todas()
language plpgsql
as $$
declare
  r        record;
  v_fallos text[] := '{}';
begin
  for r in select c.id from public.company c order by c.id loop
    begin
      perform public.conta_cerrar_dias(r.id, now());
    exception when others then
      v_fallos := v_fallos || format('%s: %s (%s)', r.id, sqlerrm, sqlstate);
    end;
    commit;
  end loop;
  if cardinality(v_fallos) > 0 then
    raise exception 'Cierre del día: falló en % empresa(s): %', cardinality(v_fallos), array_to_string(v_fallos, ' · ');
  end if;
end
$$;
comment on procedure public.conta_cierre_del_dia_todas() is
  'Cierre del día: conta_cerrar_dias de cada empresa, confirmando una a una. Lo llama el cron cada hora; si alguna falla, termina con error.';
revoke execute on procedure public.conta_cierre_del_dia_todas() from public, anon, authenticated;

-- ── 8 · Los no confirmados, para la pantalla ───────────────────────────────
-- Security invoker: la política de sale (sale_read) deja a cada uno en lo suyo.
create or replace function public.conta_no_confirmados(p_company uuid, p_desde date, p_hasta date, p_location uuid default null)
returns table (id uuid, location_id uuid, dia date, sold_at timestamptz, marca text, canal text, codigo text,
               total numeric, order_status text, delivery_state text, unconfirmed_at timestamptz)
language sql stable
set search_path = public
as $$
  select s.id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date, s.sold_at, b.name, ch.name,
         coalesce(s.platform_order_code, s.pos_short_code, s.external_ref), s.total, s.order_status, s.delivery_state, s.unconfirmed_at
    from public.sale s
    join public.company c on c.id = p_company and c.account_id = s.account_id
    left join public.brand b on b.id = s.brand_id
    left join public.sales_channel ch on ch.id = s.channel_id
   where s.unconfirmed_at is not null and s.status = 'cancelled'
     and (p_location is null or s.location_id = p_location)
     and s.sold_at >= (p_desde::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p_hasta + 1)::timestamp at time zone 'Europe/Madrid')
   order by s.sold_at
$$;
comment on function public.conta_no_confirmados(uuid, date, date, uuid) is
  'Cierre del día: los pedidos cerrados como no confirmados entre dos días (Madrid), con marca, canal, código e importe. Lee con los permisos de quien llama.';
