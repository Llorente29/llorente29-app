# C04b · Tarea 1 — comprobaciones previas con Diez

Encargo de Julio del 11/10. **Solo lectura.** Hay dos fuentes, y cada cifra
dice de cuál sale:

- **El Swagger público de apiCON.** Se lee sin credenciales, desde el runner
  de GitHub, porque el contenedor no tiene salida a apicon.diezsoftware.com.
  Workflow `diez-lectura.yml`, modo `swagger`, run 2 (`f082584f`).
- **Los datos de Foodint en Diez.** Hace falta el secreto `DIEZ_LECTURA`, y el
  modo `lectura` **está escrito y espera a ese secreto**. Más abajo está cómo
  se crea.

Lo de Folvy se ha medido en producción con `SELECT`, cuenta Foodint
(`51ad1792…`).

---

## 1. Lo que dice el Swagger (hecho)

- **Swagger 2.0**, título «WebApi», v1, en `/swagger/docs/v1` (91.939 B).
- **108 operaciones**: GET 50 · POST 38 · PUT 16 · PATCH 2 · DELETE 2.
- **Ninguna lleva texto explicativo**: 0 de 108 tienen `summary` o
  `description`. Todo lo que no sea el nombre y el tipo de un campo hay que
  medirlo; no se puede leer.
- **No declara seguridad** (`securityDefinitions` vacío), aunque `POST /token`
  existe. Se supone `Authorization: Bearer`, y el modo `lectura` lo comprueba.

### Entrar

`POST /token` recibe `AuthParameters`, con estos campos: `grant_type`,
`client_id`, `client_secret`, `username`, `password`, `nombre_bd` y
`cod_empresa` (int).

Devuelve `AuthResponse`: `access_token`, `token_type`, `expires_in`, `issued`
y `expires`. **También devuelve `Name`, `Email`, `UserName`, `Id` y
`DataBaseName`**, que son datos personales de quien entra. El lector solo
imprime los **nombres** de los campos de esa respuesta, nunca sus valores.

**El token va por empresa** (`cod_empresa`): una conexión es una empresa de
Diez. Eso decide dónde se guarda la credencial (§4).

### Leer

| Lo que se quiere | Ruta | Lo que el Swagger no dice |
|---|---|---|
| Asientos con sus líneas | `GET /api/apuntes/all?fechaDesde&fechaHasta` → `RespuestaPaginada[Apunte]` | el formato de la fecha (es `string`); cómo se pide la página 2 y su tamaño (no hay parámetros declarados) |
| Un asiento | `GET /api/apuntes/asiento/{ejercicio}/{serie}/{documento}` | **declara que devuelve `Factura`**, no `Apunte`: hay que medirlo |
| Cuántos hay, sin bajarlos | `GET /api/apuntes/resumen?fechaInicio&fechaFinal&tipoAsiento` → `ResumenApunte[]` (periodo, ejercicio, mes, tipo de introducción 1–23, número) | — |
| Facturas (libros de IVA) | `GET /api/facturas/all?fechaDesde&fechaHasta` → `RespuestaPaginada[Factura]` | lo mismo que en los asientos |
| Adjunto de una factura | `GET /api/facturas/getfile/{ej}/{serie}/{doc}` → bytes | si hay adjunto en los asientos que no son factura |
| Analítica | `GET /api/analitica/asiento/{ej}/{serie}/{doc}`; catálogos: grupos, subgrupos, nivel 3 y tablas de reparto | si el listado de asientos ya la trae en `DetallesAnalitica` |
| Sumas y saldos | `GET /api/subcuentas/getSumasYsaldos/{periodo}/{fechaIni}/{fechaFinal}` | **qué es `periodo`**. Además, el modelo que declara (`SumasYsaldos`: Documento, Linea, Serie, Ejercicio, Fecha, Subcuenta, Debe, Haber) **parece una línea de asiento y no un saldo por cuenta** |
| Plan | `GET /api/subcuentas` (longitud: `DigitosPlanContable` en `/api/parametros`) | — |

Más cosas que salen del Swagger:

- **Las fechas son `int32`** en todos los modelos (`Fecha`, `FechaFactura`…),
  supuestamente AAAAMMDD. En los filtros de `/all` son `string`.
- **Los importes son `double`.** Todo lo que se compare se compara en
  céntimos redondeados (regla 1 del encargo: cuadrar al céntimo).
- **El ejercicio es `string`** y la serie es `string` de 4 o 5 caracteres,
  según el modelo.

