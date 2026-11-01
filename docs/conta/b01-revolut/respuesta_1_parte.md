# B01 · Revolut Business · Parte de la respuesta 1 (31/10)

> Lo que pide la respuesta 1 antes de construir: confirmar lo pendiente contra la
> documentación oficial, la 572 de Foodint, la dirección de vuelta comprobada,
> las maquetas ajustadas y qué piezas son comunes y cuáles de Revolut.
> Producción solo leída (SELECT, con `account_id` de Foodint, regla 9). Nada
> aplicado ni desplegado. Sin datos reales (T11).

## 1. Lo confirmado contra la fuente oficial

**De dónde.** La web `developer.revolut.com` ya resuelve, pero responde con un
control antibots de Cloudflare (`403`, `cf-mitigated: challenge`, «Enable
JavaScript and cookies to continue»), y no lo he sorteado. Lo que sí he leído
entero es **la especificación OpenAPI oficial que publica Revolut**:
`github.com/revolut-engineering/revolut-openapi`, `json/business.json`,
commit `eff8f86` del **30/10/2026**. Es la misma referencia de la API
(`info.version 1.0`). Las API ya responden desde aquí: `b2b.revolut.com` y
`sandbox-b2b.revolut.com` dan `401` sin token, que es lo esperado.

| Punto | Antes | Ahora | Fuente (en la especificación) |
|---|---|---|---|
| Direcciones | S | **Confirmado.** `https://b2b.revolut.com/api/1.0` y `https://sandbox-b2b.revolut.com/api/1.0` | `servers` |
| Token de acceso, 40 min, con token de renovación | C | **Confirmado** | `securitySchemes.AccessToken` |
| Permisos | S | **Confirmado: cuatro.** `READ` (los GET), `WRITE` (beneficiarios, avisos y borradores de pago), `PAY` (pagar y cambiar divisa), `READ_SENSITIVE_CARD_DATA` | `securitySchemes.AccessToken` |
| Lista de IP | S, «posible bloqueo» | **Confirmado: solo es obligatoria con `READ_SENSITIVE_CARD_DATA`**, que Sumied no pide nunca. Si una empresa la activa por su cuenta, Revolut no deja entrar a Sumied: el asistente lo dice | `securitySchemes.AccessToken` |
| **Comprobación del titular (VoP)** | «por confirmar» | **Existe**: `POST /account-name-validation`, «Validate an account name (CoP/VoP)». En euros se manda `iban`, `recipient_country`, `recipient_currency` = `EUR` y `company_name` (o `individual_name`). Devuelve `result_code` y un `name_validation_id` que se pasa después en `POST /pay` (`name_validation_id`) para ligar la comprobación al pago | `paths./account-name-validation`, `ValidateAccountNameRequestEUR`, `ValidateAccountNameResponseEUR`, `/pay` |
| Qué devuelve el VoP | — | `matched` (coincide) · `close_match` (se parece, **y da el nombre real**) · `not_matched` (no coincide, **y devuelve el nombre que mandamos, no el real**) · `cannot_be_checked` (no se puede, y reintentar no sirve: p. ej., el banco del proveedor no lo admite) · `temporarily_unavailable` (ahora no, reintentar luego) | `ValidateAccountNameResponseEUR.result_code` |
| VoP en el sandbox | — | **En el sandbox, una petición completa y válida devuelve siempre `cannot_be_checked`.** La e2e no puede probar «no coincide» contra Revolut: ese camino va en unitarias con la respuesta simulada | descripción de `/account-name-validation` |
| **Pago en lote** | «no hay, que yo sepa» | **Confirmado: no hay pago en lote que salga por API.** Lo más parecido son los **borradores de pago** (`/payment-drafts`, con varios pagos), pero un borrador «se queda en borrador hasta que lo mandas a procesar **en la app de Revolut Business**». O sea, lo aprueba una persona en Revolut, no en Sumied. La remesa de Sumied son N `POST /pay` seguidos, como decidió Julio (P3) | `paths./payment-drafts` |
| Pagar | S | **Confirmado**: `POST /pay` con `request_id`, `account_id`, `receiver`, `amount` y `currency` obligatorios; `reference`, `charge_bearer` y `name_validation_id` opcionales. Devuelve `id`, `state`, `created_at` y `completed_at` | `paths./pay` |
| Estados de una transacción | S | **Confirmado**: `created`, `pending`, `completed`, `declined`, `failed`, `reverted`. Entre cuentas de Revolut se salta `pending` | `TransactionState` |
| Patas y comisión | S | **Confirmado**: `legs[]` con `leg_id`, `amount`, `fee`, `currency`, `account_id`, `counterparty`, `description` y `balance` (el saldo después). La transacción trae `reason_code` (el porqué de un rechazo) y `related_transaction_id` | `Transaction`, `TransactionLeg` |
| Lectura | S | **Confirmado**: `GET /transactions` con `from`, `to`, `account`, `count` (100 por defecto, **1.000 como mucho**), `type`, `state` y `request_id` | `paths./transactions` |
| Avisos | C que existen | **Confirmado**: `/webhooks` (v2) con los eventos `TransactionCreated`, `TransactionStateChanged`, `PayoutLinkCreated` y `PayoutLinkStateChanged`; cada aviso con su `signing_secret` (`rotate-signing-secret`) y `failed-events` para recuperar los que no llegaron | `Webhook-v2`, `WebhookEventType` |
| Sandbox | S | **Confirmado**: `POST /sandbox/topup` (recargar) y `POST /sandbox/transactions/{id}/{action}` (forzar el estado de una transferencia) | `paths./sandbox/*` |

