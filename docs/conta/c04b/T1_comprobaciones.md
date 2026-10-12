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

## 2. Lo que hay en el Diez de Foodint (bloqueado: «No tiene acceso a la empresa indicada»)

**Lo que pasó (12/10, runs 4 y 5).** Medido en los runs, no supuesto:

- **https: sí.** `GET /swagger/docs/v1` → 200 por https antes de mandar
  ninguna credencial. Nada salió sin cifrar. Ninguna redirección se siguió.
- **El secreto tiene estas claves:** `client_id`, `client_secret`,
  `cod_empresa`, `grant_type`, `password` y `username`. Son las seis de la
  colección. `nombre_bd` ni está ni se manda.
- **`POST /token` → 400** con `error: "Error"` y `error_description:
  "Error 9 - No tiene acceso a la empresa indicada."`. El número sale como 9
  porque el lector cambia todas las cifras.
  - Diez entiende la petición, y la queja **no es de usuario ni de
    contraseña**: es de la empresa.
  - O `cod_empresa` no es el código de Foodint tal como lo espera Diez (¿con
    ceros delante?), o el usuario de la API no tiene acceso a esa empresa.
- **No se ha insistido.** El run 4 probó dos formatos (formulario y JSON).
  Desde el run 5, si Diez contesta con un error OAuth no se repite, para no
  sumar intentos fallidos contra tu usuario.

**Lo que hace falta (Julio):** mirar en Diez el código exacto de la empresa de
Foodint y si el usuario de la API la tiene dada. Después, corregir
`cod_empresa` en el secreto `DIEZ_LECTURA`. Con eso, un push que empiece por
`[lectura]` vuelve a lanzarla.

### Lo que contará cuando entre

El modo `lectura` (`scripts/conta/diez/lectura.mjs`) cuenta lo siguiente, y
**solo cuenta**:

- **Paginación**: primero OData. Mide que `$top` corta, que `$skip` salta,
  que `$orderby` ordena y que `$select` elige campos, y el `$top` mayor que
  acepta. Si OData no se aplica, prueba 6 nombres de página y 6 de tamaño.
- **Cada mes** se pide con `$filter=Fecha ge … and Fecha le …`, comprobando
  que todo lo devuelto cae en el mes. Si no, con `/all` y fechas.
- **Catálogos**: series (solo los códigos), subcuentas (por longitud, por
  grupo y por tipo), clientes, proveedores, vencimientos, actividades y los
  cuatro catálogos de analítica. Solo cuántos.
- **El resumen que da Diez** por ejercicio y tipo de introducción.
- **Asientos, mes a mes de 2023-01 a 2026-09**: por ejercicio y serie, líneas,
  tipo de asiento, descuadrados al céntimo, fechas fuera del mes pedido,
  repetidos entre meses, líneas con tercero, justificante o contrapartida, el
  largo máximo de las descripciones y la analítica que trae el listado.
- **Analítica por asiento**, en una muestra de hasta 25 por ejercicio,
  preguntando a `/api/analitica/asiento/…`.
- **Facturas, mes a mes**: por ejercicio y serie, `TipoFactura`,
  simplificadas, con vencimientos y con analítica. **Adjuntos** en una muestra
  de hasta 25 por ejercicio: cuántos tienen fichero, tamaño medio y tipo. Se
  descargan para medirlos y no se guardan.
- **Sumas y saldos** con 7 valores de `periodo` sobre 2025: forma, si las filas
  son cuentas o líneas, y si cuadran.
- **Límites**: peticiones, KB, tiempos por ruta, respuestas 429 y cabeceras de
  límite.

**Lo que nunca sale**: importes, nombres, NIF, conceptos, códigos de terceros,
el token o los datos de quien entra. Los mensajes de error se imprimen con las
cifras cambiadas por 9.

**El freno**: la función que habla con Diez lanza ante cualquier método que no
sea GET, salvo `POST /token`. Está probado contra un Diez falso local: 51 peticiones, 50 GET y 1 `POST /token`.

### Cómo se crea el secreto (Julio, en GitHub; nunca en el chat)

1. GitHub → `Llorente29/llorente29-app` → **Settings › Secrets and variables ›
   Actions › New repository secret**.
2. Nombre: **`DIEZ_LECTURA`**.
3. Valor: un JSON en una sola línea con **los nombres exactos que pide
   apiCON**. Los valores son los tuyos; aquí van `…`:
   ```json
   {"grant_type":"password","client_id":"…","client_secret":"…","username":"…","password":"…","cod_empresa":"…"}
   ```
   `cod_empresa` es la empresa **real** de Foodint, como texto y tal como lo
   escribe Diez, con los ceros delante si los lleva (colección de Cegid,
   12/10). Es solo lectura y la empresa de pruebas no se usa aquí.
4. Avisa con «secreto creado» y yo lanzo la lectura empujando un commit que
   empieza por `[lectura]`. El workflow **enmascara cada valor** antes de
   correr, y lo único que escribe del secreto son **los nombres de sus
   claves**.

*Cuando el workflow esté en `main` también se podrá lanzar a mano
(`workflow_dispatch` exige que el fichero esté en la rama por defecto). Para la
tarea 1 no hace falta.*

---

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

## 4. Volúmenes (espera al secreto)

Los da la lectura: asientos y líneas por ejercicio, facturas, adjuntos (con el
tamaño medio de la muestra), KB por página y tiempo por petición. Con eso:

- **Tamaño del histórico** = líneas × bytes por línea, y facturas × tamaño
  medio de adjunto, si se traen los adjuntos.
- **Tiempo de una importación entera** = páginas × tiempo medio, con el
  límite de peticiones que se observe.

---

## 5. Preguntas para Julio

**Contestadas en la respuesta 1:** 1 (serie `FOLVY` si admite letras), 2
(facturas por `facturas/add`), 3 (2023–2025 cerrados, con apertura,
regularización y cierre de Diez) y 4 (vencimientos, remesas y punteo, fuera).
Abiertas:

5. **Serie de las facturas.** `DetalleFactura.Serie` admite 4 caracteres
   (§1b). ¿Las facturas de Folvy van a las series de factura que ya usa
   Foodint en Diez, y `FOLVY` queda solo para asientos?
6. **`cod_empresa`.** Diez dice «No tiene acceso a la empresa indicada» (§2).

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
