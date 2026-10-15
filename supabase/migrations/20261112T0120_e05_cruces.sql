-- supabase/migrations/20261112T0120_e05_cruces.sql
--
-- E05 · Tarea 3 · Los cruces de la quincena de Catcher y «Por aclarar». Solo
-- añade (tablas, una columna que admite nulos y funciones nuevas). El cruce lo
-- hace el núcleo (src/modules/conta/lib/catcherCruces.ts, con sus pruebas); la
-- base da lo que necesita y guarda lo que sale.
--
--   1. supplier_rate: la tarifa del proveedor, FECHADA y editable (una versión
--      por día de entrada en vigor; la que vale un día es la última anterior).
--      Los valores, en jsonb: tramos por km, por km de más, máximo, bonos de
--      lluvia y demanda con su máximo, pedido extra y comisión por pedido.
--   2. supplier_batch_issue: «Por aclarar», una fila por cosa que no cuadra, con
--      su pedido (código + fecha y hora), su porqué y qué decidió la persona.
--   3. supplier_batch_order.sale_id: el pedido de la app con el que casó. Sin
--      clave ajena a sale a propósito: añadirla bloquearía la tabla de ventas,
--      que está en el camino del pedido.
--   4. conta_lote_pedidos_app: lo que la app mandó a Catcher en el periodo del
--      lote (solo lectura de sale).
--   5. conta_lote_cruce_guardar: guarda el cruce (lo por aclarar, con qué casó
--      cada pedido y si cada factura queda segura) y dice lo que ha hecho.
--   6. conta_lote_aclarar: la persona decide sobre una cosa por aclarar: se da
--      por buena o se reclama a Catcher. La factura vuelve a segura solo si no
--      le queda nada abierto ni reclamado y era segura al leerla.
--   7. conta_tarifa_guardar: una versión nueva de la tarifa (o corrige la de ese día).

-- 1 · La tarifa ----------------------------------------------------------------
create table if not exists public.supplier_rate (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  provider text not null check (provider in ('catcher')),
  valid_from date not null,
  params jsonb not null,
  source text,
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists supplier_rate_uq on public.supplier_rate (account_id, company_id, provider, valid_from);
comment on table public.supplier_rate is
  'E05 · La tarifa de un proveedor que factura en lote (Catcher), fechada: vale desde valid_from hasta la siguiente. params: tramos [{hastaKm, precio}], porKmExtra, maximo, bonoLluviaPct, bonoDemandaPct, bonoMaxPct, pedidoExtra, comisionPedido (todo sin IVA).';
alter table public.supplier_rate enable row level security;
drop policy if exists supplier_rate_read on public.supplier_rate;
create policy supplier_rate_read on public.supplier_rate for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_rate from anon, authenticated;
grant select on public.supplier_rate to authenticated;

-- 2 · Por aclarar -----------------------------------------------------------------
create table if not exists public.supplier_batch_issue (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  batch_id uuid not null references public.supplier_batch(id) on delete cascade,
  supplier_invoice_id uuid references public.supplier_invoice(id) on delete cascade,
  reason text not null check (reason in ('no_se_mando', 'dos_pedidos_a_esa_hora', 'cancelado_facturado', 'precio_distinto', 'fuera_de_tarifa', 'sin_tarifa',
                                         'comision_sin_entrega', 'comision_distinta', 'entregado_sin_factura', 'suma_pedidos', 'suma_lote')),
  order_code text,
  ordered_at timestamptz,
  text text not null,
  -- Céntimos: lo que el proveedor cobra de más (positivo) o de menos.
  difference_cents integer,
  status text not null default 'abierta' check (status in ('abierta', 'aceptada', 'reclamada')),
  note text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_by_name text,
  created_at timestamptz not null default now(),
  check ((status = 'abierta') = (resolved_at is null))
);
create index if not exists supplier_batch_issue_lote_idx on public.supplier_batch_issue (batch_id, status);
create index if not exists supplier_batch_issue_factura_idx on public.supplier_batch_issue (supplier_invoice_id) where supplier_invoice_id is not null;
comment on table public.supplier_batch_issue is
  'E05 · «Por aclarar» de un lote: cada cosa que no cuadra al cruzarlo (un pedido, una comisión, una suma), con su porqué; y lo que decidió la persona (aceptada: se da por buena; reclamada: se reclama al proveedor).';
alter table public.supplier_batch_issue enable row level security;
drop policy if exists supplier_batch_issue_read on public.supplier_batch_issue;
create policy supplier_batch_issue_read on public.supplier_batch_issue for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_batch_issue from anon, authenticated;
grant select on public.supplier_batch_issue to authenticated;

-- 3 · Con qué pedido de la app casó -----------------------------------------------
alter table public.supplier_batch_order add column if not exists sale_id uuid;
comment on column public.supplier_batch_order.sale_id is 'E05 · La venta (sale.id) con la que casó el pedido al cruzar (código + fecha y hora). Sin clave ajena: sale está en el camino del pedido.';
alter table public.supplier_batch add column if not exists crossed_at timestamptz;
alter table public.supplier_batch add column if not exists cross_summary jsonb;
comment on column public.supplier_batch.cross_summary is 'E05 · El último cruce: cuántas facturas cuadran, cuántas por aclarar, la comisión esperada y la cobrada, y el coste por local, marca y plataforma.';

-- 4 · Lo que la app mandó a Catcher en el periodo -----------------------------------
create or replace function public.conta_lote_pedidos_app(p_lote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_l public.supplier_batch;
begin
  select * into v_l from public.supplier_batch where id = p_lote;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  -- Un día antes y uno después: un pedido de las 23:50 puede ir en la factura del día siguiente.
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'codigo', coalesce(s.pos_short_code, s.platform_order_code, ''), 'momento', s.sold_at,
                                        'localId', s.location_id, 'marcaId', s.brand_id, 'canalId', s.channel_id,
                                        'estado', coalesce(s.delivery_state, ''), 'precio', s.transport_price) order by s.sold_at)
      from public.sale s
     where s.account_id = v_l.account_id and s.carrier_code = v_l.provider
       and s.sold_at >= ((v_l.period_from - 1)::timestamp at time zone 'Europe/Madrid')
       and s.sold_at <  ((v_l.period_to + 2)::timestamp at time zone 'Europe/Madrid')), '[]'::jsonb);
