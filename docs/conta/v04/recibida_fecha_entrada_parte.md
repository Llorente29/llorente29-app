# V04 · Respuesta 6, punto 2 · La recibida, nunca antes del día en que entró

*27/10 · rama `conta/recibida-fecha-entrada`. Regla de Julio del 27/10.*

> «El asiento de una factura recibida nunca va antes del día en que entró, aunque el mes esté abierto. Así el asiento y su IVA caen siempre en el mismo trimestre.»

## Lo que hace

- **Al proponer una recibida** con una fecha anterior al día en que entró (`supplier_invoice.created_at`, en Madrid), el asiento va ese día.
  - Si ese mes está cerrado o su IVA presentado, va al primer día abierto desde él.
  - Lo dice: «Esta factura entró el 01/10: se contabiliza el 01/10.»
- **La fecha de la factura no se toca:** el libro de IVA la conserva como fecha de expedición y la registra el día que entró, el mismo del asiento.
- **En los dos sitios:**
  - en el front (`propuestasLibroService`), que es lo que se ve antes de proponer. Va en las razones del asiento, sin bajar la confianza, para que lo seguro se siga apuntando solo;
  - en la base, para cualquier camino que proponga una recibida: `_journal_entry_proponer` (misma firma, con su respaldo) llama a `_conta_recibida_no_antes_de_entrar` después del candado del IVA, y junta los dos avisos.
- **Lo ya asentado no se toca.**

## Lo que hay en producción (solo lectura, 27/10)

- **De las 95 recibidas validadas de Foodint, 90 tienen el asiento antes del día en que entraron.**
- Las 90 están asentadas en la fecha de su factura y entraron de 1 a 14 días después (mediana, 3).
- Ninguna cae en otro mes ni en otro trimestre: hoy el 303 no se ve afectado.
- Su libro de IVA ya las registra el día que entraron. Desde esta regla, el asiento cae ese mismo día.

## Lo probado

- **Staging, en ROLLBACK** (`supabase/staging/sql/20261027_v04_recibida_fecha_entrada_prueba.sql`), por los caminos: proponer y validar.
  - Una que entró después: asiento y libro el día de entrada.
  - La del día y un asiento a mano: sin cambio.
  - Mes de entrada cerrado: el primer día abierto.
  - Con el periodo presentado: el candado y esta regla a la vez.
  - La vuelta atrás, byte a byte.
- **Unitarias** con recibidas reales de Foodint (`tests/unit/modules/conta/recibidaFechaEntrada.test.ts`).

## La tanda

`sumied/conta-recibida-fecha-entrada`: la 1350, con su cuenta y su vuelta atrás. El analizador dice **sigue**: **sin autorizo**.
