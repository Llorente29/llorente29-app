-- supabase/migrations/20261112T0130_e05_pago_prepago.sql
--
-- E05 · Tarea 4 · El pago de la quincena de Catcher contra el saldo prepago y
-- el saldo de la 40700001. Solo añade (columnas que admiten nulos, una tabla y
-- funciones nuevas).
--
-- Hecho de Julio (15/10): los pagos de 100 € con tarjeta a Catcher son
-- RECARGAS de un saldo prepago, la 40700001 «Saldo prepago Catcher» (dada de
-- alta también en Diez C0008, con ese nombre). De ese saldo Catcher paga a los
-- riders y flotas y se cobra su comisión: sus facturas se pagan contra la
-- 40700001, no contra el banco. Y el saldo de la 40700001 tiene que ser el que
-- enseña el portal de Catcher.
--
--   1. conta_lote_pago_proponer: el pago del lote, UN asiento propuesto en la
--      serie de tesorería (bank_settings.treasury_series), con una línea al
--      debe por factura (la cuenta de su proveedor: la 41000100 «Riders» para
--      riders y flotas, la de Catcher para la comisión; el documento, su
--      número) y una al haber a la 40700001 por el total. Así lo que baja la
--      40700001 es, al céntimo, lo que suman las facturas del lote (y el
--      Excel). Una vez por lote (source_type 'supplier_payment', source_id =
--      el lote).
--   2. conta_catcher_saldo: el saldo de la 40700001 en la app, recargas menos
--      pagos; lo validado y lo propuesto por separado.
--   3. supplier_balance_check y conta_catcher_saldo_comprobar: Julio escribe el
--      saldo que ve en el portal y la app dice si coincide; queda apuntado.
--
-- PGC (Real Decreto 1514/2007), definiciones literales en el informe del E05:
-- 407 «Anticipos a proveedores», 410 «Acreedores por prestaciones de
-- servicios» y 624 «Transportes».

-- 1 · El pago del lote ------------------------------------------------------------
alter table public.supplier_batch add column if not exists payment_entry_id uuid references public.journal_entry(id) on delete set null;
comment on column public.supplier_batch.payment_entry_id is 'E05 · El asiento del pago del lote contra el saldo prepago (40700001), en la serie de tesorería.';

