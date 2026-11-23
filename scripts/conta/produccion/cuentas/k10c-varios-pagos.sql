-- scripts/conta/produccion/cuentas/k10c-varios-pagos.sql
--
-- K10c · Varios pagos de una recibida · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Regla 31 (encargo K10c: «las recibidas pagadas de las tres cuentas tienen el mismo asiento de pago antes y después;
-- ninguna cambia de estado»): por empresa (con su cuenta, regla 9), cuántas recibidas hay en cada estado de pago
-- (conta_recibida_pago) y la huella de sus pagos (factura, importe, fecha y la huella de su asiento,
-- journal_entry_canonico). La tanda solo añade funciones que nadie llama hasta que se usan: todo igual. Corte fijo en el
-- pasado: los pagos y las facturas de antes del 23/11/2026.
-- Y (Respuesta K10c · 1) cuántos asientos de pago (serie 4, supplier_payment) han salido ya a ERP10, por la salida del
-- X10f (conta_erp10_envio en_erp10 o enviando) o por el Excel (conta_erp10_salida_partida): los que borrar o cambiar
-- un pago ya no puede tocar. Hoy, 0 en todas (Frango no ha estrenado la salida).
with f as (
  select si.account_id, si.company_id, si.id, c.estado
    from public.supplier_invoice si join public.conta_recibida_pago c on c.invoice_id = si.id
   where si.company_id is not null and si.created_at < timestamptz '2026-11-23 00:00:00+01'
), p as (
  select x.account_id, x.company_id,
         left(md5(string_agg(x.invoice_id || '|' || x.amount || '|' || x.paid_on || '|' || coalesce(md5(public.journal_entry_canonico(x.entry_id)), '-'), ';'
                             order by x.invoice_id, x.paid_on, x.amount, x.entry_id)), 12) as huella, count(*) as n
    from public.supplier_invoice_payment x
   where x.created_at < timestamptz '2026-11-23 00:00:00+01'
   group by x.account_id, x.company_id
), e as (
  select je.account_id, je.company_id, count(*) as n
    from public.journal_entry je
   where je.source_type = 'supplier_payment'
     and (exists (select 1 from public.conta_erp10_envio v where v.entry_id = je.id and v.account_id = je.account_id and v.estado in ('en_erp10', 'enviando'))
          or exists (select 1 from public.conta_erp10_salida_partida s where s.entry_id = je.id and s.account_id = je.account_id and s.estado = 'salida'))
   group by je.account_id, je.company_id
)
select clave, valor from (
  select f.account_id, f.company_id,
         'cuenta ' || left(f.account_id::text, 8) || ' · empresa ' || left(f.company_id::text, 8)
           || ' · regla 31: recibidas por estado de pago · pagos y la huella de sus asientos · asientos de pago en ERP10' clave,
         (select string_agg(estado || '=' || n, ',' order by estado) from (select f2.estado, count(*) n from f f2 where f2.company_id = f.company_id and f2.account_id = f.account_id group by f2.estado) e)
           || ' · ' || coalesce((select p.n || ' pagos ' || p.huella from p where p.company_id = f.company_id and p.account_id = f.account_id), 'sin pagos')
           || ' · ' || coalesce((select e.n from e where e.company_id = f.company_id and e.account_id = f.account_id), 0) || ' en ERP10' valor
    from f group by f.account_id, f.company_id
) t order by account_id, company_id;
