# C04b · Lo que Julio exporta de Diez (documentos y sumas y saldos)

Respuesta 2 (12/10):
- **Los documentos son obligatorios.** El histórico no se da por traído sin
  ellos, y no se espera a Cegid.
- **Sumas y saldos:** hace falta un testigo de Diez que no salga de la misma
  lectura.

Este documento dice **exactamente** qué exportar. Antes de nada, **una
prueba de un solo mes**.

> **Regla de oro: lo que exporte Diez, tal cual sale.** Sin renombrar
> ficheros, sin abrir y guardar el Excel, sin cambiar columnas ni carpetas.
> El importador se ajusta a Diez, no al revés. Si algo de esta lista no lo
> saca Diez, se dice y se busca otra vía; no se rellena a mano.

## 1. La prueba de un mes: septiembre de 2026

Un solo zip:

```
diez-prueba-2026-09.zip
├── expedidas/       ← lo que Diez descarga con «descarga de documentos a una ruta», facturas EXPEDIDAS de septiembre
├── recibidas/       ← lo mismo, facturas RECIBIDAS de septiembre
├── expedidas.xlsx   ← el Excel de Diez de ese libro (expedidas, septiembre)
└── recibidas.xlsx   ← el Excel de Diez de ese libro (recibidas, septiembre)
```

- **Por qué septiembre de 2026:** es el mes con más facturas (1.103 en Diez,
  run 9). Si casa septiembre, casa cualquier mes.
- **Los nombres de las carpetas y de los dos Excel son los únicos que pongo
  yo.** Dentro de cada carpeta, los ficheros se quedan **con el nombre que les
  ponga Diez**.
- Si Diez crea subcarpetas o mete los ficheros en otro sitio, se deja tal
  cual: el importador recorre el zip entero.

**Dónde dejarlo:** en tu Drive. El zip lleva NIF y nombres de proveedores y
clientes, así que **no va al repositorio, ni al PR, ni al chat**. Lo leo desde
tu Drive, lo mido fuera del repositorio y en el PR solo pongo recuentos (lo
que casa, lo que no y por qué), como en la tarea 1.

### Qué tiene que traer el Excel (cada fila, una factura)

Los nombres de columna me dan igual: los leo como vengan. **Lo que no puede
faltar es el dato:**

| Dato | Para qué |
|---|---|
| **Serie** de la factura | casar con el asiento de Diez (series 1 y 2) |
| **Número de factura** (el del documento, `NumeroFactura`) | casar con el documento y con el asiento |
| **Fecha de la factura** (expedición) | casar |
| **NIF** del cliente o proveedor | casar (y desempatar homónimos) |
| Nombre del cliente o proveedor | solo para la lista de «revisar» |
| Base, cuota y total | comprobar que es la misma factura |
| **El nombre del fichero del documento**, si Diez lo pone en alguna columna | enlazar sin adivinar |
| El asiento de Diez (ejercicio, serie, número), si lo trae | enlazar directo |

Un ejemplo hecho a mano, con datos inventados, de lo que me sirve:

| Serie | Nº factura | Fecha | NIF | Nombre | Base | Cuota | Total | Documento |
|---|---|---|---|---|---:|---:|---:|---|
| 2 | A-1043 | 03/09/2026 | B00000000 | PROVEEDOR DE PRUEBA SL | 100,00 | 10,00 | 110,00 | `A-1043.pdf` |

**Si el Excel no trae el nombre del fichero**, el importador casa por serie,
número, fecha y NIF contra el nombre que Diez da a cada documento. Para eso
necesito ver cómo los nombra: lo dirá la prueba.

### Cómo se enlaza, y qué sale para revisar

Cada documento se enlaza con **una** factura traída de Diez, por este orden:

1. **El asiento de Diez**, si viene: ejercicio, serie y número.
2. **Si no**: serie + número de factura + NIF. La fecha desempata.
3. **Si casan dos o más, o ninguna**: no se enlaza. Va a la lista de
   **«revisar»** con el porqué: «ninguna factura con esa serie, número y
   NIF», «dos facturas posibles», «el fichero no aparece en el Excel»… **No se
   adivina nunca.**

Y al revés, la factura traída que no tiene documento se queda **«pendiente de
documento»**, y el «Histórico» no se da por terminado mientras queden.

## 2. Las sumas y saldos (el testigo de la regla 1)

### Lo que se ha mirado en la API

- El Swagger declara `Subcuenta` sin ningún campo de saldo, debe o haber.
- `getSumasYsaldos` devuelve **líneas de asiento**, no saldos (run 9).
- La lectura corta de la respuesta 2 lo mira campo a campo, y cuenta a cuenta
  contra los apuntes de 2025: §4.

Si la API no trae un saldo **independiente** de los apuntes, el testigo son
los listados de Diez.

