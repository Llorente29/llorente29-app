# D01 · Facturas recibidas · Tarea 7: preparada, sin fusionar

Respuestas 4, 5 y 6. **Nada lanzado.** En producción solo se ha leído, con
recuentos y huellas, el 14/10 entre las 05:50 y las 07:20 UTC. Lo que falta para
lanzar lo da Julio (§0); el orden lo doy yo en el §5. Los retoques de la R5
están en el §9 y las facturas que entran por la recepción (R6), en el §10.

## 0 · Lo que falta antes de fusionar (Julio, R4)

1. **La lectura con el modelo, probada.**
   - Julio pone saldo.
   - Yo relanzo `leer-con-modelo-d01.yml` sobre las 12 facturas inventadas y
     doy los aciertos por campo.
   - **Hecha el 14/10** (Julio puso el saldo). Run **24** de
     `leer-con-modelo-d01.yml` (38547500657), lanzado a mano desde
     `conta/d01-recibidas` en `a579cbe7` (= `a4ed786c` más las capturas), con
     el mismo modelo que `ocr-albaran`. En verde.
   - **Leídas 12 de 12**, todas con HTTP 200. **Aciertos, 12 de 12 en cada uno
     de los 13 campos.** «Seguro» sin serlo: **0**. Confianza: 11 seguro y 1
     probable, igual que la esperada en las 12. Líneas retenidas por la puerta
     de salida: 0.

     | Campo | Correo (10 PDF) | Subida (12: los 10 PDF y 2 fotos) |
     |---|---|---|
     | NIF | 10/10 | 12/12 |
     | Número | 10/10 | 12/12 |
     | Fecha | 10/10 | 12/12 |
     | Vencimiento | 10/10 | 12/12 |
     | Clase | 10/10 | 12/12 |
     | Qué rectifica | 10/10 | 12/12 |
     | Tipos (base y cuota por tipo) | 10/10 | 12/12 |
     | Base | 10/10 | 12/12 |
     | Cuota | 10/10 | 12/12 |
     | Recargo | 10/10 | 12/12 |
     | Retención | 10/10 | 12/12 |
     | Total | 10/10 | 12/12 |
     | Confianza | 10/10 | 12/12 |
     | «Seguro» sin serlo | 0 | 0 |

   - **Cómo se separa correo y subida:** la lectura es la misma función por
     los dos caminos; cambia lo que trae cada uno. Por correo llegan PDF
     adjuntos: los 8 formatos y los 2 escaneados. Por subida, eso mismo y
     además las fotos, la torcida y la borrosa. Las dos fotos solo llegan por
     subida, y las dos se leyeron enteras.
   - **Lo que la prueba no mide:**
     - son 12 facturas inventadas, no la población real;
     - el correo de verdad (Resend, varios adjuntos, enlaces) no está
       encendido;
     - la recepción no entra: ya lee en producción con su propia clave (R6).
   - **Sin esa prueba no sale a producción el modo «factura» de
     `ocr-albaran`.** Como `ocr-albaran` se despliega al fusionar (§4.2),
     esto para la fusión entera, no solo una pieza.
2. **Julio revisa y aprueba las capturas N22/N23** (§1).

**Estado de las dos condiciones:**
1. Lectura con el modelo: **hecha, 12 de 12 en los 13 campos** (arriba).
2. Capturas: las vigentes son las de la e2e 250, en verde. Falta que Julio las
   vea.

**Decidido en la R5** (Julio):
- **Empresa solo de contabilidad:** no hay paso de aprobación de Compras;
  aprobar es pulsar «Está bien · apuntar» en N23. Es lo que hace hoy
  `apuntarFactura`: si está `en_revision`, la aprueba y sigue.
- **«Apuntar solo lo seguro»** sigue apagado al nacer en todas las empresas
  (`post_safe_invoices default false`). Lo enciende la persona, y queda quién y
  cuándo (`conta_ajustes_compras_guardar`: `updated_by`, `updated_by_name`,
  `updated_at`, y el porqué «Lo decidió X el dd/mm/aaaa»).
- **La prueba con el modelo** vale solo para el modo «factura» nuevo (correo y
  subida) (R6). La recepción ya lee en producción con su propia clave.

## 1 · Las capturas frente a la maqueta

