# B01 · Informe de las tareas 2 a 4 (parada antes de la 5)

> Encargo B01 (`docs/conta/encargos/encargo_B01_bancos.md`), respuestas 1 y 2
> (`respuesta_B01_1.md`, `respuesta_B01_2.md`). Rama `conta/b01-bancos`.
> Producción **solo leída**; nada lanzado allí. Staging: migraciones que solo
> añaden, prefijo `20261101T`. Sin datos reales en el repositorio.

## 0. En cinco líneas

1. **El lector** lee Norma 43 (los seis registros, varias cuentas, IBAN
   reconstruido) y el Excel/CSV de los once bancos y de la tarjeta. Lo que no
   cuadra no entra, y lo mismo dos veces no cambia nada. Las posiciones se
   comprueban contra el cuaderno 43 descargado (regla 31).
2. **La base** está aplicada en staging: siete tablas, sus funciones y las
   lecturas del motor. La prueba como usuario sale **13 de 13 en verde** (run
   165), con `ROLLBACK`.
3. **El motor** solo da por seguros los cuatro casos del encargo, y solo con un
   candidato único. Todo lo demás lo propone con su porqué o lo deja «por
   aclarar» diciendo qué falta. Nada se casa dos veces. Tiene 37 pruebas.
4. **El banco paga y cobra por los caminos de siempre**:
   `mark_supplier_invoice_paid` y `channel_settlement_collect`. El freno del
   IBAN de la factura (C01b) también para al banco, y la prueba lo comprueba.
5. **Medido con la población real** (los 1.943 apuntes de banco de Foodint de
   2026, solo recuentos): lo aprendido por concepto **acierta el 74,9 %**, falla
   el 3,0 % y no sabe en el 22,1 % (§5).

## 1. Tarea 2 · Lector, cuadre y huella

| Pieza | Fichero | Pruebas |
|---|---|---|
| Modelo único, cuadre, huella y concepto limpio | `src/modules/conta/lib/extractoBanco.ts` | `bancosB01.test.ts` |
| Norma 43 (11, 22, 23, 24, 33, 88) | `src/modules/conta/lib/norma43.ts` | idem, y contra el cuaderno descargado |
| Excel/CSV de 11 bancos y la tarjeta | `src/modules/conta/lib/lectorCsvBanco.ts` | un ejemplo inventado de cada uno |
| Fuentes: fichero, correo (preparado) y agregador (simulado) | `src/modules/conta/lib/fuentesBanco.ts` | idem |

- **Cuadre.** En Norma 43: saldo inicial + movimientos = saldo final, más el
  número de apuntes y los totales del debe y del haber del registro 33, más el
  número de registros del 88. En Excel: el saldo de cada fila sale del de la
  anterior. Un Excel sin saldos **se dice** («no puedo comprobar que estén
  todos») y la base exige que conste por qué.
- **Huella** (la del encargo): fecha, importe, referencias del banco y número
  de orden dentro del día entre los iguales. Hay además una **huella suave**
  (fecha, importe y orden): el mismo movimiento traído por Excel una semana y
  por Norma 43 la siguiente no entra como nuevo. Queda como «posible repetido»
  y lo decide la persona.
- **Continuidad entre extractos** (del cuaderno, registro 11: «deberá coincidir
  con el Saldo final de la anterior información»): cada extracto queda como
  `primero`, `sigue` o `hueco` (con cuánto).
- **Concepto limpio, como N17.** La operación va en minúscula y el tercero y las
  siglas se quedan como vienen: «Pago con tarjeta MERCADO CENTRAL 0937»,
  «Adeudo TGSS cuotas septiembre».
- **Los perfiles de Excel de los once bancos están escritos con la forma
  habitual de cada exportación** y probados con ejemplos inventados. El primer
  fichero de verdad de cada banco es el que los confirma. Si un banco cambia
  sus columnas, el lector no adivina: dice qué columna busca.
- **Correo:** solo el contrato (`extractosDeCorreo`), con su prueba. El buzón es
  el E01 (P5).
- **Agregador:** la interfaz `ProveedorAgregador` y su adaptador, probados
  contra un proveedor simulado. Para cambiar de proveedor basta otra
  implementación.

## 2. Tarea 3 · La base (staging, `20261101T`)

