-- supabase/migrations/20261025T0916_pc01_motor_cobros_pagos.sql
--
-- PC01 · Entrega 1 · Un solo motor de cobros y pagos (Julio, 25/10). Esta
-- migración SOLO AÑADE: tablas, columnas que admiten vacío, funciones y vistas
-- nuevas. No toca datos ni nada que exista, y se puede pasar dos veces seguidas.
-- Lo que cambia en caliente va en la 0917; los datos, en la 0918.
--
--   1. supplier_invoice_payment: los pagos de una factura recibida, gemela de
--      customer_invoice_payment (en partes, con su asiento y su casado).
--   2. customer_invoice_payment: de qué casado del banco o de qué liquidación
--      viene cada cobro (bank_match_id, settlement_id).
--   3. bank_match_item.customer_invoice_id: la factura emitida que cobra un
--      movimiento del banco.
--   4. party_role: cuándo paga una plataforma (payout_days_after: los días
--      después de cerrar su periodo; payout_margin_days: el margen, 5 si no se
--      dice). El periodo ya estaba (settlement_every). Dato de cada plataforma,
--      editable en su ficha de Contactos: no va en el código.
--   5. channel_settlement.invoice_match_status / invoice_match_note: si al
--      cobrar la liquidación sus facturas quedaron cobradas o «a revisar», y
--      por qué.
--   6. Las funciones del motor:
--        · conta_vence_por_plataforma / conta_vence_de_cierre: el vencimiento
--          de la factura de un cierre (el día de pago que le toca más el margen);
--        · conta_liquidacion_pedidos: los pedidos de una liquidación, con su
--          factura y lo que su cierre cuenta de cada uno;
--        · _conta_liquidacion_cobros: cobra (o descobra) las facturas de una
--          liquidación, o la deja «a revisar» sin cobrar nada;
--        · _pc01_* : lo que harán los disparadores de la 0917.
--   7. Los estados, calculados en UN sitio (las vistas conta_factura_cobro y
--      conta_recibida_pago): Por cobrar o pagar, Vence esta semana, Vencida,
--      Esperando liquidación, Cobrada o Pagada en parte, Cobrada o Pagada, Sin
--      vencimiento. Los leen todas las pantallas.
--
-- La regla de la liquidación (Julio, 25/10, sí):
--   · una liquidación cobra PEDIDOS; cada pedido está en un solo cierre
--     (sales_day_summary.sale_ids) y por tanto en una sola factura;
--   · cada factura queda cobrada por lo que su cierre cuenta de esos pedidos
--     (conta_pedidos_del_dia.total), no por el neto: la comisión la compensa el
--     asiento de la liquidación contra la misma 430;
--   · los pedidos: los de channel_settlement_order con su venta, si los trae;
--     si no (Uber por correo), plataforma, local, marca y fechas del periodo en
--     hora de Madrid;
--   · si los pedidos no cuadran con los que dice la liquidación, queda «a
--     revisar» y no se cobra nada solo.
--
-- Ninguna de estas piezas está en el camino del pedido: no escribe en sale.
-- Vuelta atrás: supabase/vuelta-atras/20261025T0916_pc01_motor_cobros_pagos.down.sql

-- 1 · Los pagos de una factura recibida ---------------------------------------------------
create table if not exists public.supplier_invoice_payment (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid references public.company(id) on delete cascade,
  invoice_id       uuid not null references public.supplier_invoice(id) on delete cascade,
  paid_on          date not null,
  amount           numeric(14,2) not null check (amount <> 0),
  method           text,
  note             text,
  -- El asiento del pago (el del banco que lo casó). Sin asiento no hay pago:
  -- mark_supplier_invoice_paid (0917) solo marca pagada lo que cubren pagos con asiento;
  -- si su asiento propuesto se borra (deshacer el casado), el pago se va con él.
  entry_id         uuid references public.journal_entry(id) on delete cascade,
  bank_match_id    uuid references public.bank_match(id) on delete cascade,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text
);
comment on table public.supplier_invoice_payment is
  'PC01 · Lo pagado de una factura recibida (puede ser en partes), con su asiento. Gemela de customer_invoice_payment. La escribe Bancos al casar (disparador de bank_match_item) y la quita al deshacer.';
create index if not exists supplier_invoice_payment_factura_idx on public.supplier_invoice_payment (invoice_id);
create unique index if not exists supplier_invoice_payment_casado_uidx on public.supplier_invoice_payment (bank_match_id, invoice_id) where bank_match_id is not null;
alter table public.supplier_invoice_payment enable row level security;
revoke all on public.supplier_invoice_payment from public, anon, authenticated;
grant select on public.supplier_invoice_payment to authenticated;
drop policy if exists supplier_invoice_payment_leer on public.supplier_invoice_payment;
create policy supplier_invoice_payment_leer on public.supplier_invoice_payment for select to authenticated using (public.belongs_to_account(account_id));

