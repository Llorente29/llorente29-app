-- supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261101_s01i_comisiones_prueba.sql
-- cambia: public.channel_settlement · prueba: supabase/staging/sql/20261101_s01i_comisiones_prueba.sql
-- cambia: public.conta_pagos_lista · prueba: supabase/staging/sql/20261101_s01i_comisiones_prueba.sql
-- cambia: public.bank_facturas_para_casar · prueba: supabase/staging/sql/20261101_s01i_comisiones_prueba.sql
--
-- S01i · Lo que se compensa no se paga por banco.
--
--   1. supplier_invoice.payment_method admite «compensation» (solo amplía el
--      CHECK; paid_method ya la admite desde el S01h).
--   2. Pagos (conta_pagos_lista) y las pendientes de Bancos
--      (bank_facturas_para_casar) dejan fuera lo que se paga por compensación:
--      las facturas de comisión de las plataformas y los abonos compensados.
--      Lo demás, igual que estaba (el cuerpo de producción del 01/11).
--   3. Disparadores:
--      · al llegar o cambiar una factura de una plataforma (su proveedor, su
--        lectura, su fecha), se le busca su liquidación y queda con la forma
--        de pago «Compensación con la liquidación»;
--      · al aprobarla, si ya está ligada (o es de antes de su plataforma en
--        Sumied), queda pagada por compensación;
--      · al llegar una liquidación, se buscan las facturas de su plataforma
--        que estaban sin ligar («Falta la liquidación»).
--      Ninguno impide guardar: si algo falla, la factura sigue sin ligar.

alter table public.supplier_invoice
  drop constraint supplier_invoice_payment_method_check,
  add constraint supplier_invoice_payment_method_check check (
    payment_method is null or payment_method = any (array['transfer', 'direct_debit', 'card', 'cash', 'prepaid', 'compensation']::text[]));

-- Las dos de antes, guardadas tal cual están en la base (la vuelta atrás las restaura de aquí).
select public._respaldar_funcion('public.bank_facturas_para_casar(uuid)', '20261101T0051_s01i_comision_sin_banco');
select public._respaldar_funcion('public.conta_pagos_lista(uuid,date)', '20261101T0051_s01i_comision_sin_banco');

create or replace function public.bank_facturas_para_casar(p_company uuid)
 returns table(id uuid, numero text, fecha date, total numeric, pagado numeric, proveedor text, alias text[], tercero_id uuid, cuenta_tercero text, estado text)
 language sql stable set search_path to 'public'
