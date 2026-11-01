-- supabase/migrations/20261031T1851_s01h_abonos.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261031_s01h_abonos_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261031_s01h_abonos_prueba.sql
--
-- S01h · Los abonos de proveedor (facturas rectificativas recibidas). Añade:
--
--   1. _conta_abono_ligar (BEFORE INSERT/UPDATE en supplier_invoice): un abono
--      sin factura ligada se liga solo a la que dice que rectifica
--      (reading→factura→rectificaA), si está en Sumied: misma cuenta, mismo
--      proveedor y el mismo número normalizado (como number_key). Si hay más
--      de una, no elige: se queda sin ligar.
--   2. conta_abono_compensar(p_abono): al validarse el asiento del abono, lo
--      compensa con la factura que anula si está sin pagar y tiene su asiento
--      validado: las dos quedan pagadas «por compensación», sin banco, cada
--      una con su pago apuntado contra el asiento de la otra (PC01: o hay un
--      pago con asiento, o no está pagada). Lo que no compensa queda como
--      saldo a favor (el abono sigue «aprobada», con su importe en negativo).
--   3. _conta_abono_validado (AFTER UPDATE OF status en journal_entry): llama
--      a conta_abono_compensar cuando se valida el asiento de un abono. Para
--      cualquier otro asiento no hace nada.
--
-- Los dos disparadores son nuevos (cambian dos tablas que existen, sin tocar
-- sus filas): ninguna de las dos está en el camino del pedido. No toca ninguna
-- fila de antes. El abono 1506416 de Foodint se arregla en la
-- 1852, con su «autorizo».

create or replace function public._conta_abono_clave(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function public._conta_abono_ligar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_clave text; v_ids uuid[];
begin
  if new.doc_kind <> 'credit_note' or new.corrects_invoice_id is not null or new.supplier_id is null then return new; end if;
  v_clave := public._conta_abono_clave(new.reading->'factura'->>'rectificaA');
  if v_clave is null then return new; end if;
  select array_agg(s.id) into v_ids from public.supplier_invoice s
   where s.account_id = new.account_id and s.supplier_id = new.supplier_id and s.id <> new.id
     and s.doc_kind = 'invoice' and s.status <> 'descartada' and s.number_key = v_clave;
  if coalesce(array_length(v_ids, 1), 0) = 1 then new.corrects_invoice_id := v_ids[1]; end if;
  return new;
end $$;

drop trigger if exists s01h_abono_ligar on public.supplier_invoice;
create trigger s01h_abono_ligar before insert or update of doc_kind, supplier_id, reading on public.supplier_invoice
  for each row execute function public._conta_abono_ligar();

create or replace function public.conta_abono_compensar(p_abono uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  a public.supplier_invoice; f public.supplier_invoice;
  v_ea uuid; v_ef uuid; v_pend_f numeric; v_pend_a numeric; v_comp numeric; v_nombre text;
begin
  select * into a from public.supplier_invoice where id = p_abono for update;
  if a.id is null or a.doc_kind <> 'credit_note' then return null; end if;
  select id into v_ea from public.journal_entry
   where account_id = a.account_id and source_type = 'supplier_invoice' and source_id = a.id and status = 'validado'
   order by validated_at desc nulls last limit 1;
  if v_ea is null then return jsonb_build_object('abono', a.id, 'compensado', 0, 'motivo', 'sin asiento validado'); end if;
  -- Lo que le queda al abono (en negativo) y a la factura que anula.
  v_pend_a := coalesce(a.grand_total, 0) - coalesce((select sum(amount) from public.supplier_invoice_payment where invoice_id = a.id), 0);
  if a.corrects_invoice_id is null or v_pend_a > -0.005 then
    return jsonb_build_object('abono', a.id, 'compensado', 0, 'a_favor', abs(least(v_pend_a, 0)), 'motivo', case when a.corrects_invoice_id is null then 'sin factura ligada' else 'ya compensado' end);
  end if;
  select * into f from public.supplier_invoice where id = a.corrects_invoice_id and account_id = a.account_id for update;
  if f.id is null or f.supplier_id is distinct from a.supplier_id or f.status <> 'aprobada' then
    return jsonb_build_object('abono', a.id, 'compensado', 0, 'a_favor', abs(v_pend_a), 'motivo', 'la factura que anula no está pendiente');
  end if;
  select id into v_ef from public.journal_entry
   where account_id = f.account_id and source_type = 'supplier_invoice' and source_id = f.id and status = 'validado'
   order by validated_at desc nulls last limit 1;
  v_pend_f := coalesce(f.grand_total, 0) - coalesce((select sum(amount) from public.supplier_invoice_payment where invoice_id = f.id), 0);
  if v_ef is null or v_pend_f < 0.005 then
    return jsonb_build_object('abono', a.id, 'compensado', 0, 'a_favor', abs(v_pend_a), 'motivo', 'la factura que anula no tiene asiento o no debe nada');
  end if;
  v_comp := least(v_pend_f, abs(v_pend_a));
  v_nombre := 'Sumied · compensación del abono';
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, note, entry_id, created_by_name)
  values (f.account_id, f.company_id, f.id, a.invoice_date, v_comp, 'compensation',
          format('Compensada con el abono %s (%s)', coalesce(a.invoice_number, ''), a.code), v_ea, v_nombre),
         (a.account_id, a.company_id, a.id, a.invoice_date, -v_comp, 'compensation',
          format('Compensa la factura %s (%s)', coalesce(f.invoice_number, ''), f.code), v_ef, v_nombre);
  if v_pend_f - v_comp < 0.005 then
    update public.supplier_invoice set status = 'pagada', paid_at = a.invoice_date, paid_method = 'compensation', paid_by_name = v_nombre, updated_at = now() where id = f.id;
    insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_name)
    values (f.account_id, f.id, 'paid', a.invoice_date, 'compensation', v_nombre);
  end if;
  if abs(v_pend_a) - v_comp < 0.005 then
    update public.supplier_invoice set status = 'pagada', paid_at = a.invoice_date, paid_method = 'compensation', paid_by_name = v_nombre, updated_at = now() where id = a.id;
    insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_name)
    values (a.account_id, a.id, 'paid', a.invoice_date, 'compensation', v_nombre);
  end if;
  return jsonb_build_object('abono', a.id, 'factura', f.id, 'compensado', v_comp, 'a_favor', abs(v_pend_a) - v_comp,
    'texto', format('El abono %s compensa %s de la factura %s.', coalesce(a.invoice_number, a.code), public.conta_euros_exactos(v_comp), coalesce(f.invoice_number, f.code)));
end $$;

revoke all on function public.conta_abono_compensar(uuid) from public, anon, authenticated;

create or replace function public._conta_abono_validado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.supplier_invoice s where s.id = new.source_id and s.account_id = new.account_id and s.doc_kind = 'credit_note') then
    perform public.conta_abono_compensar(new.source_id);
  end if;
  return null;
end $$;

drop trigger if exists s01h_abono_validado on public.journal_entry;
create trigger s01h_abono_validado after update of status on public.journal_entry
  for each row when (new.status = 'validado' and old.status is distinct from 'validado' and new.source_type = 'supplier_invoice')
  execute function public._conta_abono_validado();