### Escribir: `POST /api/apuntes/add`

**Pide** un `ApunteSimplificado`:

| Campo | Tipo | Obligatorio |
|---|---|---|
| Ejercicio | string | sí |
| Serie | string | sí |
| Documento | int32 | no |
| Fecha | int32 | sí |
| Descripcion | string | no |
| Detalles[] | Linea (int), **Cuenta** (string, obligatoria), Debe, Haber (double), Descripcion, Contrapartida (string) | — |

**Devuelve** un `Apunte`: el mismo asiento con su `Documento`, su
`TipoAsiento` (0–5), Debe y Haber totales, `Detalles` (que añaden
`Justificante`, `PunteoBancario`, `PunteoCuenta` y `Tercero`) y
`DetallesAnalitica`.

**Lo que no lleva**, y pesa en el diseño:

1. **Ni analítica, ni tercero, ni IVA.** Un asiento enviado con
   `apuntes/add` no llega a los libros de IVA de Diez. **El 303 sale de las
   facturas** (`Factura`: hasta 8 bases y 8 cuotas, recargo, retención,
   claves del SII, rectificativas, `Analitica[]` y `Vencimientos[]`). Si
   Folvy envía por `apuntes/add` un asiento de factura, el 303 de Diez **no
   lo verá**, y el criterio 7 del encargo (el 303 del trimestre igual en los
   dos) no se puede cumplir. → **Pregunta 2.**
2. **No hay clave de idempotencia ni campo «referencia externa».**
3. **Corregir:** existe `PUT /api/apuntes/update` con el mismo cuerpo, y
   **no existe ningún DELETE de asientos**. Anular en Diez es un
   contraasiento, igual que en Folvy.
4. **Adjuntar:** existe `POST /api/apuntes/upload/{ej}/{serie}/{doc}`, **sin
   cuerpo declarado**. Para facturas, `POST /api/facturas/upload` con
   `DatosDocumento` (nombre y bytes en base64).

### Dónde guardar en Diez la referencia de Folvy

| Opción | A favor | En contra |
|---|---|---|
| **A. Serie propia de Folvy en Diez, y `Documento` = número de Folvy** | Es **la clave de Diez** (ejercicio, serie, documento). Antes de enviar, `GET /api/apuntes/asiento/{ej}/{serie}/{doc}` dice si ya está, sin depender de ningún texto. Un reintento no puede duplicar: si la clave ya existe, lo dice Diez | `Documento` no es obligatorio y no sabemos si Diez **respeta** el que le mandamos o pone el suyo. Se mide en la empresa de pruebas con un solo asiento |
| B. Prefijo en `Descripcion` del asiento (`F·V3·…`) | No depende de series | El largo no está declarado (el lector mide el máximo real). Un texto se puede editar a mano en Diez, y buscarlo exige bajar el mes entero |
| C. `Justificante` de la línea | — | **No está en `ApunteSimplificado`** (no se puede escribir) y su largo es 10 en `DetalleFactura` |

**Propuesta: A, con B de respaldo**, y en Folvy `external_send` guarda lo que
devuelve Diez: (ejercicio, serie, documento) y la huella de lo enviado. Si la
prueba dice que Diez no respeta `Documento`, la clave es la que devuelva, y la
comprobación previa pasa a ser B. → **Pregunta 1.**

### Rutas que no se llaman nunca, ni en lectura ni en pruebas

Hay **16 `POST /api/<Recurso>` sin parámetros que devuelven `boolean`**, contados en la tabla del run 2: `Actividades`, `Analitica`, `Apuntes`, `Autorizacion`, `Clientes`, `Facturas`, `FacturasEstimaciones`, `GrupoGastos`, `GrupoIngresos`, `Otros`, `Parametros`, `Profiture`, `Proveedores`, `Series`, `Subcuentas`, `Vencimientos`. El Swagger no dice qué hacen (¿comprobar permisos?).
Quedan **fuera del freno de lectura** (solo pasan los GET y `POST /token`) y
fuera del Diez simulado.

---

## 1b. Lo que preguntó la respuesta 1 (12/10), contestado desde el Swagger

**¿Admite letras la serie?** En el Swagger, sí. **¿Cabe `FOLVY`?** En el
asiento, sí; en las líneas de factura, no. Así está en el run 4:

