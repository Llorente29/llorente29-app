B01 · **Que no se pueda duplicar un movimiento del banco.** Julio (02/11): «buscar un sistema que no permita duplicar movimientos, es vital».

Lo medido en producción, en solo lectura y en **todas las cuentas**, el 02/11 a las 12:45Z. Solo recuentos. Para Julio: la regla que propongo, antes de escribirla.

## Lo que hay hoy

**Movimientos duplicados: ninguno.**

| Medida (todas las cuentas) | Grupos | De más |
|---|---:|---:|
| Misma cuenta, día e importe, en **extractos distintos** (cualquier mezcla de Norma 43, Excel, conexión de BBVA y Revolut) | 0 | 0 |
| Misma referencia del proveedor (`reference_2`: open-banking.io o Revolut) en la misma cuenta | 0 | 0 |
| Misma huella suave (cuenta + día + importe + orden en el día) en la misma cuenta, sin contar los apartados | 0 | 0 |
| «Posible repetido» o apartados como repetidos | 0 | — |
| Misma cuenta, día, importe y concepto **dentro del mismo extracto** | 68 | 150 |

**Los 68 del mismo extracto son movimientos distintos:**
- los 68 grupos traen referencias distintas del banco, una por movimiento;
- son, por ejemplo, 117 pagos de 100 € con tarjeta en 46 días, o 50 adeudos del mismo proveedor en 7 días;
- el banco los da como movimientos separados en el mismo fichero. Una regla no puede tratarlos como repetidos sin borrar pagos de verdad.

**Pagos casados dos veces: ninguno.**

| Medida (todas las cuentas) | Hoy |
|---|---:|
| Movimientos con dos casados vivos | 0 |
| Facturas recibidas en dos casados vivos | 0 |
| Facturas recibidas con más casado que su total | 0 |
| Facturas pagadas por Bancos y además por otro pago, por encima de su total | 0 |
| Liquidaciones de plataforma en dos casados vivos | 0 |
| Asientos enlazados a dos casados vivos (salvo traspasos, que llevan dos) | 0 |
| Líneas de remesa de pagos o de cobros con el mismo casado | 0 (aún no hay líneas) |

**Por qué no hay duplicados:** la conexión de BBVA entró el 29/10 encima de lo que ya se había subido por Norma 43, y **251 movimientos se reconocieron como «ya estaban» y no entraron dos veces**. Los reconoció la **huella suave**, que no lleva el concepto.

**Olimpo no es un duplicado:** es un pago casado con lo que no era (#447). Cada pago está casado una vez.

**Lo de hoy no hay que limpiarlo:** no hay nada duplicado.

## Lo que ya frena la base

- `bank_movement_huella`: único por cuenta y huella completa. El mismo fichero dos veces no entra.
- `bank_match_uno_vivo`: único por movimiento entre los casados vivos. **Un movimiento ya no puede casar dos veces**: lo frena la base, no la pantalla.
- `bank_importar`: con la misma huella suave por otro camino, mete el movimiento como «posible repetido» («Mismo día, importe y orden que uno traído por otro camino: ¿es el mismo?»), y lo decide una persona.
- El núcleo de casar: una factura no se paga por encima de su total (pero lo frena la función, no la tabla).

**Lo que falta:** la huella completa de lo que entra por la conexión lleva la referencia del proveedor. El mismo movimiento por un Norma 43 y por la conexión tiene dos huellas completas distintas, y hoy solo lo para la huella suave **dentro de `bank_importar`**. Cualquier otro camino que escriba en `bank_movement` no lo encuentra.

## La regla que propongo (para que la apruebe Julio)

1. **La referencia del banco, única por cuenta**, cuando la hay:
   - `unique (treasury_account_id, reference_2) where reference_2 is not null`;
   - es el id del movimiento en open-banking.io o en Revolut (la comisión y la devolución llevan el suyo: `:comision`, `:vuelta`);
   - las referencias del Norma 43 (`reference_1`, nº de documento) **no**: el banco las repite y no son de un solo movimiento;
   - hoy: 0 repetidas, se puede crear ya.
2. **Sin referencia: la huella suave, única por cuenta entre lo que no está apartado**:
   - `unique (treasury_account_id, soft_fingerprint) where status not in ('posible_repetido', 'ignorado')`;
   - la huella suave es cuenta + día + importe + orden en el día;
   - **propongo que no lleve el concepto**, aunque la respuesta lo pedía. El concepto del mismo movimiento cambia según el camino: la conexión lo arma con la información de la remesa y la contraparte, y el Norma 43 con sus campos de concepto. Con el concepto dentro, esos 251 de BBVA habrían entrado dos veces;
   - lo que hoy entra como «posible repetido» sigue entrando así (no se esconde: regla 7); el índice impide que dos iguales estén vivos a la vez;
   - **un cambio que hace falta con ella:** cuando una persona dice «no es el mismo» (`bank_repetido_resolver`), la huella suave de ese movimiento se marca como distinta (se le añade su id), para que pueda seguir vivo junto al otro;
   - hoy: 0 repetidas, se puede crear ya.
3. **Que un pago no case dos veces, también en la tabla:**
   - un movimiento: ya está (`bank_match_uno_vivo`);
   - una factura: un disparador en `bank_match_item` que para si lo casado vivo de una factura pasa de su total. Hoy lo mira solo el núcleo de casar;
   - una liquidación de plataforma: lo mismo, una sola vez viva;
   - hoy: 0 casos, se puede crear ya.

**Cómo dice la base que para** (para acordarlo con S, que hace lo mismo con asientos y facturas en la `respuesta_S01q_4`):
- código `23505`, el de «ya existe»;
- un texto que diga **qué ya estaba, desde cuándo y por dónde**, nunca solo «duplicado». Por ejemplo:
  - «Este movimiento ya está en Sumied: entró el 29/10 por la conexión con BBVA. No se mete dos veces.»
  - «Este pago ya está casado con la factura 26A/10966. Para casarlo con otra, deshaz antes ese casado.»

**Cómo iría:**
- una tanda propia, con los dos índices y el disparador;
- el cambio de `bank_repetido_resolver` (cambia en caliente, declarado, con su prueba de staging);
- la prueba de staging intenta meter el mismo movimiento por los tres caminos (Norma 43, la conexión y Revolut), lo mete con «no es el mismo», y casa una factura dos veces.

## Pendiente

- El visto bueno de Julio a la regla, sobre todo a que la huella suave **no lleve el concepto**.
- Las mismas palabras y el mismo tipo de mensaje que S.
