# D01 · Facturas recibidas · Tarea 7: preparada, sin fusionar

Respuesta 4, entera. **Nada lanzado.** En producción solo se ha leído, con
recuentos y huellas, el 14/10 entre las 05:50 y las 06:10 UTC. Los dos datos
que hacen falta para lanzar los da Julio; el orden lo doy yo en el §5.

## 0 · Lo que falta antes de fusionar (Julio, R4)

1. **La lectura con el modelo, probada.**
   - Julio pone saldo.
   - Yo relanzo `leer-con-modelo-d01.yml` sobre las 12 facturas inventadas y
     doy los aciertos por campo.
   - Hoy: **0 de 12**, porque la API contestó `error_saldo_o_limite`. Desde la
     R3, una factura sin leer cuenta 0 en todos los campos y el run sale en
     rojo: ya no puede dar verde sin leer.
   - **Sin esa prueba no sale a producción el modo «factura» de
     `ocr-albaran`.** Como `ocr-albaran` se despliega al fusionar (§4.2),
     esto para la fusión entera, no solo una pieza.
2. **Julio revisa y aprueba las capturas N22/N23** (§1).

**Queda abierto de la tarea 6:** en una empresa solo de contabilidad, ¿las
facturas «seguro» se apuntan sin pasar por la aprobación de Compras? Hoy no:
el interruptor `post_safe_invoices` nace apagado en todas.

## 1 · Las capturas frente a la maqueta

Son las de la e2e **233**, con **toda la suite en verde** (commit de
capturas `2bee8718`), en `docs/conta/capturas/d01/`:

- `n22-para-mirar-a-ordenador.png` y `n22-para-mirar-a-movil.png`;
- `n22-para-mirar-c-ordenador.png` y `n22-para-mirar-c-movil.png`;
- `n23-revisar-a-ordenador.png` y `n23-revisar-a-movil.png`;
- `n23-revisar-c-ordenador.png` y `n23-revisar-c-movil.png`.

La tabla entera está en `T6_informe.md` §9, «Las capturas frente a la
maqueta». Lo que **no** es igual, y por qué:

- **N22:**
  - **Sin «Por correo».** El correo está apagado, y lo que no funciona no se
    enseña.
  - **Sin «Por recepción», sin «Tuyos» y sin las pestañas que no existen.**
    Son de T6 §5.
  - **La banda no dice «Faltan…».** Hoy no hay facturas esperadas.
- **N23:**
  - **Sin «Local».** La factura de la semilla no casa con ninguna recepción.
  - **Sin «Precios».** Es de T6 §5.
- **Móvil:** en la captura de página entera, el botón sale al final. En la
  pantalla va fijo abajo, y la e2e mide que cabe en la mitad de abajo sin
  desplazarse.
- **Frente C:** el marco («Volver a Folvy», la barra de abajo) es de la C06.
  En Documentos la e2e no encuentra ni «Cocina» ni «Folvy».

## 2 · El contraste

Está en `docs/conta/contraste.md`, sección «Facturas recibidas (D01,
14/10/2026)». Cubre Holded, Pennylane, Puzzle, Hubdoc, Dext, Quipu y Cegid
Diez, leídos en sus ayudas el 14/10, con la fuente de cada uno. La tabla va
pieza a pieza: lo cogido y de quién, el escalón de más, y **lo que todavía
no**.

**Dónde vamos por encima:**
- el cruce con Cocina;
- las facturas esperadas;
- la lectura con su porqué;
- una sola regla de repetidas en la base, medida contra la población real;
- la dirección de correo por empresa, no por cuenta.

**Dónde no, y se dice:**
- **Pennylane manda sola la petición** a los 15 días. La nuestra la confirma
  siempre una persona, y es decisión tuya.
- **Dext y Quipu traen facturas de portales** o tienen personas que revisan.
  Nosotros no.
- **Nuestra lectura con el modelo está sin probar** (§0).

## 3 · La norma, con sus citas

Está en `docs/conta/d01/norma.md`. La escribe `scripts/conta/d01/norma.mjs`
desde los textos oficiales que baja `fuentes-oficiales-conta.yml`, con su
sha256 en `registro.json`. Si el texto no está, el guion falla. Antes de cada
subida se comprueba que el fichero es lo que sale de los textos: «norma.md:
igual a los textos oficiales».

