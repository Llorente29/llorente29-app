# B01 · Comprobaciones previas (tarea 1)

> Encargo B01 — Bancos y conciliación (frente B), `docs/conta/encargos/encargo_B01_bancos.md`.
> Hecho el 13/10/2026. Producción (`xzmpnchlguibclvxyynt`) y staging-conta
> (`oseymswjlzplqoxrfjzi`) **solo leídas** (SELECT). Toda cifra de producción va
> filtrada por la cuenta de Foodint (`account_id = 51ad1792-…`) salvo que diga
> otra cosa (regla 9). Nada aplicado, nada desplegado.
>
> **Sin datos reales en este fichero** (el repositorio es público, RGPD): ni IBAN,
> ni saldos, ni importes, ni nombres de terceros. Solo recuentos y estructura. Los
> dígitos que identifican cada cuenta se los doy a Julio en el chat, no aquí.

## 0. Lo que cambia el plan, en siete líneas

1. **Foodint no tiene dos cuentas de banco en el libro: tiene tres.** Con
   movimientos en 2026 aparecen `57200001` (1.610 apuntes hasta el 28/09),
   `57200002` (319 hasta el 28/09) y `57200003` (154, del 29/07 al 29/09). Las
   dos últimas llevan el IBAN en el nombre (BBVA, entidad 0182). La primera se
   llama «Bancos · Cuenta principal» (§1). **Pregunta P1.**
2. **En Folvy solo existe 1 `treasury_account`**, y su IBAN **no es ninguno de
   los dos** que llevan en el nombre `57200002` y `57200003`. Está enlazada a
   `57200001`. Para reconocer el extracto por IBAN faltan dos cuentas por dar de
   alta y una por confirmar (§1). **P1.**
3. **Folvy ya propone el asiento de pago de una factura y el del cobro de una
   liquidación**, pero a partir de lo que se marca a mano (`paid_at`,
   `collected_on`), no del banco. Si la conciliación también propone desde el
   movimiento, el mismo pago sale dos veces. Hay que decidir quién manda (§3).
   **P2.**
4. **Serie:** Folvy pone hoy los pagos en la **serie 3** (Banco, C04). El encargo
   dice «serie de tesorería, 4 en Diez». En los datos traídos, los movimientos
   del banco de Diez están en la serie 4 desde el 01/04/2025 y en la 3 antes
   (§2). **P3.**
5. **Corte:** hasta el 30/09 el banco ya está asentado en el libro (traído de
   Diez, 2.083 apuntes 572 en 2026). Un extracto que empiece antes del 01/10 no
   puede generar asientos de esos días: solo enlazar o ignorar (§2). **P4.**
6. **Bandeja de correo: existe la tubería, no la bandeja.** Hay correo entrante
   por Resend Inbound (`payroll-inbound`, alias `…@in.folvy.app` por cuenta),
   pero solo para nóminas. Para extractos hace falta una función y un alias
   propios, es decir, una **edge function nueva** (§4). **P5.**
7. **Producción lleva 15 migraciones de la sesión A que no están en `main`**
   (`20261019T…` y `20261020T…`, de `conta/c04b-diez`). Mi rama sale de `main`
   y no las ve. Todo lo que lea del libro lo tengo que medir contra producción y
   staging, no contra mi árbol (§6).

## 1. Bancos de Foodint: `treasury_account` y sus subcuentas

```
-- treasury_account, TODA la tabla (todas las cuentas)
filas | cuentas
1     | 1                    ← solo Foodint tiene un banco dado de alta

-- treasury_account, Foodint
kind | iban            | is_default | is_active | location_id | pgc_hint | enlace del plan
bank | BBVA (0182) ··· | true       | true      | —           | 572      | 57200001 (bank_account/principal/migrated)
```

`company_account` 57*, Foodint (las de serie del PGC aparte):

```
code     | kind | source   | nombre                         | enlace a treasury_account
57000000 | tpl  | serie    | Caja, euros                    | —
57200001 | own  | migrated | Bancos · Cuenta principal      | sí (la única)
57200002 | own  | migrated | BBVA ES·· 0182 ···· (IBAN A)   | —
57200003 | own  | migrated | BBVA ES·· 0182 ···· (IBAN B)   | —
```

Apuntes en las 572 por año y serie (sin la 9, apertura y cierre):

