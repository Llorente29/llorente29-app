-- supabase/migrations/20261207T0810_d06_riders_prepago.sql
--
-- D06 · DATOS: la ficha de RIDERS de Foodint, con su forma de pago «Saldo
-- prepago Catcher» (40700001) (Julio, 23/10, punto 5 del encargo). Las
-- facturas de Riders se pagan del saldo que se recarga por adelantado: no
-- esperan a un vencimiento. La ficha de la recibida la toma de la ficha del
-- proveedor y no la pone «por revisar» por el vencimiento.
--
--   · RIDERS · cbe3ddb1-5d3a-4aa7-a907-38f362e922b1 · Foodint
--     (51ad1792-6629-4ef7-833a-b57b09a86710) · sin NIF · payment_method nulo ·
--     82 recibidas (medido en producción el 23/10, solo lectura).
--
-- Cambia UNA fila que existe: AUTORIZO con su nombre. Solo payment_method: ni
-- updated_at (la vuelta atrás la deja exactamente como estaba), ni sus
-- facturas (su payment_method sigue nulo: la forma prevista la da la ficha
-- del proveedor). Ningún disparador de supplier mira payment_method.
-- Anclado por cuenta e id (regla 9). PARA, sin cambiar nada: si no es RIDERS,
-- si está archivado o si ya tiene otra forma de pago. En una base sin Foodint
-- (staging), no hace nada y lo dice.
-- Necesita la 0800 (el CHECK que admite 'prepaid').
-- No toca el camino del pedido, ni coste ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261207T0810_d06_riders_prepago.down.sql
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_prov constant uuid := 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1';
  v_s record;
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D06 0810: esta base no tiene la cuenta de Foodint (staging): no hay ficha que cambiar.';
    return;
  end if;
  select s.name, s.payment_method, s.archived_at into v_s from public.supplier s where s.account_id = v_acc and s.id = v_prov for update;
  if not found then raise exception 'D06 0810: RIDERS (%) no está en Foodint. No se cambia nada.', v_prov; end if;
  if v_s.name is distinct from 'RIDERS' then raise exception 'D06 0810: ese proveedor se llama «%», no RIDERS. No se cambia nada.', v_s.name; end if;
  if v_s.archived_at is not null then raise exception 'D06 0810: RIDERS está archivado. No se cambia nada.'; end if;
  if v_s.payment_method = 'prepaid' then raise notice 'D06 0810: RIDERS ya tenía «prepaid».'; return; end if;
  if v_s.payment_method is not null then
    raise exception 'D06 0810: RIDERS ya tiene forma de pago (%): no la piso. Vuelve a medir.', v_s.payment_method;
  end if;
  update public.supplier set payment_method = 'prepaid' where account_id = v_acc and id = v_prov and payment_method is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'D06 0810: se iban a cambiar % filas, no 1. No se cambia nada.', v_n; end if;
  raise notice 'D06 0810: RIDERS, con «Saldo prepago Catcher» (prepaid).';
end $$;
