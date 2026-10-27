# V04 · Respuesta 5 · PR 1 · El candado del IVA

*27/10 · rama `conta/iva-presentado-candado`. PR 1 de 2: el candado (puntos 1, 2, 4, 5 y 6). «Reabrir para corregir» (punto 3) va en el PR 2.*

> La regla de Julio: «Una vez presentado el modelo de un periodo, está totalmente prohibido contabilizar o modificar su IVA. Una factura contabilizada después de presentar el trimestre nunca entra en el trimestre cerrado: va al periodo abierto.»

## Lo que hace

### 1 · El candado, en la base

- **Presentado** = el 303 del periodo (trimestral o mensual) en `filed`, `booked`, `paid`, `offset` o `refunded`, los mismos que Impuestos cuenta como hechos.
- **Lo decide un solo sitio:** `conta_iva_presentado(empresa, día)`. El PR 2 abrirá ahí el «Reabrir para corregir».
- **Tres disparadores paran, con el periodo presentado:**
  - en el asiento: validar uno con IVA fechado en él, anular uno validado, y cambiar o mover a él uno sin validar;
  - en el apunte: crear o cambiar un apunte de IVA (472, 477 o con libro) de un asiento de ese periodo;
  - en el libro de IVA: crear, cambiar o borrar una anotación del periodo, o poner en él un «deducida en».
- **Lo que no es su IVA sí se completa:** el número, el NIF o el nombre de la contraparte, y la retención. «Completar» del libro sigue funcionando.
- **El mensaje, en lenguaje de oficina:** «El IVA del 3T de 2026 ya está presentado (20/10). No se puede cambiar. Esta factura va al 4T.»
  - A lo que ya estaba dentro (anular, cambiar su libro), en lugar de «Esta factura va», dice «Lo que haya que corregir va al 4T».
  - Mensual: «El IVA de agosto de 2026 ya está presentado (18/09)… Esta factura va a octubre.»

### 2 · La recibida tardía va al periodo abierto, sin preguntar

- `_journal_entry_proponer` (misma firma, con su respaldo byte a byte) la asienta en el primer día con el mes abierto y el IVA sin presentar.
  - Y nunca antes del día en que entró, para que asiento e IVA caigan en el mismo periodo. Su libro la registra ese día (D07, 0850).
- **La fecha de la factura no se toca.**
- **Lo dice:** en el porqué del asiento, con su cita (LIVA art. 99.Tres): «El 3T ya está presentado. Esta factura se deduce en el 4T.» La ficha lo enseña antes de validar y lo repite al validar.
- **Una expedida o un día de ventas no se mueve de periodo:** para, con el mensaje.

### 3 · En las pantallas

- **El candado en el mes y en el trimestre:**
  - en el diario: junto a la fecha de cada asiento cerrado y en el resumen del mes;
  - en el libro de IVA: en el selector de periodo, con su línea;
  - en Impuestos › Trimestre: en el 1T…4T y en la cabecera.
- **Ningún botón lleva a algo prohibido:**
  - la ficha del asiento no ofrece «Validar» ni «Anular»;
  - «Validar y enviar a Diez» no los cuenta;
  - «Nuevo asiento» no deja guardar con IVA en una fecha presentada, y lo dice.
- Si la base aún no tiene la 1233, las pantallas no pintan candado y siguen como antes.

## No entran en el candado (decide Julio si alguno debe entrar)

- **Lo traído de Diez (`migrated`):** es el libro con el que se presentó. En producción son los únicos asientos de IVA creados después de presentar (1T 1108, 2T 748).
- **El asiento de liquidación del propio 303 (`vat_settlement` de esa declaración):** nace al contabilizarla, ya presentada.
- **La apertura y el cierre del ejercicio.**
- **Borrar un asiento SIN validar:** nunca llegó al libro. Uno validado no se borra nunca (`journal_entry_inalterable`).

## F-2026-0915 (punto 5)

- **De dónde salía:**
  - `seed_c01_staging` creaba la factura el día que se pasaba la semilla (01/10, 22:40 UTC);
  - `seed_c04_staging` la asentaba el 24/09;
  - el libro la registra el día que entró (01/10).
  - Asiento en el 3T e IVA en el 4T: el agente de los libros (#347) lo veía en rojo.
- **Arreglado en este PR:**
  - la semilla crea la factura el día de su fecha;
  - `seed_v04_0915_entro_el_24_staging.sql` deja así lo que ya está en staging.
- **El 3T de la cuenta A de staging no está presentado**, así que no rompía el candado. Con el candado, una semilla que lo intentara con el 3T presentado PARA.
- **La regla que propongo (no la aplica este PR):** el asiento de una recibida, no antes del día en que entró.
  - Hoy, con el mes abierto, se puede asentar el día de la factura aunque entrara después, y entonces el asiento y su IVA quedan en trimestres distintos.
  - Para la tardía con el periodo presentado, este PR ya lo hace así.

## Lo medido en producción (punto 4, solo lectura, 27/10)

- **Foodint tiene presentados el 303 del 1T, del 2T y del 3T de 2026** (20/04, 20/07 y 20/10).
- **Después de presentar:**
  - asientos de IVA creados: solo traídos de Diez;
  - anotaciones del libro cambiadas: 0;
  - «deducida en» puestos: 0.
- **Asientos de Sumied con IVA en un periodo presentado: 0.** Hoy el candado no para nada de lo que hay.

## Lo probado

- **Staging, en ROLLBACK** (`supabase/staging/sql/20261027_v04_iva_presentado_candado_prueba.sql`), por los caminos (regla 10): proponer, validar, anular y el libro, con el 2T de la empresa A presentado.
  - Cada operación del punto 1 PARA con su mensaje.
  - Lo que no es su IVA se completa.
  - La tardía va al 3T con su aviso y su libro.
  - La expedida para.
  - Mensual, permisos y la vuelta atrás byte a byte.
  - Run verde: 636.
- **Unitarias** (`tests/unit/modules/conta/ivaPresentado.test.ts`), con los tres 303 reales de Foodint.
- **e2e de pantalla** (`tests/e2e/conta/v04/candado-iva.spec.ts`), con lo de la base simulado:
  - la ficha de F-2026-0915 sin «Anular» y con el mensaje;
  - el diario;
  - el trimestre.

## La tanda

`sumied/conta-iva-presentado-candado`: la 1233, con su cuenta (`cuentas/v04-iva-candado.sql`) y su vuelta atrás.

- **El analizador dice «sigue»:** ni camino del pedido ni nada que destruya. **Sin autorizo.**
