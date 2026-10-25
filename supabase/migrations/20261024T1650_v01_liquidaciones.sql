-- supabase/migrations/20261024T1650_v01_liquidaciones.sql
--
-- V01 · Entrega 3 · Ventas › Hostelería › Liquidaciones (Julio, 24/10). Se
-- construye encima de lo que ya hay (channel_settlement, sus tiendas, su
-- factura de comisión, el cobro casado en Bancos; licensed_settlement y su
-- lectura de los documentos del socio) y solo AÑADE:
--
--   1. conta_liquidacion_resolucion: cómo se resolvió una diferencia de una
--      liquidación de plataforma, en una frase: «gasto» (con su asiento) o
--      «reclamación» (a la plataforma; no hay asiento). Por periodo, plataforma
--      y local, o por pedido (los cerrados sin confirmar del C11b que la
--      liquidación no cobra).
--   2. conta_plataformas: las liquidaciones de plataforma de la empresa, por
--      periodo, plataforma y local, con lo que hace falta para decidir su
--      estado: las ventas de sus cierres, las de las marcas cedidas (las paga
--      la plataforma, pero no son ventas de la empresa), la comisión, lo demás
--      que se queda, lo que pagan, lo que llegó al banco, su factura de
--      comisión, su asiento, los pedidos cerrados sin confirmar que no cobra y
--      lo ya resuelto. El estado (Cuadra · Por cobrar · Falta su factura ·
--      Diferencia) lo decide el navegador con estas cifras
--      (lib/liquidacionesPlataforma.ts), con sus pruebas.
--   3. conta_plataforma_resolver: resolver una diferencia. Un gasto hace su
--      asiento (el que prepara el navegador: la cuenta de gasto contra la 430
--      de la plataforma) y lo valida; una reclamación de un pedido lo saca del
--      aviso del C11b (journal_dismissal, como «Se cobró por otro lado»).
--
-- No cambia ninguna función ni tabla que ya exista, y se puede pasar dos veces.
-- Nombres que no empiezan por sales_ a propósito: no son del camino del pedido.
--
-- Vuelta atrás: supabase/vuelta-atras/20261024T1650_v01_liquidaciones.down.sql

-- 1 · Cómo se resolvió una diferencia --------------------------------------------------------
create table if not exists public.conta_liquidacion_resolucion (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  channel_id       uuid not null,
  location_id      uuid,
  period_from      date not null,
  period_to        date not null,
  -- Un pedido cerrado sin confirmar que la liquidación no cobra (C11b); nulo,
  -- la diferencia de la liquidación entera. Sin clave ajena a sale a propósito:
  -- una clave ajena nueva cierra sale un instante, y sale es el camino del pedido.
  sale_id          uuid,
  kind             text not null check (kind in ('gasto', 'reclamacion')),
  importe          numeric(12, 2) not null,
  frase            text not null check (btrim(frase) <> ''),
  entry_id         uuid references public.journal_entry(id),
  created_at       timestamptz not null default now(),
  created_by       uuid,
  created_by_name  text,
  check (period_to >= period_from)
);
comment on table public.conta_liquidacion_resolucion is
  'V01 · Entrega 3. Cómo se resolvió una diferencia de una liquidación de plataforma (por periodo, plataforma y local, o por pedido del C11b): gasto (con su asiento) o reclamación.';
create unique index if not exists conta_liquidacion_resolucion_uq on public.conta_liquidacion_resolucion
  (company_id, channel_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), period_from, period_to,
   coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid));
alter table public.conta_liquidacion_resolucion enable row level security;
grant select on public.conta_liquidacion_resolucion to authenticated;
drop policy if exists conta_liquidacion_resolucion_leer on public.conta_liquidacion_resolucion;
create policy conta_liquidacion_resolucion_leer on public.conta_liquidacion_resolucion for select to authenticated using (public.belongs_to_account(account_id));