**Son 12 citas:**
- RD 1619/2012: arts. 6.1, 7.2 y 15;
- Ley 37/1992: arts. 97.Uno, 99.Tres y 161;
- RD 1624/1992: art. 64.1 y 4;
- Código de Comercio: art. 30.1;
- LGT: art. 66;
- Ley 3/2004: art. 4.1 y 4.3;
- **Orden EHA/962/2007, art. 7.1 y 7.2**;
- **Resolución de la AEAT de 24/10/2007**.

**Lo nuevo de la R4:**
- **La Orden EHA/962/2007.**
  - Se encuentra por su id, **BOE-A-2007-7866**, y se reconoce por el
    principio de su título. Su ELI va en la fuente:
    https://www.boe.es/eli/es/o/2007/04/10/eha962.
  - No está consolidada: es el texto publicado. **Sí se descarga desde
    Actions** (200, 52 KB, commit `89af459a` del bot).
  - Se cita su art. 7, la digitalización certificada.
- **La Resolución de homologación**, **BOE-A-2007-18911**. Se descargó en
  el commit `4414924a` del bot.
- **La nota, como pediste.**
  - Dice: «la Orden se dictó bajo el Real Decreto 1496/2003, hoy
    sustituido por el Real Decreto 1619/2012».
  - **Su apoyo, citado literal:** la **disposición adicional quinta del RD
    1619/2012** («Las referencias hechas al Reglamento … aprobado por el
    Real Decreto 1496/2003 … se entenderán realizadas a este Reglamento»).
  - No es de memoria: sale del mismo texto consolidado que el resto.
- **La pantalla no cambia.** Sin software homologado el papel se conserva,
  y en ningún sitio decimos que se pueda tirar.

## 4 · La tanda para producción

**Qué va:** la base (0200 a 0290), tres edge functions y el front.
**En este orden:** base, edge functions y front.

### 4.1 · La base

**Manifiesto:** `supabase/produccion/aplicar.txt`.
- Lleva las 10 migraciones en orden: 0200, 0210, 0220, 0230, 0240, 0250,
  0260, 0270, 0280 y 0290.
- Cuenta con `cuenta: scripts/conta/produccion/cuentas/recibidas.sql`.
- La vuelta atrás, en orden inverso, está en
  `supabase/produccion/vuelta-atras.txt`. Cada `.down.sql` **para** si ya hay
  algo de una persona o de un proveedor que se perdería: llegadas, correos,
  contactos de Facturación, enlaces aprendidos, documentos o peticiones
  confirmadas.
- La tanda anterior (R15, la 0100) ya está en el historial de producción con
  su huella. Su manifiesto queda copiado en
  `tests/conta/produccion/tanda-documentos-ventas-20261013.txt` (y
  `vuelta-atras-documentos-ventas-20261013.txt`), y su contexto en
  `contexto-produccion-documentos-20261013.json`. Sus pruebas leen ahora esas
  copias.

**El contexto, medido en producción** a las **2026-10-14T05:53Z**. Es la
consulta del workflow (`analizar.mjs sql-contexto`, con `CAMINO_TABLAS` y
`CAMINO_FUNCIONES` del workflow), en solo lectura. Va guardado con el md5 de
los 10 ficheros en `tests/conta/produccion/contexto-produccion-tanda-viva.json`.
- **Existen 5 de las tablas que toca:** `company_account_link`,
  `journal_entry_document`, `supplier`, `supplier_contact` y
  `supplier_invoice`.
- **No existe ninguna de sus 22 funciones**, ni hay otras con el mismo
  nombre. No puede haber sobrecargas.
- **Del camino del pedido, nada:** 0 tablas y 0 funciones.
- **Ninguna está ya en el historial** (`registro` vacío).
- **No hay `cron.job`** que nombre ninguna de las funciones.
- **Ojo con `supplier_invoice`:** el analizador la ve con 1 fila, porque
  `reltuples` es una estimación vieja. Hay 6 (recuento abajo). Solo cambia el
  tamaño del bloqueo que se anuncia, que es corto (SHARE ROW EXCLUSIVE para
  poner el disparador).

