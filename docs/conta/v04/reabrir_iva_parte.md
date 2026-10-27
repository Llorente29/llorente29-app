# V04 · Respuesta 5, punto 3 · PR 2 del candado del IVA: «Reabrir para corregir»

*27/10 · rama `conta/iva-reabrir`.*

## Lo que hace

- **«Reabrir para corregir el 3T»** está en Impuestos › Trimestre, debajo de la ficha del 303, escondido en «Más».
  - Solo lo ven y lo pueden usar el administrador de la empresa o su gestor (la asesoría que presenta, con consentimiento). Un encargado, no.
- **Antes de reabrir, el diálogo dice:** «¿Solo es una factura recibida? Se deduce en el 4T sin reabrir», con su botón para no reabrir.
- **Para reabrir pide:**
  - un motivo escrito (al menos diez letras);
  - el tipo de la nueva presentación (complementaria o sustitutiva);
  - la confirmación: «La presentación del 20/10 se queda como estaba. Lo que cambies irá en una nueva presentación».
- **La presentación original no se toca nunca.** Se crea otra declaración del mismo periodo, con `sequence` + 1 y `replaces_return_id` apuntando a la última presentada.
- **Mientras está reabierto:**
  - el candado no para nada de ese periodo (`conta_iva_presentado`);
  - cada asiento con IVA creado, validado, anulado o cambiado, y cada cambio de su libro, queda marcado con quién, cuándo, el motivo y la nueva presentación (`vat_reopening_entry`);
  - el diario lo enseña en la ficha del asiento: «Validado con el 3T de 2026 reabierto para corregir: Julio el 28/10 · «…» · va en la complementaria nº 2.»
- **Se vuelve a cerrar solo** al registrar la nueva presentación.
  - «Apuntar la nueva presentación» pide su CSV, la fecha, el resultado y el importe.
  - Con ella, el candado vuelve, con la fecha de la nueva en el mensaje.
- **El trimestre reabierto sale en rojo:** «Reabierto para corregir, sin presentar · complementaria nº 2».
  - A los 30 días sin presentar, aviso al administrador (`encolar_alerta`, una vez cada 7 días; cron `iva-reabierto-recordar`, cada día a las 07:17 UTC).
- **En Impuestos, la original y la nueva salen juntas**, también cuando ya está cerrada.

## Lo que no hace (y queda para después)

- **Calcular las casillas de la complementaria desde el libro.** El cálculo de hoy (`conta_impuesto_303_calcular`) trabaja con la primera presentación del periodo. La nueva se presenta en la sede de Hacienda y aquí se apunta con su CSV.
- **Cancelar una reapertura sin presentar:** la vuelta atrás no lo hace.

## Lo probado

- **Staging, en ROLLBACK** (`supabase/staging/sql/20261027_v04_iva_reabrir_prueba.sql`), por los caminos:
  - quién reabre: B no, el encargado no; el administrador sin motivo no, con motivo sí; dos veces no;
  - la original intacta y la nueva nº 2;
  - reabierto, se propone, se valida y se anula en el periodo, y queda marcado;
  - las pantallas;
  - apuntar la nueva: con un CSV malo no; con el bueno, se cierra y el candado vuelve;
  - el aviso a los 30 días;
  - la vuelta atrás: para con reaperturas; sin ellas, byte a byte.
- **Unitarias** con el 3T real de Foodint reabierto (`tests/unit/modules/conta/ivaReabrir.test.ts`).
- **e2e de pantalla** (`tests/e2e/conta/v04/reabrir-iva.spec.ts`), con lo de la base simulado.

## La tanda

`sumied/conta-iva-reabrir`: la 1408, con su cuenta y su vuelta atrás. El analizador dice **sigue**: **sin autorizo**. Hoy no hay ninguna reapertura: el candado sigue igual.
