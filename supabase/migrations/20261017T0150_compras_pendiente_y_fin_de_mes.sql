-- ============================================================================
-- Compras · 6 · LO QUE ESPERA FACTURA, CASAR LA FACTURA Y EL FIN DE MES
-- ----------------------------------------------------------------------------
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261017_compras_fin_de_mes_prueba.sql
--
-- Encargo «Contabilidad: las compras», §2.4 y §4.4 (10/10). Para el proveedor
-- que entrega con albarán y factura después:
--
-- 1 · «Qué está esperando factura» (compras_esperando_factura): por
--     proveedor y local, cuántas recepciones, cuánto y desde cuándo. Sin
--     umbral: ordena, no esconde (regla 7).
--
-- 2 · Casar: cuando llega su factura, compras_casar_candidatos propone con
--     qué recepciones casa —mismo proveedor; mismo local si factura por
--     local; recibidas hasta la fecha de la factura— y la diferencia. Las
--     propone TODAS las que esperan (lo normal es que la factura las cubra), y
--     la persona quita las que no. compras_casar las enlaza, deja la diferencia
--     en match_status y las saca de «esperando». El asiento sale de la
--     factura, no de los albaranes.
--
-- 3 · Al cerrar el mes, UN asiento por proveedor y local por lo recibido y no
--     facturado, y su contrario el día 1 (lo propone el libro: origen
--     purchase_accrual y purchase_accrual_reversal). purchase_accrual guarda
--     de qué recepciones sale cada uno. Cuenta: «no facturado» a fin de mes es
--     lo que no tiene factura, o la tiene con fecha del mes siguiente.
--
-- La base de una recepción (_compras_base_recepcion): la base del papel; si
-- no la trae, la suma de sus líneas leídas; si tampoco, cantidad × coste de
-- las líneas de la recepción. Si no hay ninguna, no se inventa: se dice.
--
-- Amplía el CHECK de journal_entry.source_type con dos orígenes (solo añade).
-- No toca stock ni coste.
-- Vuelta atrás: supabase/vuelta-atras/20261017T0150_compras_pendiente_y_fin_de_mes.down.sql
-- ============================================================================

-- ── 1 · Dos orígenes de asiento ────────────────────────────────────────────
alter table public.journal_entry drop constraint if exists journal_entry_source_type_check;
alter table public.journal_entry add constraint journal_entry_source_type_check
  check (source_type in ('sales_day', 'sales_adjustment', 'supplier_invoice', 'supplier_payment', 'channel_settlement',
                         'licensed_settlement', 'payroll', 'bank', 'vat_settlement', 'manual', 'template', 'reversal',
                         'opening', 'closing', 'migrated', 'purchase_accrual', 'purchase_accrual_reversal'));

-- ── 2 · Lo recibido y no facturado de un mes ───────────────────────────────
create table if not exists public.purchase_accrual (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  supplier_id  uuid not null references public.supplier(id),
  location_id  uuid references public.locations(id),
  month        date not null constraint purchase_accrual_mes check (month = date_trunc('month', month)::date),
  base         numeric not null,
  receipts     jsonb not null default '[]'::jsonb,
  without_base int not null default 0,
  computed_at  timestamptz not null default now(),
  constraint purchase_accrual_uno unique nulls not distinct (company_id, supplier_id, location_id, month)
);
comment on table public.purchase_accrual is
  'Compras (10/10). Lo recibido y no facturado al cierre de un mes, por proveedor y local: su base y de qué recepciones sale (receipts: id, código, fecha, base). Es el origen de los asientos purchase_accrual (fin de mes) y purchase_accrual_reversal (su contrario el día 1).';
create index if not exists purchase_accrual_cuenta on public.purchase_accrual (account_id, month);
alter table public.purchase_accrual enable row level security;
drop policy if exists purchase_accrual_select on public.purchase_accrual;
create policy purchase_accrual_select on public.purchase_accrual for select using ((select belongs_to_account(account_id)));

-- ── 3 · La base de una recepción ───────────────────────────────────────────
create or replace function public._compras_base_recepcion(p_recepcion uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when jsonb_typeof(a.parsed_result->'document'->'tax_base_total') = 'number' then (a.parsed_result->'document'->>'tax_base_total')::numeric end
       from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id where g.id = p_recepcion),
    (select sum((l->>'line_amount')::numeric)
       from goods_receipt g join goods_receipt_ai_session a on a.id = g.ai_session_id,
            jsonb_array_elements(coalesce(a.parsed_result->'lines', '[]'::jsonb)) l
      where g.id = p_recepcion and jsonb_typeof(l->'line_amount') = 'number'),
    (select round(sum(gl.qty_received * gl.unit_cost), 2) from goods_receipt_line gl
      where gl.goods_receipt_id = p_recepcion and gl.unit_cost is not null and gl.qty_received is not null))
$$;
revoke all on function public._compras_base_recepcion(uuid) from public, anon, authenticated;