**Las vigentes salen de la e2e que sigue a la 247** (la 247, `2a381cb6`, en verde entera, capturas `65d9bec0`; la 245, `2d9628cd`, también en verde): 166
pasan y 54 se saltan, que son las de otros frentes o de un solo lado. Las sube
el commit de capturas `3ebd0f54`, en `docs/conta/capturas/d01/`:
- `n22-para-mirar-{a,c}-{ordenador,movil}.png`;
- `n23-revisar-{a,c}-{ordenador,movil}.png`.

Las de la e2e 233 (T6) quedan en el historial.

**Lo que se ve de la R5,** punto por punto (lo detallo en el §9):
- **N23:**
  - «Vence 10/11/2026 · lo dice la factura, igual que su ficha (30 días)»;
  - «Se apunta en Folvy · a Diez irá cuando Cegid active los documentos»;
  - «Cómo se apunta» con «Gasto e IVA» y «A pagar», y en el móvil por grupos;
  - el papel del móvil recortado a lo escrito, con «Ver el papel entero»;
  - la banda en ámbar;
  - sin la barra de la IA.
- **N22:**
  - cada fila con su porqué y qué hacer;
  - «llegó por correo», «escrita a mano» y «leída en Compras»;
  - «Han llegado 8 facturas en octubre» y «Llegadas en octubre»;
  - en el móvil, la fecha junto al número y las cuatro pestañas enteras.

**Dos retoques vistos en las capturas de la 245,** ya en la rama:
- **En el móvil, el nombre largo cortaba también el código** («Compras de
  mercaderías · 60000…»). Ahora el que se acorta es el nombre y el código se
  ve entero, siempre. En el ordenador, la cuenta va en una línea en vez de
  partirse.
- **La fila LD decía «Va a esta cuenta (del asiento)»:** su cuenta sale de su
  asiento ya propuesto, no de la ficha. Ahora dice «Va a la cuenta de su
  asiento, ya propuesto…», con su prueba.

**Lo que sigue sin ser igual que la maqueta,** y por qué (de T6, sin cambios):
- **N22:** sin «Por correo», porque el correo está apagado; sin «Por
  recepción», sin «Tuyos» y sin las pestañas que no existen.
- **N23:** sin «Local», porque la factura de la semilla no casa con ninguna
  recepción; y sin «Precios».
- **Frente C:** el marco es de la C06.

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

**Qué va:** la base (0200 a 0310), tres edge functions y el front.
**En este orden:** base, edge functions y front.

### 4.1 · La base

**Manifiesto:** `supabase/produccion/aplicar.txt`.
- Lleva las 12 migraciones en orden: 0200, 0210, 0220, 0230, 0240, 0250,
  0260, 0270, 0280, 0290, **0300** (R5) y **0310** (R6). Las dos nuevas
  reemplazan en caliente, con la misma firma, las lecturas de N22 y N23;
  declaradas en su cabecera y con su prueba de staging.
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

**El contexto, medido en producción** a las 05:53Z para los 10 primeros, y
otra vez con la 0300 (06:53Z) y con la 0310 (**2026-10-14T07:14Z**). Es la
consulta del workflow (`analizar.mjs sql-contexto`, con `CAMINO_TABLAS` y
`CAMINO_FUNCIONES` del workflow), en solo lectura. Va guardado con el md5 de
los 12 ficheros en `tests/conta/produccion/contexto-produccion-tanda-viva.json`.
Las tres medidas dan el mismo contexto: la 0300 y la 0310 no nombran objetos
nuevos, solo añaden su versión al historial, que sigue vacío.
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
Análisis de la tanda viva contra el contexto de producción medido 2026-10-14T07:14Z (md5 de los 12 ficheros: los medidos).
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
  20261021T0300_d01_documentos_r5.sql: sigue
  20261021T0310_d01_recepcion.sql: sigue
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
- **Decidido (R5): se despliegan primero,** desde el mismo commit que se va a
  fusionar, con el workflow «Desplegar edge functions» **que lanza Julio**
  (no a mano desde la sesión), con el md5 medido a los dos lados. Después se
  fusiona el front, que las vuelve a desplegar iguales, byte a byte.
- **Lo que cuesta:** entre ese despliegue y la fusión, lo desplegado va por
  delante de `main` (`edge-drift-watchdog` lo vería si pasara de un día). Son
  minutos, y se mide a los dos lados (CLAUDE.md, regla 1).
- **Los campos del workflow, para copiarlos** (§5, paso 3):

  | Campo | Valor |
  |---|---|
  | Use workflow from | `conta/d01-recibidas` (en el commit que dé en el §5, paso 1) |
  | `funciones` | `ocr-albaran conta-facturas-entrada conta-diez-enviar` |
  | `la_prohibida` | (vacío) |

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

