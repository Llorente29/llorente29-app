# C06b · Respuesta 5 — repasos tras la C06 en producción

Rama `conta/c06b-repasos`, desde `main` (879296b). Migraciones con el prefijo
20261111T, desde la 0500. **Nada lanzado en producción**: en producción solo se
ha leído (consultas `select` y `conta_lectura`). Aquí no hay importes reales:
las cifras de Foodint van en el chat, no en el repositorio, que es público.

| Punto | Estado | Producción |
|---|---|---|
| 1 · Balance contra Diez y la banda de la IA | front hecho y probado; al 30/09 Diez y Folvy coinciden en las 150 subcuentas; octubre explica PN y otros deudores (§1.5) | solo front (va en el PR) |
| 2 · Aviso #178 | 0500 y 0510 escritas; 0500 en staging con su prueba en verde; agente nuevo en verde en staging | **tanda preparada, sin lanzar** (§2.4) |
| 3 · La barra de la IA en Libros | hecho; e2e de lo que tapa extendida a Libros | solo front |
| 4 · Semilla de Diez en staging | aplicada: plan completo, agente del plan en verde | — |
| 5 · `conta-contrasena` y la regla del PR | dos de tres sin tocar; la tercera, arreglada (§5.1); regla en `pr-a-main.yml` | `conta-contrasena` a desplegar a mano con el PR |

---

## 1 · El balance no cuadra con Diez en «Clientes»

### 1.1 · Línea a línea, en producción y solo leyendo

Foodint (cuenta `51ad1792…`, empresa `658728c0…`), balance abreviado, ejercicio
2026, con los saldos de `journal_ledger` al 30/09 (el libro no tiene ningún
apunte después: los 55 asientos de octubre están **propuestos**, sin validar,
y un propuesto no está en el libro).

Qué subcuentas van a cada línea, con el mapeo de serie del C05 (Foodint no
tiene filas propias del grupo 4, y ninguna de estas filas va «por saldo»):

| Línea | Subcuentas de Foodint con saldo |
|---|---|
| III.1 Clientes por ventas y prestaciones de servicios | las siete 430 (430–436; 437, 490 y 493 restan) |
| III.3 Otros deudores | 470, 4709, 471, 472 (44, 460, 473 y 544 también, sin saldo; la 473 «por defecto», con la nota de que Diez la pone aquí) |
| C.V.2 Otros acreedores (pasivo) | 465, 475, 4751, 476, 477 (y 41, 438, 466) |
| A.VI Activos por impuesto diferido | 474 |

**El mapeo coloca cada subcuenta donde la coloca Diez.** Las dos líneas que
coinciden en el balance de Diez (inmovilizado y capital) y la forma de las que
no coinciden (la 472 acreedora dentro de «Otros deudores», en negativo, igual
en los dos) lo confirman: **Diez y Folvy compensan igual**. Los clientes
acreedores restan dentro de «1. Clientes»; un IVA soportado acreedor resta
dentro de «3. Otros deudores». No hay un error de mapeo que arreglar.

Lo que no coincide son **importes**, en las tres líneas que Julio dio, y las
tres diferencias tienen la forma de **movimientos posteriores al 30/09 que
están en Diez y no en el libro de Folvy**: el patrimonio neto de Diez es más
bajo (más pérdida), y clientes y otros deudores de Diez son más altos. Con lo
que no hay en Folvy —octubre, sin validar— es justo lo que cabe esperar.
La comprobación en C0008 está en §1.3.

### 1.2 · La banda de la IA decía una cifra que no sale en ningún estado

`BarraIa` (`src/modules/conta/libros/Estados.tsx`) sumaba **las 430 en
negativo, sueltas** y lo titulaba «Clientes en negativo (…)». Esa suma no es
ninguna línea del balance, ni de Folvy ni de Diez, y no se puede cotejar con
nada; en Foodint, además, la línea de clientes es **positiva** (las dos
deudoras pesan más que las cinco acreedoras juntas), así que el título decía
lo contrario de lo que enseña la tabla.

Ahora (`src/modules/conta/lib/notaClientes.ts`):

- **la cifra es la de la línea oficial**, la que se presenta y la que da Diez:
  «“Clientes por ventas y prestaciones de servicios”: X €, con 5 clientes con
  saldo acreedor dentro.»;
- si la línea entera queda en negativo: «Clientes en negativo: “…” suma X €.»,
  y «Dentro hay N clientes con saldo acreedor.»;