-- ── 4 · Qué está esperando factura ─────────────────────────────────────────
create or replace function public.compras_esperando_factura(p_cuenta uuid)
returns table (supplier_id uuid, supplier_name text, location_id uuid, location_name text, receipts int, base numeric,
               without_base int, oldest date, newest date, per_location boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select belongs_to_account(p_cuenta)) then raise exception 'Esa cuenta no es tuya.' using errcode = '42501'; end if;
  return query
  select g.supplier_id, s.name, g.location_id, l.name, count(*)::int,
         coalesce(sum(public._compras_base_recepcion(g.id)), 0), count(*) filter (where public._compras_base_recepcion(g.id) is null)::int,
         min(g.receipt_date), max(g.receipt_date), coalesce(s.invoicing_per_location, false)
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    join supplier s on s.id = g.supplier_id left join locations l on l.id = g.location_id
   where p.account_id = p_cuenta and p.path = 'pendiente_factura' and p.consumed_at is null and g.status = 'confirmado'
   group by g.supplier_id, s.name, g.location_id, l.name, s.invoicing_per_location
   order by min(g.receipt_date), s.name;
end $$;
revoke all on function public.compras_esperando_factura(uuid) from public, anon;
grant execute on function public.compras_esperando_factura(uuid) to authenticated;

-- ── 5 · Casar una factura con sus recepciones ──────────────────────────────
create or replace function public.compras_casar_candidatos(p_factura uuid)
returns table (goods_receipt_id uuid, code text, receipt_date date, location_id uuid, base numeric, proposed boolean)
language plpgsql stable security definer set search_path = public as $$
declare f supplier_invoice; v_por_local boolean;
begin
  select * into f from supplier_invoice where id = p_factura;
  if f.id is null or not (select belongs_to_account(f.account_id)) then raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501'; end if;
  select coalesce(invoicing_per_location, false) into v_por_local from supplier where id = f.supplier_id;
  return query
  select g.id, g.code, g.receipt_date, g.location_id, public._compras_base_recepcion(g.id),
         -- Propuesta: las que esperan, del local de la factura si factura por local.
         (not v_por_local or f.location_id is null or g.location_id = f.location_id)
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
   where p.account_id = f.account_id and p.path = 'pendiente_factura' and p.consumed_at is null
     and g.status = 'confirmado' and g.supplier_id = f.supplier_id and g.receipt_date <= coalesce(f.invoice_date, current_date)
   order by 6 desc, g.receipt_date, g.code;
end $$;
revoke all on function public.compras_casar_candidatos(uuid) from public, anon;
grant execute on function public.compras_casar_candidatos(uuid) to authenticated;

create or replace function public._compras_casar(p_factura uuid, p_recepciones uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare f supplier_invoice; v_suma numeric; v_sin_base int; v_dif numeric; v_n int; v_base_factura numeric;
begin
  select * into f from supplier_invoice where id = p_factura for update;
  if f.id is null then raise exception 'Esa factura no existe.' using errcode = 'P0002'; end if;
  if f.status = 'anulada' then raise exception 'La factura está anulada.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_recepciones) r(id)
              where not exists (select 1 from goods_receipt g join goods_receipt_path p on p.goods_receipt_id = g.id
                                 where g.id = r.id and g.account_id = f.account_id and g.supplier_id = f.supplier_id
                                   and p.path = 'pendiente_factura' and p.consumed_at is null)) then
    raise exception 'Alguna recepción no es de este proveedor o ya no está esperando factura.' using errcode = '22023';
  end if;
  insert into supplier_invoice_receipt (supplier_invoice_id, goods_receipt_id)
  select p_factura, r.id from unnest(p_recepciones) r(id) on conflict do nothing;
  update goods_receipt_path set supplier_invoice_id = p_factura, consumed_at = now()
   where goods_receipt_id = any(p_recepciones) and consumed_at is null;
  get diagnostics v_n = row_count;
  -- La diferencia: la base de la factura contra lo que suman TODAS sus recepciones.
  select coalesce(sum(public._compras_base_recepcion(x.goods_receipt_id)), 0), count(*) filter (where public._compras_base_recepcion(x.goods_receipt_id) is null)
    into v_suma, v_sin_base from supplier_invoice_receipt x where x.supplier_invoice_id = p_factura;
  v_base_factura := coalesce(f.tax_base_total, (select sum(line_amount) from supplier_invoice_line where supplier_invoice_id = p_factura), 0);
  v_dif := round(v_base_factura - v_suma, 2);
  update supplier_invoice set match_status = case when abs(v_dif) <= 0.02 and v_sin_base = 0 then 'ok' else 'con_diferencias' end, updated_at = now()
   where id = p_factura;
  return jsonb_build_object('factura', p_factura, 'casadas', v_n, 'base_factura', v_base_factura, 'base_recepciones', v_suma,
    'diferencia', v_dif, 'sin_base', v_sin_base,
    'frase', case when abs(v_dif) <= 0.02 and v_sin_base = 0 then format('Casa con %s recepción(es): la base es la misma (%s).', v_n, public.compras_euros(v_base_factura))
                  else format('Casada con %s recepción(es). La factura dice %s de base y las recepciones %s: %s de diferencia%s.',
                              v_n, public.compras_euros(v_base_factura), public.compras_euros(v_suma), public.compras_euros(v_dif),
                              case when v_sin_base > 0 then format(' (y %s sin importe)', v_sin_base) else '' end) end);
