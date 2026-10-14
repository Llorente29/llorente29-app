-- ============================================================================
-- D01 · R2 punto 3 · La regla de repetidas, ENTERA la del C01b.
--
-- cambia: public.supplier_invoice_repetida · prueba: supabase/staging/sql/20261021_d01_repetidas_prueba.sql
--
-- La 0230 añadía un «posible» que el C01b no tiene: el mismo número con OTRO
-- total, o sin total. Medido con la población real (regla 31): el proveedor
-- que pone «01» en albaranes de fecha e importe distintos preguntaría con cada
-- factura. El C01b lo midió: con su regla, 0 repetidas y 0 posibles en los 179
-- albaranes reales. Julio aceptó la regla como «la que decidió el C01b» (R2):
--   · repetida (bloquea): mismo proveedor, misma clave de número, mismo total;
--   · posible (pregunta): misma fecha y mismo total (no 0), con otro número o
--     sin número ninguna de las dos;
--   · el mismo número con otro total, o sin total: nada.
-- El disparador de la 0230 no cambia: ya bloqueaba solo la repetida.
-- La misma firma: se reemplaza en caliente.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0260_d01_repetidas_c01b.down.sql
-- ============================================================================

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
  ), repetida as (
    select v.* from vivas v
     where v_clave is not null and public.conta_clave_numero(v.invoice_number) = v_clave
       and p_total is not null and round(v.grand_total * 100) = round(p_total * 100)
     order by v.created_at limit 1
  )
  (select 'repetida'::text, r.id, r.invoice_number, r.invoice_date, r.grand_total from repetida r)
  union all
  -- Con el mismo número y total habría salido arriba: aquí el número es otro,
  -- o no lo trae ninguna. Un total 0 no dice nada de la factura.
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where p_fecha is not null and p_total is not null and round(p_total * 100) <> 0
      and v.invoice_date = p_fecha and round(v.grand_total * 100) = round(p_total * 100)
      and not exists (select 1 from repetida)
    order by v.created_at limit 1);
end $$;
comment on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) is
  'D01 · La regla única de repetidas, la del C01b: repetida = mismo proveedor (o su NIF), misma clave de número y mismo total (bloquea); posible = misma fecha y mismo total (no 0) con otro número o sin número ninguna (pregunta). El mismo número con otro total no es nada. Para Compras, Supply, la ficha y la bandeja.';