as $function$
  select si.id, si.invoice_number, si.invoice_date, si.grand_total,
         coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                    where i.supplier_invoice_id = si.id and b.status = 'vivo'), 0),
         s.name, array_remove(array[s.name, s.legal_name], null), pr.party_id,
         (select ca.code from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
           where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal' limit 1),
         si.status
    from public.supplier_invoice si
    join public.company c on c.id = p_company and c.account_id = si.account_id
    left join public.supplier s on s.id = si.supplier_id
    left join public.party_role pr on pr.supplier_id = s.id and pr.role = 'supplier'
   where si.status in ('aprobada', 'en_revision') and si.paid_at is null and coalesce(si.grand_total, 0) > 0
     and (si.company_id is null or si.company_id = p_company)
     -- S01i · Lo que se compensa (comisiones de plataformas, abonos) no se paga por banco.
     and si.payment_method is distinct from 'compensation'
$function$;

create or replace function public.conta_pagos_lista(p_company uuid, p_mes date)
 returns jsonb language sql stable set search_path to 'public'
as $function$
  with f as (
    select si.id, si.supplier_id, s.name as proveedor, si.invoice_number as numero, si.invoice_date as fecha, rp.vence, rp.total, rp.pagado, rp.pendiente,
           rp.estado, rp.dias_vencida, coalesce(si.payment_method, s.payment_method) as forma, si.location_id, lo.name as local,
           right(public._pc01e2_iban(s.iban), 4) as iban4, (public._pc01e2_iban(s.iban) is not null) as con_iban,
           (s.iban_unconfirmed_invoice_id is not null) as iban_sin_confirmar, right(public._pc01e2_iban(si.read_iban), 4) as iban_leido4,
           (public._pc01e2_iban(si.read_iban) is not null and si.iban_decision is null and public._pc01e2_iban(s.iban) is not null
              and public._pc01e2_iban(si.read_iban) <> public._pc01e2_iban(s.iban)) as iban_distinto,
           exists (select 1 from public.company_account_link l where l.company_id = p_company and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal') as con_cuenta,
           s.payment_terms_days as plazo,
           (select jsonb_build_object('id', r.id, 'codigo', r.code, 'importe', sum(l.amount))
              from public.conta_pago_remesa_linea_estado l join public.conta_pago_remesa r on r.id = l.remesa_id
             where l.invoice_id = si.id and l.estado in ('pendiente', 'por_confirmar') group by r.id, r.code order by r.code desc limit 1) as remesa
      from public.supplier_invoice si
      join public.conta_recibida_pago rp on rp.invoice_id = si.id
      left join public.supplier s on s.id = si.supplier_id
      left join public.locations lo on lo.id = si.location_id
     where si.account_id = (select account_id from public.company where id = p_company)
       and coalesce(si.company_id, p_company) = p_company
       and si.status in ('aprobada', 'pagada')
       -- S01i · Lo que se compensa (comisiones de plataformas, abonos) no se paga por banco: no sale en Pagos.
       and si.payment_method is distinct from 'compensation' and si.paid_method is distinct from 'compensation'
  )
  select jsonb_build_object(
    'filas', coalesce((select jsonb_agg(to_jsonb(f) order by f.vence nulls last, f.fecha) from f), '[]'::jsonb),
    'pagado_mes', (select coalesce(sum(p.amount), 0) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                    where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'pagadas_mes', (select count(distinct p.invoice_id) from public.supplier_invoice_payment p join f on f.id = p.invoice_id
                     where p.entry_id is not null and p.paid_on >= date_trunc('month', p_mes)::date and p.paid_on < (date_trunc('month', p_mes) + interval '1 month')::date),
    'sin_plazo', coalesce((select jsonb_agg(distinct jsonb_build_object('id', f.supplier_id, 'nombre', f.proveedor))
                            from f where f.estado = 'sin_vencimiento' and f.plazo is null and f.supplier_id is not null), '[]'::jsonb))
$function$;

-- Al llegar o cambiar una factura de una plataforma: buscarle su liquidación.
create or replace function public._s01i_factura_comision()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status in ('anulada', 'descartada') or new.supplier_id is null then return null; end if;
  begin
    perform public._conta_comision_buscar(new.id);
  exception when others then
    -- Nunca impide guardar la factura: sigue sin ligar, y la ficha dice por qué.
    raise log 'S01i · no se ha podido buscar la liquidación de la factura %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists s01i_factura_comision on public.supplier_invoice;
create trigger s01i_factura_comision after insert or update of supplier_id, reading, invoice_date, status on public.supplier_invoice
  for each row when (pg_trigger_depth() = 0) execute function public._s01i_factura_comision();

-- Al llegar una liquidación (o al darle su tienda): las facturas de su plataforma sin ligar.
create or replace function public._s01i_liquidacion_llega()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v uuid;
begin
  begin
    for v in select si.id from public.supplier_invoice si
               join public.party_role ps on ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id
               join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform' and pl.channel_id = new.channel_id
              where si.account_id = new.account_id and si.status not in ('anulada', 'descartada', 'pagada')
                and not exists (select 1 from public.channel_settlement_invoice k where k.supplier_invoice_id = si.id) loop
      perform public._conta_comision_buscar(v);
    end loop;
  exception when others then
    raise log 'S01i · no se han podido buscar las facturas de la liquidación %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists s01i_liquidacion_llega on public.channel_settlement;
create trigger s01i_liquidacion_llega after insert or update of store_id, brand_id, location_id, period_from, period_to on public.channel_settlement
  for each row when (pg_trigger_depth() = 0) execute function public._s01i_liquidacion_llega();