**El analizador, paso 8 (salida pegada):**

```
Análisis de la tanda viva contra el contexto de producción medido 2026-10-14T05:53Z (md5 de los 10 ficheros: los medidos).
  20261021T0200_d01_recibidas.sql: sigue
  20261021T0210_d01_amplia.sql: sigue
  20261021T0220_d01_entrada.sql: sigue
  20261021T0230_d01_repetidas_con_total.sql: sigue
  20261021T0240_d01_asiento_recibida.sql: sigue
  20261021T0250_d01_aprendido_origen.sql: sigue
  20261021T0260_d01_repetidas_c01b.sql: sigue
  20261021T0270_d01_recibida_envio.sql: sigue
  20261021T0280_d01_documentos.sql: sigue
  20261021T0290_d01_revisar_y_pedir.sql: sigue
  autorizo: (ninguno)
```

Del informe largo:
- **0200 añade.** Siete tablas con sus índices y políticas. La siembra de
  `company_purchase_setting` va a una tabla que nace en el mismo fichero.
- **0210 y 0230 cambian en caliente**, declarado en cabecera y con su prueba
  de staging.
  - La 0210 quita y vuelve a poner tres CHECK que **solo amplían**:
    `supplier_contact` (0 filas), `company_account_link` (82) y
    `journal_entry_document` (0).
  - Las dos ponen el disparador `trg_supplier_invoice_no_repetida`.
- **Las demás no crean objetos que existan.**
- **Ninguno pide «autorizo».**

**La regla de repetidas contra producción, antes de aplicarla** (solo
lectura, la regla de la 0260 entera, por cuenta):

| Cuenta | Facturas | Vivas | Repetidas (bloquearían) | Posibles (preguntarían) | Mismo número, otro total (nada) |
|---|---|---|---|---|---|
| Foodint (`51ad1792…`) | 6 | 6 | **0** | **0** | 0 |

- Es la única cuenta con facturas en producción.
- Ni el disparador para ninguna de las que hay, ni la bandeja pregunta por
  ninguna.

**Lo que cuenta `recibidas.sql` hoy (el «antes»).** Tabla entera, todas las
cuentas juntas, y dicho (regla 9):
- las ocho tablas nuevas: «sin tabla»;
- facturas: aprobada 1 · en_revision 5;
- 12 líneas;
- 0 de las 6 columnas nuevas;
- 94 proveedores, sin la columna `created_from`;
- contactos: admin 1 · orders 1 · other 5;
- enlaces de cuenta: manual 8 · migrated 63 · serie 19;
- documentos de asiento: ninguno;
- huella de los tres CHECK: `65c6888ed71554c6af594b3bac8889d6`;
- disparador: 0;
- funciones: 0;
- asientos de recibidas: ninguno;
- envíos a Diez: 0.

Si el real se deshace solo, `deshacer.sh` compara con esto: tiene que salir
igual.

### 4.2 · Las edge functions

Cambian tres funciones frente a `origin/main`:

| Función | Qué cambia | `verify_jwt` |
|---|---|---|
| `ocr-albaran` | El modo «factura». Sin modo, lo de Cocina no cambia: el prompt es byte a byte el de antes, y la validación y la extracción dan lo mismo (`tests/conta/d01/ocrAlbaran.test.ts`, 3 de 3) | el que tiene hoy (el workflow lo pregunta y lo conserva) |
| `conta-facturas-entrada` | **Nueva.** El webhook de Resend | `false`, declarado en `config.toml` (lo exige el workflow para una nueva) |
| `conta-diez-enviar` | Una factura recibida va a la serie 2. Las ventas siguen por el camino de siempre | `true` |

- **Del `_shared`** cambian `diezEnviar`, `diezRecibida`, `facturasEntrada`,
  `lecturaFactura` y `ocrAlbaranNucleo`. Solo los importan estas tres
  funciones.
- **El workflow no despliega por `_shared`.** Si solo cambiara `_shared`, una
  función que lo use se quedaría con el viejo. Aquí no pasa: las tres cambian
  también en su carpeta.
- **`hubrise-webhook` no se toca.**