-- 2 · Las liquidaciones de plataforma, por periodo, plataforma y local -------------------------
-- De la empresa: las de sus tiendas y las que no dicen tienda (subidas a mano o
-- por correo sin asignar: regla 7, no se esconden). El local, el de la
-- liquidación o el de su tienda; si no se sabe, el grupo va sin local (y el
-- navegador lo dice: sin local no se pueden comparar las ventas).
create or replace function public.conta_plataformas(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_r jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  with liq as (
    select cs.*, ps.external_text as tienda, coalesce(cs.location_id, ps.location_id) as local_id,
           coalesce(cs.period_from, cs.proposed_period_from, cs.settlement_date) as desde,
           coalesce(cs.period_to, cs.proposed_period_to, cs.settlement_date) as hasta
      from public.channel_settlement cs
      left join public.platform_store ps on ps.id = cs.store_id and ps.account_id = v_cuenta
     where cs.account_id = v_cuenta and cs.channel_id is not null
       and (ps.id is null or ps.company_id = p_company)
  ), sel as (
    select * from liq
     where desde is not null and (p_hasta is null or desde <= p_hasta) and (p_desde is null or hasta >= p_desde)
  ), grupos as (
    select channel_id, local_id, desde, hasta from sel group by 1, 2, 3, 4
  ), sinconf as (
    select x.sale_id, x.location_id, x.dia, x.codigo, x.canal_id, x.total from public.conta_sin_confirmar_no_cobrados(p_company) x
  )
  select coalesce(jsonb_agg(g.j order by g.hasta desc, g.canal, g.local nulls last), '[]'::jsonb) into v_r from (
    select gr.hasta, ch.name as canal, l.name as local, jsonb_build_object(
      'canal_id', gr.channel_id, 'canal', coalesce(ch.name, 'Plataforma'), 'local_id', gr.local_id, 'local', l.name,
      'desde', gr.desde, 'hasta', gr.hasta,
      'liquidaciones', (
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'tienda', s.tienda, 'ref', s.settlement_ref, 'fecha', s.settlement_date, 'pedidos', s.orders_count,
                 'ventas', s.gross_sales, 'comision', abs(coalesce(s.commission, 0)), 'neto', s.net_payout,
                 'deuda', s.accumulated_debt, 'cobrado', s.collected_amount, 'cobrado_el', s.collected_on,
                 'referencia', coalesce(s.is_reference, false), 'por_aclarar', case when s.needs_review and not coalesce(s.is_reference, false) then s.review_note end,
                 'a_facturar', nullif((s.raw->'factura'->>'total')::numeric, 0),
                 'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'numero', si.invoice_number, 'base', si.tax_base_total, 'total', si.grand_total, 'estado', si.status) end,
                 'casada_en_banco', exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                                              where i.channel_settlement_id = s.id and b.status = 'vivo'),
                 'asiento', (select jsonb_build_object('id', e.id, 'estado', e.status, 'numero', e.number)
                               from public.journal_entry e where e.company_id = p_company and e.source_type = 'channel_settlement'
                                and e.source_id = s.id and e.status <> 'anulado' order by e.created_at desc limit 1))
               order by s.settlement_date, s.tienda)
          from sel s left join public.supplier_invoice si on si.id = s.commission_invoice_id and si.account_id = v_cuenta
         where s.channel_id = gr.channel_id and s.local_id is not distinct from gr.local_id and s.desde = gr.desde and s.hasta = gr.hasta),
      -- Las ventas de sus cierres (marcas propias), de ese canal, ese local y esos días.
      'cierres', (
        select jsonb_build_object('total', coalesce(sum(d.total), 0), 'dias', count(distinct d.sales_day),
                                  'validados', count(*) filter (where e.status = 'validado'), 'por_validar', count(*) filter (where e.status in ('propuesto', 'borrador')))
          from public.sales_day_summary d left join public.journal_entry e on e.id = d.entry_id
         where gr.local_id is not null and d.company_id = p_company and d.channel_id = gr.channel_id and d.location_id = gr.local_id
           and d.sales_day between gr.desde and gr.hasta and coalesce(e.status, 'propuesto') <> 'anulado'),
      -- Las de las marcas cedidas: la plataforma las paga, pero no son ventas de la empresa.
      'cedidas', (
        select jsonb_build_object('total', coalesce(sum(s.total), 0), 'pedidos', count(*))
          from public.sale s join public.brand b on b.id = s.brand_id and b.account_id = v_cuenta and b.ownership_type = 'licensed'
         where gr.local_id is not null and s.account_id = v_cuenta and s.channel_id = gr.channel_id and s.location_id = gr.local_id
           and s.status = 'closed' and coalesce(s.is_active, true)
           and (s.sold_at at time zone 'Europe/Madrid')::date between gr.desde and gr.hasta),
      -- Los cerrados sin confirmar que la liquidación no cobra (C11b): los que
      -- siguen en el aviso, y los ya resueltos aquí (regla 7: no desaparecen).
      'sin_confirmar', coalesce((
        select jsonb_agg(jsonb_build_object('sale_id', x.sale_id, 'codigo', x.codigo, 'dia', x.dia, 'total', x.total) order by x.dia, x.codigo)
          from sinconf x
         where x.canal_id = gr.channel_id and x.location_id is not distinct from gr.local_id and x.dia between gr.desde and gr.hasta), '[]'::jsonb),
      'resoluciones', coalesce((
        select jsonb_agg(jsonb_build_object('id', r.id, 'sale_id', r.sale_id, 'tipo', r.kind, 'importe', r.importe, 'frase', r.frase,
                                            'asiento_id', r.entry_id, 'quien', r.created_by_name, 'cuando', r.created_at,
                                            'codigo', (select coalesce(s.platform_order_code, s.pos_short_code, s.external_ref) from public.sale s where s.id = r.sale_id and s.account_id = v_cuenta),
                                            'dia', (select (s.sold_at at time zone 'Europe/Madrid')::date from public.sale s where s.id = r.sale_id and s.account_id = v_cuenta),
                                            'total', (select s.total from public.sale s where s.id = r.sale_id and s.account_id = v_cuenta))
               order by r.created_at)
          from public.conta_liquidacion_resolucion r
         where r.company_id = p_company and r.channel_id = gr.channel_id and r.location_id is not distinct from gr.local_id
           and r.period_from = gr.desde and r.period_to = gr.hasta), '[]'::jsonb)
    ) as j
      from grupos gr
      left join public.sales_channel ch on ch.id = gr.channel_id and ch.account_id = v_cuenta
      left join public.locations l on l.id = gr.local_id and l.account_id = v_cuenta
  ) g;
  return v_r;
