-- supabase/migrations/20261115T0016_b01r26_enlaces_de_la_c0009.sql
--
-- B01r26 (15/11) · LOS ENLACES A LA C0009. Hasta la 2256 (el token de la C0009,
-- #692), todo lo que hizo conta-diez-traspaso con Foodint fue en la C0009. Quedan
-- 301 envíos de octubre que apuntan a documentos de la C0009, de antes de las
-- 22:00 UTC del 14/11:
--   · 284 facturas de los Excel «enlazado» por «Ya lo he importado» (134 de la
--     serie 1 y 150 de la 2);
--   · 16 asientos «enlazado» (13 de la serie 1, 2 de la 2 y 1 de la 9);
--   · la factura FV-02931, «enviado» como 2/3365.
-- La lectura octubre-contra-c0008 (run 43651669816) dice que NINGUNO es lo mismo
-- en la C0008: 281 apuntan a otro asiento (ni el tercero ni la fecha son los
-- mismos), 18 a un documento que no existe y 2 a otro mes. Y ocupan los números
-- de la C0008: «Ya lo he importado» paró a las 23:55 con external_send_ext_uq.
-- Los 332 asientos que el traspaso escribió en la C0008 esta noche (desde las
-- 22:24 UTC) no se tocan. Ojo: 283 de las facturas no llevan la conexión
-- (account_connector_id nulo: «Ya lo he importado» no la rellena al enlazar).
--
-- Esta tanda:
--   1. Los 301 vuelven a «pendiente», sin la referencia de Diez y con la de
--      antes en el motivo. «Ya lo he importado» los vuelve a enlazar con la C0008
--      (las facturas de los Excel) y «Seguir traspasando» manda los demás.
--   2. Los 16 asientos de la API que pararon con «igual que no viene de Sumied»
--      comparando con la C0009 —13 ajustes de ventas y 3 pagos a proveedor, los
--      que se quedaron fuera de la 2256— se quedan en «pendiente» sin el motivo
--      y salen del detalle del traspaso.
--
-- LA GUARDA DE SUMIED: 284 + 16 + 1 y 16, con el traspaso de octubre en
-- «traspasando», o no cambia nada. SIN VUELTA ATRÁS, a propósito: devolverlos a
-- «enlazado» diría que están en la C0008 y no están. Nada en el camino del pedido.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_corte constant timestamptz := '2026-11-14 22:00+00';
  v_t uuid; v_f int; v_a int; v_v int; v_aj uuid[]; v_n int;
  v_hoy constant text := to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI');
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26: sin la empresa de Foodint (staging), nada que hacer.';
    return;
  end if;
  select id into v_t from public.conta_diez_traspaso where company_id = v_e and account_id = v_acc and mes = date '2026-10-01' and estado = 'traspasando';
  if v_t is null then raise exception 'B01r26: el traspaso de octubre de Foodint no está en «traspasando». No se cambia nada.'; end if;

  select count(*) filter (where status = 'enlazado' and kind = 'factura'), count(*) filter (where status = 'enlazado' and kind = 'asiento'),
         count(*) filter (where status = 'enviado')
    into v_f, v_a, v_v
    from public.external_send
   where company_id = v_e and account_id = v_acc and (account_connector_id = v_con or account_connector_id is null) and status in ('enlazado', 'enviado') and sent_at < v_corte;
  select array_agg(x.id) into v_aj
    from public.external_send x join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id
   where x.company_id = v_e and x.account_id = v_acc and x.status = 'pendiente' and x.kind = 'asiento'
     and e.source_type in ('sales_adjustment', 'supplier_payment') and x.last_error like 'en Diez ya hay un asiento igual que no viene de Sumied%';
  if v_f <> 284 or v_a <> 16 or v_v <> 1 or coalesce(cardinality(v_aj), 0) <> 16 then
    raise exception 'B01r26: se esperaban 284 facturas y 16 asientos «enlazado», 1 «enviado» de antes de las 22:00 UTC y 16 parados por la C0009; hay %, %, % y %. No se cambia nada: vuelve a medir.', v_f, v_a, v_v, coalesce(cardinality(v_aj), 0);
  end if;

  -- 1. Los 301, a «pendiente», con la referencia de la C0009 en el motivo.
  update public.external_send s
     set status = 'pendiente', next_try_at = null, sent_at = null, updated_at = now(),
         last_error = format('Enlace a la C0009: el traspaso del 14/11 leyó la C0009 (token de la C0009) y lo dio por %s %s/%s/%s; en la C0008 no es ese (lectura octubre-contra-c0008, %s). Vuelve al traspaso de octubre (B01r26).',
                             s.status, s.ext_year, s.ext_series, s.ext_number, v_hoy),
         ext_year = null, ext_series = null, ext_number = null, ext_invoice_number = null
   where s.company_id = v_e and s.account_id = v_acc and (s.account_connector_id = v_con or s.account_connector_id is null) and s.status in ('enlazado', 'enviado') and s.sent_at < v_corte;
  get diagnostics v_n = row_count;
  if v_n <> 301 then raise exception 'B01r26: se han cambiado % envíos y tenían que ser 301.', v_n; end if;

  -- 2. Los 16 parados por la C0009, sin el motivo y fuera del detalle.
  update public.external_send set last_error = null, next_try_at = null, updated_at = now() where id = any (v_aj);
  update public.conta_diez_traspaso t
     set detalle = coalesce((select jsonb_agg(d) from jsonb_array_elements(t.detalle) d
                              where (d->>'entry_id')::uuid not in (select x.entry_id from public.external_send x where x.id = any (v_aj))), '[]'::jsonb)
   where t.id = v_t;
  update public.conta_diez_traspaso set no_llegaron = jsonb_array_length(detalle) where id = v_t;
  raise notice 'B01r26: 301 enlaces a la C0009 deshechos y 16 parados por la C0009 otra vez al traspaso.';
end $$;