| Fichero | Qué | Analizador |
|---|---|---|
| `0100_b01_bancos.sql` | `bank_settings`, `bank_statement`, `bank_movement`, `bank_match` (+ `_item`), `bank_rule` (+ `_log`), `bank_activity_log`, `recurring_contract`; `treasury_account.iban_review`; lectura por cuenta (RLS) | sigue |
| `0110_b01_funciones.sql` | importar, proponer, casar, deshacer, ignorar, repetido, reglas, alta de cuentas («¿De qué local es esta cuenta?»), IBAN a revisar | sigue |
| `0120_b01_foodint.sql` | Foodint: serie de tesorería 4, «validar solo lo seguro» apagado, corte 01/10/2026 (en staging no hace nada) | sigue |
| `0130_b01_lectura.sql` | lecturas del motor; **`bank_facturas_recibidas_pendientes`, la única puerta a las facturas del frente A** | sigue |

Cada fichero tiene su vuelta atrás en `supabase/vuelta-atras/`. Las reglas que
quedan en la base:

- **Un casado vivo por movimiento** (índice único). Deshacer no borra: deja el
  casado «deshecho» con quién, cuándo y por qué. Su asiento propuesto se quita y
  el validado se anula con contraasiento.
- **El asiento lo propone el libro del C04** (`_journal_entry_proponer`,
  `source_type = 'bank'`, en la serie de tesorería de la empresa): numeración al
  validar, huella encadenada. Lo seguro se valida solo **únicamente** si la
  empresa lo activa.
- **P2 · un pago por dos caminos, un asiento.** Si el pago o el cobro ya estaba
  apuntado (propuesto o validado), se enlaza y no se crea otro. Y la
  liquidación cuyo cobro ya casó Bancos no vuelve a llevar el cobro en su
  propio asiento.
- **P4 · antes del corte** solo se enlaza con lo traído; lo que no tenga pareja
  queda «Antes del corte · sin pareja en el libro».
- **P1.** Si un extracto trae otro IBAN, la cuenta queda «Revisa esta cuenta» con
  la corrección propuesta. Nunca se corrige sola. Las 572 sin banco en Folvy
  salen en `bank_cuentas_por_dar_de_alta` con el IBAN que lleven en el nombre.

**La prueba de staging**
(`supabase/staging/sql/20261101_b01_bancos_prueba.sql`, run 165): **13 de 13**,
como el administrador de A y la RLS como B, todo con `ROLLBACK`. Avisos del run,
literales:

```
1 · alta con la pregunta del local (común / Norte Centro), sin IBAN no, y enlazadas a su 572
2 · cuadre, mismo fichero, solapado, continuidad (sigue y hueco de +49,50), IBAN a revisar sin tocar, Excel sin saldos dicho
3 · propuesto en la serie 3 (572 haber / 626 debe); con el ajuste, validado en la 4 con número y huella; registrado
4 · L-0431 frenada por su IBAN sin decidir (nada a medias); L-412 pagada por el banco el 13/10 por mark_supplier_invoice_paid (domiciliación, con su registro) y con su asiento · 5 · L-0412: el pago ya apuntado se enlaza; asientos antes 16 = después 16
6 · liquidación cobrada el 09/10 · 7 · traspaso: un asiento 572/572, los dos casados · 8 · el segundo casado, rechazado
9 · propuesta quitada; validado anulado con contraasiento; factura sin pagar otra vez; los deshechos se quedan con su porqué
10 · antes del corte: solo enlazar · 11 · regla de Folvy propuesta→aceptada→usada→apagada, todo registrado · 12 · posible repetido decidido
13 · B no ve ni una fila de A y no puede casar (42501)
PRUEBA B01 · bancos en verde: 13 de 13.
```

En el camino salieron tres cosas que corregí: dos fallos de la propia prueba
(la siembra con `code` ambiguo y una suma mal hecha, que cazó el cuadre del
servidor) y uno de verdad. **El banco marcaba la factura pagada a mano**, y
`supplier_invoice_pagada_con_fecha` lo impidió. Ahora usa la función de
siempre, con su freno del IBAN.

## 3. Tarea 4 · El motor (`src/modules/conta/lib/conciliacion.ts`)

