-- scripts/conta/produccion/cuentas/g06-casado.sql
--
-- G06 · Tarea 2 (12/11) · LO QUE CUENTA LA TANDA DEL ENLACE ÚNICO, antes y después. SOLO LEE.
-- La tabla que crea la tanda (conta_gc_enlace) solo se nombra dentro de cadenas.
--
-- Lo que tiene que cambiar: el enlace único (no existe → atados, conflictos y de una persona). Hasta que se despliegue
-- conta-gocardless-leer, solo lo escribe la tanda: no crece solo.
-- Lo demás, igual: las facturas de venta de antes del corte (12/11 09:00Z).
-- El cuadre de QBO y la huella de los dos enlaces de ahora NO van aquí: leen tablas que la lectura de GoCardless
-- reescribe en cualquier momento (avisos al instante) y pararían el ensayo sin culpa de la tanda. Se miden con
-- scripts/conta/g06/cuadre.sql, en solo lectura, antes y después.
select clave, valor from (
  select 1 o, 'enlace único: atados / conflicto / de una persona (base entera)' clave,
    case when to_regclass('public.conta_gc_enlace') is null then 'no existe' else
      (xpath('/row/v/text()', query_to_xml('select count(*) filter (where estado = ''atado'') || '' / '' || count(*) filter (where estado = ''conflicto'') || '' / '' || count(*) filter (where por = ''persona'') v from public.conta_gc_enlace', false, true, '')))[1]::text end valor union all
  select 2, 'enlace único en QBO: atados / conflicto',
    case when to_regclass('public.conta_gc_enlace') is null then 'no existe' else
      (xpath('/row/v/text()', query_to_xml('select count(*) filter (where estado = ''atado'') || '' / '' || count(*) filter (where estado = ''conflicto'') v from public.conta_gc_enlace where account_id = ''f4e8032d-510a-4e57-914c-4b67732d8655''', false, true, '')))[1]::text end union all
  select 3, 'facturas de venta de antes del corte (base entera)',
    (select count(*) from public.customer_invoice where created_at < timestamptz '2026-11-12 09:00:00+00')::text
) t order by o;
