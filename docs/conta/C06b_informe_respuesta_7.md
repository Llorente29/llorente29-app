# C06b · Respuesta 7 — tarea 1: a Diez sin esperar a Cegid

Rama `conta/c06b-repasos`, después de fusionar la #183. Nada real en el
repositorio ni en los registros: las pruebas usan importes y números
inventados; la e2e da sus filas por la red.

**Producción: no se ha lanzado nada.** La tanda está preparada (§6) y espera a
Julio; el orden entero, en §7.

---

## 1 · Lo que cambia, en una frase por freno

| Freno de R15 | Hoy |
|---|---|
| 2 · Sin el PDF guardado en Folvy no se envía | **Igual.** Sin documento en Folvy, ni se abre la conexión. |
| 3 · Diez real (C0008) cerrado | **Se abre solo con lo que autoriza Julio en la base** (`conta_diez_autorizo`): un asiento, o la empresa en esa base. Sin fila, igual de cerrado. C0001, nunca, ni autorizada. |
| 4 · «Diez no guarda documentos: no se envía» | **Solo si se va a adjuntar.** Mientras Diez no guarde documentos (`config.adjuntar_documentos = false`, hoy), la factura va sin preguntarlo. |
| 5 · Nunca dos veces | **Igual**, y con un caso más (§3). |
| 6 · «Sin adjunto no está en Diez» | **Se separa:** si Diez no guarda documentos, la factura SÍ está en Diez y queda **«PDF pendiente en Diez»**. Si Diez los guarda y adjuntar falla, sigue siendo «No ha llegado a Diez: falta el documento». |

**«En Folvy el PDF sigue siendo obligatorio. Sin documento guardado en Folvy
no se valida nada.»** Lo primero se cumple tal cual. Lo segundo, en el
camino de «Validar y enviar a Diez», es el orden de siempre: validar, guardar
el PDF y enviar. El PDF lleva el número del asiento, que lo da la validación,
así que no puede existir antes. Si guardarlo fallara, el asiento quedaría
validado sin PDF y **no se envía** («No ha llegado a Diez: falta el
documento», con Reintentar). Hacer validar y guardar en una sola transacción
pide construir el PDF en el servidor: es una pregunta para Julio (§8).

## 2 · Lo que se ve

- **El asiento:** «En Diez · 1/1801 · PDF pendiente en Diez», en azul (falta
  algo, pero no es un fallo), sin Reintentar, y debajo: «Diez aún no guarda
  documentos, así que la factura ha ido sin su PDF. Adjúntalo en Diez y
  márcalo en Pendientes de adjuntar en Diez», con el enlace.
- **El resultado de «Validar y enviar a Diez»** lo cuenta: «… 2 en Diez (1 con
  el PDF pendiente de adjuntar allí).»
- **Libros › Diario › Con Diez › Pendientes de adjuntar en Diez** (§5).
- **Lo anulado en Folvy que sigue en Diez** ya no dice «Anulado» a secas:
  «Anulado en Folvy · en Diez sigue 1/1801: falta su contraasiento en Diez»,
  en ámbar, y sale aparte en la misma pantalla.

## 3 · Nunca dos veces, comprobado

En `tests/conta/diez/enviar.test.ts` (dobles de Diez con lo medido en C0009):

1. Enviar otra vez lo que ya está con el PDF pendiente: **no habla con Diez**
   («Ya estaba en Diez: 1/1801. PDF pendiente en Diez.»).
2. La factura ya está en Diez (otro envío, o metida a mano): **se enlaza**, no
   se da otra de alta.
3. El envío se cortó a medias (intención apuntada, sin respuesta): al
   reintentar **la busca y la enlaza**.
4. Dos con el mismo número en Diez: no se toca nada.
5. Y en la base, `external_send` sigue con un envío por asiento y una clave de
   Diez por asiento (los dos índices únicos de R15).

