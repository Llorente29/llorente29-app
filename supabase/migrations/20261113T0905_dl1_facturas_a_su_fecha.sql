-- supabase/migrations/20261113T0905_dl1_facturas_a_su_fecha.sql
--
-- DL1 · Las 40 facturas recibidas de octubre con el asiento en noviembre
-- (Julio, DL1·23, 13/11). Sumied les puso la fecha del día en que llegaron o se
-- aprobaron; la regla de Julio (04/11): la factura va con su fecha, salvo que su
-- trimestre esté cerrado con el IVA presentado. El 4T está abierto.
--   Portier Eats (Uber) 29 · 4.555,58 · Glovo 9 · 1.402,45 · el alquiler de
--   Alcalá (factura 195) 892,50 · Nobleza Vacuna (259-2026) 584,06. Total 7.434,59.
--
-- El camino: _s01p_facturas_a_su_fecha (S01p·4, ya en producción), el que la
-- aplicación tiene para esto. Saca las líneas del borrador del 303 del 4T, borra
-- los asientos con _conta_asientos_borrar (respaldo, serie renumerada, cadena
-- recalculada), los vuelve a apuntar desde su respaldo con la fecha de su
-- factura, validados, enlaza cada factura con el suyo y recalcula el borrador.
-- Para si el debe, la cadena o el IVA del trimestre cambian. Borrar se puede
-- ahora: son de noviembre (después del corte), ni enviados a Diez ni casados,
-- y lo de detrás (271 asientos de noviembre) no está en otra declaración.
-- Anular y volver a apuntar dejaría en el libro los dos asientos más su
-- contraasiento en noviembre.
--
-- Los pagos no se tocan: los de las 16 facturas de Portier pagadas son otros
-- asientos (supplier_invoice_payment), y siguen pagadas.
--
-- Antes, una copia del borrador del 303 del 4T, porque la de la función
-- (conta_s01p4_303_antes) ya existe de la vez anterior y no se rehace.
--
-- SIN VUELTA ATRÁS, a propósito: lo borrado queda en su respaldo
-- (conta_asiento_borrado); deshacerlo es _conta_asientos_borrado_deshacer.

create table if not exists public.conta_dl1_303_4t_antes (
  que text not null,
  fila jsonb not null,
  copiado_at timestamptz not null default now()
);
alter table public.conta_dl1_303_4t_antes enable row level security;
revoke all on table public.conta_dl1_303_4t_antes from public, anon, authenticated;
comment on table public.conta_dl1_303_4t_antes is
  'DL1 (13/11). Copia del borrador del 303 del 4T de Foodint antes de poner las 40 facturas de octubre con su fecha. Solo lectura de respaldo.';

-- ── Foodint ────────────────────────────────────────────────────────────────
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_303 constant uuid := '8ae554ae-4853-42c9-b5b0-346840223d47';   -- el 303 del 4T, en borrador
  v_ids uuid[]; v_total numeric; v_r jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 facturas a su fecha: sin la cuenta de Foodint, no hay nada que mover.';
    return;
  end if;
  select array_agg(e.id order by e.entry_date, e.number), sum(s.grand_total) into v_ids, v_total
    from public.supplier_invoice s join public.journal_entry e on e.id = s.journal_entry_id
   where s.company_id = v_e and s.account_id = v_acc and s.discarded_at is null
     and s.invoice_date between date '2026-10-01' and date '2026-10-31'
     and e.entry_date > date '2026-10-31' and e.status = 'validado' and e.source_type = 'supplier_invoice';
  if coalesce(array_length(v_ids, 1), 0) <> 40 or v_total <> 7434.59 then
    raise exception 'DL1 facturas a su fecha: son % facturas por % y se midieron 40 por 7.434,59: no se mueve nada.', coalesce(array_length(v_ids, 1), 0), v_total;
  end if;
  if not exists (select 1 from public.tax_return where id = v_303 and company_id = v_e and form_code = '303' and fiscal_year = 2026
                  and period = '4T' and status = 'draft' and filed_at is null) then
    raise exception 'DL1 facturas a su fecha: el 303 del 4T no está en borrador: no se mueve nada.';
  end if;

  insert into public.conta_dl1_303_4t_antes (que, fila)
  select 'declaracion', to_jsonb(t) from public.tax_return t where t.id = v_303
  union all select 'linea', to_jsonb(l) from public.tax_return_line l where l.tax_return_id = v_303
  union all select 'caja', to_jsonb(x) from public.tax_return_box x where x.tax_return_id = v_303
  union all select 'comprobacion', to_jsonb(c) from public.tax_return_check c where c.tax_return_id = v_303;

  v_r := public._s01p_facturas_a_su_fecha(v_e, v_ids, v_303, v_julio,
    'DL1 (Julio, 13/11): factura de octubre apuntada en noviembre; va con la fecha de su factura (el 4T está abierto).');
  raise notice 'DL1 facturas a su fecha: %', v_r->>'texto';
end $$;