### Los cuatro Excel

Cuatro listados de **sumas y saldos** de Diez, exportados a Excel:

| Fichero | A fecha | Ejercicio |
|---|---|---|
| `sys-2023-12-31.xlsx` | 31/12/2023 | 2023 (empieza en octubre) |
| `sys-2024-12-31.xlsx` | 31/12/2024 | 2024 |
| `sys-2025-12-31.xlsx` | 31/12/2025 | 2025 |
| `sys-2026-09-30.xlsx` | 30/09/2026 | 2026 |

Opciones del listado:
- **Nivel subcuenta** (8 dígitos), no grupos ni cuentas.
- **Acumulado del ejercicio hasta esa fecha, con el asiento de apertura
  incluido.**
- **Todas las subcuentas con movimiento**, también las de saldo cero.
- **Sin** el asiento de regularización ni el de cierre si Diez deja elegir;
  si no deja, dime cuál sale.

Cada fila tiene que traer: **subcuenta**, nombre, **debe**, **haber** y
**saldo**. Si el saldo viene en dos columnas (deudor y acreedor), vale igual.

Los cuatro van al mismo sitio que el zip, y por lo mismo: nombres de terceros.

## 3. Lo que hace Folvy con todo esto (tareas 2 y 3)

- **Dónde se guarda** (tarea 2, ya en staging):
  - cada documento es una fila de `external_document`: fichero, huella sha256,
    factura con la que casa, estado enlazado, revisar o pendiente de Diez, y
    el porqué;
  - cada fila de los Excel de sumas y saldos es una fila de
    `external_balance_witness`;
  - cada lectura, una fila de `import_run`.
- **Cómo se enlaza** (tarea 3): §1, sin adivinar.
- **La regla 1** (tarea 3): cuenta a cuenta, a cada una de las cuatro fechas:
  - el saldo de Folvy después de traer;
  - **igual al céntimo** que el del Excel de Diez.

  Lo que no cuadre se lista, y el histórico no se da por traído.
- **La API sigue siendo la vía** para los asientos y las facturas. Los
  documentos se piden también a la API cada noche, por si Cegid lo arregla:
  lo que llegue por ahí se compara con lo del zip por su huella.

## 4. Lectura corta de la respuesta 2 (run 10, 12/10)

- **getfile: lectura 1 de las 2 permitidas. No se gasta la segunda.**
  - Resultado: **500** en 3 facturas de septiembre de 2026 × 4 cabeceras
    `accept` (`*/*`, pdf, octet-stream, json).
  - El error dice **«The specified container does not exist.»**: el almacén
    de documentos de la base C0008 no existe en el servidor de Diez.
  - No depende de cómo se pida. El Swagger no tiene otra ruta ni otro
    identificador (no hay listado de gestión documental). La factura suelta
    trae `Documento`, que es el que ya se usaba.
  - **→ Va a Cegid tal cual**, con el mensaje. El plan es el zip (§1), y la
    API se reintenta cada noche por si lo arreglan.
- **Saldos en la API: ninguno.**
  - `/api/subcuentas` y la subcuenta suelta solo traen datos de ficha
    (código, nombre, NIF, dirección, IVA…).
  - `getSumasYsaldos` 2025: 1.776 líneas, de 22 de las 102 cuentas con
    movimiento, iguales al céntimo a esas mismas líneas de los apuntes.
  - **No es un testigo independiente.** El testigo son los cuatro Excel (§2).
- **Subcuentas de Diez que no estaban en el plan del C02c: 42 nuevas y 4 que
  Diez ya no tiene** (781 − 743 = 38 de diferencia neta). La lista está en el
  PR, con los nombres de terceros y de cuentas de banco sin publicar.

## 5. El zip real: `septiembre2026.zip` (12/10, medido fuera del repositorio)

Julio exportó de Diez el libro de requerimientos de septiembre de 2026
(recibidas y expedidas), «con descarga de documentos», y su Excel. Se ha
medido la FORMA, sin sacar ningún valor: aquí solo recuentos.

**Qué trae: 4 entradas, 141.797 bytes.**

| Entrada | Qué es |
|---|---|
| `recibidas/` | carpeta |
| `recibidas/recibidas.xlsx` | hoja `RECIBIDAS_GASTOS`, 40 columnas, 867 filas de factura |
| `expedidas/` | carpeta |
| `expedidas/expedidas.xlsx` | hoja `EXPEDIDAS_INGRESOS`, 34 columnas, 248 filas de factura |

**Ningún PDF.** Las carpetas solo tienen el Excel. → Lo que falta: §5.3.

### 5.1 Los Excel casan con la API al documento

- Recibidas: 867 filas son **855 facturas**. Las 12 de más son la misma
  factura con un segundo tipo de IVA: el libro pone una fila por tipo.