**Anular = contraasiento, como dice el C04b** (T1: «no existe ningún DELETE
de asientos. Anular en Diez es un contraasiento, igual que en Folvy»). En
Folvy, anular deja el asiento anulado con su contraasiento; lo anulado ya no
se envía («solo se envía lo validado»). Lo que faltaba: que lo anulado en
Folvy que sigue en Diez no se quedara callado. Ahora lo dice el asiento y lo
lista la pantalla de pendientes. **Enviar el contraasiento a Diez no lo hace
Folvy todavía**: una factura en Diez se anula con una rectificativa, para que
el libro de IVA de Diez cuadre, y eso es una decisión de Julio (§8).

## 4 · El día que Cegid active los documentos

Preparado y apagado: `account_connector.config.adjuntar_documentos`. Con él a
`true`, el mismo envío de una factura que ya está en Diez con el PDF
pendiente **solo sube el documento** (sin otra alta), lo lee de vuelta y la
deja adjunta «por Diez» (`document_attached_via = 'diez'`). La lista se vacía
reenviándolas. Lo prueba «EL DÍA QUE CEGID ACTIVE EL ALMACÉN» en
`enviar.test.ts`.

## 5 · Pendientes de adjuntar en Diez

- **Cuántos y el más antiguo**, arriba y en la línea de la acción en Libros
  («3 sin su PDF», en ámbar). Con filas, nunca «nada pendiente» (regla 7).
- **De cada una, cómo encontrarla en Diez:** su asiento (serie/documento del
  ejercicio) y su número de factura; y el nombre que lleva en el zip.
- **«Descargar todos»:** un zip con cada PDF guardado en Folvy, llamado como su
  referencia en Diez (`2026-1-1801.pdf`). Lo dice al acabar: «Bajado: …, con 3
  de 3 PDF, cada uno con el nombre de su referencia en Diez».
- **«Ya está adjunto»**, uno a uno (`conta_diez_adjunto_a_mano`: solo
  administrador o encargado; solo desde «pendiente»; queda quién y cuándo).
  Lo dice: «Hecho: el PDF de 1/1801 queda adjunto en Diez, marcado por …».
- **La tarea de Claude Desktop** hace lo mismo que una persona: abre la
  pantalla, baja el zip, adjunta cada PDF en Diez (el nombre del fichero es
  la referencia) y pulsa «Ya está adjunto» en cada uno.

## 6 · Staging y la tanda

**Staging** (todo en verde):

| Qué | Ejecución |
|---|---|
| 0700 + su prueba (2.º intento; el 1.º paró en el paso 1 de la prueba: con Uber el cierre del día de A no propone, A tiene la contabilidad configurada para Glovo) | 38587569767 |
| `conta-diez-enviar` desplegada | 38588146392 |
| La conexión de Diez de «Recorrido de Prueba C06» (C0009), con credenciales FALSAS | 38588146803 |

La prueba de la 0700, del registro:

```
PRUEBA C06b · 0: tabla, función y columnas: ok.
PRUEBA C06b · 2: en Diez 1/9901 con document_status pendiente_diez: el CHECK lo admite.
PRUEBA C06b · 3: «Ya está adjunto»: adjunto, a mano, por quien lo marcó; la segunda vez, «ya estaba» y no cambia.
PRUEBA C06b · 4: un usuario no escribe en external_send (permission denied for table external_send).
PRUEBA C06b · 4: lo que no ha llegado a Diez no se marca (Ese asiento no está en Diez.).
PRUEBA C06b · 5: B ni ve ni marca lo de A (Ese asiento no está en Diez.).
PRUEBA C06b · 6: un usuario ni lee ni escribe conta_diez_autorizo.
PRUEBA C06b · 6: el servidor autoriza un asiento una vez y la empresa una vez por base; C0001, nunca.
PRUEBA C06b · 7: un estado que no existe, no (… violates check constraint "external_send_document_status_check").
```