| Confianza | Cuándo | Ejemplo de porqué (de las pruebas) |
|---|---|---|
| **Seguro** | (1) mismo importe y misma referencia que una factura, o un pago ya apuntado; (2) traspaso entre dos cuentas propias el mismo día; (3) cobro que cuadra con su liquidación; (4) cuota de un contrato confirmada 3 veces. **Siempre con un candidato único.** | «Casado solo: mismo importe y misma referencia (2026/0477) que la factura pendiente del 28/09.» |
| **Probable** | mismo importe y proveedor sin referencia; varias facturas en un pago; pago en partes; saldo traído del proveedor (R2.5); anticipo 407 (P6); cobro sin liquidación contra su 430 (P7); nóminas y TGSS que cuadran; impuestos; comisiones; reglas; lo aprendido (≥ 2) | «Pago a Mayorista Alfa · su saldo pendiente en el libro era 1.411,47.» · «Sin liquidación: cuadra con las ventas de 01/10–07/10 menos un 17 % de comisión…» |
| **Por aclarar** | lo demás, diciendo qué falta | «No hay factura de 1.278,17 €: ¿la subes o es un pago sin factura?» · TGSS sin nómina → propone 476 (R2.4) · préstamo sin cuadro |

- **Nada se casa dos veces**: en un lote, cada candidato (lo que queda de una
  factura, una liquidación, el otro lado de un traspaso, un asiento) se gasta al
  usarse. Hay una prueba con cien movimientos al azar contra diez facturas, y en
  la base un índice único.
- **Cuentas en palabras**: «Comida y bebida · 60000000», nunca el código a
  secas.
- **Reglas nuevas:** cuando lo aprendido llega a 2 sin regla que lo diga, Folvy
  propone «Cuando el concepto tenga "PLENITUDE" → Luz y agua · 62800000». Nace
  «propuesta» y la guarda la persona.
- **Servicio:** `services/bancosNucleo.ts` (recibe la base como parámetro) y
  `services/bancosService.ts` (la app). Lo que la base rechaza (el freno del
  IBAN, un mes cerrado) no se pierde: queda «por aclarar» con el motivo.

## 4. El motor funcionando en staging (lo que pide la respuesta 1 para parar)

`tests/e2e/conta/b01/motor.spec.ts`, en el workflow de e2e. Entra como el
administrador de A y usa **el mismo código que usará la pantalla**:

1. Escribe un Norma 43 inventado de los **tres bancos B01** de la semilla
   (`supabase/seeds/conta/seed_b01_staging.sql`: Norte, Sur y Mercado, como los
   tres de Foodint): 14 movimientos.
2. Lo lee y lo cuadra («He leído 3 cuentas, 14 movimientos, del 02/10 al 13/10;
   cuadra con el saldo del banco»), empareja cada cuenta por su IBAN e importa.
3. Concilia. Esperado y comprobado: **4 casados solos** (la factura B01-0477 por
   su referencia, el traspaso Norte→Sur por sus dos lados y el cobro de la
   liquidación), y los otros 10 para confirmar o por aclarar.
4. Hace la captura (`docs/conta/capturas/b01/motor-ordenador.png` y
   `motor.md`, con cada porqué).
5. **Lo deshace todo**: asientos de A antes = después, con el mismo recuento a
   los dos lados.

**Resultado: run 190 (commit `9528ec7`), la demostración PASÓ.** La captura
está en `docs/conta/capturas/b01/motor-ordenador.png` y la tabla con cada porqué
en `motor.md`. El workflow no las subió solo porque fallaron otras 6 pruebas
ajenas a B01 (abajo). Las he hecho con lo que la demostración dejó escrito en
staging (`bank_activity_log`), con el porqué **literal** que se escribió y el
mismo HTML que la prueba.

```
He casado yo 4 de 14 movimientos de octubre. Te quedan 4 por confirmar y 6 por aclarar.
casado solo:  B01-0477 por su referencia · el traspaso Norte→Sur (los dos lados) · el cobro de su liquidación (3.412,18)
para confirmar: dos comisiones (626) · pago en parte de B01-0478 (quedan 350,00) · pago en parte de F-2026-0915 (quedan 1.063,15)
por aclarar:  TGSS sin nómina (propone 476) · 1.278,17 sin dueño · dos tarjetas · un recibo de teléfono · un ingreso de efectivo
asientos de la empresa A antes = después de deshacer
```