**Cómo salen, y por qué así:**
- **Una fusión a `main` despliega las tres y publica el front a la vez.**
  Vercel y `deploy-edge-functions.yml` corren en paralelo, así que «base,
  edge functions y front» no queda garantizado con fusionar sin más.
- **El front nuevo con las funciones viejas falla en silencio.**
  - La subida llamaría a `ocr-albaran` con `modo: 'factura'`.
  - La vieja no conoce el modo: devolvería la lectura de albarán, sin
    «factura».
  - La llegada quedaría sin leer.
- **Al revés no hay riesgo.** Con las funciones nuevas y el front viejo, el
  albarán de Cocina y el envío de ventas no cambian.
- **Por eso propongo desplegarlas antes de fusionar,** a mano, desde la rama
  (§5, paso 3). La fusión las vuelve a desplegar iguales, byte a byte.
- **Lo que cuesta:**
  - entre ese despliegue y la fusión, lo desplegado va por delante de `main`;
  - `edge-drift-watchdog` lo vería si la ventana pasara de un día.
  - Son minutos, y se mide a los dos lados (CLAUDE.md, regla 1).
- **Si prefieres no abrir esa ventana:** fusionar sin más. El riesgo es el de
  arriba, durante los minutos en que Vercel gane la carrera.

### 4.3 · El front

- **Sale con la fusión a `main`,** cuando Vercel diga READY en producción, no
  con el commit.
- **Lo que lleva:**
  - Documentos (N22, N23 y «Pedírselas»);
  - la ficha del proveedor: el origen de la cuenta, «sin confirmar» y el
    papel «Facturación»;
  - `propuestasLibroService` (`proponerFactura`).
- **Lo que mide hoy la fusión:**
  - 56 commits; `main` no lleva ninguno que la rama no tenga;
  - **sin conflictos** (`git merge-tree`);
  - 22 ficheros de `src`;
  - no toca `App.tsx`, `AppContext.tsx` ni `database.ts`;
  - de `src/config` toca **solo `navegacion.ts`**: la línea de
    «Documentos», dicha desde la R2.
- **Antes del push a `main`:** `npm run build` exacto y en limpio, borrando
  `*.tsbuildinfo`. Lo corre `antes-de-subir.sh`, y hoy sale en verde.

## 5 · El orden (lo lanza Julio cuando yo lo diga)

**Todavía no:** faltan los dos datos del §0. Cuando estén:

1. **Yo:**
   - si algún fichero de la tanda ha cambiado, vuelvo a medir el contexto y
     paso el paso 8;
   - vuelvo a medir las repetidas;
   - te doy el commit exacto.
2. **Julio · la base:** `aplicar-produccion-conta.yml`, «Use workflow from»
   `conta/d01-recibidas`.
   - Primero `modo = ensayo`.
   - Con el ensayo en verde, `modo = real` **del mismo commit**.
   - El workflow comprueba después D1, el recuento, los agentes y la salud
     del pedido, y si falla se deshace solo.
3. **Julio · las edge functions:** `deploy-edge-functions.yml`, «Use workflow
   from» `conta/d01-recibidas`.
   - En `funciones`: `ocr-albaran conta-facturas-entrada conta-diez-enviar`.
   - `la_prohibida` vacío.
   - **Yo, después:** comparo el md5 de cada una desplegada contra su fichero,
     y hago un GET a cada una, que tiene que dar 405 (arranca sin escribir
     nada).
   - Y una subida de un albarán en Cocina sigue leyéndose igual: lo miro en
     su sesión de `ocr-albaran`, por recuento.
4. **Julio · el front:** la fusión del PR de `conta/d01-recibidas` a `main`.
   - **Yo, después:** Vercel READY en producción, y el md5 de las tres
     funciones otra vez, ahora contra `origin/main`.

## 6 · Lo que queda apagado en producción, y cómo

**El correo de entrada, hasta que haya dominio.** Está apagado tres veces:
1. **`company_inbound_address` nace con `active = false`.** No hay ninguna
   dirección hasta que alguien la crea, y la creada también nace apagada.
   Lo que llegue a una dirección apagada queda en `inbound_email_log` con
   `outcome = 'apagada'` y no se lee (`_shared/facturasEntrada.ts`).