```
cuenta   | 2023        | 2024          | 2025                     | 2026 (hasta 30/09)
57200001 | s3 13, s4 117 | s3 1.139, s4 2 | s3 342 (≤31/03), s4 1.371 | s4 1.610 (→28/09)
57200002 | —           | —             | s4 220 (desde 07/04)     | s4 319 (→28/09)
57200003 | —           | —             | —                        | s4 154 (29/07→29/09)
57000000 | caja: 58 apuntes en total
```

- **El IBAN de la `treasury_account` no coincide con ninguno de los dos que van
  en el nombre de 57200002 y 57200003** (comparados los cuatro últimos dígitos).
  Es un tercer IBAN.
- `treasury_account.location_id` está vacío. «Cada local paga por su cuenta» (D7,
  C04) sigue sin decir de qué local es cada banco, y `pagoFactura` cae a
  «probable» por eso (§3).
- `payment_method`: los 4 de sistema (transferencia, domiciliación, tarjeta,
  efectivo), los cuatro con `treasury_account_id` vacío. Foodint no tiene ninguno
  propio.
- **staging-conta:** 1 banco, en «Taberna de Prueba Norte» (A), con IBAN de
  prueba y subcuenta 57200001. La empresa B no tiene ninguno.

## 2. El libro: asientos de tesorería

```
-- journal_entry, Foodint, por serie · source_type · status
serie | source_type | status    | n
1     | migrated    | validado  | 2.274
2     | migrated    | validado  | 5.069
3     | migrated    | validado  | 2.422
4     | migrated    | validado  | 5.113
9     | migrated    | validado  | 55
1     | sales_day   | propuesto | 50     ← lo único de Folvy, todo de octubre
-- journal_entry, TODA la tabla: 14.983 filas, 1 cuenta (Foodint)
```

- **De Folvy no hay ni un asiento de banco**: 0 `bank`, 0 `supplier_payment`, 0
  `channel_settlement`. Todo lo 572 es traído de Diez.
- **Los apuntes 572 de Diez de 2026** (2.083) llevan contrapartida externa en
  2.070. Ninguno lleva `party_id` ni `document_ref`. Es la historia con la que se
  puede sembrar el «aprende por contraparte», pero el tercero solo está en el
  texto.
- **Contrapartidas de la 572 en 2026** (cuenta de 3 cifras · líneas): 430 · 810,
  410 · 252, 600 · 232, 400 · 212, 407 · 166, 572 · 96 (traspasos), 624 · 69,
  570 · 33, 520 · 33, 465 · 31, 551 · 23, 521 · 22, 627 · 22, 629 · 20, 626 · 20,
  628 · 19, 476 · 12, 642 · 8, 669 · 8, 662 · 7, 622 · 7, 475 · 6, y sueltas.
  Están todos los cruces del encargo (plataformas 430/410, nóminas 465/476,
  préstamo 520/170 + 662, impuestos 475, comisiones 626). Aparecen además
  **407 (anticipos a proveedores, 166)** y **551/521**, que el encargo no
  nombra. **Pregunta P6.**
- Las restricciones de `journal_entry` ya admiten lo que hace falta:
  `source_type` incluye `bank` y `supplier_payment`, `series` ∈ {1, 2, 3, 4, 9}, y
  `confidence` ∈ {seguro, probable, duda} con «propuesto ⇒ con porqué». **No hay
  que ampliar ningún CHECK.**
- Ejercicios: 2023, 2024 y 2025 `closed migrated`; 2026 `open mixed` con
  `imported_until = 30/09`.

## 3. Cómo casa hoy Folvy algo con un banco

**No lo casa.** No hay ni una tabla de extracto ni de movimientos, y no hay
ningún lector de Norma 43 ni de CSV de banco (buscado `norma 43`, `n43`,
`extracto`, `bank_statement` en `src`, `supabase` y `scripts`: los únicos
resultados eran falsos, `revision430`). Lo más cercano son dos marcas a mano que
ya generan asiento:

| Origen | Marca a mano | Lo que propone hoy (`asientosPropuestos.ts`) |
|---|---|---|
| Factura recibida | «Marcar como pagada» → `supplier_invoice.paid_at`, `paid_method`, registro en `supplier_invoice_payment_log` | `pagoFactura`: **serie 3**, `supplier_payment`, 400/410 al debe y 572 «del banco del local» al haber; seguro si la factura tiene local, probable si no |
| Liquidación de plataforma | `channel_settlement.collected_on` y `collected_amount` (C03) | el cobro, con la fecha de `collected_on` (`propuestasLibroService`, l. 370) |

En producción, a día de hoy:

```
-- supplier_invoice, Foodint
status      | pagada | payment_entry | journal_entry | n
en_revision | no     | no            | no            | 5
aprobada    | no     | no            | no            | 1
-- supplier_invoice_payment_log, Foodint: 0 filas

-- channel_settlement, Foodint (247 en toda la tabla, todas de Foodint)
canal | flow_type | source             | n  | cobradas | con asiento | fechas
Uber  | own       | import_csv_uber    | 50 | 0        | 0           | 30/04 → 30/06
Glovo | own       | import_csv_glovo   | 96 | 0        | 0           | 15/04 → 30/06
JE    | own       | import_csv_je      | 53 | 0        | 0           | 15/04 → 30/06
(3)   | licensed  | ctb_sales_detail   | 48 | 0        | 0           | sin settlement_date; periodo junio
-- licensed_settlement, Foodint: 3 filas, 0 con asiento
```

- **Para el cruce «cobro de plataforma que cuadra con su liquidación» no hay
  liquidaciones desde el 01/07.** Las 199 propias acaban el 30/06. Desde el
  01/10, el motor no encontraría liquidación con la que casar ningún cobro de
  Uber, Glovo o Just Eat hasta que se importen las nuevas. **Pregunta P7.**
- **P2, quién manda.** El encargo dice «si el asiento ya existe, se enlaza».
  Propongo que el movimiento sea la fuente: «Marcar como pagada» deja de
  proponer asiento cuando la empresa tiene el banco conectado (o fichero
  subido) para ese periodo, y el movimiento, al casar, rellena `paid_at` y
  `payment_entry_id`. Sin esto, cada pago sale dos veces como propuesto y la
  regla «nada se casa dos veces» la tendría que salvar el usuario a mano.

## 4. Bandeja de correo

- **Hay correo entrante:** Resend Inbound → `supabase/functions/payroll-inbound`
  (firma svix, el `to` se resuelve contra `payroll_settings.inbound_address`,
  adjuntos por la API de Resend, a Storage). En producción `payroll_inbox` tiene
  13 filas de origen `gmail`.
- **No hay bandeja de bancos ni bandeja genérica:** la función solo conoce
  `payroll_settings`, y su destino es `payroll-extract`.
- La fuente `correo` necesita: un alias por empresa (p. ej.
  `bancos-<empresa>@in.folvy.app`), una edge function nueva hermana de
  `payroll-inbound` y el mismo lector de la tarea 2. **Es una edge function
  nueva**: regla 1 de `CLAUDE.md` (commit antes del despliegue) y despliegue por
  el workflow, que lanza Julio. Si no se quiere en este encargo, la dejo
  preparada (el lector acepta el adjunto igual que el fichero subido) y lo digo
  en el informe. **P5.**

## 5. Qué falta en la base para este encargo

Todo nuevo, con prefijo `20261101T` (solo añadir):

| Pieza | Para qué |
|---|---|
| `bank_statement` | El extracto importado: cuenta, fuente (`fichero` / `correo` / `agregador:<p>`), fechas, saldo inicial y final del fichero, huella del fichero, cuadre, quién y cuándo |
| `bank_movement` | Un movimiento: `treasury_account_id`, fecha operación y valor, importe con signo, concepto común y propio (N43), referencias 1 y 2, concepto limpio, número de orden en el día, **huella única** por cuenta + fecha + importe + referencias + orden |
| `bank_match` | El enlace del movimiento con un asiento, una factura (recibida o emitida), una liquidación o un movimiento (traspaso), con importe parcial (pagos en partes, varias facturas en un pago), confianza, porqué y estado (propuesto / confirmado / deshecho). Único por destino para que nada se case dos veces |
| `bank_rule` | La regla en palabras: condición (concepto contiene, contraparte, importe), destino, origen (persona o Folvy), activa, confirmaciones, con su registro |
| `bank_activity_log` | «Lo que ha hecho Folvy»: qué casó solo, por qué, y su «Deshacer» |
| `recurring_contract` (o el nombre que toque) | Préstamo o alquiler con cuota conocida, para «cuota repetida confirmada 3 veces». **No existe nada parecido hoy** (buscado `loan`, `contract` en `information_schema`) |
| Ajuste de empresa «validar solo lo seguro» | Apagado por defecto. Columna nueva que admite nulos en la configuración contable de la empresa |
| Dirección de correo de bancos por empresa | Solo si va la fuente `correo` (P5) |