**Lo que sigue sin confirmar**, porque vive en las guías (tras el control
antibots) y no en la especificación:

- **La llamada del token** (`/auth/token`: el cambio del `code` y la renovación)
  y la forma exacta de la firma del cliente. Que es un JWT con `iss` = dominio
  de la vuelta, `sub` = `client_id` y `aud` = `https://revolut.com` está
  confirmado por la búsqueda (paso 0). El resto, con la primera llamada real al
  sandbox: si falla, falla allí, no en producción.
- **Cuánto dura el token de renovación.** Sumied lo trata como el permiso de BBVA:
  si una renovación falla con «permiso retirado», la cuenta sale «Desconectada
  desde Revolut · Volver a conectar».
- **Cómo va firmado el aviso** (la cabecera y lo que se firma). Da igual para la
  seguridad, por diseño: **el aviso no se cree**. Solo dice «mira esta
  transacción», y la función la lee con su token. La firma se comprueba además
  en cuanto el sandbox mande el primero, que se pega en el parte.

**Lo que cambia en el diseño:**

- Antes de crear un beneficiario y antes de cada pago a uno nuevo o cambiado,
  Sumied hace el VoP. `matched` sigue. `close_match` enseña el nombre real y
  sigue con una aprobación si el IBAN ya estaba comprobado. `not_matched`
  **para** y no tiene nombre real que enseñar: la maqueta de la v1 lo inventaba
  y ya está corregida. Con «Lo he comprobado: pagar igual», pide la segunda
  aprobación. `cannot_be_checked` se avisa y sigue como un IBAN nuevo (segunda
  aprobación). `temporarily_unavailable`: «Ahora no se puede comprobar: vuelve a
  intentarlo en unos minutos».
- En la remesa (P3), «comprobados todos los beneficiarios» quiere decir que
  todos tienen su VoP en `matched`, o `close_match`/`cannot_be_checked` con la
  segunda aprobación dada.
- La **comisión** de la pata (`fee`) entra como un movimiento propio («Comisión
  de Revolut»), con el id `<id>:<leg_id>:comision`. Se confirma con un pago
  real del sandbox.

## 2. La cuenta contable de Revolut en Foodint: **57200004**

Medido en producción el 31/10, `company_account` con `account_id` de Foodint
(1 empresa) y `code like '572%'`:

