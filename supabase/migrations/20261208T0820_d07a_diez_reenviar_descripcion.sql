-- supabase/migrations/20261208T0820_d07a_diez_reenviar_descripcion.sql
--
-- D07a · DATOS: las recibidas que Diez rechazó por la descripción, otra vez a
-- la cola (Julio, 23/10). Diez no admite `factura.Descripcion` de más de 40
-- caracteres, y la de las recibidas de RIDERS («<número>-<nombre del rider>»)
-- pasaba: «ES I 34427 26 00014-ROBLES SENGES EDGAR JOSE» mide 44 (asiento
-- 3248). El arreglo es de las funciones (_shared/diezTexto.ts: en 40, con el
-- número entero), y se despliega con conta-diez-cola y conta-diez-enviar.
--
-- Medido en producción el 23/10 a las 13:17 UTC, solo lectura: 60 envíos de
-- Foodint con ese error desde las 12:55, todos de RIDERS, todos «pendiente»
-- (34 con 1 intento y 26 con 2). Con 3 intentos la cola deja de mandarlos («lo
-- tiene que mirar una persona») y nada vuelve a ponerlos a cero: por eso esta
-- tanda.
--
-- Les pone attempts = 0 y next_try_at = ahora: la cola (conta-diez-cola, cada
-- minuto) los vuelve a mandar con la descripción en 40. Nada más: ni estado,
-- ni nada en Diez (allí no se escribió nada: Diez los rechazó).
--
-- ¡ORDEN! Esta tanda va DESPUÉS de desplegar conta-diez-cola y
-- conta-diez-enviar con el arreglo. Antes, la cola los volvería a mandar con la
-- descripción larga y gastaría los intentos otra vez.
--
-- Anclado por cuenta y proveedor (regla 9): las de Foodint, de RIDERS
-- (cbe3ddb1-…), «pendiente», de tipo factura, cuyo último error es el de la
-- descripción (o el corte que vino detrás de él). PARA si no hay ninguna, o si
-- son más de 200 (otra cosa: se vuelve a medir). En staging, nada.
-- No toca el camino del pedido, ni coste ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql
do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_prov constant uuid := 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1';
  v_n int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'D07a 0820: esta base no tiene la cuenta de Foodint (staging): no hay envíos que reponer.';
    return;
  end if;
  create temp table _d07a_reenviar on commit drop as
  select x.id
    from public.external_send x
    join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id and e.source_type = 'supplier_invoice'
    join public.supplier_invoice i on i.id = e.source_id and i.account_id = x.account_id
   where x.account_id = v_acc and i.supplier_id = v_prov and x.kind = 'factura' and x.status = 'pendiente'
     and x.last_error not like 'Se vuelve a mandar%'
     and (x.last_error ilike '%factura.Descripcion%' or x.last_error ilike '%intento anterior: Diez no ha aceptado la factura%');
  select count(*) into v_n from _d07a_reenviar;
  if v_n = 0 then raise exception 'D07a 0820: no hay ningún envío de RIDERS rechazado por la descripción. No se cambia nada: vuelve a medir.'; end if;
  if v_n > 200 then raise exception 'D07a 0820: son % (más de 200): no es lo medido. No se cambia nada.', v_n; end if;
  update public.external_send x
     set attempts = 0, next_try_at = now(), updated_at = now(),
         last_error = 'Se vuelve a mandar con la descripción en 40 caracteres (D07a). Antes: ' || left(x.last_error, 300)
    from _d07a_reenviar r
   where x.id = r.id;
  get diagnostics v_n = row_count;
  raise notice 'D07a 0820: % envíos de RIDERS, otra vez a la cola.', v_n;
end $$;