- el enlace «Ver» lleva al Mayor del cliente **más negativo** (antes, al
  primero de la lista).

La prueba (`tests/unit/modules/conta/notaClientesC06b.test.ts`) va contra el
modelo abreviado y el mapeo de serie **reales** (`cuentas-anuales.json`) con
la **forma** de Foodint al 30/09 —siete 430, cinco acreedoras y dos deudoras,
la línea en positivo, una 472 acreedora—, con importes inventados. Puede
fallar: la suma suelta de antes da otra cifra y la prueba lo comprueba.

### 1.3 · Octubre en C0008, solo leyendo

`scripts/conta/diez/balance-lineas.ts`, lanzado por `diez-lectura.yml`
(trabajo `balance`, commit que empieza por `[lectura:balance]`):

- en Diez, **solo GET**: los apuntes de 2026, por días;
- en Folvy, **`conta_lectura`** en una sesión de solo lectura, filtrando por
  la cuenta y la empresa de Foodint (regla 9). Se leen dos cosas: los saldos
  por subcuenta al 30/09 y el mapeo de serie;
- se colocan las subcuentas de los dos lados con el mismo «prefijo más largo»
  de `cuentasAnuales.colocar`;
- en el registro, que es público, **solo recuentos y sí/no**:
  - ¿coinciden Diez y Folvy al 30/09, por subcuenta y por línea?
  - ¿Diez mueve cada línea después del corte?
- las cifras van **cifradas** con `testigo-clave-publica.pem`, que solo abre
  Julio.

Diez contestó mal tres veces el 14/10 por la mañana:

| Ejecución | Qué devolvió Diez |
|---|---|
| 1.ª | `OutOfMemoryException` (400) en enero |
| 2.ª | más de 90 s sin respuesta en enero, leyendo el mes entero |
| 3.ª | lo mismo, leyendo por semanas |

La cuarta lee por días, octubre primero, reintenta dos veces cada día y dice
qué días no contestaron. **El resultado está en §1.5.**

### 1.4 · La norma, literal, y lo que dice de los clientes acreedores

Julio pidió la cita de la tercera parte del PGC. Del texto del BOE en el
repositorio (`docs/conta/fuentes/textos/rd-1514-2007.txt`):

> **Primera parte, Marco Conceptual, 3.º Principios contables, 5. No
> compensación.** «Salvo que una norma disponga de forma expresa lo contrario,
> no podrán compensarse las partidas del activo y del pasivo o las de gastos e
> ingresos, y se valorarán separadamente los elementos integrantes de las
> cuentas anuales.»

> **Tercera parte, I. Normas de elaboración de las cuentas anuales, 6.ª
> Balance, 2.** «Un activo financiero y un pasivo financiero se podrán
> presentar en el balance por su importe neto siempre que se den
> simultáneamente las siguientes condiciones: a) Que la empresa tenga en ese
> momento, el derecho exigible de compensar los importes reconocidos, y b) Que
> la empresa tenga la intención de liquidar las cantidades por el neto o de
> realizar el activo y cancelar el pasivo simultáneamente.»

Leído al pie de la letra, un cliente con saldo acreedor es una **deuda** con
ese cliente. Compensarla con lo que **otro** cliente debe no cumple la letra
a): no hay derecho a compensar entre dos terceros distintos. Por la norma, los
cinco clientes acreedores irían al pasivo (C.V.2, como la 438 «Anticipos de
clientes»), y «1. Clientes» solo sumaría las dos deudoras.

**Ni Diez ni Folvy lo hacen así: los dos compensan.** Diez es la referencia y
no he cambiado el mapeo; con la norma delante, **por norma no tiene razón
ninguno de los dos**. Si Julio quiere el balance «por norma», el cambio cabe en
el mapeo que ya existe, sin tocar código:

- dos filas «por saldo» para 430–436: deudora a III.1 y acreedora a C.V.2,
  como ya se hace con la 551 y la 5523;
- con eso Folvy dejaría de cuadrar con Diez en dos líneas, y a propósito.

Es decisión de Julio, y no la he tomado.

### 1.5 · Lo que dijo la lectura de C0008

**Run 38536114868** (14/10, de 08:35 a 09:43 UTC, en verde), en claro:

- **Enero a septiembre, completo.** Diez contestó todos los días, unos tras
  reintentar. Leídos: 525, 818, 835, 683, 653, 512, 955, 824 y 1.418
  asientos; 0 repetidos y 0 de otro ejercicio.