end $$;
revoke all on function public._compras_casar(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.compras_casar(p_factura uuid, p_recepciones uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from supplier_invoice where id = p_factura;
  if v_cuenta is null then raise exception 'Esa factura no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes casar facturas en esta cuenta.' using errcode = '42501';
  end if;
  return public._compras_casar(p_factura, p_recepciones);
end $$;
revoke all on function public.compras_casar(uuid, uuid[]) from public, anon;
grant execute on function public.compras_casar(uuid, uuid[]) to authenticated;

-- ── 6 · El fin de mes ──────────────────────────────────────────────────────
-- Calcula (y guarda) lo recibido y no facturado al cierre de p_mes, por
-- proveedor y local, para la empresa. No toca lo que ya tiene su asiento
-- validado. Devuelve las filas, con su id: es el origen del asiento.
create or replace function public._compras_fin_de_mes(p_empresa uuid, p_mes date)
returns setof public.purchase_accrual language plpgsql security definer set search_path = public as $$
declare
  v_cuenta uuid; v_ini date := date_trunc('month', p_mes)::date; v_fin date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
  v_corte date; v_unica boolean;
begin
  select account_id into v_cuenta from company where id = p_empresa;
  if v_cuenta is null then raise exception 'Esa empresa no existe.' using errcode = 'P0002'; end if;
  select max(imported_until) into v_corte from fiscal_year where company_id = p_empresa;
  v_unica := (select count(*) = 1 from company where account_id = v_cuenta and is_active);

  create temp table if not exists _fin_de_mes (supplier_id uuid, location_id uuid, receipts jsonb, base numeric, sin_base int) on commit drop;
  delete from _fin_de_mes;
  insert into _fin_de_mes
  select g.supplier_id, g.location_id,
         jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'fecha', g.receipt_date, 'base', public._compras_base_recepcion(g.id)) order by g.receipt_date, g.code),
         coalesce(sum(public._compras_base_recepcion(g.id)), 0), count(*) filter (where public._compras_base_recepcion(g.id) is null)::int
    from goods_receipt_path p join goods_receipt g on g.id = p.goods_receipt_id
    left join supplier_invoice si on si.id = p.supplier_invoice_id
   where p.account_id = v_cuenta and p.path = 'pendiente_factura' and g.status = 'confirmado'
     and (p.company_id = p_empresa or (p.company_id is null and v_unica))
     and g.receipt_date <= v_fin and (v_corte is null or g.receipt_date > v_corte)
     and (p.supplier_invoice_id is null or si.status = 'anulada' or si.invoice_date > v_fin)
   group by g.supplier_id, g.location_id;

  -- Lo que ya no está (se facturó dentro del mes) y no tiene asiento: fuera.
  delete from purchase_accrual a
   where a.company_id = p_empresa and a.month = v_ini
     and not exists (select 1 from _fin_de_mes x where x.supplier_id = a.supplier_id and x.location_id is not distinct from a.location_id)
     and not exists (select 1 from journal_entry e where e.company_id = p_empresa and e.source_type in ('purchase_accrual', 'purchase_accrual_reversal')
                      and e.source_id = a.id and e.status in ('propuesto', 'borrador', 'validado'));
  insert into purchase_accrual (account_id, company_id, supplier_id, location_id, month, base, receipts, without_base, computed_at)
  select v_cuenta, p_empresa, x.supplier_id, x.location_id, v_ini, x.base, x.receipts, x.sin_base, now() from _fin_de_mes x
  on conflict (company_id, supplier_id, location_id, month) do update set
    base = excluded.base, receipts = excluded.receipts, without_base = excluded.without_base, computed_at = now()
  where not exists (select 1 from journal_entry e where e.company_id = p_empresa and e.source_type = 'purchase_accrual'
                     and e.source_id = purchase_accrual.id and e.status = 'validado');
  return query select * from purchase_accrual where company_id = p_empresa and month = v_ini order by base desc;
end $$;
revoke all on function public._compras_fin_de_mes(uuid, date) from public, anon, authenticated;

create or replace function public.compras_fin_de_mes(p_empresa uuid, p_mes date)
returns setof public.purchase_accrual language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from company where id = p_empresa;
  if v_cuenta is null or not (select belongs_to_account(v_cuenta)) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  return query select * from public._compras_fin_de_mes(p_empresa, p_mes);
end $$;
revoke all on function public.compras_fin_de_mes(uuid, date) from public, anon;
grant execute on function public.compras_fin_de_mes(uuid, date) to authenticated;
