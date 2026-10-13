# C04b · Respuesta 15 — el PDF guardado en Folvy y «Validar y enviar a Diez» (13/10)

**Sin importes**: el repositorio es público.

Julio (R15): «Mientras Cegid activa los documentos: guarda el PDF en el
storage de Folvy enlazado a su asiento, con «Ver documento» en el Libro, y haz
«Validar y enviar a Diez» con el freno de que sin documento adjunto no se da
por enviada. No escribas nada en C0008.»

**En C0008 no se ha escrito nada, y el código no puede**: ver §3.

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| Base: bucket privado `conta-documentos` (solo PDF), `journal_entry_document`, `conta_resumen_ventas`, `conta_documento_guardar`, `external_send.document_*` | `supabase/migrations/20261021T0100_conta_documentos.sql` |
| El PDF, de lo que devuelve la base | `supabase/functions/_shared/resumenDeAsiento.ts` (+ `resumenVentasPdf.ts`) |
| El envío a Diez, con sus frenos | `supabase/functions/_shared/diezEnviar.ts` |
| La función del servidor | `supabase/functions/conta-diez-enviar/index.ts` (`verify_jwt = true`) |
| Libro diario y asiento | `src/modules/conta/libro/ConDiez.tsx`, `LibroDiarioPage.tsx`, `AsientoPage.tsx` |
| Estados en palabras | `src/modules/conta/lib/conDiez.ts` |

**El documento.** Se hace en el navegador cuando se valida un asiento de
ventas de una plataforma, tanto con «Validar asiento» como con «Validar y
enviar a Diez». Después:
- se sube a `conta-documentos/<cuenta>/<asiento>/<huella>.pdf`;
- se enlaza a su asiento con `conta_documento_guardar`, que comprueba:
  - la ruta es de su cuenta y de su asiento;
  - el fichero está subido y tiene ese tamaño;
  - el asiento está validado;
  - el asiento no tiene ya otro documento. Si es el mismo, devuelve el que
    hay: nunca dos veces.

Va solo de un asiento **validado** porque el PDF lleva su número, y lo
validado no cambia.

Con Uber (factura medida en Diez), el PDF lleva el número de factura
(`UBR-FLO-AAAAMMDD`). Con Glovo y Just Eat todavía no hay factura medida, así
que lleva el número del asiento (`Ventas nº …`). Muestra con datos inventados:
`docs/conta/maquetas/c04b/ResumenDeVentas_muestra_sin_factura.pdf`.

**«Ver documento»** está en la tarjeta «Con Diez» del asiento. Abre una URL
firmada que dura cinco minutos. Solo leen los de la cuenta (RLS del bucket).

**«Validar y enviar a Diez»** está en el Libro diario y en el asiento.
- Del Libro: el botón dice cuántos propuestos hay.
- Antes de enviar, el diálogo enseña la lista con casillas, **cuántos y el
  total** (lo que cobran las plataformas, la 430).
- Después dice qué ha pasado con cada asiento: validado, con documento y en
  Diez, o por qué no.

**Estados**, tal como los pidió la R13:
- «Propuesto»
- «Validado · enviando a Diez»
- «En Diez · 1/1801»
- «No ha llegado a Diez: <motivo>», con «Reintentar»

En la fila del libro sale un chip corto, con la frase entera en el `title`.

## 2 · El freno: sin documento adjunto, no está «En Diez»

Se aplica en tres sitios:
1. **Servidor, antes de hablar con Diez.** Si Folvy no tiene el PDF del
   asiento guardado, no se abre la conexión y queda «falta el documento».
2. **Servidor, después.** El PDF se sube y se lee de vuelta. Solo queda
   `document_status = adjunto` si Diez devuelve la misma huella. Si no:
   «No ha llegado a Diez: falta el documento». «Reintentar» solo vuelve a
   subir el documento, porque la factura ya está.
3. **Pantalla.** «En Diez» exige `adjunto`. Una factura que Diez tiene sin su
   PDF sigue diciendo «No ha llegado a Diez: falta el documento».

Y lo que dejó el R14: **si Diez responde que no tiene contenedor de
documentos** (el 500 de Cegid), no se da de alta la factura. El servidor lo
pregunta antes con una factura que Diez ya tiene. El aviso es: «Diez todavía
no guarda documentos (falta que Cegid active su almacén): no se envía la
factura sin su PDF». Así no queda una factura a medias en Diez.

## 3 · Los frenos de Diez, en código y probados uno a uno

`tests/conta/diez/enviar.test.ts` tiene 19 pruebas.
- **C0008 cerrado.** Con la conexión en C0008, se para antes de abrir el
  cliente: «Diez real (C0008) está cerrado: no se escribe nada hasta que Julio
  lo autorice». Además, la función no pasa nunca `escribirEnReal`, así que el
  cliente de Diez se negaría igual.