- Expedidas: **248 facturas**, una fila cada una.
- **855 + 248 = 1.103**, las mismas que dice la API para septiembre de 2026
  (run 9: «2026-09 · 1103»).
- Fechas de recepción de las recibidas: del 01/09 al 30/09. Fechas de
  expedición: del 13/01 al 30/09 (facturas atrasadas que entran en septiembre).
- Las fechas vienen como número de serie de Excel; el lector las convierte.

### 5.2 La clave del documento ya viene en el Excel, exacta

La última columna, **«Registro gestión documental»**, tiene un código de 7
piezas separadas por `_`. Es la misma forma en las 838 + 248 filas:

| Pieza | Recibidas | Expedidas | Qué es |
|---|---|---|---|
| 1 | `C0008` | `C0008` | la base de datos |
| 2 | `CON` | `CON` | contabilidad |
| 3 | `202` | `201` | el libro (recibidas / expedidas) |
| 4 | `RECIBIDA` | `EXPEDIDA` | — |
| 5 | `2026` | `2026` | el ejercicio |
| 6 | `2` | `1` | la serie de Diez |
| 7 | `<n>.pdf` (838 distintos) | `<n>.pdf` (248 distintos) | el número de documento del asiento |

- **Es la clave del asiento de Diez**: ejercicio, serie y documento.
- Confirma de paso lo que la API no decía: **serie 2 = recibidas** y **serie
  1 = expedidas**.
- **Enlazar es exacto, sin casar por nombre ni por NIF**: el PDF se busca por
  ese código, y el código dice a qué asiento pertenece.
- El Excel solo hace falta para eso y para las facturas sin código.

**Facturas sin código de documento:** 17 recibidas, 0 expedidas. Esas son
las que, si Julio confirma que no tienen PDF en Diez, quedan «pendiente de
documento», cada una con su porqué.

### 5.3 Lo que falta antes de pedir el resto de meses

1. **Los PDF.**
   - La «descarga de documentos» no los ha metido en el zip. O Diez los dejó
     en otra carpeta del ordenador, o la opción no se marcó.
   - Lo que hace falta: la carpeta con los ficheros tal como los nombra Diez.
     Si los nombra como el código de la última columna, se enlazan solos.
2. **Nada más del Excel.** Trae lo necesario: el código del documento, la
   serie, el número de factura y el NIF del expedidor o destinatario (para las
   17 sin código), las fechas y la base, el tipo, la cuota y el total.

**Propuesta para el resto de meses:**
- un zip por trimestre;
- las mismas dos carpetas, con los PDF dentro y el Excel al lado;
- primero se repite septiembre con los PDF, para comprobar que se enlazan los
  838 + 248.

## 6. La analítica de Diez al enviar facturas (Local, Marca, Plataforma)

Julio (12/10): en la pantalla de Diez, la factura recibida tiene Local, Marca y
Plataforma en la contrapartida. Hoy nadie los rellena. Folvy sabe local y
marca: si la API los admite, se rellenan al enviar, y la comparación puede ir
también por local.

### 6.1 Medido con una factura de prueba en la C0009

Workflow `diez-prueba-c0009.yml`, runs 1 y 2. Una factura recibida de 1,00 €
de base, número `FOLVY-PRUEBA-0001`, con la forma de una recibida real de la
propia C0009.

| Qué | Resultado |
|---|---|
| `facturas/add` con `Analitica[]` | **200**, documento 3174 de la serie 2 (ejercicio 2026) |
| La lee `facturas/factura` | base, cuota, total y número iguales; Diez generó **3 líneas de asiento** (600, 472, 400). **`Analitica`: vacía** |
| La lee `analitica/asiento/2026/2/3174` | **1 fila: Grupo `BAR`, Subgrupo `1`, Nivel3 `GLV`**, subcuenta 600…, debe 1,00, TipoImporte 0. **Es la que se mandó** |
| En el listado de facturas de octubre | sí |
| Segunda pasada (run 2) | la encontró por serie + número + NIF y **no envió otra** |

**Conclusión:**
- La API **admite la analítica** al dar de alta la factura y la guarda.
- Solo se lee por `analitica/asiento`: `facturas/factura` no la devuelve.
  Para comparar por local hay que pedir la analítica de cada factura enviada.
  Son unas 1.100 peticiones al mes; sin 429 medidos, cabe en la pasada
  nocturna.
- Queda en el cliente (`analiticaDe`) y en el Diez simulado, que se comporta
  igual.

**Falta que lo mire Julio en la pantalla de Diez (C0009):**
1. que la factura `FOLVY-PRUEBA-0001` salga en el libro de recibidas y en el
   303 del 4T;
2. que en la contrapartida se vean Local, Marca y Plataforma rellenos.