- **Al 30/09, Diez y Folvy coinciden al céntimo en las 150 subcuentas con
  saldo** (0 distintas), y por eso también en las cuatro líneas: Clientes,
  Otros deudores, el total de III y el patrimonio neto. La importación del
  12/10 está entera; no hay ningún asiento de antes del corte cambiado
  después en Diez.
- **Después del 30/09, Diez tiene 4 asientos** (leídos del 02 al 14/10;
  **el 01/10 no contestó** ni reintentando dos veces).
  - Mueven «Otros deudores» y el patrimonio neto.
  - **No mueven «Clientes»**: Diez con todo lo leído da en Clientes lo mismo
    que Folvy.

Lo que eso dice de las tres diferencias:

| Diferencia | Explicada |
|---|---|
| Patrimonio neto y «Otros deudores» | **Sí, por octubre de Diez**, que Folvy no tiene en el libro: sus 55 asientos de octubre están propuestos, sin validar. Las cifras van cifradas en el run (`testigo-clave-publica.pem`), para que Julio las compare con las que dio. |
| «Clientes» | **No, con lo leído.** Falta el 01/10, el único día sin leer. Lo vuelvo a leer solo (§1.6). |

### 1.6 · El 01/10, otra vez

*(Run con `[lectura:balance:202610]`, solo octubre.)*

---

## 2 · Aviso #178: los 27 rojos «Plan traído»

El análisis de B (`docs/conta/B01_informe_aviso_178.md`, rama
`conta/b01-bancos`) era correcto, y lo medí otra vez en producción, solo
leyendo, el 14/10:

- **27 subcuentas** `migrated` sin `import_id`, las 27 de Foodint y ninguna de
  otra cuenta;
- las 27 tienen apuntes de la **única** lectura del histórico (`import_run`
  `0542e958…`, `historico`, `hecho`) y **ninguna** tiene apuntes de otra;
- las 27 se crearon en la misma transacción que esa lectura (las dos marcas de
  tiempo son 2026-10-12 21:04:04.733305+00).

### 2.1 · Lo que se escribe

- **0500** `20261111T0500_c06b_cuenta_lectura.sql`:
  - `company_account.import_run_id`, que admite nulos y apunta a `import_run`;
  - `conta_diez_subcuentas` con la **misma firma** y el cuerpo de producción
    (md5 `9a545a02…`, el de la 0300), con un único cambio: las tres altas
    escriben la lectura en curso.
  - Declarada en la cabecera y con su prueba de staging.
- **0510** `20261111T0510_c06b_cuenta_lectura_las_27.sql`: rellena las 27, y
  **pide `autorizo`**.
  - La lectura no se elige por nombre ni por un literal: es la **única**
    lectura `hecho`, de la misma cuenta y empresa, cuyos asientos usan esa
    subcuenta.
  - Escribe 27 o para.
  - Después tiene que quedar 0 «migrated» sin importación ni lectura.
  - No borra ni recrea ninguna cuenta.
- **Vueltas atrás**:
  - la de la 0510 escribe 27 o para, y solo toca subcuentas creadas antes del
    14/10;
  - la de la 0500 devuelve el cuerpo de la 0300 y PARA si queda alguna lectura
    escrita.

### 2.2 · El agente acepta los dos caminos, nunca el nombre

`scripts/conta/lib/agentePlan.mjs`. Una cuenta `migrated` es buena si cumple
uno de los dos caminos, y en los dos guarda su nombre de origen (`name_source`)
o espera el suyo (`name_pending`, la que Diez trajo sin nombre en la C06):

- **o** tiene su importación del plan, como hasta ahora;
- **o** tiene `import_run_id`, y además:
  - esa lectura es de su misma cuenta y empresa;
  - está en estado `hecho`;
  - la cuenta tiene **al menos un apunte traído por esa lectura**.

Un `created_by_name` «Diez (traída)» no cuenta; hay una prueba de que sin la
lectura los 27 siguen en rojo con ese nombre.

`scripts/conta/agente-plan-contable.sql` lee la columna por `to_jsonb`, así
que funciona antes y después de la tanda (probado en producción con `select`:
781 cuentas, 1 lectura, 0 con lectura todavía). Lee también `import_run`, que
`conta_lectura` ya tenía (`20261019T0120_diez_lectura.sql`). La prueba de que
la lectura cubre lo que nombran los agentes pasa de 42 a 43 nombres.

Pruebas en `tests/conta/cumplimiento/agentePlan.test.ts`, contra los 27
códigos reales del #178 (los del informe de B, sin importes):

