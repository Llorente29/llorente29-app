-- supabase/migrations/20261115T0825_b01r26_los_15_de_la_caida.sql
--
-- B01r26 (15/11) · LOS 15 DE LA CAÍDA. A las 23:56 UTC del 14/11 la renovación
-- del token de Diez falló («Error 5 - Cliente no autorizado»), la conexión de
-- Foodint quedó en `down` y la pantalla siguió lanzando tandas: un asiento se
-- paró con «Conexión con Diez caída» y otros 14 envíos con «la conexión con
-- Diez no está configurada para esta empresa», sin llegar a llamar a Diez. Los
-- 15 están en el detalle del traspaso de octubre, y la tanda se salta lo que
-- está ahí: aunque la conexión vuelva, no viajarían.
--
-- Son, por su envío (external_send), todos «pendiente» y de la conexión de la C0008:
--   asientos  1/1995 (Conexión caída), 1/2019 (a mano), 1/2022 … 1/2032
--             (ajustes de ventas) y 9/4 (nómina);
--   factura   2/3274 (Supabase, EFWCEJ-00008).
--
-- Esta tanda los deja en «pendiente» SIN el motivo y los quita del detalle del
-- traspaso (20 fallos → 5). Los 5 que se quedan son los de a mano en Diez
-- (FV-02927, la 195 y las tres exentas): no se tocan.
--
-- LA GUARDA DE SUMIED: los 15 envíos, exactamente esos, en «pendiente» y con su
-- motivo de la caída, y en el detalle del traspaso de octubre en «traspasando»
-- con 20 fallos; si no, no cambia nada.
-- SIN VUELTA ATRÁS, a propósito: el motivo que se quita dice que la conexión no
-- estaba; devolverlo sería volver a parar 15 envíos por una caída que ya pasó.
-- Nada en el camino del pedido.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_ids constant uuid[] := array[
    '968984c5-161e-40ed-bb80-46a8ac894b27', -- 1/1995
    '3173d64b-c064-414f-bf9f-e3b846197b56', -- 1/2019
    '51e68ebe-415d-4de4-9f48-326d2858debc', -- 1/2022
    '75940e1f-e115-4e75-86f6-40c8316adab9', -- 1/2023
    '10141675-940a-4b4c-8fc1-d196fb2fe31b', -- 1/2024
    '9b492493-3342-4249-8574-ed25a212ceb2', -- 1/2025
    '8f96b2d3-4e3a-4f7e-a238-27f6b915bd05', -- 1/2026
    'a6326475-60ef-4509-b68d-be6e441934a7', -- 1/2027
    '28b430b8-2820-47b4-b255-448451dab188', -- 1/2028
    '067f7400-6bc1-4598-9dc2-9b7ad5c852d8', -- 1/2029
    'fe6b1f02-35b2-423a-8da2-d6b341b8d59d', -- 1/2030
    'bbf5f721-80a6-4bb5-9119-3899ae431ee3', -- 1/2031
    'cf0b362f-add6-4f83-8cfd-878e9e9ce042', -- 1/2032
    '2b8e581c-27c1-468a-b83f-12d0f89af861', -- 9/4
    '6012c690-e5ba-4841-a67a-90d3cf69e26b'  -- 2/3274
  ]::uuid[];
  v_t uuid; v_entries uuid[]; v_n int; v_det int; v_en int;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26: sin la empresa de Foodint (staging), nada que hacer.';
    return;
  end if;
  select id, jsonb_array_length(detalle) into v_t, v_det from public.conta_diez_traspaso
   where company_id = v_e and account_id = v_acc and mes = date '2026-10-01' and estado = 'traspasando';
  if v_t is null then raise exception 'B01r26: el traspaso de octubre de Foodint no está en «traspasando». No se cambia nada.'; end if;
  if v_det <> 20 then raise exception 'B01r26: el detalle del traspaso de octubre tiene % fallos y se esperaban 20. No se cambia nada: vuelve a medir.', v_det; end if;

  select array_agg(x.entry_id) into v_entries
    from public.external_send x
   where x.id = any (v_ids) and x.company_id = v_e and x.account_id = v_acc and x.account_connector_id = v_con
     and x.status = 'pendiente'
     and (x.last_error = 'la conexión con Diez no está configurada para esta empresa' or x.last_error like '%Conexión con Diez caída%');
  if coalesce(cardinality(v_entries), 0) <> 15 then
    raise exception 'B01r26: se esperaban los 15 envíos parados por la caída, en «pendiente»; hay %. No se cambia nada: vuelve a medir.', coalesce(cardinality(v_entries), 0);
  end if;
  select count(*) into v_en from public.conta_diez_traspaso t, jsonb_array_elements(t.detalle) d
   where t.id = v_t and (d->>'entry_id')::uuid = any (v_entries);
  if v_en <> 15 then raise exception 'B01r26: de los 15, % están en el detalle del traspaso y tenían que ser 15. No se cambia nada.', v_en; end if;

  update public.external_send set last_error = null, next_try_at = null, updated_at = now() where id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n <> 15 then raise exception 'B01r26: se han cambiado % envíos y tenían que ser 15.', v_n; end if;
  update public.conta_diez_traspaso t
     set detalle = coalesce((select jsonb_agg(d) from jsonb_array_elements(t.detalle) d
                              where (d->>'entry_id')::uuid <> all (v_entries)), '[]'::jsonb)
   where t.id = v_t;
  update public.conta_diez_traspaso set no_llegaron = jsonb_array_length(detalle) where id = v_t;
  if (select jsonb_array_length(detalle) from public.conta_diez_traspaso where id = v_t) <> 5 then
    raise exception 'B01r26: el detalle no ha quedado en 5 fallos.';
  end if;
  raise notice 'B01r26: los 15 envíos de la caída vuelven a ir en el traspaso de octubre (detalle 20 → 5).';
end $$;
