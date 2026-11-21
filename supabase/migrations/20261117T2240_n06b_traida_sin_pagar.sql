-- supabase/migrations/20261117T2240_n06b_traida_sin_pagar.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.supplier_invoice_payment · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
-- cambia: public.conta_pago_remesa_linea · prueba: supabase/staging/sql/20261117_n06b_darlo_por_bueno_prueba.sql
--
-- N06b · Darlo por bueno. 2 de 4: UNA FACTURA TRAÍDA EN PRUEBA NO SE PAGA NI SE CASA (respuesta N06a · 1,
-- «no sé» 1). Dos funciones nuevas y tres disparadores nuevos (BEFORE, que solo paran) en tres tablas que
-- ya existen: por eso es «cambia», declarado. No cambia ninguna fila ni ninguna función de las que hay.
--
--   _conta_traida_en_prueba(source, import_run_id, import_mark): la regla, en un solo sitio. Una
--     recibida traída (source «traida») está «en prueba» mientras su carga lo está, o si se dejó
--     fuera. La leen las listas de Pagos y Bancos (la 2241) y los candados de abajo.
--   Los candados: no se apunta un pago de una traída en prueba (supplier_invoice_payment), no se mete en
--     un pago a mano ni en una remesa (conta_pago_remesa_linea) ni se la marca pagada
--     (supplier_invoice.paid_at o payment_entry_id). Así ningún camino de pago —a mano,
--     remesa, casar con el banco— la paga, aunque alguien llegue a ella por otro sitio.
--
-- Nada en el camino del pedido.

create or replace function public._conta_traida_en_prueba(p_source text, p_run uuid, p_mark text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_source = 'traida', false)
     and (p_mark is not distinct from 'fuera'
          or exists (select 1 from public.import_run r where r.id = p_run and r.kind = 'carga' and r.status = 'en_prueba'))
$$;
revoke all on function public._conta_traida_en_prueba(text, uuid, text) from public, anon;
grant execute on function public._conta_traida_en_prueba(text, uuid, text) to authenticated, service_role;

create or replace function public.tg_n06b_traida_no_se_paga()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_i public.supplier_invoice;
begin
  if tg_table_name in ('supplier_invoice_payment', 'conta_pago_remesa_linea') then
    select * into v_i from public.supplier_invoice where id = new.invoice_id;
  else
    if not ((new.paid_at is not null and old.paid_at is null)
            or (new.payment_entry_id is not null and new.payment_entry_id is distinct from old.payment_entry_id)) then
      return new;
    end if;
    v_i := new;
  end if;
  if v_i.id is not null and public._conta_traida_en_prueba(v_i.source, v_i.import_run_id, v_i.import_mark) then
    raise exception 'La factura % es de lo traído que todavía está en prueba: se paga cuando lo des por bueno.', v_i.invoice_number
      using errcode = '23514', hint = 'traida_en_prueba';
  end if;
  return new;
end $$;
revoke all on function public.tg_n06b_traida_no_se_paga() from public, anon, authenticated;

drop trigger if exists trg_supplier_invoice_payment_n06b_en_prueba on public.supplier_invoice_payment;
create trigger trg_supplier_invoice_payment_n06b_en_prueba before insert on public.supplier_invoice_payment
  for each row execute function public.tg_n06b_traida_no_se_paga();
drop trigger if exists trg_conta_pago_remesa_linea_n06b_en_prueba on public.conta_pago_remesa_linea;
create trigger trg_conta_pago_remesa_linea_n06b_en_prueba before insert on public.conta_pago_remesa_linea
  for each row execute function public.tg_n06b_traida_no_se_paga();
drop trigger if exists trg_supplier_invoice_n06b_en_prueba on public.supplier_invoice;
create trigger trg_supplier_invoice_n06b_en_prueba before update of paid_at, payment_entry_id on public.supplier_invoice
  for each row execute function public.tg_n06b_traida_no_se_paga();