create or replace function public.conta_lote_pago_proponer(p_lote uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l public.supplier_batch; v_prepago public.company_account; v_serie int; v_fecha date; v_total numeric := 0; v_n int := 0;
  v_sin_cuenta text[]; v_lineas jsonb := '[]'::jsonb; f record; r jsonb; v_entry uuid; v_eur text;
begin
  select * into v_l from public.supplier_batch where id = p_lote for update;
  if v_l.id is null or not public.belongs_to_account(v_l.account_id) then raise exception 'Ese lote no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_l.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone pagos.' using errcode = '42501';
  end if;
  if v_l.payment_entry_id is not null and exists (select 1 from public.journal_entry e where e.id = v_l.payment_entry_id and e.status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('id', v_l.payment_entry_id, 'ya_estaba', true, 'texto', 'El pago de la ' || v_l.label || ' ya estaba propuesto: no se ha creado otro.');
  end if;

  select * into v_prepago from public.company_account where account_id = v_l.account_id and company_id = v_l.company_id and code = '40700001';
  if v_prepago.id is null then
    raise exception 'Falta la 40700001 «Saldo prepago Catcher» en el plan de la empresa: dala de alta antes de proponer el pago.' using errcode = 'P0002';
  end if;

  -- Cada factura del lote, a la cuenta de su proveedor (su enlace «principal»).
  select array_agg(i.invoice_number order by i.invoice_number) into v_sin_cuenta
    from public.supplier_invoice i
   where i.batch_id = p_lote and i.status <> 'anulada'
     and not exists (select 1 from public.company_account_link k join public.company_account ca on ca.id = k.company_account_id and ca.account_id = k.account_id
                      where k.account_id = i.account_id and k.company_id = v_l.company_id and k.entity = 'supplier' and k.role = 'principal' and k.entity_id = i.supplier_id::text);
  if v_sin_cuenta is not null then
    raise exception 'No se puede proponer el pago: % sin proveedor o sin su cuenta (%). Si es Catcher, dalo de alta y dale su cuenta.',
      case array_length(v_sin_cuenta, 1) when 1 then '1 factura' else array_length(v_sin_cuenta, 1) || ' facturas' end, array_to_string(v_sin_cuenta[1:5], ', ')
      using errcode = '23514';
  end if;

  for f in
    select i.invoice_number, i.grand_total, i.location_id, i.invoice_date, ca.code
      from public.supplier_invoice i
      join public.company_account_link k on k.account_id = i.account_id and k.company_id = v_l.company_id and k.entity = 'supplier' and k.role = 'principal' and k.entity_id = i.supplier_id::text
      join public.company_account ca on ca.id = k.company_account_id and ca.account_id = k.account_id
     where i.batch_id = p_lote and i.status <> 'anulada'
     order by i.invoice_number
  loop
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', f.code, 'debe', f.grand_total, 'haber', 0,
                  'local_id', f.location_id, 'comun', f.location_id is null, 'documento', f.invoice_number));
    v_total := v_total + f.grand_total; v_n := v_n + 1;
    v_fecha := greatest(v_fecha, coalesce(f.invoice_date, v_l.period_to));
  end loop;
  if v_n = 0 then raise exception 'El lote no tiene facturas que pagar.' using errcode = '23514'; end if;
  -- Lo que baja la 40700001 = lo que suman las facturas = lo que sumaba el Excel.
  if v_l.grand_total is not null and round(v_l.grand_total * 100) <> round(v_total * 100) then
    raise exception 'Las facturas del lote suman % y el lote (el Excel) %: no se paga hasta aclararlo.', v_total, v_l.grand_total using errcode = '23514';
  end if;
  v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('cuenta', '40700001', 'debe', 0, 'haber', v_total, 'local_id', null, 'comun', true, 'documento', v_l.label));

  select coalesce((select b.treasury_series from public.bank_settings b where b.account_id = v_l.account_id and b.company_id = v_l.company_id limit 1), 3) into v_serie;
  r := public.journal_entry_proponer(v_l.company_id,
    jsonb_build_object('series', v_serie, 'fecha', coalesce(v_fecha, v_l.period_to), 'concepto', left('Pago desde el ' || v_prepago.name || ' · ' || v_l.label, 200),
                       'source_type', 'supplier_payment', 'source_id', p_lote, 'confianza', 'seguro',
                       'porque', 'Catcher paga a los riders y se cobra su comisión del saldo prepago: las facturas de la quincena se pagan contra la 40700001.',
                       'documento', v_l.label),
    v_lineas, null, p_quien_nombre);
  v_entry := (r->>'id')::uuid;
  update public.supplier_batch set payment_entry_id = v_entry where id = p_lote;
  update public.supplier_invoice set payment_entry_id = v_entry, updated_at = now() where batch_id = p_lote and status <> 'anulada';

  v_eur := replace(replace(replace(to_char(v_total, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' €';
  return jsonb_build_object('id', v_entry, 'ya_estaba', false, 'facturas', v_n, 'total', v_total, 'serie', v_serie,
    'texto', 'Propuesto el pago de la ' || v_l.label || ': ' || v_n || case v_n when 1 then ' factura, ' else ' facturas, ' end || v_eur
             || ' desde la 40700001 «' || v_prepago.name || '» (serie ' || v_serie || ').');
end $$;
comment on function public.conta_lote_pago_proponer(uuid, text) is
  'E05 · Propone el pago de un lote de Catcher contra el saldo prepago (40700001), en la serie de tesorería: una línea por factura a la cuenta de su proveedor y el total al haber de la 40700001. Una vez por lote.';
revoke all on function public.conta_lote_pago_proponer(uuid, text) from public, anon;
grant execute on function public.conta_lote_pago_proponer(uuid, text) to authenticated;

-- 2 · El saldo de la 40700001 ------------------------------------------------------------
create table if not exists public.supplier_balance_check (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  provider text not null check (provider in ('catcher')),
  checked_at timestamptz not null default now(),
  portal_amount numeric(14,2) not null,
  app_amount numeric(14,2) not null,
  app_validated_amount numeric(14,2) not null,
  matches boolean not null,
  checked_by uuid,
  checked_by_name text
);
create index if not exists supplier_balance_check_idx on public.supplier_balance_check (company_id, provider, checked_at desc);
comment on table public.supplier_balance_check is
  'E05 · Cada vez que alguien escribe el saldo que enseña el portal del proveedor (Catcher) y la app lo compara con el de su cuenta prepago (40700001).';
alter table public.supplier_balance_check enable row level security;
drop policy if exists supplier_balance_check_read on public.supplier_balance_check;
create policy supplier_balance_check_read on public.supplier_balance_check for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_balance_check from anon, authenticated;
grant select on public.supplier_balance_check to authenticated;

create or replace function public.conta_catcher_saldo(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_ca public.company_account; r record; u public.supplier_balance_check;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_ca from public.company_account where account_id = v_acc and company_id = p_company and code = '40700001';
  if v_ca.id is null then
    return jsonb_build_object('cuenta', '40700001', 'existe', false, 'texto', 'Falta la 40700001 «Saldo prepago Catcher» en el plan de la empresa.');
  end if;
  select coalesce(sum(l.debit) filter (where e.status = 'validado'), 0) as recargas_v, coalesce(sum(l.credit) filter (where e.status = 'validado'), 0) as pagos_v,
         coalesce(sum(l.debit) filter (where e.status in ('propuesto', 'borrador')), 0) as recargas_p, coalesce(sum(l.credit) filter (where e.status in ('propuesto', 'borrador')), 0) as pagos_p,
         max(e.entry_date) filter (where e.status in ('propuesto', 'borrador', 'validado')) as ultimo
    into r
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id and e.company_id = p_company
   where l.company_account_id = v_ca.id;
  select * into u from public.supplier_balance_check where company_id = p_company and provider = 'catcher' order by checked_at desc limit 1;
  return jsonb_build_object('cuenta', v_ca.code, 'nombre', v_ca.name, 'existe', true,
    'recargas', r.recargas_v + r.recargas_p, 'pagos', r.pagos_v + r.pagos_p, 'saldo', (r.recargas_v + r.recargas_p) - (r.pagos_v + r.pagos_p),
    'saldo_validado', r.recargas_v - r.pagos_v, 'propuesto', (r.recargas_p - r.pagos_p), 'ultimo_movimiento', r.ultimo,
    'ultima_comprobacion', case when u.id is null then null else jsonb_build_object('cuando', u.checked_at, 'portal', u.portal_amount, 'app', u.app_amount, 'coincide', u.matches, 'quien', u.checked_by_name) end);
end $$;
comment on function public.conta_catcher_saldo(uuid) is
  'E05 · El saldo de la 40700001 «Saldo prepago Catcher» en la app: recargas (debe) menos pagos (haber), con lo validado y lo propuesto por separado, y la última vez que se comparó con el portal.';
revoke all on function public.conta_catcher_saldo(uuid) from public, anon;
grant execute on function public.conta_catcher_saldo(uuid) to authenticated;

create or replace function public.conta_catcher_saldo_comprobar(p_company uuid, p_saldo_portal numeric, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; s jsonb; v_app numeric; v_val numeric; v_ok boolean; v_dif numeric;
  eur constant text := 'FM999G999G990D00';
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501'; end if;
  if p_saldo_portal is null then raise exception 'Escribe el saldo que enseña el portal de Catcher.' using errcode = '22023'; end if;
  s := public.conta_catcher_saldo(p_company);
  if not (s->>'existe')::boolean then raise exception '%', s->>'texto' using errcode = 'P0002'; end if;
  v_app := (s->>'saldo')::numeric; v_val := (s->>'saldo_validado')::numeric;
  v_ok := round(v_app * 100) = round(p_saldo_portal * 100);
  v_dif := p_saldo_portal - v_app;
  insert into public.supplier_balance_check (account_id, company_id, provider, portal_amount, app_amount, app_validated_amount, matches, checked_by, checked_by_name)
  values (v_acc, p_company, 'catcher', p_saldo_portal, v_app, v_val, v_ok, auth.uid(), p_quien_nombre);
  return jsonb_build_object('coincide', v_ok, 'portal', p_saldo_portal, 'app', v_app, 'diferencia', v_dif,
    'texto', case when v_ok then 'Coincide: ' || replace(replace(replace(to_char(v_app, eur), ',', '#'), '.', ','), '#', '.') || ' € en el portal y en la 40700001.'
                  else 'No coincide: el portal dice ' || replace(replace(replace(to_char(p_saldo_portal, eur), ',', '#'), '.', ','), '#', '.') || ' € y la 40700001 '
                       || replace(replace(replace(to_char(v_app, eur), ',', '#'), '.', ','), '#', '.') || ' € (el portal tiene '
                       || replace(replace(replace(to_char(abs(v_dif), eur), ',', '#'), '.', ','), '#', '.') || ' € ' || case when v_dif > 0 then 'más' else 'menos' end || ').' end
             || case when round(v_app * 100) <> round(v_val * 100) then ' Hay pagos o recargas propuestos sin validar.' else '' end);
end $$;
comment on function public.conta_catcher_saldo_comprobar(uuid, numeric, text) is
  'E05 · Compara el saldo que alguien ve en el portal de Catcher con el de la 40700001 en la app, lo apunta y dice si coincide (y cuánto no).';
revoke all on function public.conta_catcher_saldo_comprobar(uuid, numeric, text) from public, anon;
grant execute on function public.conta_catcher_saldo_comprobar(uuid, numeric, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.supplier_balance_check to conta_lectura;
  end if;
end $$;