### 6.2 Qué es cada nivel (catálogo de la C0009, copia de la C0008)

| Nivel de la API | En la pantalla | Cuántos | Códigos |
|---|---|---|---|
| Grupo | **Local** | 5 | `BAR`, `CAM`, `CAN`, `FLO`, `JDH` (con nombre de calle) |
| Subgrupo | **Marca** | 12 | `1`–`12`; no cuelgan de ningún grupo |
| Nivel3 | **Plataforma** | 3 | `GLV` Glovo, `JUS` Just Eat, `UBR` Uber Eats |

### 6.3 La correspondencia con Folvy: no sale por nombre, se confirma

**Locales.**
- Diez tiene **5 grupos con nombre de calle**: Juan Antonio Bardem, Camichi 4,
  Cañaveral, Florencio Llorente y José del Hierro.
- Folvy tiene **3 locales**: Foodint Alcalá, Foodint Carabanchel y Foodint
  Plaza Castilla.
- No hay forma de casarlos sin adivinar. **Julio dice cuál es cuál**, y si
  dos de los cinco son locales cerrados o de otra empresa.

**Marcas: 12 en Diez y 18 en Folvy.**

| Diez | Folvy (propuesta, a confirmar) |
|---|---|
| 1 Milanesa House | Milanesa House *(Folvy tiene también «Milanesa Haus»: ¿cuál?)* |
| 2 Meraki Pita | Meraki Pita |
| 3 Scandal Burger | Scandal Burgers |
| 4 Smash Brothers | Smash Brothers Burgers |
| 5 Mila's Sandwiches | Mila's Sandwiches |
| 6 Bendito Burrito | Bendito Burrito |
| 7 The Urban Kebab | The Urban Kebab |
| 8 Dirty Burger | Dirty Burger |
| 9 French Tacos Club | — *(no está en Folvy)* |
| 10 Vooger | — *(no está en Folvy)* |
| 11 Lovers Burger | Lovers Burgers |
| 12 NKD Burger | — *(no está en Folvy)* |

Hay 9 marcas de Folvy sin subgrupo en Diez: Ay Mamita Bowls, Big Mike´s
Burger Joint, Birria Burrito, Chivuos, Deep Pizza, Dos Coyotes, Koreans do it
better, Lobbers y Milanesa Haus. Para enviarlas con marca, alguien las da de
alta en Diez; si no, salen sin marca.

**Plataformas:** GLV, JUS y UBR casan con los canales de Folvy sin duda.

### 6.4 Cómo lo usará Folvy al enviar (propuesta)

- **Una tabla de correspondencia por empresa** (Diez ↔ local, marca, canal).
  Una fila sin confirmar no se usa.
- **Al enviar una factura con línea de local y marca:** se manda su analítica.
  - Si el local o la marca no tienen correspondencia confirmada, se envía la
    factura igualmente, sin esa dimensión, y queda contada: «enviada sin
    marca: no tiene subgrupo en Diez».
  - La analítica es optativa en Diez y **no se retiene una factura por ella**.
- **Comparar por local:** solo para lo que envía Folvy desde el 01/10. El
  histórico de Diez no tiene analítica (0 de 606 recibidas en julio en la
  C0009, y 0 en las muestras de la C0008, run 9).

### 6.5 Lo que contestó Julio (12/10) y cómo ha quedado

- **La prueba vale.** `FOLVY-PRUEBA-0001` sale en el libro de recibidas y en
  el 303 del 4T de la C0009, con Local, Marca y Plataforma rellenos en
  pantalla. `facturas/add` con `Analitica[]` es la forma de enviar.
- **Locales.** La correspondencia no es simétrica: una tabla para leer y otra
  para enviar.

  | Grupo de Diez | Al leer | Al enviar |
  |---|---|---|
  | `CAM` Camichi 4 | Carabanchel | **Carabanchel va siempre con CAM** |
  | `BAR` Juan Antonio Bardem | **Carabanchel** | nunca (solo vale al leer) |
  | `FLO` Florencio Llorente | Alcalá | Alcalá |
  | `CAN` Cañaveral | Plaza Castilla | Plaza Castilla |
  | `JDH` José del Hierro | fuera: no es un local abierto ni tiene ventas | **nunca: freno en el cliente** |

  - BAR es la marca Scandal Burger, que se prepara y se recibe en Camichi 4.
    La dirección de Bardem solo sale porque Glovo no la cambió.
  - Scandal Burger se dice en el subgrupo, como las demás marcas.
- **Dónde vive:**
  - el freno de JDH está en el cliente (`GRUPOS_VETADOS` en `diezCliente.ts`).
    Una factura con `Grupo: JDH` en cualquier fila de la analítica no sale, y
    no llega a hacerse ninguna petición de escritura;
  - las dos tablas están en `diezAnalitica.ts`, con una revisión que no deja
    enviar con BAR ni con JDH;
  - las pruebas, en `tests/conta/diez/analitica.test.ts`.