Lo que ya está y se usa tal cual: `treasury_account` (el IBAN es obligatorio
para `kind = 'bank'`), `company_account_link` (`bank_account → 572xxxxx`),
`journal_entry` y `journal_line` del C04 (numeración al validar, huella
encadenada, anulación con contraasiento), `supplier_invoice.payment_entry_id`,
`channel_settlement.collected_on` y `collected_amount`, y
`channel_settlement.journal_entry_id`.

Lectura de facturas recibidas: según pide el encargo, una función propia de
lectura (`banco_facturas_recibidas_pendientes(company)` o similar) sobre
`supplier_invoice`, para que el motor no conozca la tabla y el cambio del frente A
solo toque esa función.

## 6. Choques con las sesiones A y C

| Con | Qué | Riesgo | Qué hago |
|---|---|---|---|
| A (`conta/c04b-diez`) | **15 migraciones `20261019T…`/`20261020T…` aplicadas en producción que no están en `main`.** En staging están las 7 `20261020T…` (con una `20261020T0125_…_regla_a` que en producción no está) | Mis lecturas de funciones del libro, si las tomo de `main`, no son las de producción | Mido siempre contra `pg_proc` de producción y de staging. No redefino ninguna función del libro: solo llamo |
| A | `20261021T0100_conta_documentos` (bucket `conta-documentos`, `journal_entry_document`) en su rama, sin aplicar | El ticket de tarjeta por foto necesita un documento enlazado a un asiento | Si A lo fusiona, el ticket va a `journal_entry_document` con su propio tipo. Si no, espero. No creo un segundo bucket para lo mismo. **Para coordinar** |
| A | Rehace facturas recibidas | El cruce con facturas | Función de lectura (§5). Hoy A no toca `supplier_invoice` en ninguna migración (0 coincidencias en su diff) |
| A | `asientosPropuestos.ts` / `propuestasLibroService.ts` | P2: dejar de proponer el pago desde «pagada» si hay banco | Cambio pequeño en fichero compartido. Se dice en el informe y lo coordinas tú |
| C (`conta/c06-sola`) | **La rama no existe todavía en el remoto** | No he podido mirar nada | Lo miro antes de la primera migración |
| Las tres | Prefijos: en producción y staging no hay ninguna `20261101T…` ni `20261111T…` | — | `20261101T` para B |
| Las tres | Menú del módulo (`useCuentasMenu.ts` / navegación), `database.ts`, `antes-de-subir.sh` | Choque de fusión | Cambios pequeños y dichos |

## 7. Lo que no me ha llegado

- ~~`maqueta_B01.zip` (N17)~~ **llegó el 13/10** y está guardada en
  `docs/conta/maquetas/b01/`. Lo que dice frente a la base, en §9.
- **`claude/folvy-contabilidad-benchmark.md` no está en el repositorio.** El
  contraste se apoya en su sección «Conciliación bancaria». Lo necesito antes de
  construir, porque el encargo dice que, si no estamos un escalón por encima,
  se para.
- La norma (Norma 43 de Cajamar, CCom 25 y 29, PGC grupo 57, PSD2 y RDL 19/2018)
  la compruebo y cito literal con la tarea 2. El lector depende del cuaderno
  43.

## 9. La maqueta N17 frente a lo que hay

`docs/conta/maquetas/b01/N17Bancos.png` (1440, empresa A de staging, cifras
inventadas). Lo que cada pieza necesita y si existe:

