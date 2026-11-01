# B01 · Revolut Business · Paso 0 (solo leer y medir)

> Encargo B01 · Revolut Business en Sumied: leer movimientos y pagar desde la
> factura. Sesión B. Hecho el 31/10/2026 sobre `main` en `f1ca68b`.
> Producción (`xzmpnchlguibclvxyynt`) **solo leída** (SELECT). Toda cifra va
> filtrada por la cuenta de Foodint (`account_id = 51ad1792-…`, regla 9).
> Nada aplicado, nada desplegado, ningún fichero de código tocado.
>
> **Sin datos reales** (T11): ni IBAN, ni saldos, ni nombres de proveedores. Solo
> recuentos y estructura. Los nombres y cifras de las maquetas son inventados.
>
> **Nombre:** ya existe un «B01» (Bancos y conciliación, 13/10, `docs/conta/B01_*`).
> Para no mezclarlos, todo lo de este encargo va en `docs/conta/b01-revolut/` y
> `docs/conta/maquetas/b01-revolut/`.

## 0. Lo que cambia el plan, en ocho líneas

1. **Revolut entra por el mismo enchufe que BBVA, sin vía paralela.** El núcleo
   `_shared/bancoAgregador.ts` ya tiene el contrato de un proveedor
   (`ProveedorAgregador` + `ConexionDelProveedor`) y `sincronizarEmpresa` mete
   lo leído por `bank_importar`, la misma que la subida de un fichero. Revolut es
   un proveedor más (`proveedorRevolut`), con su función propia (§1).
2. **«Sin duplicados por el id de Revolut» ya lo da la huella**: la huella dura
   de `bank_movement` incluye `reference_2`, y ahí va el id del proveedor;
   `bank_importar` hace `on conflict (treasury_account_id, fingerprint) do
   nothing`. Con dos condiciones que fijo yo: la fecha tiene que ser estable
   (la de `completed_at` en Madrid, no `created_at`) y solo entran los
   **completados** (§1.3).
3. **Solo 2 de los 67 proveedores activos de Foodint tienen IBAN** (y 1
   comprobado). De las 35 facturas recibidas sin pagar, **30 son de
   proveedores sin IBAN**. «Si la ficha no tiene IBAN, lo pide» no es la
   excepción: es el camino normal de las primeras semanas (§3). **P1.**
4. **La remesa de pagos ya existe** (PC01: `conta_pago_remesa`, fichero SEPA,
   «Confirmar el IBAN» si cambió). La remesa por Revolut es **esa misma remesa
   con otra salida**: en vez de «Descargar el fichero», «Pagar con Revolut».
   Foodint aún no ha hecho ninguna (0 filas) (§3).
5. **La API de Revolut Business, por lo que sé, no tiene un pago en lote**: cada
   transferencia es un `POST /pay` con su `request_id`. «Un lote aprobado una
   vez» se hace en Sumied, y puede salir a medias: la pantalla tiene que decir
   cuál salió y cuál no (§2.4). **P3.**
6. **La documentación oficial no la he podido abrir**: la red de esta sesión no
   deja pasar `developer.revolut.com` (sí la búsqueda). Lo de §2 es lo que sé de
   la API más lo que confirma la búsqueda, y cada punto lleva si está
   confirmado. **Antes de construir hay que dejar pasar `developer.revolut.com`,
   `b2b.revolut.com` y `sandbox-b2b.revolut.com`** en la red del entorno.
7. **La puerta de la demo aún no está en `main`**: `cuenta_puede_salir` existe en
   producción, pero `_shared/puerta.ts` y su prueba (`tests/unit/demo/puerta.test.ts`,
   `salidas.ts`) viven en el #409 (DM1 · PR 2a, borrador). Esa prueba detecta
   sola cualquier función que lleve escrita una dirección de fuera
   (`b2b.revolut.com` cuenta), así que las funciones de Revolut entran solas en
   su vigilancia. **Mi PR tiene que ir después del #409**, o traerlo con
   `git merge origin/main` cuando se fusione (§4).
8. **El sandbox de Revolut lo tiene que abrir Julio**: es una cuenta de empresa de
   pruebas en `sandbox-business.revolut.com`, a su nombre. Sin ella no hay e2e
   (§2.7). **P7.**

## 1. Cómo entra hoy un banco en Sumied, y dónde encaja Revolut

### 1.1 Las piezas que hay

