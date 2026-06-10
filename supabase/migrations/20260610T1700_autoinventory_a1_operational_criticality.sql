-- 20260610T1700_autoinventory_a1_operational_criticality.sql
--
-- Autoinventario IA — A1 (esquema): criticidad operativa en recipe_item.
--
-- Caso que rompe el ABC clásico (decisión Julio): un consumible BARATO e
-- INVISIBLE cuyo fallo CIERRA la marca — p. ej. las bolsas de envío: coste
-- ridículo, no van en ningún escandallo, el ABC por valor las pondría en clase C
-- (contar trimestral)... pero si faltan, NO SALE UN PEDIDO de delivery: cero
-- ventas, marca cerrada esa noche.
--
-- No se puede DEDUCIR de los datos de venta (una bolsa no está en recetas), así
-- que es un ATRIBUTO MARCABLE del artículo. La IA solo SUGIERE candidatos; el
-- "esto cierra la marca si falta" lo confirma un humano (gerente).
--
-- Modelo (decisión Julio, opción 2): flag + stock mínimo OPCIONAL.
--   - is_operational_critical: el artículo entra en la cola de conteo como
--     OVERRIDE del ABC, pase lo que pase con su valor/rotación.
--   - operational_min_qty: si se fija, salta ALARMA proactiva al bajar de aquí,
--     sin esperar al conteo (el muestreo no salva si se acaba a las 20:00 en
--     servicio). Si no se fija, al menos entra en conteo frecuente.
--
-- DDL puro, sin SECURITY DEFINER → seguro en una transacción.

begin;

alter table recipe_item
  add column if not exists is_operational_critical boolean not null default false,
  add column if not exists operational_min_qty numeric null;

comment on column recipe_item.is_operational_critical is
  'Criticidad operativa: si falta, no se puede operar (ej. packaging de envio). Marcado por gerente; la IA sugiere. Override del ABC.';
comment on column recipe_item.operational_min_qty is
  'Stock minimo operativo (en unidad base), opcional. Si se fija, salta alarma proactiva al bajar de aqui, sin esperar al conteo.';

commit;
