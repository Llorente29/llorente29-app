-- supabase/vuelta-atras/20261025T0840_v01b_cuota_por_linea.down.sql
--
-- Vuelta atrás de 20261025T0840_v01b_cuota_por_linea: todo como estaba.
--   1. Sin el disparador ni sus tres funciones.
--   2. customer_invoice_line_inalterable y _conta_venta_cifras, byte a byte
--      las de la 0835 (las que había en producción el 25/10, medidas con
--      pg_get_functiondef).
--   3. Sin la columna tax_amount (se va con lo que lleve: va DESPUÉS de la
--      vuelta atrás de la 0841, que deja la copia de antes).

drop trigger if exists trg_customer_invoice_cuotas on public.customer_invoice;
drop function if exists public._conta_venta_cuotas_al_emitir();
drop function if exists public._conta_venta_cuotas_guardar(uuid);
drop function if exists public._conta_venta_cuotas_de(uuid);

create or replace function public.customer_invoice_line_inalterable()
returns trigger language plpgsql set search_path = public as $$
declare v_estado text;
begin
  select status into v_estado from public.customer_invoice where id = coalesce(new.invoice_id, old.invoice_id);
  -- Al borrar un borrador entero (cascada) la factura ya no está: se deja.
  if v_estado is not null and v_estado <> 'borrador' then
    raise exception 'Las líneas de una factura emitida no se cambian.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public._conta_venta_cifras(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.customer_invoice; v_ret numeric := 0; v_base numeric; v_iva numeric; v_rec numeric; v_retencion numeric;
  v_tipos jsonb; v_cuentas jsonb;
begin
  select * into v_f from public.customer_invoice where id = p_id;
  if v_f.withholding_rate_id is not null then select rate into v_ret from public.withholding_rate where id = v_f.withholding_rate_id; end if;
  with l as (
    select tax_rate_id, tax_pct, coalesce(surcharge_pct, 0) as rec_pct, revenue_account_id, amount from public.customer_invoice_line where invoice_id = p_id
  ), t as (
    select tax_rate_id, tax_pct, rec_pct, sum(amount) as base,
           round(sum(amount) * tax_pct / 100, 2) as iva,
           case when v_f.surcharge then round(sum(amount) * rec_pct / 100, 2) else 0 end as rec
      from l group by tax_rate_id, tax_pct, rec_pct
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo_id', tax_rate_id, 'pct', tax_pct, 'rec_pct', rec_pct, 'base', base, 'iva', iva, 'rec', rec) order by tax_pct desc), '[]'),
         coalesce(sum(base), 0), coalesce(sum(iva), 0), coalesce(sum(rec), 0)
    into v_tipos, v_base, v_iva, v_rec from t;
  select coalesce(jsonb_agg(jsonb_build_object('cuenta_id', revenue_account_id, 'base', s) order by revenue_account_id), '[]') into v_cuentas
    from (select revenue_account_id, sum(amount) s from public.customer_invoice_line where invoice_id = p_id group by revenue_account_id) x;
  v_retencion := round(v_base * coalesce(v_ret, 0) / 100, 2);
  return jsonb_build_object('base', v_base, 'iva', v_iva, 'recargo', v_rec, 'retencion', v_retencion, 'retencion_pct', coalesce(v_ret, 0),
                            'total', v_base + v_iva + v_rec - v_retencion, 'tipos', v_tipos, 'cuentas', v_cuentas);
end $$;
revoke all on function public._conta_venta_cifras(uuid) from public, anon, authenticated;

alter table public.customer_invoice_line drop column if exists tax_amount;