| Código | Tipo | Enlazada a un banco | Apuntes |
|---|---|---|---:|
| 57200000 | `template` (la cuenta del plan, «Bancos e instituciones de crédito c/c vista, euros») | no | 0 |
| 57200001 | `own` | sí (`bank_account`, `principal`) | 4.680 |
| 57200002 | `own` | sí | 572 |
| 57200003 | `own` | sí | 211 |

La 57200000 no está «libre»: es la cabecera del plan, no una subcuenta propia.
**La primera libre es la 57200004.** La crea el asistente al ligar la cuenta de
Revolut, igual que se crea hoy la de un banco nuevo (`company_account` de tipo
`own` con su enlace `bank_account`/`principal`). No va en una migración: es un
dato de Foodint.

## 3. La dirección de vuelta, comprobada

- En Vercel, el proyecto de producción (`folvy-app`) tiene **verificados**
  `app.sumied.com`, `app.folvy.app`, `foodint.folvy.app` y
  `folvy-app.vercel.app` (consultado el 31/10).
- La marca sale de `_shared/marcas.ts`: Sumied → `app.sumied.com`; Folvy →
  `app.folvy.app` (su primer dominio).
- **La dirección**: `https://app.sumied.com/bancos/revolut/vuelta`, o
  `https://app.folvy.app/bancos/revolut/vuelta` si la empresa entra por Folvy.
  Es una ruta del front, que recoge el `code` y lo pasa, con la sesión de la
  persona, a la función `conta-revolut-vuelta`. Así el `iss` del JWT es el
  dominio de la marca. La ruta no existe todavía: la crea el PR 1.
- **Staging** usa su propio dominio de staging y solo el sandbox (W10). Un
  certificado de staging no vale en producción, porque la vuelta es otra.

## 4. Un solo «Pagar» para todos los bancos: qué es común y qué es de Revolut

La regla: **añadir un banco con el que pagar es añadir un proveedor, sin tocar
pantallas.** Lo de leer movimientos ya era así (`ProveedorAgregador`, B01c);
pagar se hace igual.

### Común (Sumied)