| Modelo | `Serie` | Largo máximo |
|---|---|---|
| `Serie` (el catálogo, `Codigo`) | string | **5** |
| `Apunte`, `ApunteSimplificado`, `DetalleApunte` | string | sin declarar |
| `Factura`, `VencimientoFactura` | string | **5** |
| `FacturaData` (lo que se manda en `facturas/add`) | string | sin declarar |
| **`DetalleFactura`** | string | **4** |

- El tipo es texto en todos, así que el `8` no hace falta por el tipo.
- `FOLVY` cabe en el catálogo y en el asiento.
- **Las líneas de una factura (`DetalleFactura`) admiten 4 caracteres.**
- Que el Swagger diga «texto» no prueba que Diez acepte letras al grabar. Lo
  dicen dos cosas:
  - la lista de series reales, que saca la lectura;
  - el asiento único de prueba en la empresa de pruebas.

**Qué pasa con las facturas.** Si las facturas que envía Folvy también van a
la serie `FOLVY`, sus líneas no caben, y Diez la cortaría o daría error.
Propuesta:
- `FOLVY` para los asientos;
- las facturas en las series de factura que ya use Foodint en Diez, que
  saldrán en la lectura.

→ **Pregunta 5.**

**`facturas/add` frente a `facturas/addNuevoSistemaSII`.**
- Las dos reciben **el mismo cuerpo** (`FacturaData`) y devuelven `Factura`.
- El Swagger no dice nada más de ninguna de las dos (0 textos).
- La diferencia está en el servidor de Diez y no se puede leer.
- Por el nombre, la segunda es la de las empresas en el SII (el Suministro
  Inmediato de Información). **Para una empresa que no está en el SII
  corresponde `facturas/add`.** Es una deducción por el nombre, no una medida.
- Se confirma con **una sola factura** en la empresa de pruebas: tiene que
  aparecer en el libro de IVA de Diez y en el 303 del trimestre. Si no
  aparece, paro y lo digo.

**La colección de Postman de Cegid no está en el repositorio ni la tengo.**
- La he buscado en el correo y en Drive, sin resultado.
- Lo que uso de ella es lo que dice la respuesta 1:
  - OData (`$filter`, `$top`, `$skip`, `$orderby`, `$select`);
  - `/token` sin `nombre_bd` y con `cod_empresa` como texto;
  - https siempre.
- El ejemplo de `PostFactura` coincide en forma con `FacturaData` del
  Swagger, que lleva `Apuntes[]`, `Vencimientos[]` y `Analitica[]`.
- Si el ejemplo tiene algo que el Swagger no declara (un campo, un formato de
  fecha), lo necesito: **pégalo sin los valores**.

## 2. Lo que hay en el Diez de Llorente29 (C0008), medido

**Run 9** (`diez-lectura.yml`, 12/10, 06:30–06:52 UTC). Solo GET, solo
recuentos. Los runs 4 a 8 se quedaron por el camino, y cada uno dejó algo:
- **runs 4–6:** la base de datos va en `nombre_bd`;
- **run 7:** Diez corta las páginas en 200;
- **run 8:** `$skip` cuenta páginas, no elementos.

### Entrar

- **Un solo intento**, en formulario, con grant_type, client_id,
  client_secret, username, password y `nombre_bd`. `cod_empresa` no se manda.
  → **200**.
- **DataBaseName = C0008.** En el registro sale `***` porque es el mismo
  valor que el secreto y GitHub lo enmascara. El lector **solo sigue leyendo
  si es C0008**: con otro nombre entra y no lee nada, y con C0001 ni siquiera
  pide el token. Esos tres casos están probados contra el Diez falso.
- El token dura **14 días** (`expires_in` 1.209.599 s).
- La respuesta trae también `Name` y `UserName`, que son datos personales:
  solo se imprimen sus nombres de campo.
- `TipoContabilidad` 1 · **`DigitosPlanContable` 8**, como el C02c.

### ¿Es Llorente29? Sí

| | Diez hoy (C0008) | C02c, plan leído el 06/10 |
|---|---:|---:|
| Subcuentas de 8 cifras | **781** | 743 |
| grupo 1 | 76 | 76 |
| grupo 2 | 105 | 101 |
| grupo 3 | 30 | 30 |
| grupo 4 | 148 | 140 |
| grupo 5 | 140 | 139 |
| grupo 6 | 149 | 147 |
| grupo 7 | 133 | 110 |
| de ellas 40/41/43/44 (terceros) | 118 | 109 |
| Ejercicios con asientos | 2023, 2024, 2025, 2026 | 2023–2026 (el encargo) |

