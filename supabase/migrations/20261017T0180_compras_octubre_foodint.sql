-- ============================================================================
-- Compras · 9 · OCTUBRE DE FOODINT: el camino de lo ya recibido
-- ----------------------------------------------------------------------------
-- Encargo «Contabilidad: las compras», tarea 7. El disparador de la 0120 da
-- camino a cada recepción que se CONFIRMA desde que existe; las confirmadas
-- antes (octubre, desde el día siguiente al corte del 30/09) no lo tienen.
-- Esto se lo da, con la misma función (_compras_camino_rellena), solo en
-- Foodint y por id. Lo que crea queda apuntado en _compras_relleno_octubre
-- para que la vuelta atrás quite eso y nada más.
--
-- Medido en producción (solo lectura, 10/10): 18 recepciones confirmadas del
-- 01/10 al 09/10, las 18 con papel leído y ninguna factura ya registrada de
-- sus papeles. Lo que se espera (con la 0110 y la 0130 aplicadas):
--   · 14 del socio de marca: 1 a su nombre (va a su liquidación) y 13 a
--     nombre de sus locales, que preguntan «a nombre de quién» (dos nombres:
--     contestar dos veces resuelve las 13);
--   · 1 albarán de un proveedor cuya ficha dice «con cada entrega»: pregunta;
--   · 3 facturas de dos proveedores sin forma de facturar: se crean las 3
--     facturas «en revisión» y preguntan la forma.
-- Lo que diga el ensayo del workflow manda; el aviso final lo cuenta.
--
-- PARA si la 0110 o la 0130 no están (la ficha del socio no liquida cada mes):
-- sin ellas las 14 del socio saldrían «pendiente de factura».
-- Vuelta atrás: supabase/vuelta-atras/20261017T0180_compras_octubre_foodint.down.sql
-- ============================================================================

create table if not exists public._compras_relleno_octubre (
  goods_receipt_id    uuid primary key,
  supplier_invoice_id uuid,
  created_at          timestamptz not null default now()
);
alter table public._compras_relleno_octubre enable row level security;
revoke all on public._compras_relleno_octubre from public, anon, authenticated;
comment on table public._compras_relleno_octubre is
  'Compras (10/10). Lo que dio camino la 0180 en octubre de Foodint, para poder deshacerlo. Se borra con su vuelta atrás.';

do $$
declare
  c_foodint constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  c_socio   constant uuid := '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e';
  v_antes uuid[]; v jsonb; v_resumen text;
begin
  if not exists (select 1 from public.accounts where id = c_foodint) then
    raise notice 'Compras · octubre: esta base no tiene la cuenta de Foodint; no hago nada.';
    return;
  end if;
  if (select invoicing_mode from public.supplier where id = c_socio) is distinct from 'monthly_settlement' then
    raise exception 'Compras · octubre: la ficha del socio no liquida cada mes. Aplica antes la 0110 y la 0130.';
  end if;
  v_antes := array(select goods_receipt_id from public.goods_receipt_path where account_id = c_foodint);
  v := public._compras_camino_rellena(c_foodint, date '2026-10-01');
  insert into public._compras_relleno_octubre (goods_receipt_id, supplier_invoice_id)
  select p.goods_receipt_id, p.supplier_invoice_id from public.goods_receipt_path p
   where p.account_id = c_foodint and not (p.goods_receipt_id = any(v_antes))
  on conflict (goods_receipt_id) do nothing;
  select string_agg(format('%s %s%s', n, path, coalesce(' / ' || question, '')), ' · ' order by path, question) into v_resumen
    from (select p.path, p.question, count(*) n from public.goods_receipt_path p join public._compras_relleno_octubre r using (goods_receipt_id)
           group by 1, 2) x;
  raise notice 'Compras · octubre: % recepciones con camino (%). % facturas creadas en revisión.',
    v->>'recepciones', coalesce(v_resumen, 'ninguna'),
    (select count(*) from public._compras_relleno_octubre where supplier_invoice_id is not null);
end $$;
