B01 · PR 4 · **Paso 0: las nóminas, leído y medido.** Sin construir nada.

Medido en producción el 02/11/2026, en solo lectura y con `account_id` (regla 9). Aquí solo hay recuentos y sumas: ni nombres, ni DNI, ni IBAN (T11).

## Lo primero, antes que el PR 4

> **Corregido el 02/11 por la tarde:** Revolut se conectó en producción ese mismo día, a las 10:52 de Madrid, después de esta medida (08:00), con permiso de pagar. Lo que sigue de este apartado es la foto de las 08:00.

**En producción, Foodint no tiene Revolut conectado.** `revolut_conexion` tiene una sola fila:
- entorno `sandbox`;
- estado `certificado`: se subió el certificado y no se llegó a conectar;
- sin permisos, sin lecturas y con 0 pagos en `conta_pago_salida`.

Las tres cuentas de tesorería de Foodint son de BBVA (entidad 0182), y ninguna lleva movimientos con el id de Revolut. La prueba de 1 € necesita antes conectar la cuenta de Revolut de producción («Conectar Revolut» con el entorno de producción, y después «Activar pagos»). Es de la sesión principal; lo dejo dicho por si no estaba en su lista.

## Cómo se pagan hoy las nóminas

- **Por el servicio de nóminas de BBVA**, desde «Cuenta principal»: un cargo al mes, «PAGO DE NOMINAS POR SU CUENTA», con todas las personas dentro.

  | Mes del cargo | Cargos | Importe | Estado en Bancos |
  |---|---:|---:|---|
  | 2026-01 | 1 | 9.245,93 | casado |
  | 2026-02 | 1 | 8.747,99 | casado |
  | 2026-03 | 2 | 10.119,85 | antes del corte |
  | 2026-04 | 2 | 11.797,04 | antes del corte |
  | 2026-05 | 2 | 9.810,22 | antes del corte |
  | 2026-06 | 1 | 10.354,05 | antes del corte |
  | 2026-07 | 4 | 14.732,16 | antes del corte |
  | 2026-08 | 1 | 7.444,96 | antes del corte |
  | 2026-09 | 1 | 7.917,23 | antes del corte |
  | 2026-10 | 1 | 7.071,41 | casado |

- **Aparte, unas pocas transferencias sueltas** con «nómina» en el concepto: 4 desde «Cuenta principal» (1.736,63 €, de marzo a julio) y 5 desde las otras dos de BBVA (2.008 €). Ninguna casada.
- **La 465 (Remuneraciones pendientes de pago)**, sin anulados:
  - 113 líneas migradas, del 31/12/2023 al 30/09/2026: debe 191.729,00 y haber 198.719,20;
  - 1 de Bancos, el cargo del 06/10: debe 7.071,41;
  - saldo: **81,21 € deudor**.

## Las personas y su IBAN

- **Foodint:** 19 personas en `employees`, 6 activas (las mismas 6 en alta en el Excel de Cegid). Una sola empresa.
- **`lab_persona`:** 19 filas y **0 con IBAN**.
- **El volcado de Cegid no trae el IBAN.** Ninguna de sus 9 hojas tiene una columna de banco o de IBAN (1.247 filas mirando solo los nombres de columna).
- **Ninguna otra tabla guarda el IBAN de una persona.** El IBAN está en `supplier`, `courier`, `customer_fiscal`, `treasury_account` y en las remesas, nunca en `employees`.
- **El nombre:** `employees.name` es un solo campo. La comprobación del titular de una persona pide el nombre y los apellidos por separado. La hoja «trabajadores» de Cegid los trae en la forma «Apellidos, Nombre» en las 19 filas, así que se pueden separar por la coma.
- **Quién ve qué hoy:**
  - `lab_persona` (donde iría el IBAN): solo quien tiene el permiso de Laboral;
  - `payroll_cost`: el administrador y la propia persona;
  - `payroll_inbox`: solo el administrador.

## Cuánto hay que pagar: dos fuentes, y no cuadran

- **El recibo de Cegid** (hoja «nominas», con su «Líquido»): de diciembre de 2023 a septiembre de 2026, 160 recibos.
- **`payroll_cost.net`** (las nóminas que llegan por correo o se suben): solo junio y julio de 2026, 13 filas.
- **`payroll_summary`** (el resumen del mes con su asiento a la 465, S01): **0 filas**. La propuesta de asiento de nóminas no se ha generado nunca.

| Mes | Cegid: recibos y líquido | `payroll_cost`: filas y neto |
|---|---|---|
| 2026-06 | 9 · 9.750,70 | 7 · 8.495,41 |
| 2026-07 | 8 · 12.784,69 | 6 · 7.333,93 |

