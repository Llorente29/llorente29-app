-- supabase/migrations/20261101T0921_s01l_releer_foodint.sql
--
-- S01l · Vuelve a leer la factura de Foodint que falló el 01/11 por su
-- retención (Julio): la llegada de «LLORENTE29-FOOD-S.L.pdf» (correo «Fwd:
-- FACTURA DEL MES»), que se quedó «recibido» sin factura. Su lectura sí está
-- (goods_receipt_ai_session, medida el 01/11: 19 % y 204,46 € sobre una base
-- de 1.076,12 €, que es 204,46 €): con la 0920 entra con el tipo «Alquiler de
-- local», «Por revisar». Solo esa llegada, por su cuenta, y solo si sigue sin
-- factura; si ya la tiene, o no está (staging), no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_inbox constant uuid := '55541602-d1bc-4fc4-97da-041a1822c205';
  v_sesion constant uuid := 'f1fd89f8-8597-4a76-92ae-bdebdaa27f1e';
  r jsonb;
begin
  if not exists (select 1 from public.document_inbox where id = v_inbox and account_id = v_acc and supplier_invoice_id is null)
     or not exists (select 1 from public.goods_receipt_ai_session where id = v_sesion and account_id = v_acc) then
    raise notice 'S01l 0921: la llegada de Foodint no está o ya tiene su factura: no hay nada que hacer.';
    return;
  end if;
  r := public.conta_factura_desde_lectura(v_inbox, v_sesion);
  if r->>'estado' <> 'factura' or (select withholding_rate_id from public.supplier_invoice where id = (r->>'factura_id')::uuid) is null then
    raise exception 'S01l 0921: la factura de Foodint no ha entrado con su retención: %', r;
  end if;
  raise notice 'S01l 0921: %', r->>'texto';
end $$;
