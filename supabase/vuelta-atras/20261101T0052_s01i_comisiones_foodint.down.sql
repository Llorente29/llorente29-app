-- supabase/vuelta-atras/20261101T0052_s01i_comisiones_foodint.down.sql
--
-- S01i · Vuelta atrás de la 0052 (datos de Foodint): deshace lo que hizo, y
-- solo eso. Medido el 01/11, ninguna factura de plataforma de Foodint tenía
-- forma de pago ni estaba pagada; las ligadas de antes (matched_by 'antes')
-- se quedan.
--   · los pagos por compensación que puso Sumied, fuera; esas facturas, otra
--     vez aprobadas y sin pagar;
--   · los enlaces que puso Sumied, fuera;
--   · la forma de pago «compensation» de sus facturas de plataforma, otra vez vacía.
-- sin prueba con datos: solo toca la cuenta de Foodint, que no está en staging (la prueba de staging
-- la pasa para ver que entra y no hace nada); sobre los datos de Foodint la ejecuta el ensayo, en ROLLBACK.

do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
begin
  if not exists (select 1 from public.accounts where id = v_acc) then return; end if;
  -- Los disparadores de la 0051 siguen vivos aquí (se deshace después): sin esto, al volver a
  -- «aprobada» se buscaría su liquidación y se pagaría otra vez (lo cazó el ensayo del 01/11: 3).
  perform set_config('s01i.sin_buscar', 'si', true);
  with p as (
    delete from public.supplier_invoice_payment where account_id = v_acc and method = 'compensation' and created_by_name = 'Sumied · compensada con la liquidación'
    returning invoice_id)
  update public.supplier_invoice si set status = 'aprobada', paid_at = null, paid_method = null, paid_by_name = null, updated_at = now()
   where si.account_id = v_acc and si.id in (select invoice_id from p);
  delete from public.supplier_invoice_payment_log where account_id = v_acc and actor_name = 'Sumied · compensada con la liquidación';
  update public.channel_settlement cs set commission_invoice_id = null, updated_at = now()
   where cs.account_id = v_acc and exists (select 1 from public.channel_settlement_invoice k
           where k.account_id = v_acc and k.settlement_id = cs.id and k.supplier_invoice_id = cs.commission_invoice_id and k.matched_by = 'sumied');
  delete from public.channel_settlement_invoice where account_id = v_acc and matched_by = 'sumied';
  update public.supplier_invoice si set payment_method = null, updated_at = now()
   where si.account_id = v_acc and si.payment_method = 'compensation'
     and exists (select 1 from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                  where ps.account_id = v_acc and ps.role = 'supplier' and ps.supplier_id = si.supplier_id);
  perform set_config('s01i.sin_buscar', '', true);
end $$;