| Pieza | Qué hace | Revolut |
|---|---|---|
| `treasury_account` (kind `bank`) | Cada banco de la empresa, con su IBAN y su cuenta 572 (`pgc_hint`). Foodint tiene **3** (BBVA). | **Una más por cada cuenta de Revolut** que se ligue, con su 572 (P2). |
| `bank_statement` | Cada lectura: fuente, periodo, saldo inicial y final, continuidad. | Fuente `agregador:revolut`. |
| `bank_movement` | Los movimientos, con `fingerprint` (dura) y `soft_fingerprint` (día+importe). Foodint: 2.300. | La misma tabla. |
| `bank_importar(...)` | La única entrada: deduplica por huella dura, marca «posible repetido» por la suave, mide la continuidad. | La misma. |
| `bank_aggregator_connection` | Una fila por empresa y proveedor: el nombre del secreto, si está activa, su último error. Foodint: 1 (BBVA). | Una fila `revolut`. El secreto, en el Vault por empresa (no una variable de entorno, como BBVA). |
| `bank_aggregator_link` | Por cuenta: estado, saldo del banco y su fecha, nuevos y repetidos de la última pasada. Es lo que pinta «Al día · hace…». Foodint: 3, las tres `al_dia`. | Una por cuenta de Revolut. Su saldo es el que usa el Cierre del mes. |
| `conta-banco-agregador` | La pasada de cada noche (03:00) para BBVA. | **No se toca**: Revolut tiene la suya (`conta-revolut-leer`). |
| `CierreDelMes.tsx` | Por banco, saldo del banco contra el contable a fin de mes. | Ya funciona para cualquier banco con extracto: sin cambios. |
| `CuentasYExtractos.tsx` + `DialogoBancoNuevo` + `lib/agregadorBanco.ts` (`lineaConexion`) | La lista de bancos y «Conectar un banco». | Revolut como opción propia en el diálogo; su línea, con `lineaConexion`. |

### 1.2 Lo común que se toca, lo mínimo

- `_shared/bancoAgregador.ts`: **nada** si el proveedor de Revolut va en su
  propio fichero (`_shared/revolut/proveedor.ts`) e implementa el contrato.
  `desdeCuando` usa `FUENTE_OBI` fijo: para Revolut hay que pasarle su fuente
  (un parámetro opcional, una línea). Es el único cambio en común.
- `DialogoBancoNuevo` / `CuentasYExtractos`: una opción y una línea más. Lo de
  dentro, en `src/modules/conta/bancos/revolut/`.
- La pantalla de Pagos (`compras/PagosPage.tsx`, `RemesaPagosPage.tsx`): un
  botón en la ficha de la factura y una salida más en la remesa.

### 1.3 Las reglas de la lectura (las fijo aquí, para la prueba unitaria)

- **Un movimiento por pata**: en Revolut una transacción tiene `legs`, una por
  cuenta tocada (un cambio de divisa toca dos). El id que va a `reference_2`
  es `<id de la transacción>:<leg_id>`. Así una transacción entre dos cuentas
  propias entra en cada una, una vez.
- **Solo `completed`.** `pending` no entra (cambiaría de fecha e importe).
  `declined` y `failed` no entran nunca.
- **La fecha, la de `completed_at` en Madrid** (regla 4), que no cambia. Con
  `created_at` una transferencia de las 23:50 que se completa a las 00:10 tendría
  dos fechas y dos huellas.
- **`reverted` después de completada**: entra un movimiento nuevo, de signo
  contrario, con id `<id>:<leg_id>:vuelta`. Lo ya casado no se toca: el
  contrario sale «por casar» y lo ve la persona. **P10.**
- La segunda lectura del mismo periodo da 0 nuevos y N repetidos. Es la prueba
  unitaria «sin duplicados».
- Las cuentas que no son en euros se leen y se guardan, **sin propuesta de
  casado** (`status` por casar, con el motivo «En dólares: no se casa solo
  todavía»).

## 2. Qué ofrece la API de Revolut Business

> Confirmado por búsqueda (enlaces abajo): **C**. De lo que sé de la API, sin
> haber podido abrir hoy la documentación: **S**. Todo lo **S** se confirma
> contra developer.revolut.com antes de escribir código.

### 2.1 Autenticación (C)

1. Quien conecta genera un **par de claves RSA** y un **certificado X.509** con la
   pública (S: RSA 2048, `openssl req -x509`). **Lo genera Sumied, en la función,
   y la privada no sale de ahí**: va al Vault por empresa.
2. En Revolut Business › **Ajustes › API** (S: *Settings › APIs › Business API ›
   Add API certificate*) se pega el certificado y una **dirección de vuelta
   (OAuth redirect URI)**. Revolut da un **`client_id`**.