**Lo que NO se ha ensayado, y por qué (regla 10, se dice):** el envío por la
edge function contra Diez de verdad. En staging no hay credenciales reales de
Diez («nada real en staging»): la conexión de prueba lleva unas falsas, que
prueban la fila, Vault y el estado, no Diez. Y en producción no hay conexión
todavía. Por eso el plan de Julio empieza por UN asiento, que él mira en Diez.
Lo que protege ese primer envío: busca antes en Diez y, si ya está, la enlaza;
apunta la intención antes de escribir; y como mucho 3 intentos.

**La tanda** (`supabase/produccion/aplicar.txt`):

1. `20261111T0700_c06b_diez_pdf_pendiente.sql` — **sigue** (declara
   «cambia: public.external_send» con su prueba; el resto, nuevo).
2. `20261111T0710_c06b_diez_autorizo_primero.sql` — **sigue**: escribe UNA
   fila en la tabla que crea la propia tanda (para el analizador, «añade»).
   Es la autorización de Julio: la da al lanzar esta tanda.

**Paso 8** (contexto real de producción, medido el 14/10 a las 15:20 UTC):

```
20261111T0700_c06b_diez_pdf_pendiente.sql: sigue
20261111T0710_c06b_diez_autorizo_primero.sql: sigue
autorizo: (ninguno)
```

**Cuenta de antes** (`scripts/conta/produccion/cuentas/diez-pdf-pendiente.sql`,
producción, 15:21:38 UTC):

| | antes | después del real |
|---|---|---|
| envíos a Diez (tabla entera) | 0 | 0 |
| con el PDF pendiente en Diez | 0 | 0 |
| CHECK de document_status | pendiente, adjunto, fallo | + pendiente_diez |
| columnas document_attached_* | 1 (la _at de R15) | 4 |
| tabla conta_diez_autorizo | no | sí |
| autorizaciones de Foodint | sin tabla | 1 |
| función conta_diez_adjunto_a_mano | no | sí |
| conexiones de Diez (tabla entera) | 0 | 0 |
| asientos de Foodint (no se tocan) | 14.988 | 14.988 |

## 7 · El orden, para el primer asiento en C0008

1. **La tanda** (ensayo y real): la 0700 y la autorización del asiento.
2. **El PR a `main`** (front, `conta-diez-enviar` y el workflow de la
   conexión) y **desplegar `conta-diez-enviar`** a mano.
3. **La conexión**: workflow «Diez · dar de alta la conexión de una empresa»,
   `entorno = produccion`, `empresa = 658728c0-fcd7-46ef-a860-d4e5e6eb21d9`,
   `confirmo = produccion`, `autorizo = conexion-diez`. Usa el secreto
   `DIEZ_LECTURA` (el de R13 en C0009) y deja `adjuntar_documentos = false`.
4. **Julio**, en el Libro, abre «Ventas Uber · Foodint Alcalá» del 01/10 y
   pulsa «Validar y enviar a Diez»: valida, guarda el PDF y lo envía. Tiene
   que decir «En Diez · 1/NNNN · PDF pendiente en Diez».
5. **Julio lo mira en Diez.**
6. Después, otra tanda con la autorización de la empresa (`alcance =
   'empresa'`) y «Validar y enviar a Diez» con el resto.

## 8 · Preguntas para Julio

1. **«Sin documento guardado en Folvy no se valida nada»:** ¿vale el orden de
   hoy (se valida, se guarda el PDF y, si el PDF falta, no se envía) o quieres
   que validar y guardar el PDF vayan juntos o no vaya ninguno? Lo segundo
   pide hacer el PDF en el servidor.
2. **Anular lo que ya está en Diez:** ¿Folvy envía la rectificativa a Diez, o
   la hace la gestoría en Diez y Folvy solo avisa (como ahora)?

## 9 · Diseño

**Por rellenar con las capturas de la e2e.**