- **Marcas:** la tabla de §6.3 sigue sin confirmar. Mientras tanto, las
  facturas salen sin marca y lo dicen.

## 7. Septiembre de 2026 con los PDF (12/10, medido en el Drive de Julio)

Carpeta `septiembre2026/` (recibidas y expedidas, cada una con su Excel). Los
nombres y tamaños se leyeron de Drive; los Excel se bajaron y son idénticos a
los del primer zip (mismo md5). Nada de esto entra en el repositorio: aquí
solo recuentos.

**Los documentos enlazan todos, por la clave, sin adivinar:**

| | PDF | Códigos en el Excel | Enlazados | Código sin PDF | PDF sin código |
|---|---:|---:|---:|---:|---:|
| Recibidas (serie 2) | 852 (838 nombres distintos) | 838 | **838** | 0 | 0 |
| Expedidas (serie 1) | 248 | 248 | **248** | 0 | 0 |

- **Cómo se nombran:**
  - cada PDF se llama `C0008_F<ejercicio>_<serie>_<documento>.PDF`;
  - el Excel lo nombra `C0008_CON_<libro>_<RECIBIDA|EXPEDIDA>_<ejercicio>_<serie>_<documento>.pdf`;
  - los dos dan la clave del asiento de Diez.
  
  Lo hace `diezDocumentos.ts` (`claveDeFichero`, `claveDeCodigoExcel`,
  `cruzar`). El cruce de arriba está hecho **con ese módulo sobre los 1.100
  nombres reales**.
- **14 nombres de recibidas salen dos veces** en Drive, con el mismo tamaño en
  las dos copias. Se quedará uno, comparando la huella sha256 al subirlo (la
  tabla de documentos ya exige sha único; corregido en §8.1).
- **Ningún PDF pasa de 10 MB.** El mayor pesa 652 KB, ninguno pesa 0 bytes y
  todos son `application/pdf`.
- **Las 17 recibidas sin código de documento** (§5.2) siguen sin PDF. Quedan
  «pendiente de documento», cada una con su porqué.

**Un hallazgo: algunos ficheros traen delante las cabeceras HTTP de la
descarga.**
- Muestra bajada entera: 6 PDF de todo el rango de tamaños (de 1.976 B a
  652 KB, de los dos libros).
  - Cinco empiezan por `%PDF` y acaban en `%%EOF`.
  - **Uno, la recibida 2026/2/3172, empieza por `content-length`,
    `accept-ranges`, `date`, `last-modified`, `etag` y `content-type:
    application/pdf`**, y después el PDF.
- **Cómo se trata:** `limpiarPdf()` las quita solo si:
  - todo lo que hay delante son cabeceras;
  - `content-length` cuadra con lo que queda;
  - el PDF acaba en `%%EOF`.
  
  Si algo no cuadra, el documento va a «revisar» con el porqué. Nunca se
  arregla a ojo.
- **Cuántos son de verdad no se sabe hasta subirlos todos:** el conector de
  Drive solo da tamaños. El importador lo cuenta y el informe lo dice.

**Para los trimestres:** el formato vale tal cual. Se pueden pedir en la
misma forma: una carpeta por trimestre, con `recibidas/` y `expedidas/` y su
Excel dentro.

### 6.6 Marcas: la tabla confirmada (Julio, 12/10)

| Subgrupo de Diez | Al leer | Al enviar |
|---|---|---|
| 1 Milanesa House | Milanesa House | Milanesa House → 1 |
| 2 Meraki Pita | Meraki Pita | → 2 |
| 3 Scandal Burger | Scandal Burgers | → 3 |
| 4 Smash Brothers | Smash Brothers Burgers | → 4 |
| 5 Mila's Sandwiches | Mila's Sandwiches | → 5 |
| 6 Bendito Burrito | Bendito Burrito | → 6 |
| 7 The Urban Kebab | The Urban Kebab | → 7 |
| 8 Dirty Burger | Dirty Burger | → 8 |
| 9 «French Tacos Club» | **Lovers Burgers** | **nunca: freno en el cliente** |
| 10 Vooger | se conserva «Vooger» (sin marca en Folvy) | — |
| 11 Lovers Burger | Lovers Burgers | **Lovers Burgers → 11, siempre** |
| 12 NKD Burger | se conserva «NKD Burger» (sin uso desde hace años) | — |

- **El 9 es Lovers Burgers.** Es la misma tienda de Glovo, en Florencio
  Llorente 29 (Alcalá): se le cambió el nombre y la dirección para
  aprovecharla, pero Glovo no actualizó los datos. Los subgrupos 9 y 11 se
  unifican: al leer, los dos son Lovers Burgers; al enviar, siempre el 11.
  Freno en el cliente (`SUBGRUPOS_VETADOS`), con su prueba, como el de JDH.