| Pieza de N17 | Necesita | Hoy |
|---|---|---|
| «TUS BANCOS»: Norte ···4821, Sur ···0937, **Tarjeta ···1150** | Un banco por local (`treasury_account.location_id`, C04) y **la tarjeta como cuenta propia** | El modelo lo admite (`kind` ∈ bank/card/cash). En producción hay 1 `bank` y 0 `card`. **Pregunta P8:** ¿la tarjeta tiene extracto propio (y en qué formato: el de una tarjeta de crédito no es Norma 43) o sus cargos se ven en el banco como en la fila «Pago con tarjeta MERCADO CENTRAL»? |
| «Por correo · activo» | La fuente `correo` | No existe (§4). Si P5 la deja preparada, el botón diría «preparado», no «activo»: **sería un cambio sobre la maqueta y lo digo antes** |
| «Conectar · pronto» | Nada (interfaz del agregador) | Se puede tal cual |
| Banda «He casado yo 142 de 158…» y las cinco cifras | Saldo del extracto (registro 33), saldo de la 572 a la fecha, recuentos por estado | Saldo contable: ya sale de `journal_ledger`. Lo demás, de las tablas nuevas (§5) |
| Cobro de plataforma «cuadra con su liquidación (ventas − comisión)» | `channel_settlement` del periodo | Ninguna desde el 01/07 (§3, P7) |
| Pago de factura «pendiente del 28/09» | Factura recibida pendiente, por la función de lectura | `supplier_invoice` de Foodint: 6, ninguna pagada (§3). Las anteriores al corte están en Diez como apuntes, no como facturas de Folvy: casarlas es contra la 400/410 del proveedor, no contra una factura |
| Tarjeta «las 6 anteriores de este comercio fueron mercadería» | Historia por contraparte | En Diez la contraparte solo está en el texto (`external_counterpart`, 2.070 de 2.083 apuntes 572 de 2026), sin `party_id` |
| Seguros sociales «cuadra con las nóminas (476 a pagar)» | Saldo de la 476 por el asiento de nóminas del mes | Folvy lo propone (`nomina`, serie 9, desde `payroll_cost`), pero en Foodint el último `payroll_cost` se creó el 04/08 (13 filas). **Pregunta P9:** las nóminas de octubre en adelante, ¿entran en Folvy? Si no, la TGSS de noviembre no tiene 476 con la que cuadrar y caería a «Por aclarar» |
| Traspaso Norte → Sur «casado solo» | Dos cuentas propias en Folvy | Depende de P1 |
| «Sí a los 11 que propongo» | Confirmación en lote | Regla 8 de `CLAUDE.md`: la confirmación dirá cuántos y a qué asientos pasaron |
| Nombre de cuenta | El encargo pide «Luz y agua · 62800000»; la maqueta escribe «mercadería (60000000)» | **Sigo el encargo** (`nombre · código`) salvo que digas lo contrario |

Lo que la maqueta no dibuja y haré en el mismo estilo, sin inventar piezas
nuevas: las pestañas Reglas, Cuentas y extractos y Cierre del mes; «Subir
extracto» (arrastrar, «He leído…», confirmar); «Lo que ha hecho Folvy»; y el
**móvil**, para el que no hay maqueta: lo haré como pide el encargo (solo «Para
confirmar» y «Por aclarar», una tarjeta por movimiento) con el patrón de
`M4Proveedor`. Si quieres maqueta de alguno, la espero antes de la tarea 5.

## 8. Preguntas para Julio

- **P1 · Las cuentas.** En el libro hay tres 572 con movimiento en 2026
  (57200001 «Cuenta principal», 57200002 y 57200003 con IBAN BBVA en el nombre),
  y en Folvy un solo banco con un tercer IBAN, enlazado a 57200001. ¿Cuáles son
  las cuentas vivas, qué IBAN va con cada subcuenta y de qué local es cada una?
  Doy de alta las que falten en `treasury_account` cuando lo digas, nunca por
  nombre.
- **P2 · Quién manda en el pago.** Propuesta: el movimiento del banco. «Marcar
  como pagada» deja de proponer asiento cuando hay extracto de ese periodo, y el
  casado rellena `paid_at` y `payment_entry_id`. ¿Sí?
- **P3 · Serie.** ¿Los asientos del banco van a la serie 3 (Banco, como hace hoy
  `pagoFactura` y dice el C04) o a la 4 (como Diez desde abril de 2025)?
- **P4 · Desde cuándo.** ¿La conciliación empieza el 01/10/2026? Lo de antes
  ya está en el libro por Diez: si se sube un extracto anterior, propongo solo
  enlazar y cerrar meses, sin generar asientos.
- **P5 · Correo.** ¿Entra la fuente `correo` en este encargo (edge function
  nueva, desplegada por el workflow)? ¿O la dejo preparada?
- **P6 · Cruces que el encargo no nombra.** Hay 407 (anticipos a proveedores,
  166 líneas en 2026), 551 (cuenta con socios) y 521 (deudas a corto plazo).
  ¿Entran como cruces con nombre o como «Por aclarar» con regla aprendida?
- **P7 · Liquidaciones.** Las de Uber, Glovo y Just Eat acaban el 30/06. ¿Se
  van a importar las de julio en adelante (y quién), o el motor casa los cobros
  de plataforma contra las ventas del día mientras tanto?
- **P8 · La tarjeta.** ¿Tiene extracto propio? ¿En qué formato?
- **P9 · Nóminas desde octubre.** ¿Entran en Folvy (`payroll_cost` → asiento)?
  Sin ellas, los seguros sociales no tienen con qué cuadrar.
