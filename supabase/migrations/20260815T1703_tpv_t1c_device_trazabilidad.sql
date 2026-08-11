-- Aplicada: PENDIENTE (Julio, por MCP).
--
-- ENCARGO TPV T1.c — trazabilidad de dispositivo y turno, ANTES del merge de
-- T1 (§1 del encargo: barato ahora en una migración que se va a escribir de
-- todos modos, caro después con ventas reales encima y sin forma de deducir
-- a posteriori desde qué tablet salió un ticket).
--
-- RECON en vivo (11/08, antes de escribir esto):
--   · sale NO tiene device_id ni cash_session_id (information_schema).
--   · No existe ninguna tabla de caja/turno/arqueo. shift_templates/
--     open_shifts/shift_swap_requests/open_shift_requests son del módulo
--     Team (turnos de personal) — NO se reutiliza el nombre `shift` para el
--     turno de caja, se usa `cash_session` (la tabla llega en T2, aquí solo
--     se reserva la columna).
--   · kds_device: 14 columnas, CHECK kds_device_device_mode_chk = ANY
--     ('estacion','equipo','gestion'). NO SE TOCA — ni la tabla, ni el
--     CHECK, ni device_mode. Confirmado explícitamente por el encargo: la
--     petición original de añadir 'tpv' al CHECK se retira porque (a) un
--     DROP/ADD CONSTRAINT sobre kds_device es el tipo de operación que
--     participó en tumbar la BBDD el 11/08 y exigiría servicio cerrado para
--     nada, y (b) sería mal diseño — en un bar pequeño la MISMA tablet puede
--     ser KDS y TPV a la vez; un modo excluyente obligaría a elegir.
--     device_id en sale ya dice todo lo necesario.
--   · upsert_pos_sale (20260815T1702, ya aplicada) tiene firma de 8
--     parámetros — verificado con pg_get_function_identity_arguments antes
--     de escribir esto (ver guard DO de abajo, que aborta si ha cambiado).
--   · kds_resolve_device(p_token) ya existe (fix/kds-latido-raiz, PR #48):
--     única puerta de entrada por token, filtra is_active=true, sin filtro
--     de account/location (igual que usan todas las rutas _by_token).
--
-- ── Tarea A: dos columnas en sale ────────────────────────────────────────
-- device_id uuid null references kds_device(id) on delete set null — se
-- reutiliza kds_device, no se crea pos_device (duplicaría alta/baja, token,
-- latido, versión de app y pantalla de gestión ya existentes para el mismo
-- hardware). ON DELETE SET NULL, nunca CASCADE: borrar un dispositivo no
-- borra jamás la venta.
-- cash_session_id uuid null, SIN FK todavía — la tabla cash_session llega
-- en T2; esto es solo el hueco reservado, tal como pide el encargo.
-- Ambas nullable: las ventas de Last/HubRise no tienen dispositivo de Folvy
-- y deben poder seguir entrando sin tocar nada (verificación §6.4).
--
-- ── Tarea B: que el RPC lo guarde ────────────────────────────────────────
-- upsert_pos_sale gana un 9º parámetro, p_device_token text DEFAULT NULL —
-- el cliente pasa el TOKEN crudo (el mismo kds_device_token que ya guarda en
-- localStorage /estacion y printWorker), no un uuid resuelto por el propio
-- cliente: el servidor resuelve por kds_resolve_device(), igual que hacen
-- las rutas por token, en vez de confiar en un device_id que el cliente
-- podría inventar. Si el token no resuelve, o resuelve a un dispositivo de
-- OTRA cuenta/local (defensa extra, barata: la sesión ya validó cuenta/local
-- vía _pos_can_operate, el dispositivo debe coincidir), device_id se queda
-- en null — LA VENTA NUNCA SE BLOQUEA POR ESTO (regla explícita del
-- encargo). Se escribe solo en el INSERT (creación de la cuenta), igual que
-- created_by/created_by_name: el dispositivo que abrió la venta es el dato
-- que importa, no se reescribe en cada Guardar/Comandar/Cobrar posterior.
--
-- ⚠️ TRAMPA DE POSTGRES EVITADA (documentada porque no es obvia): añadir un
-- parámetro nuevo a una función existente NO es lo mismo que "reemplazarla".
-- CREATE OR REPLACE FUNCTION identifica la función por NOMBRE + TIPOS DE
-- PARÁMETRO; con 9 parámetros en vez de 8 habría CREADO UNA SEGUNDA FUNCIÓN
-- SOLAPADA (overload) en vez de sustituir la de T1 — las dos habrían
-- convivido en pg_proc, y PostgREST habría tenido que desambiguar según los
-- argumentos que mandara el cliente (fuente de bugs intermitentes difíciles
-- de reproducir). Por eso el DROP FUNCTION explícito de la firma vieja
-- ANTES del CREATE OR REPLACE de la firma nueva, más abajo.
--
-- ── Tarea C: índice ───────────────────────────────────────────────────────
-- Parcial sobre device_id (la inmensa mayoría de ventas históricas lo
-- tendrán a null). El índice de cash_session_id NO se crea aquí — sin tabla
-- ni datos no sirve de nada, va en T2, tal como pide el encargo.
--
-- Validado por MCP antes de escribir este fichero (creado, probado, borrado
-- en los tres casos):
--   · ADD COLUMN + FK a kds_device(id) + índice parcial, contra una tabla
--     desechable (_tmp_check_sale_device) que apunta al kds_device REAL —
--     sin tocar `sale`.
--   · ON DELETE SET NULL de extremo a extremo: dispositivo desechable creado
--     en kds_device, referenciado, borrado — la fila que lo referenciaba
--     sobrevive con device_id=null, confirmado por query.
--   · El cuerpo completo de la nueva upsert_pos_sale compiló sin error como
--     _tmp_check_upsert_pos_sale (check_function_bodies=on) — NOTA HONESTA:
--     esto confirma sintaxis/tipos, pero PL/pgSQL NO valida en CREATE TIME
--     que las columnas de un INSERT existan de verdad en la tabla (se
--     comprueba en la primera ejecución, no al compilar) — por eso el orden
--     de este fichero importa: el ALTER TABLE va ANTES del CREATE OR REPLACE
--     de la función, para que cuando alguien la ejecute la columna ya exista.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='sale') then
    raise exception 'tpv_t1c_device_trazabilidad: falta tabla sale — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='kds_device') then
    raise exception 'tpv_t1c_device_trazabilidad: falta tabla kds_device — RECON desactualizado, parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='kds_resolve_device') then
    raise exception 'tpv_t1c_device_trazabilidad: falta kds_resolve_device — RECON desactualizado, parar';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'upsert_pos_sale'
      and pg_get_function_identity_arguments(p.oid) =
        'p_sale_id uuid, p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_channel_kind text, p_lines jsonb, p_action text, p_payment_method text'
  ) then
    raise exception 'tpv_t1c_device_trazabilidad: upsert_pos_sale no tiene la firma de 8 parámetros esperada (T1/T1.b) — RECON desactualizado, parar';
  end if;