**Todavía no:** falta la prueba de la lectura con el modelo (§0) y que Julio
vea las capturas nuevas (§1).

**El orden de las tandas en producción** (Julio, R5): **primero C06, después
B01 y después D01.** Cuando entre la C06, traigo `main` a esta rama y cambio el
puente de «solo contabilidad» por `useCuentaConta().soloContabilidad`, con su
prueba (§7). Cuando entre B01, traigo `main` otra vez: su `sinPregunta` es el
mismo que he puesto aquí, byte a byte (§9), y se une solo. Con cada `main`
nuevo, vuelvo a medir el contexto y paso el paso 8.

Cuando le toque a D01:

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
3. **Julio · las edge functions:** «Desplegar edge functions»
   (`deploy-edge-functions.yml`), con los campos de la tabla del §4.2:
   - «Use workflow from»: `conta/d01-recibidas`, el commit del paso 1;
   - `funciones`: `ocr-albaran conta-facturas-entrada conta-diez-enviar`;
   - `la_prohibida`: vacío.
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
   - **Lo comprueba Julio** (R5) en Supabase › Edge Functions › Secrets:
     que `RESEND_FACTURAS_WEBHOOK_SECRET` **no** esté puesto.
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
- **R5 · `src/modules/conta/marco/MarcoConta.tsx` y `MenuConta.tsx`.** El
  `sinPregunta` de B01 (`conta/b01-bancos`), copiado **byte a byte** de su
  diff (`git apply` de su parche), para que las dos ramas se unan sin
  conflicto.
- **R5 · `src/modules/conta/module.tsx`.** `enMarco` con su tercer argumento,
  igual que en B01, y `true` en las dos rutas de Documentos.

## 9 · R5 · Los retoques de N22 y N23

Cada punto, con lo que se ha hecho y dónde se prueba.

**N23 · Revisar factura**
1. **El vencimiento.**
   - **Era la semilla, no la lectura.** `seed_d01_staging.sql` metía la
     F-2026-1022 sin `due_date`: la semilla no pasa por la lectura. El camino
     de verdad (`conta_factura_desde_lectura`, 0220) sí guarda el vencimiento
     leído.
   - **Arreglada:** 10/11/2026, y la ficha de Alfa a 30 días (con la fecha da
     el mismo día).
   - **Lo que sí faltaba en la lectura:** si el modelo copia la fecha como
     está en el papel («10/11/2026 · transferencia»), se perdía y la pantalla
     decía «sin vencimiento».
     - Ahora `fechaLeida` entiende el día primero (10/11 es el 10 de
       noviembre), y una fecha que no existe no vale.
     - Un vencimiento que viene y no se entiende se dice
       («vencimiento_ilegible»), no se calla.
   - **Pruebas nuevas** en `lecturaFactura.test.ts`: seis formas del mismo
     vencimiento, fechas imposibles, y el que no se entiende.
   - **En pantalla** (`vencimientoAEnsenar`): manda el de la factura; si su
     ficha da otro día, en ámbar («su ficha (60 días) daría el 10/12/2026»).
     Sin vencimiento en la factura, el de su ficha; sin ninguno, «ni la
     factura ni su ficha lo dicen».
2. **«Se apunta en Folvy · a Diez irá cuando Cegid active los documentos»,** en
   vez de «se enviará a Diez con su PDF». Vendido solo: «Se apunta aquí · …».
3. **«Cómo se apunta».**
   - En el ordenador, dos columnas alineadas con su título pequeño: «Gasto e
     IVA» y «A pagar».
   - En el móvil, por grupos: cada cuenta en una línea, sin partirse (se
     corta con «…» si no cabe), y su cifra a la derecha.
4. **El papel en el móvil.**
   - `PapelPdf` mide hasta dónde llega la tinta (`tinta.ts`), y el papel se
     recorta a eso, con un máximo de 280 px.
   - Se toca (o «Ver el papel entero») para verlo entero, y «Recoger el
     papel» lo vuelve a recortar. Lo mide la e2e.
5. **La banda,** en ámbar (punto y borde) mientras no esté apuntada; verde solo
   con su asiento validado (`tonoDeLaFactura`). La de N22 también: ámbar si
   queda algo por mirar.

**N22 · Bandeja**

