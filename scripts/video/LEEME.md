# scripts/video · Los vídeos de Sumied, grabados en staging

V01 (02/11): el vídeo «De la factura al pago», con Revolut y el cargo que se
casa solo. Lo graba un guion de Playwright contra **staging-conta**, en la
empresa A de un **carril** (la copia de las cuentas de prueba de las e2e, que
se borra al acabar), y lo monta `ffmpeg`. Nada de producción.

## Volver a grabarlo

Un push a esta rama (o a una `video/**`) que toque `scripts/video` o el
workflow, o «Re-run» del último run de **Vídeo en staging-conta**
(`.github/workflows/video-staging-conta.yml`). Tarda unos 6 minutos.

Deja el artefacto **video** del run y, como desde el entorno de las sesiones
no se bajan artefactos, lo mismo en la rama aparte `video-salida/<rama>` (un
commit sin historia que se reescribe en cada run; no es la rama de ningún PR):

| Fichero | Qué es |
|---|---|
| `factura-al-pago.mp4` | El vídeo: 1920×1080, H.264, subtítulos quemados y voz |
| `factura-al-pago-sin-voz.mp4`, `voz.m4a` | El mismo sin voz, y la voz sola (pista aparte) |
| `pasos/` | Un fotograma de cada paso, a mitad de su subtítulo |
| `fotogramas/` | Uno cada 2 s, para revisarlo sin abrir el vídeo |
| `capturas/` | La pantalla de cada paso y su texto (lo que lee `revisar.mjs`) |
| `revision.txt` | Lo que ha buscado `revisar.mjs` (T11) y si ha encontrado algo |
| `montaje.json`, `tramos.json`, `subtitulos.ass` | Los tiempos: dónde empieza cada paso y qué esperas se han cortado |

## Las piezas

- `factura-al-pago.mjs`: la entrada. Entra como la persona administradora de
  A del carril y llama al guion.
- `guion.mjs`: el guion. Prepara la factura de La Huerta como la deja la
  lectura (con su PDF, hecho aquí con datos inventados) y la apunta con el
  botón de la pantalla **fuera de cámara** (en producción lo hace «Apuntar
  solo lo seguro»); graba los pasos con el ratón a la vista; marca dónde
  empieza cada subtítulo y qué esperas de red se cortan.
- `raton.mjs`: el cursor que se ve, el círculo de cada clic, el reloj y las
  tarjetas de portada y cierre.
- `datos.mjs`: los datos inventados (proveedores de hostelería, NIF de ceros,
  IBAN del banco 9999 con su control).
- `sembrar.sql`: en el carril, nombres creíbles, los tres proveedores y dos
  facturas aprobadas. Para si la cuenta es la plantilla.
- `cargos.sql`: los tres cargos de Revolut que vuelven, casados por el núcleo
  de verdad (`_bank_casar_nucleo`, como «folvy»).
- `montar.mjs`: portada, tramos sin esperas, cierre y subtítulos; y la voz, si hay modelo.
- `voz.py`: la voz con Piper (voz neuronal libre que corre en el runner, sin
  llamar a ningún servicio), `es_ES-davefx-medium`, castellano de España. Dice
  lo mismo que los subtítulos, cada frase al empezar su paso.
- `revisar.mjs`: busca en el texto de cada pantalla IBAN que no sean del
  9999, DNI, NIE, NIF que no sean de ceros, correos y nombres reales.
- `reconocer.sql`: solo lectura, lo que tiene la empresa A del carril.

## Lo que es de verdad y lo que no

- **De verdad**: las pantallas (el build de la rama), la base de staging, el
  login, la factura con su PDF, su asiento validado, la lista de Pagos, el
  casado de los cargos (el núcleo de casar, que hace los asientos y marca las
  facturas pagadas) y Movimientos.
- **Interceptado en el navegador**, como en la e2e del B01
  (`tests/e2e/conta/b01/revolutPagarVarias.spec.ts`): lo del pago con
  Revolut (quién puede pagar, preparar, el titular, aprobar, el PIN y el
  envío). En el sandbox de Revolut el titular siempre sale «no se puede
  comprobar», y el PIN de pago se crea con un correo que staging no manda.
  **No sale ningún pago, ni siquiera al sandbox.**
- **Escrito por el guion**: los cargos de Revolut (`cargos.sql`), como los
  traería la lectura al llegar el aviso.
- **Oculto en la grabación**: la franja «BUILD LOCAL · NO ES PRODUCCIÓN» (es
  de staging, no del producto).
- **No se graba** el paso 1 del guion (el correo que llega): la empresa de
  prueba no tiene dirección de facturas y staging no recibe correo. Su
  subtítulo va sobre la factura ya leída.