- Los grupos 1 y 3 son idénticos y el resto crece poco.
- Diez tiene **38 subcuentas más** que el PDF del C02c, 23 de ellas en el
  grupo 7. O son altas posteriores o el PDF no las sacaba. Se verán cuenta a
  cuenta al importar.
- En Folvy, Foodint tiene hoy **751** cuentas de 8 cifras (110 de terceros),
  filtradas por cuenta.
- **En una sociedad no existen `/api/clientes` ni `/api/proveedores`.** Diez
  responde «endpoint de Estimaciones/Autónomos para una empresa
  Estándar/Sociedades», y lo mismo con actividades y grupos de gastos e
  ingresos. Los terceros son subcuentas: 56 de las 781 llevan NIF.

### Cómo se lee

- **Páginas de 200 como máximo**, aunque se pida más con `$top`.
- **`$skip` cuenta páginas, no elementos.** Con `$top=2&$skip=2` llega el 5.º,
  y Diez dice «página 3».
  - Con `$skip` en elementos se pedía una página que no existe.
  - **Diez devuelve entonces la primera otra vez, sin avisar.** El lector
    ahora lo detecta y para.
- `$filter` funciona: `Fecha ge … and Fecha le …` devuelve todo dentro del
  mes, y `Ejercicio eq '2025'` todo de 2025.
- `$orderby` y `$select` también funcionan.
- `/api/apuntes/all` acepta fechas en formato `AAAAMMDD`, y no ISO ni
  `dd/mm/aaaa` (400).
- **Límites:** ningún 429 y ninguna cabecera de límite en 341 peticiones.

### Asientos, completos

Leídos **14.937 de 14.937** (enero 2023 – septiembre 2026). Cada mes cuadra
con el total que da Diez. 2026 tiene 4 más en su ejercicio, que son de
octubre.

| Ejercicio | Asientos | Líneas | Por serie |
|---|---:|---:|---|
| 2023 (desde octubre) | 929 | 2.794 | 1: 568 · 2: 158 · 3: 153 · 4: 45 · 9: 5 |
| 2024 | 2.563 | 6.474 | 1: 196 · 2: 778 · 3: 1.544 · 4: 8 · 9: 37 |
| 2025 | 4.222 | 10.704 | 1: 279 · 2: 1.281 · 3: 725 · 4: 1.926 · 9: 11 |
| 2026 (ene–sep) | 7.223 | 19.483 | 1: 1.234 · 2: 2.852 · 4: 3.134 · 9: 3 |
| **Total** | **14.937** | **39.455** | |

- **La contabilidad empieza en octubre de 2023**: de enero a septiembre de
  2023 hay 0 asientos.
- **Descuadrados al céntimo: 0** de 14.937. Hay 1 asiento sin líneas.
- **Series: 1, 2, 3, 4 y 9**, todas numéricas. Son las mismas cinco que
  Folvy tiene en su CHECK.
- Por tipo de asiento: 0 → 7.580 · 1 → 2.277 · 2 → 5.069 · otros 11.
- En las líneas:
  - con tercero: 0;
  - con justificante: 0;
  - **con contrapartida: 38.894 de 39.455** (98,6 %).
- **La descripción más larga tiene 68 caracteres**, en el asiento y en la
  línea. Es el margen para la referencia de Folvy de la opción B.
- `/api/apuntes/resumen` **cuenta líneas, no asientos**. Su «Número» sumado
  por ejercicio da exactamente las líneas de arriba: 2.794 · 6.474 · 19.483.

### Facturas, completas

**7.346 leídas de 7.346.** Las facturas son **los asientos de las series 1 y
2**: cuadran serie a serie con la tabla de arriba.

| Ejercicio | Facturas | Serie 1 | Serie 2 |
|---|---:|---:|---:|
| 2023 | 726 | 568 | 158 |
| 2024 | 974 | 196 | 778 |
| 2025 | 1.560 | 279 | 1.281 |
| 2026 (ene–sep) | 4.086 | 1.234 | 2.852 |

- `TipoFactura`: 1 → 7.330 · 6 → 10 · 7 → 6.
- `TipoAsiento`: 1 → 2.277 · 2 → 5.069. Es la misma partición que la serie;
  1 parece «emitida» y 2 «recibida», sin confirmar.
- Simplificadas: 0 · con vencimientos: 0 · con analítica: 0.

### Analítica: definida, pero sin uso

- El catálogo tiene 5 grupos, 12 subgrupos, 3 de nivel 3 y 0 tablas de
  reparto.