2. **`conta-facturas-entrada` sin sus secretos contesta 500 y no lee
   nada.** Los secretos son `RESEND_FACTURAS_WEBHOOK_SECRET` y
   `RESEND_API_KEY`.
   - **No lo he podido comprobar** desde aquí: los secretos de producción
     no se leen con lo que tengo.
   - **Julio:** en Supabase › Edge Functions › Secrets, que
     `RESEND_FACTURAS_WEBHOOK_SECRET` **no** esté puesto.
3. **Resend no tiene el dominio `entrada.folvy.app`.** Nadie le manda
   correos al webhook. Los pasos están en `docs/conta/d01/pasos_resend.md`.

En N22, la entrada «Por correo» solo sale con el correo encendido.

**El envío de recibidas a Diez, hasta que Cegid active los documentos.**
Para por tres sitios, y ninguno escribe en Diez:
1. **No hay conexión de Diez en producción:** `account_connector` de `diez`
   = 0, medido el 14/10. «Está bien · apuntar» aprueba, propone, valida y
   guarda el PDF, y el envío contesta «No ha llegado a Diez: la conexión con
   Diez no está configurada». Deja su fila en `external_send`, con 0
   intentos.
2. **C0008 y C0001, cerrados en el código** (`BASES_PROHIBIDAS`).
3. **«Diez todavía no guarda documentos».** Antes de dar de alta nada, se
   pregunta a Diez si devuelve el documento de una factura que ya tiene. Hoy
   contesta «The specified container does not exist», y no se envía una
   factura sin su PDF.

## 7 · El puente «solo contabilidad» si el D01 entra antes que la C06

**Qué hace el puente:** `src/modules/conta/documentos/producto.ts` decide
«solo» con la misma regla que la C06. La C06 tiene `esCuentaSoloContabilidad`
en `contratoCuenta.ts` de `conta/c06-sola`, leída hoy en `a2e76130`:
- la marca (`product_brand`) es un texto no vacío;
- o, fuera de producción, `?marca=` o la sesión del navegador con la misma
  clave, `producto.marca`.

**Con Foodint, igual que hoy:**
- **La columna `product_brand` no existe en producción:**
  `information_schema` devuelve 0 filas, medido el 14/10.
- **La cuenta se lee con `select('*')`**
  (`featureGateService.ts:97`). Sin la columna, la fila no la trae y la
  lectura no falla.
- **`esCuentaConMarca` da `false`** si falta: lee `product_brand?`. Así que
  Foodint ve Documentos dentro de Folvy, con «De Cocina» si recibe la
  mercancía con Folvy, y el nombre «Folvy».
- **En producción `?marca=` no hace nada** (`esProduccion`). Lo cubren las
  pruebas de `documentosPantalla.test.ts`.

**El día que entre la C06:**
- se cambia el import de `producto.ts` por `useCuentaConta().soloContabilidad`,
  y se borra el puente;
- «El correo de entrada» de la ficha espera a `direccionDeFacturas` de
  `marcas.ts`: no lo calculo por otro lado.

**Probado hoy uniendo las dos ramas** (sin commit), choca en tres ficheros.
Los tres conflictos son de dos lados que añaden, sin lógica que elegir:
- `src/config/navegacion.ts`: una línea de menú cada una;
- `src/modules/conta/estilo/index.ts`: un CSS cada una;
- `supabase/staging/aplicar.txt`: el manifiesto de staging.

`_shared/diezEnviar.ts`, `SusCuentas.tsx` y `config.toml` se unen solos. El
que fusione segundo trae `main` y resuelve esos tres.

## 8 · Lo compartido que he tocado en esta respuesta

- **`supabase/produccion/aplicar.txt` y `vuelta-atras.txt`.** Son la tanda
  viva: la de la R15 queda copiada en `tests/conta/produccion/`.
- **`tests/conta/produccion/contexto-produccion-tanda-viva.json`.** Es el
  contexto de esta tanda; el de la R15 queda copiado con fecha.
- **`docs/conta/contraste.md`.** Una sección nueva al final; no cambia nada de
  lo que había.
- **`scripts/conta/produccion/cuentas/recibidas.sql`.** Es nuevo.
