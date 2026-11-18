-- supabase/migrations/20261114T2256_b01r26_token_de_la_c0009.sql
--
-- B01r26 (14/11) · EL TOKEN DE LA C0009. El traspaso de octubre a la C0008 no
-- hablaba con la C0008: el token de Diez va ligado a la base que se abre al
-- entrar (nombre_bd), y la conexión de Foodint guardó uno de la C0009 el 13/11
-- a las 23:05 UTC (el primer ensayo). La limpieza devolvió la conexión a la
-- C0008, pero el token siguió guardado (caduca el 27/11) y ClienteDiez lo
-- reutilizaba sin mirar de qué base era. Así, el traspaso real del 14/11 y el de
-- las 22:10 leyeron la C0009: los «iguales» de 4/3160 … 4/3734 y 1/1953 … que
-- la C0008 no tiene son los asientos del ensayo en la C0009. La lectura de
-- GitHub (octubre-contra-c0008) entra con un token nuevo de la C0008 y por eso
-- da lo correcto. Lo arregla el mismo PR (el token se guarda con su base).
--
-- Esta tanda:
--   1. Quita el token guardado de la conexión de Foodint: la próxima llamada
--      entra de nuevo en la C0008 (también con el código de antes del PR).
--   2. Los envíos del traspaso de octubre que pararon con «en Diez ya hay un
--      asiento igual que no viene de Sumied» o «hay N asientos iguales en Diez
--      ese día» —solo banco, liquidaciones (de canal, de licencia y del IVA) y
--      asientos a mano— se quedan en «pendiente» SIN el motivo, y salen del
--      detalle del traspaso: la tanda siguiente los vuelve a llevar.
-- Las facturas no se tocan, ni los ajustes de ventas ni los pagos a proveedor.
--
-- LA GUARDA DE SUMIED: tienen que ser exactamente 333 (297 + 36), del traspaso
-- de octubre en «traspasando», o no cambia nada.
-- SIN VUELTA ATRÁS, a propósito: el motivo que se quita lo escribió el traspaso
-- comparando con la C0009; devolverlo diría algo falso. Nada en el camino del pedido.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_con constant uuid := '860fcb61-9b95-46da-bc1a-ad73d665f19b';
  v_t uuid; v_ids uuid[]; v_n int;
begin
  if not exists (select 1 from public.company where id = v_e and account_id = v_acc) then
    raise notice 'B01r26: sin la empresa de Foodint (staging), nada que hacer.';
    return;
  end if;
  select id into v_t from public.conta_diez_traspaso where company_id = v_e and account_id = v_acc and mes = date '2026-10-01' and estado = 'traspasando';
  if v_t is null then raise exception 'B01r26: el traspaso de octubre de Foodint no está en «traspasando». No se cambia nada.'; end if;

  select array_agg(x.id) into v_ids
    from public.external_send x join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id
   where x.company_id = v_e and x.account_id = v_acc and x.status = 'pendiente' and x.kind = 'asiento'
     and e.source_type in ('bank', 'channel_settlement', 'licensed_settlement', 'vat_settlement', 'manual')
     and (x.last_error like 'en Diez ya hay un asiento igual que no viene de Sumied%' or x.last_error ~ '^hay [0-9]+ asientos iguales en Diez ese día');
  if coalesce(cardinality(v_ids), 0) <> 333 then
    raise exception 'B01r26: se esperaban 333 envíos parados por «iguales» (banco, liquidaciones y a mano); hay %. No se cambia nada: vuelve a medir.', coalesce(cardinality(v_ids), 0);
  end if;

  -- 1. El token de la C0009, fuera.
  update public.account_connector set token_ref = null, token_expires_at = null where id = v_con and account_id = v_acc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'B01r26: no se ha quitado el token de la conexión.'; end if;

  -- 2. Sin el motivo, y fuera del detalle del traspaso.
  update public.external_send set last_error = null, next_try_at = null, updated_at = now() where id = any (v_ids);
  get diagnostics v_n = row_count;
  if v_n <> 333 then raise exception 'B01r26: se han cambiado % envíos y tenían que ser 333.', v_n; end if;
  update public.conta_diez_traspaso t
     set detalle = coalesce((select jsonb_agg(d) from jsonb_array_elements(t.detalle) d
                              where (d->>'entry_id')::uuid not in (select x.entry_id from public.external_send x where x.id = any (v_ids))), '[]'::jsonb)
   where t.id = v_t;
  update public.conta_diez_traspaso set no_llegaron = jsonb_array_length(detalle) where id = v_t;
  raise notice 'B01r26: token de la conexión quitado; 333 envíos vuelven a ir en el traspaso de octubre.';
end $$;
