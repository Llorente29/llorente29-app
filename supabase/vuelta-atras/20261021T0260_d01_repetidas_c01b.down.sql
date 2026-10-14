-- Vuelta atrás de 20261021T0260 (D01): la función como la dejó la 0230.
-- Sin datos que proteger: es una lectura.
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