- **Sin subgrupo, a propósito:**
  - Milanesa Haus, Ay Mamita Bowls, Big Mike´s Burger Joint, Birria Burrito,
    Chivuos, Deep Pizza, Dos Coyotes y Koreans do it better son **cedidas**:
    van por la liquidación con el socio, nunca como venta, y si algo suyo
    llega a Diez va sin marca, diciendo por qué;
  - Lobbers ya no existe y no se usa.
- **Comprobado contra las 18 marcas reales de Folvy:** cada una tiene
  subgrupo o un porqué para ir sin él. Ninguna queda sin decidir (prueba en
  `analitica.test.ts`).

## 8. 2023, cuarto trimestre (12/10, medido en el Drive de Julio)

Carpeta `2023-4T/` con `recibidas/`, `expedidas/` y sus dos Excel. Es el
primer trimestre del libro: van del 31/10 al 31/12 de 2023. Aquí solo hay
recuentos. Los Excel llevan en el nombre los datos de la empresa y se quedan
fuera del repositorio.

| | Filas del Excel | Con código de documento | PDF | Enlazados | Código sin PDF | PDF sin código |
|---|---:|---:|---:|---:|---:|---:|
| Recibidas (serie 2) | 158 | 67 | 67 | **67** | 0 | 0 |
| Expedidas (serie 1) | 576 | 23 | 23 | **23** | 0 | 0 |

- **Las 158 recibidas** son las mismas que la API contaba en serie 2 de 2023.
- **Las 91 recibidas sin código** son, sobre todo, facturas de plataforma con
  numeración `ES-…`. En Diez no tienen documento, así que quedan «pendiente de
  documento», cada una con su porqué.
- **Las expedidas casi no tienen documento:** 553 de 576 no lo tienen, que
  es lo normal en ventas registradas por resumen. Las 23 que sí lo tienen son
  los documentos 1–18 y 774–778.
- **Ningún PDF pasa de 10 MB.** El mayor pesa 579 KB.
- **Cabeceras HTTP:** en este trimestre no se ha bajado ninguna muestra
  entera. Se cuentan al importar, igual que en septiembre (§7).

### 8.1 El mismo PDF respalda más de un asiento

Glovo emite **un solo documento** que Diez registra dos veces:

- como **expedida**, por la venta;
- y como **recibida**, por la comisión y los riders.

Dentro de las recibidas, además, el apunte de la plataforma y el de «riders»
comparten a veces la misma factura.

- **Medido:**
  - los 18 documentos expedidos 1–18 tienen cada uno el mismo tamaño exacto
    que una o dos recibidas (de la 4 a la 26). Son 18 grupos con 43 asientos;
  - hay un grupo más, solo de recibidas, con tres asientos (139, 140 y 142).
  - En total, 90 ficheros y **63 contenidos distintos** por tamaño.
- **Comprobado byte a byte en un par:** la expedida 2023/1/9 y la recibida
  2023/2/14 tienen el mismo sha256. El resto se ha comparado por tamaño
  exacto. El importador lo confirma con la huella de cada fichero.

**Consecuencia para el modelo.** El índice `external_document_sha_uq`, que
es único por (empresa, sha256), **impide enlazar el mismo fichero a dos
asientos**. Por eso la frase de §7 «la tabla ya exige sha único» deja de ser
una garantía y pasa a ser un error del diseño.

Confirmado por Julio el 12/10 (va en `20261019T0130_diez_documento_compartido.sql`):
- el fichero se guarda **una vez**, en una ruta de Storage derivada de su
  sha256;
- cada asiento tiene **su propia fila** en `external_document`, apuntando a
  ese mismo `storage_path`;
- la unicidad pasa a ser (empresa, sha256, asiento): el mismo fichero no se
  enlaza dos veces **al mismo asiento**, pero sí a varios.

Los 14 nombres repetidos de septiembre (§7) se siguen resolviendo igual:
mismo nombre y misma huella, una sola fila.

Es un fichero nuevo, con su cabecera `cambia:`. La 0110 ya está en el
historial de staging con su huella, así que no se reescribe. Se acompaña de
la prueba `20261019_diez_documento_compartido_prueba.sql` y de un ensayo que
la precede en el manifiesto.

### 8.2 Las 553 expedidas sin documento: qué son (12/10)

Julio pidió medirlas por cuenta y concepto antes de marcarlas. La regla que
dio:
- si son resúmenes de ventas del día (tiques), quedan como «no requiere
  documento»;
- si no, quedan como pendientes.