end $$;
comment on function public.conta_lote_pedidos_app(uuid) is
  'E05 · Los pedidos que la app mandó al proveedor del lote (sale.carrier_code) en su periodo, un día antes y uno después (hora de Madrid), para cruzarlos con su Excel de pedidos. Solo lee.';
revoke all on function public.conta_lote_pedidos_app(uuid) from public, anon;
grant execute on function public.conta_lote_pedidos_app(uuid) to authenticated;

-- 5 · Guardar el cruce ------------------------------------------------------------------
create or replace function public.conta_lote_cruce_guardar(p_lote uuid, p_cruce jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l public.supplier_batch; a jsonb; k text; v jsonb;
  v_bien int := 0; v_mal int := 0; v_n int; v_abiertas int;
begin
  select * into v_l from public.supplier_batch where id = p_lote for update;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_l.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cruza las facturas.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cruce->'facturas') <> 'object' or jsonb_typeof(p_cruce->'porAclarar') <> 'array' then
    raise exception 'El cruce no trae sus facturas y lo que hay que aclarar.' using errcode = '22023';
  end if;

  -- Lo abierto se rehace; lo que ya decidió una persona se queda.
  delete from public.supplier_batch_issue where batch_id = p_lote and status = 'abierta';
  for a in select * from jsonb_array_elements(p_cruce->'porAclarar') loop
    -- Si la persona ya decidió sobre ese mismo pedido y motivo, no se vuelve a abrir.
    if exists (select 1 from public.supplier_batch_issue i where i.batch_id = p_lote and i.status <> 'abierta' and i.reason = a->>'motivo'
                and i.order_code is not distinct from a->'pedido'->>'codigo' and i.ordered_at is not distinct from nullif(a->'pedido'->>'momento', '')::timestamptz
                and i.supplier_invoice_id is not distinct from (select f.id from public.supplier_invoice f where f.batch_id = p_lote and f.invoice_number = a->>'factura' limit 1)) then
      continue;
    end if;
    insert into public.supplier_batch_issue (account_id, batch_id, supplier_invoice_id, reason, order_code, ordered_at, text, difference_cents)
    values (v_l.account_id, p_lote, (select f.id from public.supplier_invoice f where f.batch_id = p_lote and f.invoice_number = a->>'factura' limit 1),
            a->>'motivo', a->'pedido'->>'codigo', nullif(a->'pedido'->>'momento', '')::timestamptz, a->>'texto', nullif(a->>'diferencia', '')::int);
  end loop;

  -- Con qué venta casó cada pedido.
  update public.supplier_batch_order o set sale_id = null where o.batch_id = p_lote;
  for k, v in select * from jsonb_each(coalesce(p_cruce->'casados', '{}'::jsonb)) loop
    update public.supplier_batch_order o set sale_id = (v #>> '{}')::uuid
     where o.batch_id = p_lote and o.invoice_number || '|' || o.order_code || '|' || coalesce(to_char(o.ordered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '') = k;
  end loop;

  -- Cada factura en revisión: segura solo si el cruce la da por buena, no le queda nada
  -- abierto ni reclamado y ya era segura al leerla.
  for k, v in select * from jsonb_each(p_cruce->'facturas') loop
    select count(*) into v_abiertas from public.supplier_batch_issue i join public.supplier_invoice f on f.id = i.supplier_invoice_id
     where f.batch_id = p_lote and f.invoice_number = k and i.status <> 'aceptada';
    update public.supplier_invoice f
       set reading = jsonb_set(coalesce(f.reading, '{}'::jsonb), '{cruce}', jsonb_build_object('estado', v->>'estado', 'aclarar', v_abiertas, 'cruzada', now())),
           reading_confidence = case when v->>'estado' = 'seguro' and v_abiertas = 0 and f.reading->>'confianza' = 'seguro' then 'seguro' else 'duda' end,
           needs_review = not (v->>'estado' = 'seguro' and v_abiertas = 0 and f.reading->>'confianza' = 'seguro'),
           updated_at = now()
     where f.batch_id = p_lote and f.invoice_number = k and f.status = 'en_revision';
    if v->>'estado' = 'seguro' and v_abiertas = 0 then v_bien := v_bien + 1; else v_mal := v_mal + 1; end if;
  end loop;
  select count(*) into v_n from public.supplier_batch_issue where batch_id = p_lote and status = 'abierta';

  update public.supplier_batch set crossed_at = now(),
         cross_summary = jsonb_build_object('cuadran', v_bien, 'aclarar', v_mal, 'abiertas', v_n, 'totales', p_cruce->'totales', 'coste', coalesce(p_cruce->'coste', '[]'::jsonb), 'por', p_quien_nombre)
   where id = p_lote;
  return jsonb_build_object('cuadran', v_bien, 'aclarar', v_mal, 'abiertas', v_n,
    'texto', 'Cruzada la ' || v_l.label || ': ' || (v_bien + v_mal) || case when v_bien + v_mal = 1 then ' factura' else ' facturas' end || ', '
             || v_bien || case v_bien when 1 then ' cuadra' else ' cuadran' end
             || case when v_mal > 0 then ' y ' || v_mal || ' por aclarar' else '' end
             || case when v_n > 0 then ' (' || v_n || case v_n when 1 then ' cosa que mirar' else ' cosas que mirar' end || ')' else '' end || '.');
end $$;
comment on function public.conta_lote_cruce_guardar(uuid, jsonb, text) is
  'E05 · Guarda el cruce de un lote (catcherCruces.ts): lo que hay que aclarar (rehace lo abierto, respeta lo decidido), con qué venta casó cada pedido y si cada factura en revisión queda segura.';
revoke all on function public.conta_lote_cruce_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_lote_cruce_guardar(uuid, jsonb, text) to authenticated;

-- 6 · La persona decide ------------------------------------------------------------------
create or replace function public.conta_lote_aclarar(p_issue uuid, p_decision text, p_nota text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_i public.supplier_batch_issue; v_quedan int; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Alguien de la cuenta');
begin
  select * into v_i from public.supplier_batch_issue where id = p_issue for update;
  if v_i.id is null or not public.belongs_to_account(v_i.account_id) then raise exception 'Eso no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_i.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta decide lo que hay que aclarar.' using errcode = '42501';
  end if;
  if p_decision not in ('aceptada', 'reclamada', 'abierta') then raise exception 'Se da por buena, se reclama o se vuelve a abrir.' using errcode = '22023'; end if;
  if p_decision = 'reclamada' and coalesce(btrim(p_nota), '') = '' then raise exception 'Di qué se reclama.' using errcode = '22023'; end if;
  update public.supplier_batch_issue
     set status = p_decision, note = nullif(btrim(p_nota), ''),
         resolved_at = case when p_decision = 'abierta' then null else now() end,
         resolved_by = case when p_decision = 'abierta' then null else auth.uid() end,
         resolved_by_name = case when p_decision = 'abierta' then null else v_quien end
   where id = p_issue;
  if v_i.supplier_invoice_id is not null then
    select count(*) into v_quedan from public.supplier_batch_issue where supplier_invoice_id = v_i.supplier_invoice_id and status <> 'aceptada';
    update public.supplier_invoice f
       set reading = jsonb_set(coalesce(f.reading, '{}'::jsonb), '{cruce,aclarar}', to_jsonb(v_quedan)),
           reading_confidence = case when v_quedan = 0 and f.reading->>'confianza' = 'seguro' and f.reading->'cruce'->>'estado' is not null then 'seguro' else 'duda' end,
           needs_review = not (v_quedan = 0 and f.reading->>'confianza' = 'seguro' and f.reading->'cruce'->>'estado' is not null),
           updated_at = now()
     where f.id = v_i.supplier_invoice_id and f.status = 'en_revision';
  end if;
  return jsonb_build_object('estado', p_decision, 'quedan', coalesce(v_quedan, 0),
    'texto', case p_decision when 'aceptada' then 'Dado por bueno' when 'reclamada' then 'Apuntado para reclamar a Catcher' else 'Vuelto a abrir' end
             || coalesce(' (' || v_i.order_code || ')', '') || '. '
             || case when v_i.supplier_invoice_id is null then '' when coalesce(v_quedan, 0) = 0 then 'A su factura no le queda nada por aclarar.'
                     else 'A su factura le ' || case v_quedan when 1 then 'queda 1 cosa' else 'quedan ' || v_quedan || ' cosas' end || '.' end);
end $$;
comment on function public.conta_lote_aclarar(uuid, text, text, text) is
  'E05 · La persona decide sobre una cosa por aclarar de un lote: aceptada (se da por buena), reclamada (con lo que se reclama) o abierta otra vez. Rehace si su factura queda segura.';
revoke all on function public.conta_lote_aclarar(uuid, text, text, text) from public, anon;
grant execute on function public.conta_lote_aclarar(uuid, text, text, text) to authenticated;

-- 7 · Guardar la tarifa ---------------------------------------------------------------------
create or replace function public.conta_tarifa_guardar(p_company uuid, p_provider text, p_desde date, p_params jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_id uuid; v_ya boolean; t jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then raise exception 'Solo un administrador o un encargado de la cuenta cambia la tarifa.' using errcode = '42501'; end if;
  if p_provider <> 'catcher' then raise exception 'Solo hay tarifa de Catcher.' using errcode = '22023'; end if;
  if p_desde is null then raise exception 'Di desde cuándo vale.' using errcode = '22023'; end if;
  if jsonb_typeof(p_params->'tramos') <> 'array' or jsonb_array_length(p_params->'tramos') = 0 then raise exception 'La tarifa necesita al menos un tramo por km.' using errcode = '22023'; end if;
  for t in select * from jsonb_array_elements(p_params->'tramos') loop
    if coalesce((t->>'hastaKm')::numeric, 0) <= 0 or coalesce((t->>'precio')::numeric, -1) < 0 then raise exception 'Cada tramo lleva hasta cuántos km y su precio.' using errcode = '22023'; end if;
  end loop;
  if exists (select 1 from unnest(array['porKmExtra', 'maximo', 'bonoLluviaPct', 'bonoDemandaPct', 'bonoMaxPct', 'pedidoExtra', 'comisionPedido']) k
              where jsonb_typeof(p_params->k) <> 'number' or (p_params->>k)::numeric < 0) then
    raise exception 'Faltan valores de la tarifa (por km de más, máximo, bonos, pedido extra o comisión), o alguno es negativo.' using errcode = '22023';
  end if;
  select exists (select 1 from public.supplier_rate where account_id = v_acc and company_id = p_company and provider = p_provider and valid_from = p_desde) into v_ya;
  insert into public.supplier_rate (account_id, company_id, provider, valid_from, params, source, created_by_name)
  values (v_acc, p_company, p_provider, p_desde, p_params, 'manual', p_quien_nombre)
  on conflict (account_id, company_id, provider, valid_from) do update set params = excluded.params, source = 'manual', created_by_name = excluded.created_by_name, updated_at = now()
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'texto', case when v_ya then 'Corregida la tarifa de Catcher que vale desde el ' else 'Guardada la tarifa de Catcher: vale desde el ' end || to_char(p_desde, 'DD/MM/YYYY') || '.');
end $$;
comment on function public.conta_tarifa_guardar(uuid, text, date, jsonb, text) is
  'E05 · Guarda una versión de la tarifa del proveedor (Catcher) que vale desde p_desde; si ya hay una de ese día, la corrige.';
revoke all on function public.conta_tarifa_guardar(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.conta_tarifa_guardar(uuid, text, date, jsonb, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.supplier_rate, public.supplier_batch_issue to conta_lectura;
  end if;
end $$;