6. **Cada fila con su porqué y qué hacer.** Para eso la base trae más (0300):
   cuántas facturas suyas había antes y lo aprendido de ellas (0250).
   - **SB y PL:** «Es la primera factura de este proveedor: elige dónde se
     apunta y lo recuerdo».
   - **Con anteriores sin apuntar:** «Hay 2 facturas suyas anteriores, pero
     ninguna está apuntada: …».
   - **Con algo aprendido:** sale como lo entendido, «· sin confirmar», con su
     porqué y «Confírmalo y lo recuerdo», como en N23.
   - **LD,** con su cuenta de la ficha y escrita a mano: «Va a su cuenta de
     siempre, la de su ficha. La escribieron a mano y no la he leído:
     comprueba los importes con el papel».
   - Ninguna fila sin apuntar se queda sin porqué: lo prueban la unitaria y la
     e2e, fila a fila.
7. **Por dónde llegó,** en minúscula y lo que pasó de verdad:
   - «llegó por correo»;
   - «foto subida» o «PDF subido», según su fichero;
   - «escrita a mano», la de Compras sin papel;
   - «leída en Compras», la leída allí sin canal;
   - «de su recepción en Cocina».

   No pongo «subida desde el móvil» ni «subida a mano»: de una subida se sabe
   si fue una foto o un PDF, no desde qué aparato. Y «a mano» es que se
   escribió en Compras, no que se subiera. Antes, sin canal apuntado, la base
   decía «subida» aunque no lo fuera (0280); la 0300 lo arregla.
8. **El periodo.** La banda y la primera cifra son del mes elegido: «Han
   llegado 7 facturas en octubre», «Llegadas en octubre». La base contaba los
   últimos 7 días aunque se eligiera un mes; la 0300 cuenta el periodo pedido,
   como la lista. Lo prueba staging («la creada hace 30 días cuenta»).
9. **Móvil.** La fecha va junto al número («F-2026-1022 · 11/10 · llegó por
   correo»). Las cuatro pestañas caben en 390 px. En un teléfono más estrecho
   van más juntas y, si aun así no caben, se deslizan. La e2e mide que «Todas»
   queda entera dentro de la pantalla.

**Las dos**

10. **Sin la barra «Pregunta o pide algo»,** ni el botón de la IA en el móvil,
    mientras solo diga «Muy pronto». Es el mismo `sinPregunta` de B01, copiado
    tal cual. La e2e comprueba que no está en N22 ni en N23.

**La base de la R5: la 0300** (staging, run **38525387878**, en verde: el
ensayo, la real con su registro y su prueba como usuario A y B).

## 10 · R6 · Las facturas que ya entran por la recepción

**Lo medido en producción,** solo leyendo, Foodint (`51ad1792…`, regla 9), el
14/10.

**Las cifras de la R6 incluyen la cuenta plantilla.** La tabla sale de
`goods_receipt_ai_session` entera:
- 252 / 50 / 32 son de Foodint **más la plantilla**, `Folvy Interno`, que
  aporta 30 / 6 / 3;
- de Foodint solas son **222 / 44 / 29 lecturas**.

**Y son lecturas, no documentos.** Una recepción se puede leer más de una vez.
Por recepción (`goods_receipt.ai_session_id`), Foodint tiene:

| Papel leído por la recepción | Recepciones | Vivas (no anuladas) | Desde el corte (01/10) | Con su papel | Ya son factura |
|---|---|---|---|---|---|
| factura | 19 | 18 | 2 | 19 | 2 |
| albarán-factura | 26 | 24 | 3 | 26 | 3 |
| albarán | 151 | 143 | 18 | 151 | 0 |

**Así que las «82» son 43 recepciones vivas,** o 45 contando las 2 anuladas.

**1 · ¿Salen hoy en la bandeja?**
- **Hoy, en producción, ninguna:** N22 no está publicada.
- **Cuando lo esté, desde el corte salen las 5.** Ya son factura recibida:
  Compras las hizo con el mismo papel al confirmar la recepción (0140). Son
  las 5 `en_revision` de octubre, con su papel y su recepción. Saldrían «para
  mirar» y, con la 0300, «de su recepción en Cocina» (con la 0280 habrían
  dicho «subida»).
- **Las 38 de antes del corte no salían en ninguna parte:** Compras no las
  hace factura a propósito, porque las llevó Diez.