**Y el cargo del banco tampoco es el líquido de Cegid del mes anterior:**

| Nómina (Cegid) | Líquido | Cargo del mes siguiente | Diferencia |
|---|---:|---:|---:|
| 2026-08 | 7.953,83 | 7.917,23 | −36,60 |
| 2026-09 | 7.041,43 | 7.071,41 | +29,98 |

Julio de 2026 no se puede comparar así: hubo 4 cargos en julio y la paga extra pudo ir aparte. Las diferencias pequeñas pueden ser anticipos, embargos o un recibo de otro mes, pero no lo sé: **es una pregunta (la 2)**.

## Lo que da la API de Revolut para pagar a personas

De la especificación oficial (`revolut-openapi`, `business.json`):

- **Beneficiario persona:** `POST /counterparty` con `individual_name {first_name, last_name}` en vez de `company_name`, más `bank_country`, `currency` EUR e `iban`. Hoy `pago.ts` siempre lo crea como `business`.
- **La comprobación del titular** (`POST /account-name-validation`, EUR): con `individual_name` en vez de `company_name`. Contesta `matched`, `close_match`, `not_matched`, `cannot_be_checked`… Si la persona tiene una cuenta de empresa, o al revés, lo dice en el motivo.
- **Sin remesa:** la API no tiene pago en bloque. Es **una transferencia por persona** (`POST /pay`), cada una con su `request_id`. Con 6 personas, 6 transferencias y 6 cargos en el extracto, en vez del cargo único de BBVA.
- **El motivo `payroll`:** `transfer_reason_code` admite «payroll» donde un país lo pide (`GET /transfer-reasons` dice dónde). En España no es obligatorio, que yo sepa: se confirma en el sandbox.
- **`name_validation_id`:** `/pay` admite el id de la comprobación del titular para enlazarla al pago. Hoy `pago.ts` no lo pasa, ni para proveedores. Lo apunto para otro encargo (T1); en el PR 4 se pasaría.
- **Los enlaces de pago** (`/payout-links`, para pagar sin el IBAN): existen, pero no los propongo para nóminas.

## Lo que ya sirve del PR 2 y el PR 3

- El PIN, la segunda aprobación y los topes de «Activar pagos».
- Cada pago queda en `conta_pago_salida`, y el cargo se casa solo por el id de Revolut (`conta_pago_casar_banco`, PR 3a).
- **Lo que no sirve tal cual:** las salidas cuelgan de una factura de proveedor, y su casado lleva la factura a pagada. Una nómina no tiene factura: el casado tendría que saldar la 465 de esa persona y ese mes.

## Lo que no choca con nadie

- No hay ningún PR de Laboral abierto (abiertos hoy: el #414 de demos y el #386 de fichajes).
- Lo de Laboral que se tocaría es del N1 (`lab_persona`, ya en producción). Nada del importador.

## Preguntas para Julio

1. **¿De dónde sale el IBAN de cada persona?** Cegid no lo exporta. Opciones:
   - a mano en la ficha de Laboral, solo con el permiso de Laboral, comprobando el titular con Revolut al guardarlo;
   - o hay otro informe de Cegid que lo trae.
2. **¿Qué importe se paga a cada persona?**
   - Mi propuesta: el líquido del recibo de Cegid de ese mes. `payroll_cost` se queda para el coste, y las diferencias (anticipos, embargos) las dice quien aprueba.
   - Y antes de construir, lo que explica las diferencias con el cargo de BBVA (−36,60 en septiembre, +29,98 en octubre).
3. **¿Las nóminas pasan de BBVA a Revolut?** Con Revolut son tantas transferencias como personas, sin remesa. ¿Todas, o solo las que no quepan en el servicio de BBVA?
4. **¿Quién aprueba?**
   - Mi propuesta: quien tenga el permiso de Laboral **y** el de pagos, con el PIN y la segunda aprobación de siempre.
   - Y quien no tenga el de Laboral no ve ni importes ni IBAN, tampoco en la cola de pagos.
5. **¿El asiento?** `payroll_summary` no tiene ninguna fila y la 465 viene migrada hasta el 30/09.
   - ¿El PR 4 genera la propuesta de nóminas del mes (640/642/476/4751 contra la 465 por el neto) desde el recibo de Cegid,
   - o solo paga y casa contra lo que ya haya en la 465?
6. **¿Va antes la prueba de 1 €?** Necesita la conexión de Revolut de producción, que hoy no existe (ver arriba).