-- 2 · De dónde viene cada cobro ------------------------------------------------------------
alter table public.customer_invoice_payment add column if not exists bank_match_id uuid references public.bank_match(id) on delete cascade;
alter table public.customer_invoice_payment add column if not exists settlement_id uuid references public.channel_settlement(id) on delete cascade;
comment on column public.customer_invoice_payment.bank_match_id is 'PC01 · El casado del banco que cobró la factura (su asiento, entry_id, es el del banco). Se va al deshacer el casado.';
comment on column public.customer_invoice_payment.settlement_id is 'PC01 · La liquidación de plataforma que cobró los pedidos de esta factura. Se va al descobrar la liquidación. Su asiento es el de la liquidación.';
create index if not exists customer_invoice_payment_casado_idx on public.customer_invoice_payment (bank_match_id) where bank_match_id is not null;
create index if not exists customer_invoice_payment_liquidacion_idx on public.customer_invoice_payment (settlement_id) where settlement_id is not null;

-- 3 · La factura emitida que cobra un movimiento del banco ---------------------------------
alter table public.bank_match_item add column if not exists customer_invoice_id uuid references public.customer_invoice(id) on delete restrict;
comment on column public.bank_match_item.customer_invoice_id is 'PC01 · La factura emitida que cobra este casado (bank_casar, tipo factura_emitida con «facturas»).';

-- 4 · Cuándo paga una plataforma -------------------------------------------------------------
alter table public.party_role add column if not exists payout_days_after integer check (payout_days_after is null or payout_days_after between 0 and 90);
alter table public.party_role add column if not exists payout_margin_days integer check (payout_margin_days is null or payout_margin_days between 0 and 60);
comment on column public.party_role.payout_days_after is 'PC01 · Plataforma: cuántos días después de cerrar su periodo (settlement_every) paga, más o menos. Uber: 1 (el lunes); Just Eat: 4; Glovo: 20. Lo edita la ficha de Contactos.';
comment on column public.party_role.payout_margin_days is 'PC01 · Plataforma: días de margen sobre el día de pago antes de dar su factura por vencida. Vacío = 5.';

-- 5 · Las facturas de una liquidación, cobradas o a revisar ---------------------------------
alter table public.channel_settlement add column if not exists invoice_match_status text check (invoice_match_status is null or invoice_match_status in ('cobradas', 'a_revisar'));
alter table public.channel_settlement add column if not exists invoice_match_note text;
comment on column public.channel_settlement.invoice_match_status is 'PC01 · Al cobrarla: «cobradas» (sus facturas quedaron cobradas por sus pedidos) o «a_revisar» (no cuadran: no se cobró nada solo). Vacío: sin cobrar.';
comment on column public.channel_settlement.invoice_match_note is 'PC01 · Lo que pasó al cobrar sus facturas, en una frase (regla 8).';

-- 6 · Las funciones del motor ---------------------------------------------------------------

-- El vencimiento de lo vendido el día p_dia por un canal de plataforma: el día
-- de pago que le toca (fin de su periodo + los días que tarda) más el margen.
-- Null si el canal no es de una plataforma con su plazo dicho.
create or replace function public.conta_vence_por_plataforma(p_account uuid, p_channel uuid, p_dia date)
returns date language sql stable set search_path = public as $$
  with r as (
    select settlement_every, payout_days_after, coalesce(payout_margin_days, 5) as margen
      from public.party_role
     where account_id = p_account and role = 'platform' and channel_id = p_channel
       and settlement_every is not null and payout_days_after is not null
     order by created_at limit 1
  )
  select (case r.settlement_every
            -- Semana de lunes a domingo: cierra el domingo.
            when 'weekly' then date_trunc('week', p_dia)::date + 6
            -- Quincenas del 1 al 15 y del 16 a fin de mes.
            when 'fortnightly' then case when extract(day from p_dia) <= 15 then date_trunc('month', p_dia)::date + 14
                                         else (date_trunc('month', p_dia) + interval '1 month')::date - 1 end
            when 'monthly' then (date_trunc('month', p_dia) + interval '1 month')::date - 1
          end) + r.payout_days_after + r.margen
    from r
$$;
comment on function public.conta_vence_por_plataforma(uuid, uuid, date) is 'PC01 · Vencimiento de lo vendido un día por el canal de una plataforma: fin de su periodo + días hasta el pago + margen (5 si no se dice). Null sin plazo.';

-- El de la factura de un cierre (por su asiento). Null si no es de plataforma.
create or replace function public.conta_vence_de_cierre(p_entry uuid)
returns date language sql stable set search_path = public as $$
  select public.conta_vence_por_plataforma(s.account_id, s.channel_id, s.sales_day)
    from public.sales_day_summary s
   where s.entry_id = p_entry and s.channel_id is not null and s.unit_key is not null
   limit 1
$$;