- hoy, los 27 rojos;
- entre la 0500 y la 0510, siguen los 27;
- después de la 0510, verde;
- pueden fallar en los tres casos de lectura mala: de otra cuenta, sin
  terminar, o sin apuntes suyos;
- y con el nombre, sin lectura, siguen en rojo.

### 2.3 · Staging

- 0500 y su prueba (`20261111_c06b_cuenta_lectura_prueba.sql`) aplicadas: run
  38534392147, en verde.
  - «1 y 2 OK: las 3 altas (propia, sin nombre, de serie) con su lectura; la
    que estaba, sin tocar; rechazos como antes.»
  - «3 OK: solo una lectura que existe.»
- La 0510 no va a staging: allí no están las 27 y su guarda pide exactamente
  27. Su selección se ensayó en producción con un `select`:
  - 27 candidatas;
  - 27 con una sola lectura `hecho`;
  - 1 lectura y 1 cuenta;
  - 0 subcuentas creadas desde el 14/10.
- El agente «Plan contable» con el SQL nuevo, en staging (run 38534392526,
  segunda vuelta): **en verde**.

### 2.4 · La tanda (paso 8)

`supabase/produccion/aplicar.txt`:

1. `cuenta: scripts/conta/produccion/cuentas/cuenta-lectura.sql`
2. `20261111T0500_c06b_cuenta_lectura.sql`
3. `20261111T0510_c06b_cuenta_lectura_las_27.sql`

Vuelta atrás en `supabase/produccion/vuelta-atras.txt`, en orden inverso.

El contexto se midió en producción, solo leyendo, el 14/10 a las 08:32 UTC,
con la consulta del workflow y sus `CAMINO_TABLAS` y `CAMINO_FUNCIONES`:

- existen `company_account` y `conta_diez_subcuentas`;
- **nada en el camino del pedido**;
- **ninguno de los dos ficheros en el historial**.

La salida entera está en `docs/conta/c06b/tanda-analisis-20261014.md`:

```
20261111T0500_c06b_cuenta_lectura.sql: sigue
20261111T0510_c06b_cuenta_lectura_las_27.sql: AUTORIZO
autorizo: 20261111T0510_c06b_cuenta_lectura_las_27.sql
```

La cuenta de antes, en producción, el 14/10 a las 08:33 UTC:

| Qué | Valor |
|---|---:|
| subcuentas | 781 |
| «migrated» sin importación | 27 |
| columna `import_run_id` | 0 (sin columna) |
| con su lectura | sin columna |
| md5 de `conta_diez_subcuentas` | `9a545a02237517ed39048277b48e5612` |
| lecturas | 1 |
| apuntes | 39.734 |

Después del real tiene que salir: 781 · 27 · 1 · 27 · md5 distinto (el de la
0500) · 1 · 39.734.

**Orden con la B01: lo dice Julio.** Las dos tandas no tocan lo mismo: la B01
da a la 57200003 su ficha de banco y no toca la cuenta.

---

## 3 · La barra «Pregunta o pide algo» en Libros

- **Libros, el diario, un asiento y el asiento nuevo** dejan de enseñar la
  barra: solo contestaba «Muy pronto», y tapaba filas.
  - En el ordenador no queda nada flotando.
  - En el móvil, el botón central de la IA tampoco se enseña.
- Va con el mismo mecanismo que B en Bancos (`sinPregunta` en `MarcoConta` y
  `sinIA` en la barra inferior). Los dos cambios son **idénticos** a los de la
  rama `conta/b01-bancos`, línea a línea, así que fusionan sin choque.
- El hueco del final ya estaba: `.cx-principal` deja 112 px en el móvil para
  la barra inferior.

**Lo que no he hecho y es de Julio:** la barra dice «Muy pronto» en **todas**
las pantallas, no solo en Libros. Por la misma regla, sobraría en todas. La he
quitado donde tapaba, que es lo que se pidió.

La e2e de lo que tapa, extendida a Libros: `loQueTapanSinPregunta`, en
`tests/e2e/conta/solapes.ts`.

- En `/conta/libros…`, en el ordenador, **exige que la barra no esté**.
- En el móvil, y fuera de Libros, mide como siempre.
- La usan las cuatro e2e que pasan por Libros: c05 libros, c04 libro, c04 con
  Diez y cierre.

---

## 4 · La semilla de Diez de staging, con el plan completo

`supabase/seeds/conta/seed_c06b_diez_plan_staging.sql`, aplicada (run
38535231420). Activa el plan **con la misma función que el alta**,
`company_chart_activate`.