**Lo que enseñó, ya corregido (37 pruebas del motor):**
- El lado Norte del traspaso quedó apuntado un momento como «por aclarar» antes
  de que el lado Sur casara los dos. El estado final era bueno, pero «Lo que ha
  hecho Folvy» enseñaría una línea de más. Ahora el otro lado lleva
  `otroLadoDe` y no se propone aparte.
- El nombre de la cuenta arrastraba el punto final del plan («…datáfono. ·
  62600000»). Ya no.
- La tarjeta sin historial decía «no hay factura»: ahora pide el ticket. Y un
  ingreso de efectivo sale como probable desde la caja (570).

**Las 6 que fallan en ese run no son de B01.** La línea base, mi primer run
(tarea 2, sin nada mío en staging), ya fallaba en 5:
- `cierre/cierre.spec.ts:48` y `:58` (×2): staging cierra ahora a las **2:00** y
  la prueba espera las 6:00. Es la migración `20261019T0170_cierre_a_las_dos`
  del frente A, aplicada en staging.
- `c01b/flujos.spec.ts:161` (×2): al crear su factura de prueba, la base dice
  «Repetida: ya está la factura E2E-001 de este proveedor». Hay facturas
  `E2E-001` / `e2e-001` sobrantes en staging de runs cortados, y la sesión
  `conta/d01-recibidas` está cambiando la regla de repetidas.
- El run 188 llegó a 43 fallos, casi todos del móvil: varias sesiones lanzaron
  e2e a la vez (C a las 16:19, D01 a las 16:39). El grupo de concurrencia es
  **por rama** y cada run pone una contraseña nueva a los mismos cuatro usuarios
  de prueba, así que se pisan. Propuesta: un grupo de concurrencia común para
  las e2e de staging. Es un workflow compartido y no lo he tocado.

## 5. La población real (regla 31), solo recuentos

Los apuntes de banco de Foodint traídos de Diez de enero a septiembre de 2026
(sin los traspasos 572↔572). Para cada uno: ¿qué habría propuesto lo aprendido
con lo anterior del mismo concepto (al menos 2 veces, la contrapartida más
repetida)?

```
total 1.943 · acierta 1.455 (74,9 %) · falla 58 (3,0 %) · sin predicción 430 (22,1 %) · 355 conceptos distintos
```

Es el concepto del asiento de Diez, no el del banco (lo escribió quien llevaba
la contabilidad), así que la cifra es orientativa. Todo eso entraría como
**probable**, nunca como seguro. El histórico de Diez ya alimenta lo aprendido
(`bank_historial`).

## 6. Ficheros compartidos que he tocado (para coordinar con A y C)

| Fichero | Cambio |
|---|---|
| `src/modules/conta/services/propuestasLibroService.ts` | P2: lee los cobros casados en Bancos y no vuelve a poner el cobro en la liquidación |
| `src/modules/conta/lib/asientosPropuestos.ts` | `cobroEnBancos?` en la entrada de la liquidación; su razón «Cobro en Bancos» |
| `tsconfig.node.json` | `paths` con `@/*` para que el tipado de las e2e conozca el núcleo puro (Playwright ya lo resolvía) |
| `docs/conta/fuentes/fuentes.json` y `registro.json` | dos cuadernos 43 añadidos. **Aviso:** cada push que toca `fuentes.json` vuelve a bajarlo **todo**, y `geonames-cp-es` ha cambiado en origen: dos veces rompió la comprobación de los códigos postales y lo devolví a mano. Al siguiente que toque la lista le pasará igual |
| `supabase/staging/aplicar.txt` | el manifiesto con la tanda B (es por rama) |

**No tocados:** `pagoFactura` y el cobro de liquidación siguen proponiendo en la
serie 3 (P3, §10 de las comprobaciones previas). Pasarlos a la serie de
tesorería es una línea cada uno, pero queda para cuando lo coordines.

## 7. Pendiente, apuntado

- Tarea 5: las pantallas (N17 y las cinco sin maqueta, y el móvil).
- Tarea 6: el agente «Conciliación», el cierre del mes del banco y los
  permisos de `conta_lectura` sobre las tablas nuevas.
- Contratos (`recurring_contract`): están en la base y en el motor, pero sin
  pantalla para darlos de alta (tarea 5).
- Los perfiles de Excel se confirman con el primer fichero real de cada banco.
- Facturas emitidas: no hay tabla en Folvy. Hoy el cobro de un cliente se casa
  contra su saldo en la 430.
