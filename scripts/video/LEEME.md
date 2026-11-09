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
| `factura-al-pago.zip` | **Todo junto para descargar y mandar**: el vídeo y las dos portadas (unos 12 MB: cabe en un correo) |
| `factura-al-pago.mp4` | El vídeo: 1920×1080, H.264, subtítulos quemados y voz. Empieza con la portada (lo que enseñan WhatsApp y el correo) y la lleva dentro como carátula |
| `factura-al-pago-sin-voz.mp4`, `voz.m4a` | El mismo sin voz, y la voz sola (pista aparte) |
| `miniatura-16x9.jpg`, `miniatura-1x1.jpg` | La portada para subirlo o mandarlo: 1280×720 (YouTube, web, correo, LinkedIn) y 1080×1080 (WhatsApp, Instagram). Con capturas de esta misma grabación |
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
- `montar.mjs`: portada, tramos sin esperas, cierre, subtítulos y la voz.
- `locucion.mjs`: lo que dice la voz, frase a frase, cada una pegada a un
  gesto del guion. Los subtítulos son esas mismas frases. **Para cambiar lo
  que se dice, se cambia aquí.**
- `voz-elevenlabs.txt`: **la voz de los vídeos, y el único sitio donde está**:
  el id de la voz de ElevenLabs (`bsEDAkNZWaEolZ7vEeVJ`, la que eligió Julio
  el 03/11) y `modelo: v4`. Ninguna variable del repositorio la cambia.
- `voz_nube.py`: hace la voz con ElevenLabs, ANTES de grabar (el guion espera
  a que acabe cada frase antes del gesto siguiente, así nunca se pisan). La
  clave va en el secreto `VOZ_ELEVENLABS_KEY`; **sin él, el vídeo para en rojo**
  y no sale con otra voz.
- `voz.py`: Piper, la voz libre (`es_ES-davefx-medium`), solo para una prueba
  hecha a mano: se usa si `voz-elevenlabs.txt` lleva la línea `piper: sí`.
- `miniatura.mjs`: la portada para las plataformas, en los dos tamaños.
- `carril-unicos.py`: parche AL VUELO de `scripts/e2e/carril/clonar.sql`, solo
  en el runner del vídeo, para que el carril clone aunque la plantilla tenga
  pagos de verdad (`conta_pago_salida.request_id`). El arreglo de verdad va en
  `clonar.sql`, en otro encargo: afecta a todas las e2e.
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

## GD · el vídeo para QBO (nº52 y nº56)

`gd/qbo.mjs` y `.github/workflows/gd-video-qbo.yml`: Sumied para gestorías,
grabado en la «Gestoría Demo» de **producción** con el usuario de Julio (un
enlace de acceso generado en el servidor, sin correo), a 1440×900, sin voz y
con rótulos. **Por escenas**: cada una deja `escenas/<id>.mp4` y
`capturas/<id>.png` en `video-salida/gd-qbo`; para cambiar una se lanza el
workflow con `escenas: 05b` y las demás se reutilizan. `modo: ensayo` no
escribe nada; `modo: grabar` envía el cobro de la demo al sandbox (autorizado
por Julio). Las maquetas (el portal y Sumied dentro de Bitrix24) son capturas
del tablero, en `gd/maquetas/`, rotuladas «En construcción».

**Las tomas de Julio (nº60).** Las escenas 5 (Al instante, en pantalla partida)
y 7b (el buzón) no las graba el guion: son GIF que graba Claude desde el
Chrome de Julio, en la rama `video-tomas/gd-qbo`, carpeta `tomas/`:
`05-bitrix.gif`, `05-sumied.gif` y `07b-buzon.gif`. El guion les pone los
rótulos; sin la toma, la escena queda como hueco y el registro lo dice. Para
montarlas sin regrabar el resto: `escenas: 05,07b`. En «grabar» no se toca
Bitrix24.

**La escena 5, ya montada (nº61).** Las dos tomas de Julio (rama
`conta/gd-video-clips`, commit 38cfc63) van recortadas en `gd/tomas/`:
`05-bitrix.gif` (la ficha con «Situación» y «Guardar», sin el fotograma en
blanco) y `05-sumied.gif` (el panel del cliente, solo los fotogramas en que ya
dice «Moroso»). Ninguna se repite. Sumied entra a los 15 s, cuando Bitrix24 ya
ha guardado. El guion busca las tomas primero en `gd/tomas/` y después en
`video-tomas/gd-qbo`.