end $$;

-- ── 1) Tarea A: columnas en sale ────────────────────────────────────────────

alter table public.sale add column if not exists device_id uuid null references public.kds_device(id) on delete set null;
alter table public.sale add column if not exists cash_session_id uuid null;

comment on column public.sale.device_id is
  'Dispositivo Folvy (kds_device) que originó la venta — TPV T1.c, 11/08.
   ON DELETE SET NULL: borrar el dispositivo nunca borra la venta. NULL en
   ventas de Last/HubRise (sin dispositivo Folvy) y en TPV abierto desde un
   navegador sin token de dispositivo pareado. Se fija solo al crear la
   venta (upsert_pos_sale, acción de INSERT), no se reescribe después.';

comment on column public.sale.cash_session_id is
  'Turno de caja (cash_session) al que pertenece la venta — columna
   reservada en T1.c (11/08), SIN FK todavía: la tabla cash_session llega en
   T2. No confundir con las tablas shift_* del módulo Team (turnos de
   personal de cuadrante) — esto es turno de CAJA, entidad distinta.';

-- ── 2) Tarea C: índice parcial (device_id) ──────────────────────────────────
-- cash_session_id NO se indexa aquí — sin tabla ni datos no serviría de
-- nada; el índice llega en T2 junto con la FK.

create index if not exists idx_sale_device_id on public.sale (device_id) where device_id is not null;

-- ── 3) Tarea B: upsert_pos_sale acepta y guarda p_device_token ──────────────
-- DROP explícito de la firma vieja de 8 parámetros ANTES del CREATE (ver
-- nota de la cabecera sobre el overload accidental que esto evita).

