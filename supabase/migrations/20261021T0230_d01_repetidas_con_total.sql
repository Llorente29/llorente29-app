-- ============================================================================
-- D01 · La regla única de repetidas, con el TOTAL (como el C01b).
--
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.tg_supplier_invoice_no_repetida · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.supplier_invoice_repetida · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
-- cambia: public.supplier_invoice_repetidas_que_hay · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
--
-- La 0210 bloqueaba por número solo. Medido contra los 179 albaranes reales de
-- Foodint (tests/unit/modules/conta/datos/albaranes-fecha-importe-…json): el
-- único número repetido entre los vivos es «01», de un proveedor que lo pone en
-- dos albaranes de fecha e importe distintos. Con la 0210, el segundo no habría
-- podido entrar. El C01b ya lo había decidido así (lib/repetidas.ts: «número E
-- importe»), y la regla única no puede ser más dura que lo que sustituye.
--
--   · repetida (bloquea): mismo proveedor, misma clave de número y mismo total;
--   · posible (pregunta, no bloquea): misma clave con otro total o sin total,
--     o misma fecha y mismo total con otro número.
--
-- La clave sale de UNA función, conta_clave_numero(), que también reconoce
-- «sin número» con tilde (la Ú se quitaba y quedaba SINNMERO). La columna
-- number_key de la 0200 se queda como está (cambiarla es quitar y poner la
-- columna); las comparaciones de aquí no la usan.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0230_d01_repetidas_con_total.down.sql
-- ============================================================================

create or replace function public.conta_clave_numero(p text)
returns text language sql immutable parallel safe as $$
  select nullif(case when k ~ '^(SN|SINNUMERO|SINNMERO|SINNUM|0+)$' then '' else k end, '')
    from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) as k) x
$$;
comment on function public.conta_clave_numero(text) is
  'D01 · La clave de número de factura de la regla única de repetidas: mayúsculas, solo letras y cifras; «s/n», «sin número», «0…» no son número (null). La misma que claveNumero() en _shared/lecturaFactura.ts.';
grant execute on function public.conta_clave_numero(text) to authenticated, service_role;

create or replace function public.tg_supplier_invoice_no_repetida()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_otra public.supplier_invoice;
  v_k text := public.conta_clave_numero(new.invoice_number);
begin
  if new.status = 'anulada' or new.not_duplicate_confirmed_at is not null or new.supplier_id is null
     or v_k is null or new.grand_total is null then return new; end if;
  -- En un cambio, solo si cambia lo que decide (número, proveedor, total o que deje de estar anulada).
  if tg_op = 'UPDATE' and v_k is not distinct from public.conta_clave_numero(old.invoice_number)
     and new.supplier_id is not distinct from old.supplier_id
     and round(new.grand_total * 100) is not distinct from round(old.grand_total * 100)
     and not (old.status = 'anulada' and new.status <> 'anulada') then return new; end if;
  select * into v_otra from public.supplier_invoice i
   where i.account_id = new.account_id and i.supplier_id = new.supplier_id
     and public.conta_clave_numero(i.invoice_number) = v_k
     and round(i.grand_total * 100) = round(new.grand_total * 100)
     and i.id <> new.id and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   order by i.created_at limit 1;
  if v_otra.id is not null then
    raise exception 'Repetida: ya está la factura % de este proveedor (%), con el mismo total. No entra dos veces; si no es la misma, márcala «No es repetida».',
      v_otra.invoice_number, coalesce(v_otra.code, v_otra.id::text) using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_invoice_no_repetida on public.supplier_invoice;
create trigger trg_supplier_invoice_no_repetida
  before insert or update of invoice_number, supplier_id, status, not_duplicate_confirmed_at, grand_total on public.supplier_invoice
  for each row execute function public.tg_supplier_invoice_no_repetida();

create or replace function public.supplier_invoice_repetida(
  p_account uuid, p_supplier uuid, p_nif text, p_numero text, p_fecha date, p_total numeric, p_excluir uuid default null)
returns table (nivel text, invoice_id uuid, invoice_number text, invoice_date date, grand_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_clave text := public.conta_clave_numero(p_numero);
  v_nif text := nullif(regexp_replace(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', ''), '');
begin
  if not (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa cuenta no es tuya.' using errcode = '42501';
  end if;
  return query
  with vivas as (
    select i.* from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = p_account and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
       and (p_excluir is null or i.id <> p_excluir)
       and ((p_supplier is not null and i.supplier_id = p_supplier)
            or (v_nif is not null and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif))
  ), mismo_numero as (
    select v.* from vivas v where v_clave is not null and public.conta_clave_numero(v.invoice_number) = v_clave
  ), repetida as (
    select v.* from mismo_numero v where p_total is not null and round(v.grand_total * 100) = round(p_total * 100)
     order by v.created_at limit 1
  )
  (select 'repetida'::text, r.id, r.invoice_number, r.invoice_date, r.grand_total from repetida r)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from mismo_numero v
    where not exists (select 1 from repetida) order by v.created_at limit 1)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where p_fecha is not null and p_total is not null and v.invoice_date = p_fecha and round(v.grand_total * 100) = round(p_total * 100)
      and v_clave is distinct from public.conta_clave_numero(v.invoice_number)
      and not exists (select 1 from mismo_numero)
    order by v.created_at limit 1);
end $$;
comment on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) is
  'D01 · La regla única de repetidas: repetida = mismo proveedor (o su NIF), misma clave de número y mismo total (bloquea); posible = misma clave con otro total o sin total, o misma fecha y mismo total con otro número (pregunta). Para Compras, Supply, la ficha y la bandeja.';

create or replace function public.supplier_invoice_repetidas_que_hay(p_account uuid)
returns table (supplier_id uuid, number_key text, facturas integer, ids uuid[])
language sql stable security definer set search_path = public as $$
  select i.supplier_id, public.conta_clave_numero(i.invoice_number), count(*)::int, array_agg(i.id order by i.created_at)
    from public.supplier_invoice i
   where i.account_id = p_account and (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role')
     and public.conta_clave_numero(i.invoice_number) is not null and i.supplier_id is not null and i.grand_total is not null
     and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   group by i.supplier_id, public.conta_clave_numero(i.invoice_number), round(i.grand_total * 100) having count(*) > 1
$$;