3. **Firma del cliente** (C): un JWT firmado con la privada, con `iss` = el
   dominio de la dirección de vuelta (sin `https://`), `sub` = el `client_id`,
   `aud` = `https://revolut.com`. El dominio del `iss` tiene que ser el de la
   dirección de vuelta. (S: RS256, con `exp`.)
4. **Autorizar** (C): la persona pulsa «Activar acceso» en Revolut, Revolut
   vuelve a la dirección de vuelta con un `code` (S: vale 2 minutos), y se cambia
   por el token en `/auth/token`.
5. **Token de acceso: 40 minutos** (C). Con él viene un **token de renovación**
   (C). **Su caducidad no la he podido confirmar**: una librería de terceros dice
   90 días para el plan de autónomos (PSD2); para empresa, por confirmar. Si
   caduca, sale «Hay que volver a autorizar» como el permiso de BBVA.
6. **Retirar**: desde Sumied (borrar del Vault y, S, `DELETE` del certificado no
   se puede por API: se avisa de que lo quite también en Revolut) y desde
   Revolut (quitar el certificado: la siguiente renovación falla con
   `invalid_grant`, S, y Sumied lo pinta «Desconectada desde Revolut»).
7. Revolut avisa (C) de que la firma del cliente, el token y el de renovación
   **no se comparten nunca**: dan acceso a los datos y a pagar. Nada de eso en un
   registro (T11): los `console.log` de estas funciones solo llevan los últimos
   4 de la cuenta y recuentos.

**Consecuencias para el diseño**

- **La dirección de vuelta es una por entorno**: la función
  `conta-revolut-vuelta` de staging y la de producción. El certificado se ata a
  ella, así que **un certificado de staging no vale en producción** (bien: W10).
- (S) Revolut deja limitar el acceso a unas IP en producción. **Las funciones de
  Supabase no salen por IP fija**: si Foodint tiene esa opción puesta, no
  funciona. Por confirmar; si es obligatorio, es un bloqueo. **P8.**
- (S) El acceso se puede dar solo de lectura (`READ`) o también para pagar
  (`PAY`). Propongo **conectar primero solo para leer**, y pedir el de pagar
  cuando Julio active «Pagar con Revolut». **P4.**

### 2.2 Cuentas (S)

`GET /accounts` (id, nombre, saldo, divisa, estado) y `GET /accounts/{id}/bank-details`
(IBAN y BIC de cada una). Con varias cuentas o divisas, cada una se liga a su
`treasury_account` y su 572 en el paso 3 del asistente.

### 2.3 Transacciones (S)

`GET /transactions?from&to&account&count` (hasta 1.000 por página; se pagina
moviendo `to`), `GET /transaction/{id}`. Cada una: `id`, `type`, `state`
(`pending`, `completed`, `declined`, `failed`, `reverted`), `created_at`,
`completed_at`, `request_id`, `reference`, y `legs[]` con `leg_id`,
`account_id`, `amount`, `currency`, `description`, `balance` y la contraparte.
El `balance` de cada pata da el saldo después del movimiento: el Cierre del mes
puede tomar el **saldo real de fin de mes**, no reconstruirlo como con BBVA.

### 2.4 Beneficiarios y pagos (S)

- `POST /counterparty` con nombre de empresa, país, divisa e IBAN (y BIC si hace
  falta). `GET /counterparties` para no crearlo dos veces.
- **Comprobación del titular**: en euros, desde el 09/10/2025 los bancos de la UE
  tienen que comprobar el nombre del beneficiario (Verificación del beneficiario,
  Reglamento de pagos inmediatos). Cómo lo devuelve la API de Revolut (si en el
  alta del beneficiario o en el pago, y con qué respuesta: coincide, se parece,
  no coincide) **lo tengo que confirmar**. La maqueta del «rechazado» enseña el
  caso «no coincide» con lo que Revolut dice que es el titular.
- `POST /pay` con `request_id` (idempotente: si se repite, no paga dos veces),
  cuenta de origen, beneficiario, importe, divisa y concepto (`reference`).
  Devuelve `id` y `state`. El estado final llega por el aviso o leyendo
  `GET /transaction/{id}`.
- **No hay pago en lote** que yo sepa (la transferencia masiva es de la web de
  Revolut, con CSV). **P3.**
- (S) Si la cuenta de Revolut tiene reglas de aprobación propias, un pago por API
  se queda en Revolut esperando a que alguien lo apruebe allí. Sería una doble
  aprobación. **P5.**

