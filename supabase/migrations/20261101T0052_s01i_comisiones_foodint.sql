-- supabase/migrations/20261101T0052_s01i_comisiones_foodint.sql
--
-- S01i · Datos de Foodint (Julio, 31/10: «estas facturas, todas, se compensan
-- con la liquidación de ventas; las que ya he hecho no tienen puesta forma de
-- pago»). Filtrando por su cuenta, a cada factura de una plataforma (Uber,
-- Glovo, Just Eat) se le busca su liquidación, con la misma regla que las que
-- lleguen a partir de ahora (_conta_comision_buscar, de la 0050):
--
--   · encaja una sola → ligada, con «Compensación con la liquidación»; si está
--     aprobada, pagada por compensación con la fecha de su liquidación;
--   · de antes de la primera liquidación de su plataforma en Sumied →
--     «Compensada fuera de Sumied» (pagada, si está aprobada);
--   · encajan varias, o ninguna todavía → sin ligar, con la forma de pago
--     puesta: no sale en Pagos ni en Bancos, y la ficha dice por qué.
--
-- Las que están «Por revisar» no se pagan: quedan ligadas y se pagan al
-- validarlas. Las pagadas, anuladas o descartadas no se tocan.
-- Guarda: sin la cuenta de Foodint (staging, la base local) no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v uuid; r text; v_n jsonb := '{}'::jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01i 0052: sin la cuenta de Foodint, no hay nada que hacer.';
    return;
  end if;
  for v in select si.id from public.supplier_invoice si
             join public.party_role ps on ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id
             join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
            where si.account_id = v_acc and si.status not in ('anulada', 'descartada', 'pagada')
            order by si.invoice_date, si.id loop
    r := coalesce(public._conta_comision_buscar(v), 'no');
    v_n := jsonb_set(v_n, array[r], to_jsonb(coalesce((v_n->>r)::int, 0) + 1));
  end loop;
  raise notice 'S01i 0052: facturas de plataformas de Foodint, por lo que les pasa: %', v_n;
end $$;