-- El canal de plataforma de una factura emitida: el de su cierre; y si no tiene
-- cierre (las traídas de Diez), el de la plataforma dueña de la 430 de su
-- asiento (company_account_link «customer · principal» → party_role platform).
-- Null si no es de plataforma.
create or replace function public.conta_canal_de_factura(p_invoice uuid)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select r.channel_id from public.customer_invoice ci
       join public.sales_day_summary s on s.entry_id = ci.entry_id and s.company_id = ci.company_id and s.channel_id is not null
       join public.party_role r on r.account_id = ci.account_id and r.role = 'platform' and r.channel_id = s.channel_id
      where ci.id = p_invoice limit 1),
    (select r.channel_id from public.customer_invoice ci
       join public.journal_line jl on jl.entry_id = ci.entry_id and jl.company_id = ci.company_id and jl.debit > 0
       join public.company_account ca on ca.id = jl.company_account_id and ca.code like '430%'
       join public.company_account_link k on k.account_id = ci.account_id and k.company_id = ci.company_id and k.company_account_id = ca.id
                                         and k.entity = 'customer' and k.role = 'principal'
       join public.party_role r on r.account_id = ci.account_id and r.role = 'platform' and r.party_id::text = k.entity_id and r.channel_id is not null
      where ci.id = p_invoice and ci.origin = 'cierre_dia' limit 1))
$$;

-- ¿Es de plataforma esta factura emitida? (su canal tiene una plataforma en Contactos).
create or replace function public.conta_factura_es_de_plataforma(p_invoice uuid)
returns boolean language sql stable set search_path = public as $$
  select public.conta_canal_de_factura(p_invoice) is not null
$$;

-- El vencimiento que le toca a una factura emitida de plataforma (el de su
-- cierre, o, sin cierre, el de su fecha). Null si no es de plataforma o su
-- plataforma no tiene plazo.
create or replace function public.conta_vence_de_factura(p_invoice uuid)
returns date language sql stable set search_path = public as $$
  select public.conta_vence_por_plataforma(ci.account_id, public.conta_canal_de_factura(ci.id),
           coalesce((select s.sales_day from public.sales_day_summary s where s.entry_id = ci.entry_id and s.company_id = ci.company_id and s.channel_id is not null limit 1), ci.issue_date))
    from public.customer_invoice ci where ci.id = p_invoice
$$;