Medido con el Excel y con el API. Para el API se usó la lectura
`[lectura:expedidas]` (run 19), que devuelve solo formas y recuentos.

**Lo que dice el Excel de las 553:**

| Filas | Destinatario | Qué son |
|---:|---|---|
| 542 | Uber Eats | **Una factura por pedido**, tipo F1, al 10 %. El número es el código del pedido de Uber (5 caracteres). Se registran en lote el último día de cada mes: 93 en octubre, 329 en noviembre y 120 en diciembre. |
| 11 | Un cliente B2B | **No faltan:** son las líneas adicionales de sus 3 facturas, y esas 3 sí tienen PDF (el Excel da una fila por línea). |

**Lo que dice el API, por cuenta y concepto** (serie 1, del 01/10 al
31/12/2023: 568 facturas):

| Facturas | Forma del nº | Cuentas del asiento | Concepto | Qué son |
|---:|---|---|---|---|
| 525 | 5 caracteres (`X`, `9` o `A`) | 430 · 477 · 700 | `<código>-UBER EATS` | los pedidos de Uber |
| 36 | 16 caracteres | 430 · 477 · 700 | — | los documentos 1–18 de Glovo, dos facturas por asiento; todos con PDF |
| 5 | `A-9` (8) y otras | 430 · 477 · **705** | — | facturas a clientes B2B, con CIF; todas con PDF (docs 774–778) |
| 2 | 5 caracteres | solo 430 | — | dos registros del mismo documento con una línea: se revisan al importar |

Además hay **126 asientos de serie 1 sin factura** en esas fechas. No
están en el libro de expedidas, así que no generan fila de documento.

**Conclusión: ninguna de las 553 es un resumen de ventas del día.**
- **Uber Eats (542):** son facturas reales por pedido. Su PDF existe, pero
  vive en el portal de Uber, no en Diez. Por la regla de Julio no son «no
  requiere»: quedan **«pendiente de documento»**, con el porqué «factura
  por pedido emitida en el portal de Uber», a la espera del robot de
  portales (E04).
- **Cliente B2B (11):** no falta nada.

El importador cuenta por factura, no por fila del Excel, y por eso hay que
casar sus cifras con estas:
- Excel 576 filas ↔ API 568 facturas;
- Uber 542 filas ↔ 525 facturas (+2 por revisar). La diferencia de 15 se
  explicará al importar, factura a factura.

### 8.3 Los que quedan pendientes, y quién los traerá

| | Cuántos (2023-4T) | Estado | Quién los trae |
|---|---:|---|---|
| Recibidas de plataforma (`ES-…`) | 91 | `pendiente_diez`, con porqué | robot de portales (E04), cuando llegue |
| Expedidas de Uber Eats por pedido | 542 filas (≈ 525 facturas) | `pendiente_diez`, con porqué | robot de portales (E04), cuando llegue |
| Resúmenes de ventas del día | 0 en el libro | `no_requiere` (estado nuevo de la 0130) | no llevan PDF propio |

**No es una alarma:** son documentos que existen en los portales de las
plataformas, no papeles perdidos. Cuando haya pantalla, los enseñará todos, pero
separados de los que de verdad faltan y con quién los trae (regla 7: ordenar y
etiquetar, no esconder).


## 9. Los años completos 2024, 2025 y 2026 hasta el 30/09 (12/10, medido en el Drive de Julio)

Se midieron tres carpetas (`2024`, `2025` y `2026`), cada una con
`recibidas/` y `expedidas/` y su Excel, y se cruzaron por la clave igual que
2023-4T. Aquí solo hay recuentos: los Excel llevan en el nombre los datos de
la empresa y se quedan fuera del repositorio.

### 9.1 El cuadro

| Año | Libro | Filas del Excel | Códigos | Ficheros | **Enlazados** | Código sin fichero | Fichero sin código |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024 | Recibidas | 1.146 | 667 | 667 | **667** | 0 | 0 |
| 2024 | Expedidas | 236 | 195 | 195 | **195** | 0 | 0 |
| 2025 | Recibidas | 1.740 | 1.245 | 1.245 | **1.245** | 0 | 0 |
| 2025 | Expedidas | 297 | 261 | 261 | **261** | 0 | 0 |
| 2026 | Recibidas | 3.204 | 2.301 | 2.301 | **2.301** | 0 | 0 |
| 2026 | Expedidas | 1.234 | 1.135 | 1.135 | **1.135** | 0 | 0 |

- **Todo enlaza** por la clave (ejercicio, serie, documento), sin adivinar y
  sin nombres raros. Ningún fichero pasa de 10 MB; el mayor pesa 2,4 MB.
- **Septiembre de 2026 está repetido dentro de 2026:** las 838 recibidas y las
  248 expedidas de §7 vuelven a salir con la misma clave. El importador las
  reconoce por la clave y no las duplica.