- Esa función exige un administrador de la cuenta. Hay uno que **solo existe
  dentro de la transacción**: se crea y se borra en ella, y nadie entra en la
  empresa.
- También exige un plan vacío. La 57200001 de la semilla C06 es mía y no tiene
  apuntes: se aparta antes y vuelve después, igual que la deja el paso del
  banco del alta.

En staging, después:

| Qué | Valor |
|---|---:|
| cuentas | 622 (615 de serie, 6 de IVA y el banco) |
| hojas sin cuenta | 0 |
| enlaces de IVA | 6 |
| el administrador de un rato | 0 (no queda) |

El agente «Plan contable» en staging, que antes daba 7 rojos de esta empresa,
**en verde**.

---

## 5 · Comprobaciones

### 5.1 · `conta-contrasena` (pública, `verify_jwt = false`)

| Lo que pide Julio | ¿Se cumple? |
|---|---|
| Nunca dice si un correo existe | **Por el cuerpo, sí**: el mismo 200 y el mismo texto en todos los caminos después de validar el formato. **Por el tiempo, no lo cumplía**: si el correo existe, esperaba a crear el enlace y a mandar el correo antes de contestar, y eso se nota en el reloj. **Arreglado**: el enlace y el correo salen en segundo plano (`EdgeRuntime.waitUntil`). Ahora los dos casos contestan después de la misma consulta. Desplegada en staging (run 38535360214). La e2e `tests/e2e/conta/c06b/contrasena.spec.ts` lo mide con la misma vara a los dos lados: dos correos que existen y dos que no, en tres vueltas. |
| Tiene límite de intentos | **Sí, por correo**: uno por minuto (`recovery_sent_at`, en `conta_contrasena_de_marca`). **No hay límite por quien llama** (por IP) ni un tope por hora: con un minuto entre envíos son hasta 60 correos por hora a una misma persona de una marca. No lo he cambiado. Si se quiere un tope por hora, es una tabla nueva y una condición más en la función; es decisión de Julio. |
| No cambia nada sin el enlace | **Sí.** `generateLink('recovery')` no cambia la contraseña: solo deja un token de recuperación (y `recovery_sent_at`). La contraseña solo cambia en `/reset-password/confirm` con ese token. Efecto lateral: un enlace nuevo invalida el anterior todavía sin usar, como mucho uno por minuto. «Contraseña cambiada» exige la sesión de la persona y solo manda un correo. |

**A desplegar a mano con el PR:** `conta-contrasena`.

### 5.2 · La regla del PR a `main`

- **`pr-a-main.yml`** corre en cada PR a `main` y falla si:
  - el **título** lleva `[skip ci]` o una de sus hermanas;
  - la descripción **no tiene** `## Funciones a desplegar a mano`, o no dice
    exactamente las que toca el diff.
- Cuenta como tocadas las carpetas cambiadas y **cada función que importa un
  `_shared` cambiado**, porque `deploy-edge-functions` se salta `_shared`.
- El mensaje que se escribe **al fusionar** no lo puede ver. Ése lo vigila
  quien fusiona; está escrito en `CLAUDE.md`, en la regla nueva.
- Probado con la población real, el diff de la #181:
  - da `conta-contrasena`, `conta-crear-cuenta`, `conta-diez-enviar` y
    `send-email`;
  - **`conta-diez-enviar` va por `_shared/diezCliente.ts` y `diezEnviar.ts`**;
  - en producción están las cuatro desplegadas el 14/10 a las 09:52, después
    de la fusión de las 09:46. No falta ninguna.

---

## Lo que queda apuntado

- e2e de staging del commit de los puntos 1 y 3 (run 38535087773): **173 en verde**, incluidas las cuatro que pasan por Libros, y **2 en rojo** ajenas: `c01b/flujos` «marcar pagada…», en ordenador y móvil. La cuenta A compartida ya tiene la factura `E2E-001` y la regla de repetidas devuelve 409. Esta rama no toca proveedores ni facturas.

- Staging, agente «Libro diario»: un rojo `dia_sin_asiento` de la cuenta
  `c01b0000` (los datos del cierre del día del frente B). No es de este
  encargo.
- Las pruebas del analizador que siguen la tanda viva
  (`analizar.test.ts`, `w01.test.ts`) estaban en rojo en `main` (5): seguían
  la tanda del C04b R15. Ahora siguen esta. Medido a los dos lados: 5 fallos
  en `origin/main` y 0 en la rama.