-- Guardar cuándo paga una plataforma (su ficha de Contactos) y que sus
-- facturas por cobrar sigan el plazo nuevo. Las cobradas no se tocan.
create or replace function public.conta_plataforma_plazo_guardar(p_party uuid, p_cada text, p_dias integer, p_margen integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_r public.party_role; v_n int := 0; v_canal text;
begin
  select * into v_r from public.party_role where party_id = p_party and role = 'platform' for update;
  if v_r.id is null or not public.belongs_to_account(v_r.account_id) then raise exception 'Este contacto no está como plataforma.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_r.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia cuándo paga una plataforma.' using errcode = '42501';
  end if;
  if p_cada is not null and p_cada not in ('weekly', 'fortnightly', 'monthly') then raise exception 'El periodo es cada semana, cada quincena o cada mes.' using errcode = '22023'; end if;
  if p_dias is not null and (p_dias < 0 or p_dias > 90) then raise exception 'Los días hasta el pago van de 0 a 90.' using errcode = '22023'; end if;
  if p_margen is not null and (p_margen < 0 or p_margen > 60) then raise exception 'El margen va de 0 a 60 días.' using errcode = '22023'; end if;
  update public.party_role set settlement_every = p_cada, payout_days_after = p_dias, payout_margin_days = p_margen where id = v_r.id;
  if v_r.channel_id is not null then
    with f as (
      select ci.id, public.conta_vence_de_factura(ci.id) v from public.customer_invoice ci
       where ci.account_id = v_r.account_id and ci.status = 'emitida' and ci.origin = 'cierre_dia' and ci.total > 0
         and public.conta_canal_de_factura(ci.id) = v_r.channel_id
         and ci.total - coalesce((select sum(p.amount) from public.customer_invoice_payment p where p.invoice_id = ci.id), 0) >= 0.005)
    update public.customer_invoice ci set due_date = f.v from f where f.id = ci.id and f.v is not null and ci.due_date is distinct from f.v;
    get diagnostics v_n = row_count;
    select name into v_canal from public.sales_channel where id = v_r.channel_id;
  end if;
  return jsonb_build_object('party_id', p_party, 'canal', v_canal, 'facturas', v_n);
end $$;
revoke all on function public.conta_plataforma_plazo_guardar(uuid, text, integer, integer) from public, anon;
grant execute on function public.conta_plataforma_plazo_guardar(uuid, text, integer, integer) to authenticated;
comment on function public.conta_plataforma_plazo_guardar(uuid, text, integer, integer) is 'PC01 · Guarda cuándo paga una plataforma (periodo, días hasta el pago, margen) y recoloca el vencimiento de sus facturas por cobrar. Dice cuántas.';

-- Los pedidos de una liquidación: cada uno con su cierre, su factura y lo que
-- el cierre cuenta de él. Por los pedidos que trae la liquidación, si los trae;
-- si no, por plataforma, local, marca y fechas del periodo (Madrid).
--   via: 'pedidos' o 'periodo'.
create or replace function public.conta_liquidacion_pedidos(p_settlement uuid)
returns table (sale_id uuid, company_id uuid, location_id uuid, sales_day date, summary_id uuid, invoice_id uuid, importe numeric, via text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_cs public.channel_settlement; v_st public.platform_store; v_marca uuid; v_local uuid; v_empresa uuid; d date;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement;
  if v_cs.id is null then return; end if;
  if exists (select 1 from public.channel_settlement_order o where o.settlement_id = v_cs.id and o.account_id = v_cs.account_id) then
    return query
      with v as (
        select distinct o.sale_id from public.channel_settlement_order o
         where o.settlement_id = v_cs.id and o.account_id = v_cs.account_id and o.sale_id is not null
      ), s as (
        select v.sale_id, sm.* from v
          left join public.sales_day_summary sm on sm.account_id = v_cs.account_id and v.sale_id = any(sm.sale_ids) and sm.entry_id is not null
      )
      select s.sale_id, s.company_id, s.location_id, s.sales_day, s.id,
             (select ci.id from public.customer_invoice ci where ci.entry_id = s.entry_id and ci.company_id = s.company_id and ci.status = 'emitida' limit 1),
             (select d2.total from public.conta_pedidos_del_dia(s.company_id, s.location_id, s.sales_day) d2 where d2.id = s.sale_id limit 1),
             'pedidos'::text
        from s;
    return;
  end if;
  select * into v_st from public.platform_store where id = v_cs.store_id and account_id = v_cs.account_id;
  v_marca := coalesce(v_cs.brand_id, v_st.brand_id);
  v_local := coalesce(v_cs.location_id, v_st.location_id);
  v_empresa := v_st.company_id;
  if v_marca is null or v_local is null or v_empresa is null or v_cs.period_from is null or v_cs.period_to is null or v_cs.channel_id is null then return; end if;
  for d in select g::date from generate_series(v_cs.period_from, v_cs.period_to, interval '1 day') g loop
    return query
      select p.id, v_empresa, v_local, d, sm.id,
             (select ci.id from public.customer_invoice ci where ci.entry_id = sm.entry_id and ci.company_id = v_empresa and ci.status = 'emitida' limit 1),
             p.total, 'periodo'::text
        from public.conta_pedidos_del_dia(v_empresa, v_local, d) p
        left join public.sales_day_summary sm on sm.company_id = v_empresa and sm.location_id = v_local and sm.sales_day = d
             and sm.channel_id = v_cs.channel_id and sm.entry_id is not null and p.id = any(sm.sale_ids)
       where p.canal_id = v_cs.channel_id and p.marca_id = v_marca and p.estado = 'closed' and coalesce(p.total, 0) <> 0;
  end loop;
end $$;
revoke all on function public.conta_liquidacion_pedidos(uuid) from public, anon;
grant execute on function public.conta_liquidacion_pedidos(uuid) to authenticated;
comment on function public.conta_liquidacion_pedidos(uuid) is 'PC01 · Los pedidos de una liquidación con su cierre, su factura y lo que el cierre cuenta de cada uno. Solo lee.';

-- Cobra (o descobra) las facturas de una liquidación. Siempre empieza quitando
-- los cobros que esta liquidación hubiera hecho: se puede llamar las veces que
-- haga falta y deja lo mismo.
--   · sin cobrar → nada cobrado, sin estado;
--   · cobrada y todo cuadra → un cobro por factura (lo que su cierre cuenta de
--     los pedidos de la liquidación), «cobradas»;
--   · cobrada y algo no cuadra → nada cobrado, «a_revisar» con el porqué.
create or replace function public._conta_liquidacion_cobros(p_settlement uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cs public.channel_settlement; v_n int; v_esperados int; v_sin_cierre int; v_sin_factura int; v_mal_total text;
        v_pasa text; v_motivo text; v_facturas int := 0; v_total numeric := 0; f record; v_plat text; v_via text; v_res jsonb; v_porque text;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then return jsonb_build_object('liquidacion', p_settlement, 'estado', 'no_existe'); end if;
  select coalesce(name, slug) into v_plat from public.sales_channel where id = v_cs.channel_id;
  if to_regclass('pg_temp._pc01_pedidos') is null then
    create temp table _pc01_pedidos (sale_id uuid, company_id uuid, location_id uuid, sales_day date, summary_id uuid, invoice_id uuid, importe numeric, via text) on commit drop;
    create temp table _pc01_antes (invoice_id uuid, importe numeric) on commit drop;
    create temp table _pc01_ahora (invoice_id uuid, importe numeric, n int) on commit drop;
  end if;
  delete from _pc01_pedidos; delete from _pc01_antes; delete from _pc01_ahora;
  -- Lo que esta liquidación tenía cobrado: se quita siempre, y al final se dice lo que ha cambiado.
  insert into _pc01_antes select invoice_id, sum(amount) from public.customer_invoice_payment where settlement_id = v_cs.id group by invoice_id;
  delete from public.customer_invoice_payment where settlement_id = v_cs.id;

  if v_cs.collected_on is null then
    v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'sin_cobrar');
    v_porque := 'la liquidación ya no está cobrada';
    update public.channel_settlement set invoice_match_status = null, invoice_match_note = null where id = v_cs.id
       and (invoice_match_status is not null or invoice_match_note is not null);
  elsif coalesce(v_cs.flow_type, '') = 'licensed' then
    -- Una liquidación de una marca cedida no cobra facturas tuyas: su dinero es del socio.
    v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'cedida');
    v_porque := 'es de una marca cedida';
    update public.channel_settlement set invoice_match_status = null, invoice_match_note = 'Es de una marca cedida: su dinero es del socio, no cobra facturas tuyas.' where id = v_cs.id;
  else
    insert into _pc01_pedidos select * from public.conta_liquidacion_pedidos(v_cs.id);
    select count(*), count(*) filter (where summary_id is null), count(*) filter (where summary_id is not null and invoice_id is null), max(via)
      into v_n, v_sin_cierre, v_sin_factura, v_via from _pc01_pedidos;
    -- Cuántos tenía que haber: los que dice la liquidación.
    if v_via = 'pedidos' then
      select count(*) into v_esperados from public.channel_settlement_order where settlement_id = v_cs.id and account_id = v_cs.account_id;
    else
      v_esperados := v_cs.orders_count;
    end if;
    if v_n = 0 and v_cs.brand_id is null and v_cs.store_id is not null
       and not exists (select 1 from public.platform_store where id = v_cs.store_id and brand_id is not null) then
      v_motivo := 'su tienda no tiene marca: dísela en Ventas › Liquidaciones y se cobran sus facturas';
    elsif v_n = 0 then
      v_motivo := 'no encuentro sus pedidos en Folvy';
    elsif v_esperados is null then
      v_motivo := format('no dice cuántos pedidos trae, y en Folvy hay %s: no lo doy por bueno a ciegas', v_n);
    elsif v_esperados <> v_n then
      v_motivo := format('trae %s pedidos y en Folvy hay %s', v_esperados, v_n);
    elsif v_sin_cierre > 0 then
      v_motivo := format('%s de sus %s pedidos no están en ningún cierre del día', v_sin_cierre, v_n);
    elsif v_sin_factura > 0 then
      v_motivo := format('%s de sus %s pedidos están en un cierre que aún no tiene factura (sin validar)', v_sin_factura, v_n);
    end if;
    -- Cada factura: lo que suma su cierre por pedido tiene que ser su total (si
    -- no, el reparto no sería el de su cierre), y no se cobra de más.
    if v_motivo is null then
      select string_agg(x.number_text, ', ') into v_mal_total from (
        select ci.number_text from (select distinct p.invoice_id, p.summary_id from _pc01_pedidos p) u
          join public.customer_invoice ci on ci.id = u.invoice_id
          join public.sales_day_summary sm on sm.id = u.summary_id
         where abs(ci.total - coalesce((select sum(d2.total) from public.conta_pedidos_del_dia(sm.company_id, sm.location_id, sm.sales_day) d2 where d2.id = any(sm.sale_ids)), 0)) >= 0.005
      ) x;
      if v_mal_total is not null then v_motivo := format('el cierre de %s no cuenta sus pedidos por su total', v_mal_total); end if;
    end if;
    if v_motivo is null then
      select string_agg(x.number_text, ', ') into v_pasa from (
        select ci.number_text from (select p.invoice_id, sum(p.importe) imp from _pc01_pedidos p group by p.invoice_id) u
          join public.customer_invoice ci on ci.id = u.invoice_id
         where coalesce((select sum(amount) from public.customer_invoice_payment c where c.invoice_id = ci.id), 0) + u.imp > ci.total + 0.005
      ) x;
      if v_pasa is not null then v_motivo := format('cobraría de más %s (ya tiene otros cobros por esos pedidos)', v_pasa); end if;
    end if;

    if v_motivo is not null then
      v_porque := 'la liquidación está a revisar: ' || v_motivo;
      update public.channel_settlement set invoice_match_status = 'a_revisar',
             invoice_match_note = 'A revisar: ' || v_motivo || '. No he cobrado ninguna factura.' where id = v_cs.id;
      v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'a_revisar', 'motivo', v_motivo, 'pedidos', v_n, 'esperados', v_esperados);
    else
      insert into _pc01_ahora select p.invoice_id, round(sum(p.importe), 2), count(*) from _pc01_pedidos p group by p.invoice_id;
      for f in select * from _pc01_ahora loop
        insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, settlement_id, created_by, created_by_name)
        select ci.account_id, ci.company_id, ci.id, v_cs.collected_on, f.importe, 'plataforma',
               format('%s pedido%s de la liquidación de %s del %s al %s', f.n, case when f.n = 1 then '' else 's' end, coalesce(v_plat, 'la plataforma'),
                      to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY')),
               v_cs.id, v_cs.collected_by, coalesce(v_cs.collected_by_name, 'Sumied · liquidación')
          from public.customer_invoice ci where ci.id = f.invoice_id;
        -- El historial, solo si cambia (volver a mirar una liquidación no lo repite).
        if not exists (select 1 from _pc01_antes a where a.invoice_id = f.invoice_id and a.importe = f.importe) then
          perform public._conta_venta_evento(f.invoice_id, 'cobro',
            format('Cobrados %s de %s pedido%s por la liquidación de %s del %s al %s.', public.conta_euros_exactos(f.importe), f.n, case when f.n = 1 then '' else 's' end,
                   coalesce(v_plat, 'la plataforma'), to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY')),
            jsonb_build_object('liquidacion', v_cs.id), coalesce(v_cs.collected_by_name, 'Sumied · liquidación'));
        end if;
        v_facturas := v_facturas + 1; v_total := v_total + f.importe;
      end loop;
      update public.channel_settlement set invoice_match_status = 'cobradas',
             invoice_match_note = format('Cobradas %s factura%s por %s (%s pedido%s).', v_facturas, case when v_facturas = 1 then '' else 's' end,
                                         public.conta_euros_exactos(v_total), v_n, case when v_n = 1 then '' else 's' end) where id = v_cs.id;
      v_res := jsonb_build_object('liquidacion', v_cs.id, 'estado', 'cobradas', 'facturas', v_facturas, 'importe', v_total, 'pedidos', v_n);
    end if;
  end if;

  -- Lo que tenía cobrado y ya no: se dice en su factura.
  for f in select a.* from _pc01_antes a where not exists (select 1 from _pc01_ahora n where n.invoice_id = a.invoice_id) loop
    perform public._conta_venta_evento(f.invoice_id, 'cobro_deshecho',
      format('Quitado el cobro de %s de la liquidación de %s del %s al %s: %s.', public.conta_euros_exactos(f.importe), coalesce(v_plat, 'la plataforma'),
             to_char(v_cs.period_from, 'DD/MM'), to_char(v_cs.period_to, 'DD/MM/YYYY'), coalesce(v_porque, 'ha cambiado')),
      jsonb_build_object('liquidacion', v_cs.id), coalesce(v_cs.collected_by_name, 'Sumied · liquidación'));
  end loop;
  return v_res;
end $$;
revoke all on function public._conta_liquidacion_cobros(uuid) from public, anon, authenticated;
comment on function public._conta_liquidacion_cobros(uuid) is 'PC01 · Cobra las facturas de una liquidación cobrada por lo que su cierre cuenta de sus pedidos, o la deja «a revisar». Quita antes lo que hubiera cobrado: se puede repetir.';

-- Lo que harán los disparadores de la 0917 (aquí, nuevas; los disparadores, allí).

-- Liquidación: al cobrarla o descobrarla, sus facturas.
create or replace function public._pc01_liquidacion_cobrada()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.collected_on is null then return null; end if;
  if tg_op = 'UPDATE' and new.collected_on is not distinct from old.collected_on and new.collected_amount is not distinct from old.collected_amount then return null; end if;
  perform public._conta_liquidacion_cobros(new.id);
  return null;
end $$;
revoke all on function public._pc01_liquidacion_cobrada() from public, anon, authenticated;

-- Tienda de plataforma: si cambia su marca o su local, sus liquidaciones cobradas se vuelven a mirar.
create or replace function public._pc01_tienda_cambiada()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if new.brand_id is not distinct from old.brand_id and new.location_id is not distinct from old.location_id then return null; end if;
  for v in select id from public.channel_settlement where store_id = new.id and account_id = new.account_id and collected_on is not null loop
    perform public._conta_liquidacion_cobros(v);
  end loop;
  return null;
end $$;
revoke all on function public._pc01_tienda_cambiada() from public, anon, authenticated;

-- Factura de un cierre: su vencimiento (el de su plataforma), y al nacer, las
-- liquidaciones cobradas que esperaban su factura se vuelven a mirar.
create or replace function public._pc01_factura_cierre_vence()
returns trigger language plpgsql security definer set search_path = public as $$
declare v date;
begin
  if new.origin = 'cierre_dia' and new.entry_id is not null then
    v := public.conta_vence_de_cierre(new.entry_id);
    if v is not null then new.due_date := v; end if;
  end if;
  return new;
end $$;
revoke all on function public._pc01_factura_cierre_vence() from public, anon, authenticated;

create or replace function public._pc01_factura_cierre_nace()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_s public.sales_day_summary; v uuid;
begin
  if new.origin <> 'cierre_dia' or new.entry_id is null or new.status <> 'emitida' then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'emitida' then return null; end if;
  select * into v_s from public.sales_day_summary where entry_id = new.entry_id and company_id = new.company_id limit 1;
  if v_s.id is null or v_s.channel_id is null then return null; end if;
  for v in select cs.id from public.channel_settlement cs
            where cs.account_id = new.account_id and cs.channel_id = v_s.channel_id and cs.collected_on is not null
              and cs.invoice_match_status = 'a_revisar' and v_s.sales_day between cs.period_from and cs.period_to loop
    perform public._conta_liquidacion_cobros(v);
  end loop;
  return null;
end $$;
revoke all on function public._pc01_factura_cierre_nace() from public, anon, authenticated;

-- Recibida: al validarla sin vencimiento, el plazo del proveedor
-- (supplier.payment_terms_days) sumado a la fecha de la factura. Sin plazo, se
-- queda sin vencimiento.
create or replace function public._pc01_recibida_vence()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dias integer;
begin
  if new.status <> 'aprobada' or new.due_date is not null or new.invoice_date is null or new.supplier_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'aprobada' then return new; end if;
  select payment_terms_days into v_dias from public.supplier where id = new.supplier_id and account_id = new.account_id;
  if v_dias is null then return new; end if;
  new.due_date := new.invoice_date + v_dias;
  new.due_date_set_name := 'Sumied · plazo del proveedor (' || v_dias || ' días)';
  new.due_date_set_at := now();
  return new;
end $$;
revoke all on function public._pc01_recibida_vence() from public, anon, authenticated;

-- Recibida pagada con el saldo prepago de Catcher: cuando el pago del lote
-- (conta_lote_pago_proponer, asiento supplier_payment) le pone su asiento, ese
-- es su pago; y si está aprobada, queda pagada.
create or replace function public._pc01_recibida_pago_lote()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e public.journal_entry;
begin
  if new.payment_entry_id is null or new.payment_entry_id is not distinct from old.payment_entry_id then return null; end if;
  select * into v_e from public.journal_entry where id = new.payment_entry_id;
  if v_e.id is null or v_e.source_type <> 'supplier_payment' or v_e.status not in ('propuesto', 'borrador', 'validado') then return null; end if;
  if coalesce(new.grand_total, 0) = 0 or exists (select 1 from public.supplier_invoice_payment where invoice_id = new.id and entry_id = v_e.id) then return null; end if;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, created_by, created_by_name)
  values (new.account_id, coalesce(new.company_id, v_e.company_id), new.id, v_e.entry_date, coalesce(new.grand_total, 0), 'prepaid',
          'Pagada del saldo prepago de Catcher con el pago de su lote', v_e.id, auth.uid(), coalesce(v_e.created_by_name, 'Sumied · lote'));
  if new.status = 'aprobada' then
    perform public.mark_supplier_invoice_paid(new.id, v_e.entry_date, 'prepaid');
  end if;
  return null;
end $$;
revoke all on function public._pc01_recibida_pago_lote() from public, anon, authenticated;

-- Casado del banco: lo que paga o cobra, a su tabla de pagos o de cobros.
create or replace function public._pc01_casado_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_b public.bank_match; v_m public.bank_movement; v_metodo text;
begin
  if new.supplier_invoice_id is null and new.customer_invoice_id is null then return null; end if;
  select * into v_b from public.bank_match where id = new.match_id;
  select * into v_m from public.bank_movement where id = v_b.movement_id;
  v_metodo := case when v_m.common_code = '03' or v_m.bank_concept ~* 'RECIBO|ADEUDO|DOMICILIA' then 'direct_debit' else 'transfer' end;
  if new.supplier_invoice_id is not null then
    insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, bank_match_id, created_by, created_by_name)
    values (new.account_id, v_b.company_id, new.supplier_invoice_id, v_m.op_date, abs(new.amount), v_metodo,
            'Casado en Bancos con el movimiento del ' || to_char(v_m.op_date, 'DD/MM/YYYY'), v_b.journal_entry_id, v_b.id, v_b.created_by, v_b.created_by_name)
    on conflict (bank_match_id, invoice_id) where bank_match_id is not null do update set amount = supplier_invoice_payment.amount + excluded.amount;
  end if;
  if new.customer_invoice_id is not null then
    insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, bank_match_id, created_by, created_by_name)
    values (new.account_id, v_b.company_id, new.customer_invoice_id, v_m.op_date, abs(new.amount), v_metodo,
            'Casado en Bancos con el movimiento del ' || to_char(v_m.op_date, 'DD/MM/YYYY'), v_b.journal_entry_id, v_b.id, v_b.created_by, v_b.created_by_name);
    perform public._conta_venta_evento(new.customer_invoice_id, 'cobro',
      format('Cobrados %s casando en Bancos el movimiento del %s.', public.conta_euros_exactos(abs(new.amount)), to_char(v_m.op_date, 'DD/MM/YYYY')),
      jsonb_build_object('casado', v_b.id, 'asiento', v_b.journal_entry_id), v_b.created_by_name);
  end if;
  return null;