- **El Excel de expedidas de 2024** se leyó en pantalla, porque el conector
  no lo dejó como fichero. Sus 195 códigos son los documentos 1–196 salvo el
  141.

### 9.2 No todo es PDF

| | PDF | XLSX | JPG |
|---|---:|---:|---:|
| 2024 recibidas | 662 | 4 | 1 |
| 2024 expedidas | 187 | 8 | — |
| 2025 expedidas | 260 | 1 | — |

- Los `.XLSX` de expedidas de 2024 son los **resúmenes mensuales de Uber
  Eats**. En 2023 Uber era una factura por pedido; en 2024 pasa a ser un
  asiento al mes con su hoja.
- El Excel nombra cada documento con su misma extensión, y la clave no
  depende de ella.
- `diezDocumentos.ts` las acepta ahora (`claveDeFichero`, `claveDeCodigoExcel`
  y `limpiarDocumento`). Lo que no es PDF se comprueba por su firma y no se
  toca; lo que no es lo que dice ser va a «revisar».

### 9.3 Documentos compartidos entre la expedida y la recibida

Es el patrón de 2023-4T (§8.1): **Glovo emite un documento que Diez registra
como expedida y como recibida.**

| Año | Parejas expedida ↔ recibida con el mismo tamaño exacto | Grupos mixtos de más de dos |
|---|---:|---:|
| 2024 | 170 | 4 (12 asientos) |
| 2025 | 231 | 3 (11 asientos) |
| 2026 | 213 | 17 (64 asientos) |

- **Comprobado por contenido** en una pareja de cada año (2024/1/120 ↔
  2024/2/587, 2025/1/113 ↔ 2025/2/434 y 2026/1/166 ↔ 2026/2/535): es la misma
  factura de Glovo, mismo número y mismo texto.
- **El mismo tamaño solo es una pista.** Se vio en dos sitios:
  - en los grupos de solo recibidas, como uno de 45 recibidas de 28.812 B en
    2024: son albaranes-factura distintos del mismo proveedor;
  - en los grupos de solo expedidas de 2026, como uno de 44 expedidas de
    2.494 B: son resúmenes diarios de Glovo de tiendas y días distintos.

  **Esos no se cuentan como compartidos.**
- **La cifra exacta la dará la huella sha256** al importar. El modelo ya lo
  admite: un fichero, una fila por cada asiento que lo usa (§8.1, la 0130).

### 9.4 Lo que no lleva documento, por año

Se cuentan facturas, no filas. Las líneas de más de una factura que sí tiene
documento (otro tipo de IVA, por ejemplo) no se cuentan como «sin documento».

| Año | Libro | Sin documento | Reparto |
|---|---|---:|---|
| 2024 | Recibidas | 111 | 102 Uber Eats (Portier, nº `ES-…`, de enero a abril) · 9 de otros proveedores |
| 2024 | Expedidas | 1 | el resumen de Uber Eats del 3T de 2024 (un asiento sin código) |
| 2025 | Recibidas | 36 | 12 Glovo (julio) · 2 Uber Eats (Portier) · 21 de otros proveedores · 1 registrada como «facturas por localizar» |
| 2025 | Expedidas | 18 | 13 Glovo (01/07/2025) · 5 de clientes B2B |
| 2026 | Recibidas | 551 | **368 de riders** (facturas de repartidores, de enero a marzo) · 138 Uber Eats (Portier, de enero a abril) · 45 de otros proveedores |
| 2026 | Expedidas | 99 | **90 de Uber Eats diarias** (`UBER-<fecha>`, una por día de enero a marzo) · 9 de un cliente B2B |

Sobre la regla de §8.2 (resumen del día = «no requiere documento»):

- **Las 90 de Uber Eats de 2026 son una por día**, con número
  `UBER-<fecha>`. Tienen la forma de un resumen de ventas del día. Se
  proponen como `no_requiere`, pendiente de que Julio lo confirme.
- **El resto queda «pendiente de documento»**, con su porqué y con quién lo
  trae:
  - Uber Eats (Portier), Glovo y Just Eat: el robot de portales (E04);
  - riders, proveedores y clientes: subida a mano o el buzón de facturas.

### 9.5 Una trampa del conector de Drive

Al listar una carpeta de más de 1.000 ficheros, las páginas de la búsqueda
**repiten unos ficheros y se saltan otros**. En 2026 recibidas salieron 157
repetidos y faltaron 184, aunque los 184 sí existían.

Se arregló listando por tramos de hora de creación, cada uno en una sola
página. Así salen los 2.302, sin repetidos.

El importador **no puede fiarse de un listado paginado**. Cuenta lo que trae
contra los códigos del Excel, y si falta algo lo busca por su nombre antes de
dar nada por perdido.