### 2.5 Avisos (webhooks) (C que existen; detalle S)

`POST /webhooks` (S: versión 2) con la dirección y los eventos
`TransactionCreated` y `TransactionStateChanged`. Cada aviso viene firmado
(S: cabecera `Revolut-Signature`, HMAC-SHA256 de `v1.<marca de tiempo>.<cuerpo>`
con el secreto del aviso, y `Revolut-Request-Timestamp`). El aviso **no se cree**:
solo dice «mira esta transacción», y la función la lee con el token. Así un aviso
falso no mete nada. De respaldo, la lectura programada cada hora.

### 2.6 Límites (S)

No publican una cifra fija; responden 429 con espera. La carga del histórico va
por páginas, despacio, y se puede cortar y seguir (apunta hasta dónde llegó).

### 2.7 Sandbox (S)

`sandbox-b2b.revolut.com/api/1.0` y la web `sandbox-business.revolut.com`, con
cuentas de prueba, recarga de saldo por API y forma de forzar el estado de una
transacción (completar, rechazar, devolver). **Staging solo conoce la dirección
del sandbox** (W10): la dirección va en una constante por entorno, y en staging
la de producción no existe ni como texto.

## 3. Los datos de pago de los proveedores de Foodint

Medido en producción el 31/10, `supplier` con `account_id` de Foodint (1 cuenta):

| | Proveedores |
|---|---:|
| Fichas | 74 |
| Activas (sin archivar) | 67 |
| Activas con IBAN | **2** (las dos españolas) |
| … con el IBAN comprobado (`iban_verified_at`) | 1 |
| Activas con BIC | 0 |
| Activas con razón social (`legal_name`) | 59 |
| Activas con forma de pago puesta | 6 (`card`, `direct_debit`, `prepaid`, `transfer`) |

`supplier_invoice` de Foodint:

| Estado | Facturas | Proveedores |
|---|---:|---:|
| pagada | 90 | 4 |
| aprobada | 22 | 13 |
| en_revision | 11 | 1 |
| anulada · descartada | 1 · 1 | |

Sin pagar (`paid_at` nulo): **35**, de las que **30 son de proveedores sin IBAN**
y 5 de los 2 que lo tienen. Por la forma de pago (factura / ficha): 22 sin
ninguna de las dos, 6 con tarjeta, 5 por transferencia, 1 domiciliada, 1 en
efectivo. Las de tarjeta, domiciliación y efectivo **no deben ofrecer** «Pagar
con Revolut» como principal (se pagan solas o ya están pagadas).

**Lo que sale de aquí:**

- El IBAN se pide en el panel de pago y se guarda en la ficha **con la misma
  traza que ya existe** (`iban_set_at`, `iban_set_by_name`; y si cambia,
  `iban_previous`, `iban_changed_*`, el «IBAN nuevo» en ámbar de la remesa).
  Nada nuevo para eso.
- La razón social (`legal_name`, 59 de 67) es el nombre que va al beneficiario;
  si falta, el nombre comercial, avisado.
- Un IBAN recién escrito y un pago en el mismo minuto es justo el fraude del
  «cambio de cuenta del proveedor». Propongo que **un IBAN nuevo o cambiado
  pida la segunda aprobación** aunque el pago esté por debajo del tope. **P1.**

## 4. Qué tocan las otras sesiones (para no pisarse)

PR abiertos el 31/10 a las 20:00:

| PR | Qué toca que me afecte | Choque |
|---|---|---|
| #412 S01h · Abonos de proveedor (borrador) | `_shared/lecturaFactura.ts` y una migración `pago_por_compensacion` (forma de pago nueva en el pago de una factura). | **No toca** Bancos, conciliación ni Pagos en `src`. Mi pago apunta en `supplier_invoice_payment` igual que hoy: si el #412 añade una forma de pago, la mía (`revolut`) va en mi migración y no en la suya. Al construir, traigo `main` antes. |
| S01i · Comisiones de plataformas | Sin rama todavía. | Lo miro otra vez antes de tocar la conciliación. |
| #409 DM1 · PR 2a · La puerta (borrador) | `_shared/puerta.ts`, y cambia `conta-banco-agregador` y `conta-pago` para que pregunten. | Yo no toco esas dos funciones. **Las mías importan `puerta.ts`, que aún no está en `main`**: mi primer PR espera a que se fusione el #409. |
| #380 W10 · Staging no llama a producción | `_shared/secretoConRelevo.ts`. | Lo uso para el secreto del aviso de Revolut si se fusiona antes. |
| #399, #386 | Laboral. | Ninguno (el PR de nóminas por Revolut, el segundo, sí lo mirará). |