end $$;
revoke all on function public._pc01_casado_item() from public, anon, authenticated;

-- Casado deshecho: sus pagos y cobros se van (bank_deshacer marca después la
-- factura recibida como no pagada, si lo estaba por el banco).
create or replace function public._pc01_casado_deshecho()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status <> 'deshecho' or old.status = 'deshecho' then return null; end if;
  delete from public.supplier_invoice_payment where bank_match_id = new.id;
  for r in delete from public.customer_invoice_payment where bank_match_id = new.id returning invoice_id, amount loop
    perform public._conta_venta_evento(r.invoice_id, 'cobro_deshecho',
      format('Cobro de %s deshecho en Bancos: %s.', public.conta_euros_exactos(r.amount), coalesce(new.undo_reason, 'sin motivo')),
      jsonb_build_object('casado', new.id), new.undone_by_name);
  end loop;
  return null;
end $$;
revoke all on function public._pc01_casado_deshecho() from public, anon, authenticated;

-- 7 · Los estados, en un solo sitio -----------------------------------------------------------

-- El día de hoy en Madrid (regla 4: nada de horario en UTC).
create or replace function public.conta_hoy()
returns date language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Madrid')::date $$;

-- Emitidas. estado: borrador · anulada · emitida (rectificativa o a cero, no se
-- cobra) · cobrada · vencida · cobrada_parte · esperando_liquidacion ·
-- vence_semana · por_cobrar. Cobrado y pendiente al céntimo.
create or replace view public.conta_factura_cobro with (security_invoker = true) as
  with c as (
    select ci.id, ci.account_id, ci.company_id, ci.status, ci.total, ci.due_date,
           coalesce((select sum(p.amount) from public.customer_invoice_payment p where p.invoice_id = ci.id), 0)::numeric(14,2) as cobrado,
           public.conta_factura_es_de_plataforma(ci.id) as de_plataforma
      from public.customer_invoice ci
  )
  select c.id as invoice_id, c.account_id, c.company_id, c.total, c.cobrado,
         (c.total - c.cobrado)::numeric(14,2) as pendiente, c.due_date as vence, c.de_plataforma,
         case
           when c.status = 'borrador' then 'borrador'
           when c.status = 'anulada' then 'anulada'
           when c.total < 0 then case when abs(c.total - c.cobrado) < 0.005 then 'cobrada' else 'emitida' end
           when c.total = 0 then 'emitida'
           when c.total - c.cobrado < 0.005 then 'cobrada'
           when c.due_date is not null and c.due_date < public.conta_hoy() then 'vencida'
           when c.cobrado > 0 then 'cobrada_parte'
           when c.de_plataforma then 'esperando_liquidacion'
           when c.due_date is not null and c.due_date <= public.conta_hoy() + 7 then 'vence_semana'
           else 'por_cobrar'
         end as estado,
         case when c.due_date is not null and c.due_date < public.conta_hoy() and c.total - c.cobrado >= 0.005 and c.status = 'emitida'
              then public.conta_hoy() - c.due_date end as dias_vencida
    from c;
