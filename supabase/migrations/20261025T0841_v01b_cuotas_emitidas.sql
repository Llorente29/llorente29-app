-- supabase/migrations/20261025T0841_v01b_cuotas_emitidas.sql
--
-- V01b · La cuota de IVA de cada línea de las facturas YA EMITIDAS, con la de
-- su asiento (la del libro de expedidas por tipo). Va DESPUÉS de la 0840.
--
-- Medido en producción el 25/10 (solo lectura), Foodint: 1.286 emitidas (1.196
-- traídas de Diez, 85 cierres de octubre y 5 resúmenes de Sumied), todas
-- factura, ninguna rectificativa. En las 1.286, el IVA del libro de su asiento
-- = el IVA de la factura = la 477 del asiento, con los mismos tipos y bases
-- que sus líneas. 108 traídas no tienen PDF porque el IVA calculado sale un
-- céntimo por encima del del libro (Diez trunca el medio céntimo).
--
-- Se rellenan TODAS las emitidas sin cuota (no solo las traídas): así ninguna
-- factura emitida vuelve a calcular su IVA. Nada más cambia: ni la factura,
-- ni el asiento, ni el libro, ni Diez, ni los modelos presentados.
--
-- TOCA DATOS QUE EXISTEN (las líneas de facturas emitidas): pide «autorizo».
-- COPIA PREVIA: _copia_v01b_cuotas (cada línea con su cuota de antes, nula).
-- Comprueba al céntimo, antes de terminar, que la suma de las cuotas de cada
-- factura es su IVA; si alguna no, no aplica nada.
-- Vuelta atrás: supabase/vuelta-atras/20261025T0841_v01b_cuotas_emitidas.down.sql

create table if not exists public._copia_v01b_cuotas (
  line_id     uuid primary key,
  invoice_id  uuid not null,
  cuota_antes numeric,
  copiado_at  timestamptz not null default now()
);
alter table public._copia_v01b_cuotas enable row level security;
revoke all on table public._copia_v01b_cuotas from anon, authenticated;

insert into public._copia_v01b_cuotas (line_id, invoice_id, cuota_antes)
select l.id, l.invoice_id, l.tax_amount
  from public.customer_invoice_line l join public.customer_invoice ci on ci.id = l.invoice_id
 where ci.status <> 'borrador' and l.tax_amount is null
on conflict (line_id) do nothing;

-- La cuota de cada línea, la de _conta_venta_cuotas_de (la del libro de su asiento).
update public.customer_invoice_line l set tax_amount = q.cuota
  from (select distinct invoice_id from public._copia_v01b_cuotas) c
  cross join lateral public._conta_venta_cuotas_de(c.invoice_id) q
 where q.line_id = l.id and l.tax_amount is null;

do $$
declare v_facturas int; v_lineas int; v_mal int; v_ejemplo text;
begin
  -- Nada queda sin cuota, y cada factura suma su IVA, al céntimo.
  if exists (select 1 from public.customer_invoice_line l join public.customer_invoice ci on ci.id = l.invoice_id
              where ci.status <> 'borrador' and l.tax_amount is null) then
    raise exception 'CUOTAS V01b: después de aplicar sigue habiendo líneas de emitidas sin su cuota.';
  end if;
  select count(*), min(numero) into v_mal, v_ejemplo from (
    select ci.number_text as numero from public.customer_invoice ci join public.customer_invoice_line l on l.invoice_id = ci.id
     where ci.status <> 'borrador' and ci.doc_type = 'factura'
     group by ci.id, ci.number_text, ci.tax having sum(l.tax_amount) <> ci.tax) x;
  if v_mal > 0 then
    raise exception 'CUOTAS V01b: % facturas no suman su IVA con la cuota guardada (por ejemplo, %): no se aplica nada.', v_mal, v_ejemplo;
  end if;
  select count(*), count(distinct invoice_id) into v_lineas, v_facturas from public._copia_v01b_cuotas;
  raise notice 'CUOTAS V01b: % líneas de % facturas emitidas con su cuota; cada una suma su IVA, igual que el libro.', v_lineas, v_facturas;
end $$;