- **0 de 14.937 asientos** la llevan en el listado.
- **0 de 100** en la muestra pedida asiento a asiento (25 por ejercicio).
- **0 de 7.346** facturas.

→ **Regla 6: se compara por día**, porque Diez no tiene la venta por local.

### Adjuntos: no se pueden contar

`GET /api/facturas/getfile/{ej}/{serie}/{doc}` → **500 en 20 de 20** (5 por
ejercicio). En el run 7 dio 500 en 98 de 98. Puede que no haya adjuntos o que
la ruta falle; un 500 no distingue entre las dos cosas. **Pregunta para
Cegid.**

### Sumas y saldos: no son saldos

`getSumasYsaldos/{periodo}/20250101/20251231`:
- Con `periodo` 0, 1, 2, 3, 12 o 13 → 0 filas.
- **Con `periodo` 2025** (es decir, el ejercicio) → 1.776 filas.
- **Todas llevan `Documento` y `Linea`**: son líneas de asiento, no un saldo
  por cuenta, tal como hacía temer el modelo del Swagger.

La regla 1 dice «cuadrar al céntimo contra getSumasYsaldos». Con esta forma,
**el cuadre se hace con los saldos que Folvy calcule de los 39.455 apuntes
leídos**, y getSumasYsaldos se queda como segunda vara si Cegid explica qué
devuelve. → **Pregunta 7.**

## 3. Inventario: qué tiene cada uno que el otro no

### Lo que tiene Diez y no tiene sitio en Folvy

| En Diez | En Folvy hoy | Qué propongo |
|---|---|---|
| **Serie como texto** (≤ 5 caracteres) | `journal_entry.series` es `smallint` con CHECK (1, 2, 3, 4, 9) | Lo traído conserva la serie de Diez en `external_series` (ya existe). La serie de Folvy se asigna con una tabla de correspondencia por empresa, que hay que construir en la tarea 2 con las series reales |
| **Contrapartida y Justificante** por línea | No hay | `journal_line` + 2 columnas que admiten nulos (añadir: pasa siempre) |
| **Punteo bancario** (`PunteoBancario`, `PunteoCuenta`) | No hay conciliación | Se guarda tal cual en el apunte importado, sin uso. Conciliar es otro encargo |
| **Tercero como texto** (≤ 14) en la línea | `party_id` (uuid) | Se resuelve contra `party` por NIF o subcuenta; lo que no resuelva queda en texto y se cuenta |
| **Vencimientos y remesas** (`VencimientoFactura`: 27 campos) | No hay tabla de vencimientos | Fuera del C04b, salvo decisión. Se traen los asientos de cobro y pago, no la cartera |
| **Tablas de reparto** de analítica (porcentajes por grupo y subgrupo) | `cost_center` existe; no hay reparto | Depende de lo que diga la lectura sobre si Foodint usa analítica |
| **Facturas con 8 bases y claves del SII** | `vat_book_entry` (C05) | La correspondencia campo a campo es tarea 2. Si Diez tiene facturas sin asiento o al revés, sale en la lectura |
| **Estimación objetiva** (`facturasestimaciones`, módulos) e **Inmovilizado** de Diez | `investment_good` (C05) para bienes de inversión | Foodint es una SL: la estimación objetiva no debería tener datos, y la lectura no la toca. El inmovilizado se mira si la lectura da asientos de amortización |

### Lo que tiene Folvy y Diez no recibe

| En Folvy | En `apuntes/add` | Consecuencia |
|---|---|---|
| Local (`location_id`), marca (`brand_id`) y común por línea | No hay analítica en el cuerpo | Por local solo se puede enviar con facturas (`Analitica[]`) o con otra llamada que el Swagger no ofrece para asientos. Si Diez no tiene analítica, **se compara por día** (regla 6) |
| IVA por línea (tipo, base, libro, deducible) | No hay | **Pregunta 2**: facturas por `facturas/add` |
| Estado (propuesto o validado), confianza, porqué, cadena de huellas | No hay | Solo se envía lo **validado**. La huella de Folvy viaja en `external_send`, no a Diez |
| Tercero con ficha (`party`) | Solo en facturas (`CuentaCliente`, `CifCliente`) | — |

### Lo que ya está en Folvy para esto (medido)

- `journal_entry` **ya tiene** `external_program`, `external_series` y
  `external_number`, y el CHECK `journal_entry_traido`: `source_type =
  'migrated'` ⇔ `external_program` no nulo. **No hay índice único** sobre la
  referencia externa: hay que crearlo para la idempotencia (regla 2). Hoy hay
  0 filas con `external_program`.
