-- Vuelta atrás de 20261021T0230 (D01): la regla de repetidas como la dejaron
-- la 0200 y la 0210 (solo el número). No hay datos que proteger: son funciones
-- y el disparador. Copiado tal cual de esos dos ficheros.
create or replace function public.tg_supplier_invoice_no_repetida()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_otra public.supplier_invoice;
  -- En un disparador BEFORE la columna generada number_key todavía no está
  -- calculada (llega nula): se calcula aquí con la misma expresión.
  v_k text := nullif(case when upper(regexp_replace(coalesce(new.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(SN|SINNUMERO|SINNUM|0+)$' then ''
                          else upper(regexp_replace(coalesce(new.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) end, '');
begin
  if new.status = 'anulada' or new.not_duplicate_confirmed_at is not null or new.supplier_id is null or v_k is null then return new; end if;
  -- En un cambio, solo si cambia lo que decide (el número, el proveedor o que deje de estar anulada).
  if tg_op = 'UPDATE' and v_k is not distinct from old.number_key and new.supplier_id is not distinct from old.supplier_id
     and not (old.status = 'anulada' and new.status <> 'anulada') then return new; end if;
  select * into v_otra from public.supplier_invoice i
   where i.account_id = new.account_id and i.supplier_id = new.supplier_id and i.number_key = v_k
     and i.id <> new.id and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   order by i.created_at limit 1;
  if v_otra.id is not null then
    raise exception 'Repetida: ya está la factura % de este proveedor (%). No entra dos veces; si no es la misma, márcala «No es repetida».',
      v_otra.invoice_number, coalesce(v_otra.code, v_otra.id::text) using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_invoice_no_repetida on public.supplier_invoice;
create trigger trg_supplier_invoice_no_repetida
  before insert or update of invoice_number, supplier_id, status, not_duplicate_confirmed_at on public.supplier_invoice
  for each row execute function public.tg_supplier_invoice_no_repetida();


create or replace function public.supplier_invoice_repetida(
  p_account uuid, p_supplier uuid, p_nif text, p_numero text, p_fecha date, p_total numeric, p_excluir uuid default null)
returns table (nivel text, invoice_id uuid, invoice_number text, invoice_date date, grand_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_clave text := nullif(case when upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(SN|SINNUMERO|SINNUM|0+)$' then ''
                              else upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g')) end, '');
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
  )
  (select 'repetida'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where v_clave is not null and v.number_key = v_clave order by v.created_at limit 1)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where p_fecha is not null and p_total is not null and v.invoice_date = p_fecha and round(v.grand_total * 100) = round(p_total * 100)
      and (v_clave is null or v.number_key is distinct from v_clave)
      and not exists (select 1 from vivas w where v_clave is not null and w.number_key = v_clave)
    order by v.created_at limit 1);
end $$;

create or replace function public.supplier_invoice_repetidas_que_hay(p_account uuid)
returns table (supplier_id uuid, number_key text, facturas integer, ids uuid[])
language sql stable security definer set search_path = public as $$
  select i.supplier_id, i.number_key, count(*)::int, array_agg(i.id order by i.created_at)
    from public.supplier_invoice i
   where i.account_id = p_account and (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role')
     and i.number_key is not null and i.supplier_id is not null and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
   group by 1, 2 having count(*) > 1
$$;
drop function if exists public.conta_clave_numero(text);