- **C0001 vetada.**
- **Nunca dos veces.**
  - Antes de enviar se busca por serie, número y 430, y si ya está se enlaza.
  - Si hay dos con el mismo número, no se toca nada.
  - La intención de escribir se apunta antes de escribir.
- **Como mucho 3 intentos.**
- **El PDF que va es el guardado**, con la huella registrada.

**Comprobado que las pruebas pueden fallar.** Quité a mano el freno de C0008
y el de «sin documento» y las dos pruebas se pusieron en rojo; con el código
bueno, 19 de 19.

**En producción hoy:** no hay conexión de Diez (`account_connector` vacío para
Diez, medido el 13/10). El envío contestaría «la conexión con Diez no está
configurada para esta empresa» y no escribiría nada. Aunque la hubiera, sería
C0008, y estaría cerrado.

## 4 · Staging

**Base**, runs 154 y 155 de `aplicar-staging-conta`: ensayo con ROLLBACK, real
y prueba, todo en verde. La prueba
`supabase/staging/sql/20261021_conta_documentos_prueba.sql`:
- Propone un día de Glovo de A y, como administrador de A:
  - lee el resumen: 2 pedidos, la 430 al debe;
  - no puede guardar el documento de un propuesto;
  - valida el asiento;
  - no puede enlazar sin fichero subido;
  - no puede subir a la carpeta de B;
  - no puede enlazar con otro tamaño ni con una ruta de otra cuenta;
  - enlaza el documento una vez; si repite, recibe el que hay; otro
    documento, no;
  - no puede escribir directamente en la tabla.
- Como administrador de B: no lee el resumen, ni la fila, ni el fichero.

**e2e** (`tests/e2e/conta/c04/conDiez.spec.ts`), en ordenador y móvil:
- el botón con cuántos;
- el diálogo con una casilla por propuesto y «N asientos · X €»;
- desmarcar uno cambia la cuenta;
- Cancelar no toca nada;
- la tarjeta «Con Diez» de un asiento de Glovo.

Resultado: **ver §6**.

**Lo que la e2e NO hace, y lo digo:** validar en el navegador. Validar deja
huella para siempre en staging. Además, la bajada de la 0130 PARA si hay
unidades validadas, así que rompería el siguiente real de la tanda en staging.
Por eso el camino «validar → PDF en el navegador → subir → enlazar» no se ha
probado de punta a punta en un navegador:
- la parte de base la prueba el SQL de arriba, como usuario;
- el PDF y el envío, las pruebas unitarias.

Si Julio quiere ese camino entero en un navegador, se puede hacer con un día
desechable sembrado en cada e2e, en una cuenta que no use la tanda.

## 5 · Producción: la tanda, lista para Julio

`supabase/produccion/aplicar.txt` tiene **solo la `20261021T0100`**. La tanda
anterior está en el historial y queda copiada en
`tests/conta/produccion/tanda-ventas-plataforma-20261013.txt`.

- **Analizador con el contexto REAL** (paso 8), medido en producción el 13/10
  a las 12:29 UTC, en solo lectura: **«sigue»**, sin «autorizo».
  - La primera versión BLOQUEABA. Quitaba y volvía a poner dos políticas de
    `storage.objects`, que tiene ficheros de otros buckets, y eso es cambiarlas
    en caliente.
  - Ahora las dos políticas, que son nuevas, se crean solo si no están, sin
    quitar nada.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/documentos.sql`),
  tomado en producción antes de la tanda:

  | Medida | Antes |
  |---|---|
  | bucket conta-documentos | 0 |
  | ficheros | 0 |
  | políticas | 0 |
  | tabla journal_entry_document | no |
  | documentos | sin tabla |
  | funciones | 0 |
  | columnas document_* | 0 |
  | envíos | 0 |
  | asientos de ventas | propuesto 50 |

  Si el real se deshace solo, tiene que volver exactamente a esto.
- **Vuelta atrás:** `supabase/vuelta-atras/20261021T0100_conta_documentos.down.sql`.
  PARA si ya hay algún documento guardado o algún fichero en el bucket.

**Lo que hace Julio:** `aplicar-produccion-conta`, primero **ensayo** y luego
**real**, con el mismo commit de esta rama. No hace falta «autorizo».

**Ojo, lo que NO publica esta tanda:** el front y la función
`conta-diez-enviar`.
- Salen al fusionar a `main`: Vercel publica el front y el workflow despliega
  la función. Hasta entonces, en producción no se ve ningún botón nuevo.
- La fusión es otra decisión, y la base tiene que ir **antes**: si no, el Libro
  pediría `journal_entry_document` y `conta_resumen_ventas`, que no existirían
  (regla 40).

## 6 · Resultados

(se rellena con la e2e)