- **Ejercicios de Foodint en Folvy: solo 2026** (`open`, `origin mixed`,
  `imported_until 2026-09-30`). **2023, 2024 y 2025 no existen**, y para traer
  el histórico hay que crearlos (¿cerrados?). → **Pregunta 3.**
- **Credenciales**: ya existe un patrón con Vault, `account_connector`
  (`credentials_ref`) y `connector_secret_save/read/clear`, que solo puede
  ejecutar `service_role`: ni `anon` ni `authenticated`. Medido con
  `has_function_privilege`. Pero `account_connector` es **por cuenta** y una
  conexión de Diez es **por empresa** (`cod_empresa`). Propuesta:
  `external_connection` por empresa, con la misma forma (referencia a Vault,
  funciones `security definer` solo para `service_role`, RLS de lectura sin el
  secreto) y el **mismo código de guardado**. Así no hay dos maneras de
  guardar un secreto. En el catálogo `connector` no hay ninguno de Diez.
- Hoy Foodint tiene en Folvy 20 asientos (`sales_day`) y 152 líneas.

---

## 4. Volúmenes, medidos

| | Cuántos | Datos bajados | Tiempo de Diez |
|---|---:|---:|---|
| Asientos (con líneas) | 14.937 · 39.455 líneas | 13,9 MB en 116 peticiones | 5,4 s de media por página de 200 |
| Facturas (con apuntes) | 7.346 | 24,7 MB en 66 peticiones | 8,9 s de media por página |
| Subcuentas | 781 | 0,6 MB | 0,4 s |

- **Traer el histórico entero, octubre 2023 – septiembre 2026, es ~22
  minutos y ~39 MB por lectura.**
- **La importación cabe en un solo workflow.** Un mes al día son entre 1 y 8
  páginas (el mayor, septiembre de 2026, tiene 1.418 asientos).
- **Adjuntos:** sin medir (ver §2).

## 5. Preguntas para Julio

**Contestadas en la respuesta 1:** 1 (serie `FOLVY` si admite letras), 2
(facturas por `facturas/add`), 3 (2023–2025 cerrados, con apertura,
regularización y cierre de Diez) y 4 (vencimientos, remesas y punteo, fuera).
Abiertas:

5. **Serie de las facturas.** `DetalleFactura.Serie` admite 4 caracteres
   (§1b). ¿Las facturas de Folvy van a las series de factura que ya usa
   Foodint en Diez, y `FOLVY` queda solo para asientos?
6. ~~`cod_empresa`~~ Resuelta el 12/10: en Diez cada empresa es una base de
   datos y se nombra con `nombre_bd` (Llorente29 = C0008, pruebas = C0009,
   C0001 nunca se toca).
7. **Sumas y saldos y adjuntos.** `getSumasYsaldos` devuelve líneas, no
   saldos, y `getfile` da 500 en 20 de 20. Propongo:
   - cuadrar contra los saldos que calcule Folvy de los apuntes leídos;
   - preguntar a Cegid qué devuelven las dos rutas.

   Mientras, la regla 1 se mide así.
8. **Las series de Diez son 1, 2, 3, 4 y 9, todas numéricas.** Que admita
   `FOLVY` solo lo dirá el asiento de prueba en C0009. Si no lo admite, `8`
   está libre en C0008, porque no aparece en ningún asiento.

Las cuatro de antes, por si hace falta releerlas

1. **Serie propia en Diez para lo que envía Folvy** (opción A de §1). ¿La
   creas tú en la empresa de pruebas, y con qué código (máximo 5)? Con un solo
   asiento de prueba se mide si Diez respeta el `Documento` que mandamos.
2. **Facturas con IVA: ¿se envían como factura (`facturas/add`) o como
   asiento (`apuntes/add`)?** Propongo factura: es la única forma de que el
   303 de Diez las vea y de que se cumpla el criterio 7. Lo demás (ventas del
   día, liquidaciones, nóminas, banco) va como asiento.
3. **Ejercicios 2023–2025 en Folvy**: ¿se crean **cerrados**, con lo traído
   de Diez como `migrated`, sin opción de tocarlo?
4. **Vencimientos, remesas y punteo bancario de Diez**: ¿fuera del C04b?

## Pendiente (fuera de la tarea 1)

- `workflow_dispatch` de `diez-lectura.yml` solo funcionará cuando el fichero
  esté en `main`. No hace falta para la tarea 1.