drop function if exists public.upsert_pos_sale(uuid, uuid, uuid, uuid, text, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.upsert_pos_sale(p_sale_id uuid, p_account_id uuid, p_location_id uuid, p_brand_id uuid, p_channel_kind text, p_lines jsonb, p_action text, p_payment_method text DEFAULT NULL::text, p_device_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sale_id   uuid := p_sale_id;
  v_channel   uuid;
  v_actor     text;
  v_line      jsonb;
  v_repr      jsonb;
  v_vat       numeric;
  v_ltotal    numeric;
  v_lbase     numeric;
  v_base_sum  numeric := 0;
  v_tax_sum   numeric := 0;
  v_total_sum numeric := 0;
  v_status    text;
  v_device    kds_device;
  v_device_id uuid;
  v_result    sale%rowtype;
begin
  if not public._pos_can_operate(p_account_id, p_location_id) then
    raise exception 'upsert_pos_sale: sin acceso a esta cuenta/local';
  end if;
  if p_action not in ('save', 'command', 'charge', 'deliver') then
    raise exception 'upsert_pos_sale: acción no válida %', p_action;
  end if;
  if p_action = 'charge' and p_payment_method not in ('cash', 'card') then
    raise exception 'upsert_pos_sale: cobrar exige payment_method cash|card';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'upsert_pos_sale: la cuenta no tiene líneas';
  end if;

  select display_name into v_actor from user_profiles
  where user_id = auth.uid() and account_id = p_account_id limit 1;

  v_channel := public._pos_channel_id(p_account_id, coalesce(p_channel_kind, 'counter'));

  -- Dispositivo (T1.c, 11/08): resuelto por TOKEN, igual que las rutas por
  -- token — el cliente nunca manda un device_id propio. Si el token no
  -- resuelve, o resuelve a un dispositivo de otra cuenta/local, se queda en
  -- null sin bloquear la venta (regla explícita del encargo).
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is not null
       and v_device.account_id = p_account_id
       and v_device.location_id = p_location_id then
      v_device_id := v_device.id;
    end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_repr   := public._shop_reprice_line(p_account_id, v_line);
    v_ltotal := coalesce((v_repr->>'lineTotal')::numeric, 0);

    select vat_rate into v_vat from menu_item
    where id = (v_line->>'menuItemId')::uuid and account_id = p_account_id;
    v_vat := coalesce(v_vat, 10);

    v_lbase     := round(v_ltotal / (1 + v_vat / 100.0), 2);
    v_base_sum  := v_base_sum + v_lbase;
    v_tax_sum   := v_tax_sum + (v_ltotal - v_lbase);
    v_total_sum := v_total_sum + v_ltotal;
  end loop;

  if v_sale_id is null then
    insert into sale (
      account_id, location_id, brand_id, channel_id, source, service_type,
      status, order_status, sold_at, opened_at, total, taxable_base, tax,
      payment_method, payment_status, dispatch_mode, pos_short_code,
      raw_tab, created_by, created_by_name, device_id
    ) values (
      p_account_id, p_location_id, p_brand_id, v_channel, 'folvy_pos', 'pickup',
      'open', null, now(), now(), round(v_total_sum, 2), round(v_base_sum, 2), round(v_tax_sum, 2),
      null, null, 'auto', public._pos_next_ticket_code(p_account_id, p_location_id),
      jsonb_build_object('lines', p_lines)::text, auth.uid(), v_actor, v_device_id
    )
    returning id into v_sale_id;
  else
    select * into v_result from sale where id = v_sale_id
      and account_id = p_account_id and location_id = p_location_id;
    if v_result.id is null then
      raise exception 'upsert_pos_sale: venta inexistente o de otra cuenta/local';
    end if;
    if v_result.status <> 'open' then
      raise exception 'upsert_pos_sale: la cuenta ya está cerrada (status=%)', v_result.status;
    end if;

    update sale set
      brand_id      = p_brand_id,
      channel_id    = v_channel,
      total         = round(v_total_sum, 2),
      taxable_base  = round(v_base_sum, 2),
      tax           = round(v_tax_sum, 2),
      raw_tab       = jsonb_build_object('lines', p_lines)::text,
      updated_at    = now()
    where id = v_sale_id;
  end if;

  perform public._adapt_folvy_pos_order(v_sale_id);

  if p_action in ('command', 'charge') then
    update sale set order_status = coalesce(order_status, 'accepted') where id = v_sale_id;
  end if;

  if p_action = 'charge' then
    update sale set
      status         = 'closed',
      payment_method = p_payment_method,
      payment_status = 'paid',
      paid_at        = now(),
      closed_at      = now()
    where id = v_sale_id;
  end if;

  if p_action = 'deliver' then
    select status into v_status from sale where id = v_sale_id;
    if v_status <> 'closed' then
      raise exception 'upsert_pos_sale: no se puede marcar Entregado sin cobrar antes';
    end if;
    update sale set order_status = 'completed' where id = v_sale_id;
  end if;

  select * into v_result from sale where id = v_sale_id;
  return jsonb_build_object(
    'saleId', v_result.id,
    'posShortCode', v_result.pos_short_code,
    'status', v_result.status,
    'orderStatus', v_result.order_status,
    'paymentStatus', v_result.payment_status,
    'total', v_result.total,
    'taxableBase', v_result.taxable_base,
    'tax', v_result.tax
  );
end;
$function$;

notify pgrst, 'reload schema';

-- ── 4) Verificación (§6 del encargo) — QUERIES INDEPENDIENTES, no "Success" ─
-- Ejecutar tras aplicar, antes de dar por buena la migración:
--
-- 1) Columnas nullable:
--   select column_name, is_nullable from information_schema.columns
--   where table_schema='public' and table_name='sale'
--     and column_name in ('device_id','cash_session_id');
--
-- 5) kds_device sigue con exactamente 3 escritores y el CHECK intacto:
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.prosrc ~* 'update\s+(public\.)?kds_device';
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'kds_device_device_mode_chk';
--
-- 2/3/4 (venta desde tablet con token / navegador sin token / entrada por
-- Last) se verifican en caliente, no por SQL — ver parte de la encargo.