| Pieza | Dónde | Qué hace |
|---|---|---|
| El pago | base: `conta_pago_salida` | Un pago saliente: la factura (o la línea de remesa), el importe, el beneficiario tal como se aprobó (nombre e IBAN), la cuenta de origen (`treasury_account`), **qué proveedor lo manda** (`revolut`, mañana `qonto`…), su `request_id` y su estado común: `preparado → aprobado → esperando_segunda → enviado → esperando_banco → pagado` · `rechazado` · `devuelto` · `cancelado`, con el motivo en palabras. |
| El registro | base: `conta_pago_salida_evento` | Quién, cuándo y qué, de cada paso: lo pide la regla de permisos. Solo se añade. |
| La aprobación | base: `conta_pago_aprobar`, `conta_pago_segunda` | La primera, de quien paga. La segunda, cuando hace falta (IBAN nuevo o cambiado, IBAN leído de la factura, por encima del tope, «pagar igual»). **Quién la da lo decide la base**: si hay otra persona con permiso de pagar, ella (aviso en Sumied y, a los 15 minutos, al correo); si no, la misma, con un código de un solo uso. |
| El código de un solo uso | base: `conta_pago_codigo` (solo su huella, caduca a los 10 min, 3 intentos) + correo por `send-email` | Pantalla aparte. Un segundo clic en la misma pantalla no vale. |
| Los topes | base: en la empresa (3.000 € por pago y 10.000 € al día de partida, cambiables) | Por encima, segunda aprobación. El del día suma lo aprobado ese día, en hora de Madrid. |
| El permiso de pagar | base: el administrador, o quien él autorice | Sin él no sale el botón. |
| Mandar el pago | función: `conta-pagar` | Comprueba en la base que está aprobado (y que tiene la segunda si hace falta), pasa por `cuentaPuedeSalir` (demo, #409) y llama al proveedor por su contrato. **No hay otra forma de llegar a un `pagar()` de un proveedor**: lo vigila una prueba. |
| El contrato del proveedor | `_shared/pagos/proveedorPago.ts` | `comprobarTitular`, `beneficiario`, `pagar`, `estado`. Igual que `ProveedorAgregador` para leer. |
| El resultado | base: `conta_pago_resultado` | Pagado: el pago de la factura (`supplier_invoice_payment`, forma `banco_api`) y la factura pagada. Rechazado: el motivo, y la factura sigue por pagar. Devuelto: la factura vuelve a por pagar, con aviso. |
| El casado | la conciliación de siempre | El movimiento de un pago mandado por Sumied trae su `request_id`; al entrar por `bank_importar`, se casa solo con su pago. |
| Las pantallas | `src/modules/conta/pagos/` | El botón «Pagar con {banco}», el panel, la segunda aprobación, la salida de la remesa y el historial. El nombre del banco sale de la cuenta elegida. |
| La remesa | `conta_pago_remesa` (PC01), que ya existe | Una salida más: «Pagar las N con {banco}», al lado de «Descargar fichero SEPA». |

### De Revolut

| Pieza | Dónde |
|---|---|
| El cliente de la API: firma del cliente (JWT RS256), token y renovación, reintentos con 429 | `_shared/revolut/cliente.ts` |
| Leer: Revolut como `ProveedorAgregador` (patas, solo `completed`, fecha de `completed_at` en Madrid, devueltas y comisiones) | `_shared/revolut/lectura.ts` |
| Pagar: Revolut como `ProveedorPago` (VoP, `POST /counterparty`, `POST /pay`, estado) y sus motivos (`reason_code`) traducidos a palabras | `_shared/revolut/pago.ts` |
| Conectar: el par de claves, el certificado, el `client_id` y la vuelta | funciones `conta-revolut-conectar` y `conta-revolut-vuelta` |
| La lectura del histórico y la de cada hora | función `conta-revolut-leer` |
| El aviso | función `conta-revolut-aviso` |
| La conexión por empresa: estado, alcance (`READ`, después `READ`+`WRITE`+`PAY`), y los secretos en el Vault (privada, token de renovación, secreto del aviso), nombrados por empresa | base: `revolut_conexion` + funciones del Vault |
| El asistente de tres pasos y la línea de la cuenta | `src/modules/conta/bancos/revolut/` |

## 5. Los PR, en orden

1. **PR 1 · Conectar y leer** (Revolut): la conexión solo para leer, el
   asistente, el histórico, la lectura de cada hora y el aviso. Las cuentas ligadas
   a su 572 y el Cierre del mes. Va **después de que se fusione el #409**. Hoy
   (31/10, 21:30) sigue abierto y en borrador.
2. **PR 2 · Pagar** (común + la salida de Revolut): el pago, la segunda
   aprobación, los topes, el permiso, «Activar pagos» (pedir `PAY`), la factura
   y la remesa.
3. **PR 3 · Nóminas**: el mismo camino desde la remesa de nóminas.

Cada uno con su tanda en
`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/` (o la
de su rama), su prueba de staging en ROLLBACK, sus unitarias y su e2e contra el
sandbox.

## 6. Lo que pediré a Julio para la e2e del PR 1 (P9)

Se lo pido cuando el PR 1 llegue a la e2e, con estos pasos:

1. Abrir una cuenta de empresa de pruebas en el **sandbox de Revolut Business**
   (`sandbox-business.revolut.com`), con datos inventados.
2. En staging, con el asistente: copiar el certificado, pegarlo en el sandbox
   › Ajustes › API con la dirección de vuelta de staging, pegar el `client_id` y
   autorizar. **Una vez**: la e2e usa después esa conexión (su token de
   renovación vive en el Vault de staging) para leer y, en el PR 2, para pagar.
   La e2e prueba el asistente hasta la vuelta, y la vuelta con un `code` de
   prueba que da error. Autorizar de verdad pide entrar en Revolut con la cuenta
   de Julio, y eso no lo hace una máquina.