**2 · Que salgan (0310), sin volver a leer.**
- **N22** trae, además de las facturas, las recepciones cuyo papel es una
  factura y que no son factura:
  - **de antes del corte:** «en Diez». Enlazadas con su asiento traído cuando
    casan por proveedor, número y total: «Ya en Diez · asiento 2/…». Solo en
    «Todas», con «Ver papel» y sin botón de apuntar;
  - **desde el corte sin factura**, porque la recepción no pudo hacerla (por
    ejemplo, sin importes por línea): «por aclarar», con el porqué de su
    camino (regla 7). Hoy en producción son 0: las 5 lo son.
- **N23:** si la factura salió de su recepción y no trae lectura propia, se
  comprueba lo que leyó la recepción con la **misma regla** que el modo
  factura: cuadra, IVA por tipo, NIF, número…
  - Es `conLoLeidoEnRecepcion`, en el navegador, sin el modelo ni coste
    nuevo.
  - Lo dice primero: «Lo leyó la recepción del 11/10 con su papel; no la he
    vuelto a leer».
  - Comprobado contra la forma real de esas lecturas: las claves de
    `parsed_result` de las 73 de Foodint (`document`, `lines`, `confidence`).
- **Repetidas:** una factura hecha desde la recepción es una `supplier_invoice`
  como las demás. Si luego llega la misma por correo o subida, la regla la
  marca «repetida» y el disparador no la deja entrar (prueba de staging de la
  0310, punto 5).

**3 · El albarán suelto (151)** no sale: no es factura, y sigue esperando la
suya.

**4 · Hacia atrás.**
- **Desde el corte** vale solo, porque Compras ya las hace factura.
- **Antes del corte, solo se enlazan.**
  - **Nunca se apuntan otra vez:** la fila no tiene botón de apuntar, y la
    base no deja asentar en fecha anterior a `imported_until` (30/09/2026,
    C04 0120).
  - **No se escribe nada en producción:** el enlace con Diez se calcula al
    leer N22, sin una tabla nueva ni datos que rellenar.

**5 · Recuentos** (las mismas condiciones que la 0310, medidas en producción):

| | Recepciones vivas | En Diez: proveedor + número + total | En Diez: el número con otro total | En Diez: solo el mismo total, ±31 días | Sin rastro en Diez | Sin subcuenta (no se puede casar) |
|---|---|---|---|---|---|---|
| Antes del corte | 38 | **21** | 1 | 4 | 12 | 3 |
| Desde el corte | 5 | 0 | 0 | 1 | 4 | 0 |

- **Cómo se casa con Diez.**
  - **El número va en el concepto.** El histórico de Diez no trae el número
    de factura en ningún campo propio: 0 de 5.345 líneas de serie 2 con
    referencia o justificante. Va en el concepto: 5.210 de 5.345 conceptos
    llevan cifras.
  - **Se casa por concepto:** su número, sin signos, dentro del concepto, con
    el mismo proveedor (su subcuenta) y el mismo total.
  - **«Solo el mismo total» no se cuenta como casada.** Desde el corte, Diez
    no tiene nada (acaba el 30/09). Su 1 de «mismo total» es otra factura con
    el mismo importe: prueba de que el total solo no basta.
- **Con la regla de la 0310** (recepción confirmada, de esta empresa):
  - antes del corte salen **37 filas**, 20 con su asiento de Diez y 17 sin
    casar;
  - desde el corte, 0, porque las 5 ya son factura.

  De 38 a 37, y de 21 a 20: una de las vivas está en `borrador`, sin confirmar,
  y no sale.
- **Una de las 37 tiene fecha de recepción de 2025-09,** con su lectura de
  2026. Es un dato de la recepción para mirar; aquí sale en su mes, como las
  demás.

**La prueba con el modelo sigue siendo necesaria** para el modo «factura»
nuevo (correo y subida). La recepción ya lee en producción con su propia clave.

**Lo que no hace la 0310, y lo digo:**
- **Una factura de antes del corte que llegue después por correo o subida.**
  Se crea como factura, `para mirar`, y no se puede apuntar, porque su fecha
  es anterior al corte. No se reconoce todavía como «ya en Diez»: eso sería
  llevar la regla de repetidas al histórico de Diez.
- **Las empresas con varias sociedades.** Una recepción de antes de Compras
  (sin camino) se atribuye a la empresa del NIF a cuyo nombre va el papel, o
  a la única de la cuenta. Foodint tiene una. En una cuenta con varias y sin
  NIF en el papel, esa recepción no sale.