comment on view public.conta_factura_cobro is 'PC01 · El estado de cobro de cada factura emitida, calculado en un solo sitio. Lo leen todas las pantallas.';
grant select on public.conta_factura_cobro to authenticated;

-- Recibidas. estado: lo de la factura si no está validada (en_revision,
-- anulada…) · pagada · vencida · pagada_parte · sin_vencimiento · vence_semana
-- · por_pagar.
create or replace view public.conta_recibida_pago with (security_invoker = true) as
  with p as (
    select si.id, si.account_id, si.company_id, si.status, coalesce(si.grand_total, 0) as total, si.due_date,
           coalesce((select sum(x.amount) from public.supplier_invoice_payment x where x.invoice_id = si.id), 0)::numeric(14,2) as pagado
      from public.supplier_invoice si
  )
  select p.id as invoice_id, p.account_id, p.company_id, p.total, p.pagado,
         greatest(p.total - p.pagado, 0)::numeric(14,2) as pendiente, p.due_date as vence,
         case
           when p.status = 'pagada' then 'pagada'
           when p.status <> 'aprobada' then p.status
           when p.total - p.pagado < 0.005 then 'pagada'
           when p.due_date is not null and p.due_date < public.conta_hoy() then 'vencida'
           when p.pagado > 0 then 'pagada_parte'
           when p.due_date is null then 'sin_vencimiento'
           when p.due_date <= public.conta_hoy() + 7 then 'vence_semana'
           else 'por_pagar'
         end as estado,
         case when p.status = 'aprobada' and p.due_date is not null and p.due_date < public.conta_hoy() and p.total - p.pagado >= 0.005
              then public.conta_hoy() - p.due_date end as dias_vencida
    from p;
comment on view public.conta_recibida_pago is 'PC01 · El estado de pago de cada factura recibida, calculado en un solo sitio. Lo leen todas las pantallas.';
grant select on public.conta_recibida_pago to authenticated;
