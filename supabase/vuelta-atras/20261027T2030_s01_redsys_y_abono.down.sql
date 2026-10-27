-- supabase/vuelta-atras/20261027T2030_s01_redsys_y_abono.down.sql
--
-- Vuelta atrás de la 2030 (S01 · Redsys y el abono casado), que solo añade: se
-- quita todo lo que crea, en orden inverso. Antes, la de la 2031 (las cuatro
-- funciones del enlace vuelven a no usar las piezas de aquí).
--
-- Las tablas se van con sus filas: los datos del TPV de cada empresa, los
-- intentos de pago y los avisos del banco. Las claves de Redsys guardadas en
-- Vault también se quitan (vault.secrets con nombre «conta_redsys:…»): sin su
-- tabla no las usa nadie. Lo que ya está en otras tablas se queda, porque es
-- verdad con o sin la 2030: los cobros apuntados (customer_invoice_payment),
-- los casados del banco y sus asientos, y el historial de cada factura.
-- Se puede pasar dos veces (todo «if exists»).

drop function if exists public.conta_cobros_abonos(uuid);
drop function if exists public.conta_abono_pasarela_casar(uuid, uuid[], text, text, text);
drop function if exists public.conta_abonos_pasarela_pendientes(uuid);
drop function if exists public.conta_enlace_pago_comision(text, numeric, numeric);
drop function if exists public.conta_redsys_aviso_apuntar(text, uuid, boolean, text, numeric, text, jsonb);
drop function if exists public.conta_enlace_pago_cobrado_redsys(text, text, numeric, text, text);
drop function if exists public._s01_enlace_cobrar(uuid, numeric, text, text, text, date);
drop function if exists public.conta_redsys_aviso_datos(text);
drop function if exists public.conta_enlace_pago_pedido(text, numeric);
drop function if exists public.conta_cobro_redsys_datos(uuid);
drop function if exists public.conta_cobro_redsys_guardar(uuid, text, text, text, boolean, boolean, text, boolean, text);
drop function if exists public.conta_cobro_redsys_leer(uuid);
drop function if exists public._s01_metodos_enlace(uuid);
drop function if exists public._s01_proveedor_enlace(uuid);
drop function if exists public._s01_redsys_estado(public.conta_cobro_redsys);

drop table if exists public.conta_redsys_aviso;
drop table if exists public.conta_enlace_pago_intento;
drop index if exists public.conta_enlace_pago_abono_idx;
alter table if exists public.conta_enlace_pago drop column if exists abono_match_id;
alter table if exists public.conta_enlace_pago drop column if exists neto;
alter table if exists public.conta_enlace_pago drop column if exists comision;
alter table if exists public.conta_enlace_pago drop column if exists proveedor;
delete from vault.secrets where name like 'conta\_redsys:%';
drop table if exists public.conta_cobro_redsys;