## 5. Piezas propuestas (para el paso 1, no hechas)

- **Base** (tanda `supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`,
  todo «añade»): `revolut_conexion` (por empresa: `client_id` cifrado o en el
  Vault, estado, alcance lectura/pago, topes por pago y por día), `revolut_pago`
  (cada pago: factura o remesa, `request_id`, importe, beneficiario, estado de
  Revolut, motivo, quién aprobó y cuándo, segunda aprobación) y las funciones
  `conta_revolut_*`. Los secretos (privada, token de renovación, secreto del
  aviso) en el Vault, nombrados por empresa, con la pieza de
  `conta_cert_cuenta_vault` como modelo.
- **Funciones**: `conta-revolut-conectar` (genera el par, devuelve el
  certificado, guarda el `client_id`), `conta-revolut-vuelta` (recibe el `code`),
  `conta-revolut-leer` (histórico y lectura programada), `conta-revolut-aviso`
  (el webhook), `conta-revolut-pagar` (aprueba y manda). Todas pasan por
  `cuentaPuedeSalir` antes de hablar con Revolut.
- **Pantallas**: `src/modules/conta/bancos/revolut/` (asistente, línea de la
  cuenta) y en Pagos el panel y la salida de la remesa.
- **Pruebas**: unitarias de la lectura (sin duplicados, patas, revertidas,
  divisas) y del resumen del pago; una que **falla si `conta-revolut-pagar`
  llama a `/pay` sin una aprobación registrada** y otra si una cuenta demo
  llega a la red (con un `fetch` simulado que revienta); prueba de staging en
  ROLLBACK; e2e contra el sandbox.

## 6. Preguntas para Julio

- **P1 · IBAN nuevo.** Casi ningún proveedor tiene IBAN: el panel lo pedirá casi
  siempre. ¿Un IBAN escrito o cambiado en el mismo pago pide la segunda
  aprobación, aunque esté por debajo del tope? *Propuesta: sí.*
- **P2 · Cuenta contable.** ¿Qué 572 lleva cada cuenta de Revolut de Foodint
  (la siguiente libre, `57200004`…)? ¿Cuántas cuentas y en qué divisas hay?
  (Me lo dices en el chat, no en el repositorio.)
- **P3 · Remesa.** Revolut no paga en lote por API: una remesa de 5 son 5 pagos.
  Si uno falla, los otros 4 salen. ¿Vale así, con cada línea diciendo cómo
  acabó? *Alternativa: no mandar ninguno hasta tener los 5 beneficiarios
  creados y comprobados, y entonces los 5 seguidos.* *Propuesta: la alternativa.*
- **P4 · Dos permisos.** ¿Conectamos primero solo para leer y pedimos el de
  pagar al activar el primer pago? *Propuesta: sí.*
- **P5 · Aprobación en Revolut.** ¿La cuenta de Revolut de Foodint tiene reglas de
  aprobación de pagos? Si las tiene, cada pago de Sumied esperaría además en
  Revolut.
- **P6 · Topes.** ¿Qué tope por pago y por día ponemos de partida a Foodint?
  *Propuesta: 3.000 € por pago y 10.000 € al día.* ¿Y quién es «quien él
  autorice» (un permiso nuevo «Pagar con Revolut» que da el administrador)?
- **P7 · Sandbox.** Hace falta que abras una cuenta de pruebas en el sandbox de
  Revolut Business para staging y la e2e. Te lo pido cuando toque.
- **P8 · IP fija.** Si tu Revolut pide limitar la API a unas IP, las funciones de
  Supabase no las tienen fijas. ¿Lo tienes activado?
- **P9 · Red de la sesión.** Para construir necesito que el entorno deje pasar
  `developer.revolut.com`, `sandbox-b2b.revolut.com` y `b2b.revolut.com`.
- **P10 · Devoluciones.** Un pago completado que Revolut devuelve después
  entraría como un movimiento contrario, por casar. ¿Vale?

## Fuentes

- [Revolut Business API · Make your first API request](https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request) (vía búsqueda)
- [Revolut Business API · Set up a webhook](https://developer.revolut.com/docs/business/set-up-webhook) (vía búsqueda)
- [Revolut Business API](https://developer.revolut.com/docs/business/business-api) (vía búsqueda)
- [go-revolut (terceros), caducidad del token de renovación](https://beta.pkg.go.dev/github.com/adless-tech/go-revolut)