end $$;
revoke all on function public.conta_plataformas(uuid, date, date) from public, anon;
grant execute on function public.conta_plataformas(uuid, date, date) to authenticated;

-- 3 · Resolver una diferencia, en una frase ----------------------------------------------------
-- p_lineas: el asiento de un gasto, como lo prepara el navegador (la cuenta de
-- gasto contra la 430 de la plataforma, por el importe). Se propone y se valida
-- aquí, en la misma transacción. Una reclamación no lleva asiento.
create or replace function public.conta_plataforma_resolver(
  p_company uuid, p_canal uuid, p_local uuid, p_desde date, p_hasta date, p_pedido uuid,
  p_tipo text, p_importe numeric, p_frase text, p_fecha date default null, p_lineas jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor()); v_r jsonb; v_entry uuid; v_val jsonb;
  v_id uuid; v_canal text; v_frase text := btrim(coalesce(p_frase, ''));
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'Solo un administrador o un encargado de la cuenta resuelve diferencias.' using errcode = '42501';
  end if;
  if p_tipo not in ('gasto', 'reclamacion') then raise exception 'Una diferencia se resuelve como gasto o como reclamación.' using errcode = '22023'; end if;
  if v_frase = '' then raise exception 'Escribe en una frase por qué.' using errcode = '22023'; end if;
  if p_importe is null or p_importe = 0 then raise exception 'La diferencia tiene que tener importe.' using errcode = '22023'; end if;
  select name into v_canal from public.sales_channel where id = p_canal and account_id = v_cuenta;
  if v_canal is null then raise exception 'Esa plataforma no es de la cuenta.' using errcode = '23514'; end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_cuenta) then
    raise exception 'Ese local no es de la cuenta.' using errcode = '23514';
  end if;
  if p_pedido is not null and not exists (select 1 from public.sale where id = p_pedido and account_id = v_cuenta and channel_id = p_canal) then
    raise exception 'Ese pedido no es de esa plataforma.' using errcode = '23514';
  end if;
  if exists (select 1 from public.conta_liquidacion_resolucion r
              where r.company_id = p_company and r.channel_id = p_canal and r.location_id is not distinct from p_local
                and r.period_from = p_desde and r.period_to = p_hasta and r.sale_id is not distinct from p_pedido) then
    raise exception 'Esa diferencia ya está resuelta.' using errcode = '23505';
  end if;
  -- Un gasto de la liquidación entera: su asiento, validado.
  if p_tipo = 'gasto' and p_pedido is null then
    if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then
      raise exception 'Un gasto lleva su asiento.' using errcode = '22023';
    end if;
    v_r := public._journal_entry_proponer(p_company,
      jsonb_build_object('series', 1, 'fecha', coalesce(p_fecha, p_hasta), 'source_type', 'manual',
        'concepto', 'Diferencia de la liquidación de ' || v_canal || ' (' || to_char(p_desde, 'DD/MM') || '–' || to_char(p_hasta, 'DD/MM/YYYY') || '): ' || v_frase,
        'confianza', 'seguro', 'porque', 'Diferencia resuelta como gasto en Ventas › Liquidaciones.'),
      p_lineas, null, v_quien, auth.uid());
    v_entry := (v_r->>'id')::uuid;
    v_val := public.journal_entry_validar(v_entry, v_quien);
  end if;
  -- Un pedido reclamado (o dado por gasto: su devolución la propone el
  -- navegador al libro, como en Lo que deja el cierre del día) sale del aviso del C11b.
  if p_pedido is not null then
    insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by, created_by_name)
    select v_cuenta, p_company, 'sales_adjustment', p_pedido::text,
           case p_tipo when 'reclamacion' then 'Reclamado a ' || v_canal || ': ' else 'Gasto (su devolución, al libro): ' end || v_frase, auth.uid(), v_quien
     where not exists (select 1 from public.journal_dismissal d where d.company_id = p_company and d.source_type = 'sales_adjustment' and d.source_key = p_pedido::text);
  end if;
  insert into public.conta_liquidacion_resolucion (account_id, company_id, channel_id, location_id, period_from, period_to, sale_id, kind, importe, frase,
                                                   entry_id, created_by, created_by_name)
  values (v_cuenta, p_company, p_canal, p_local, p_desde, p_hasta, p_pedido, p_tipo, round(p_importe, 2), v_frase, v_entry, auth.uid(), v_quien)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'asiento', v_entry, 'numero_asiento', v_val->'numero');
end $$;
revoke all on function public.conta_plataforma_resolver(uuid, uuid, uuid, date, date, uuid, text, numeric, text, date, jsonb, text) from public, anon;
grant execute on function public.conta_plataforma_resolver(uuid, uuid, uuid, date, date, uuid, text, numeric, text, date, jsonb, text) to authenticated;
