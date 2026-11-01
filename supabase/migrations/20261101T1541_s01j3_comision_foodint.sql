-- supabase/migrations/20261101T1541_s01j3_comision_foodint.sql
--
-- S01j·3 · Las liquidaciones de Just Eat de Foodint cuya factura de comisión es
-- un abono (total negativo) se guardaron con la comisión del revés (-abs()).
-- Se les pone la buena: −(total de su factura). Medido el 01/11 (solo lectura):
-- 5 (settlement_ref 3994685, 3994768, 3995007 y 4126387, con ventas 0; y la de
-- ventas 42,31), y con esto las 33 de Just Eat cuadran: ventas + comisión +
-- otros = neto. Solo las que tienen su factura ligada y la comisión guardada es
-- justo el total de esa factura (el signo dado la vuelta); las demás, ni se miran.
-- Mueve filas: va con «autorizo». Lo de antes queda en s01j3_comision_antes.
-- Vuelta atrás: supabase/vuelta-atras/20261101T1541_s01j3_comision_foodint.down.sql

create table if not exists public.s01j3_comision_antes (
  settlement_id uuid primary key, account_id uuid not null, commission_antes numeric not null, commission_ahora numeric not null,
  corregido_at timestamptz not null default now()
);
alter table public.s01j3_comision_antes enable row level security;
revoke all on public.s01j3_comision_antes from public, anon, authenticated;

with fac as (
  select cs.id, si.grand_total
    from public.channel_settlement cs
    join public.supplier_invoice si
      on si.account_id = cs.account_id
     and si.id = coalesce((select k.supplier_invoice_id from public.channel_settlement_invoice k
                            where k.settlement_id = cs.id and k.account_id = cs.account_id order by k.created_at limit 1), cs.commission_invoice_id)
   where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs.source = 'correo_justeat'
     and si.grand_total < 0 and cs.commission = si.grand_total
), antes as (
  insert into public.s01j3_comision_antes (settlement_id, account_id, commission_antes, commission_ahora)
  select cs.id, cs.account_id, cs.commission, -f.grand_total
    from public.channel_settlement cs join fac f on f.id = cs.id
  on conflict (settlement_id) do nothing
  returning settlement_id, commission_ahora
)
update public.channel_settlement cs set commission = a.commission_ahora, updated_at = now()
  from antes a
 where cs.id = a.settlement_id and cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
