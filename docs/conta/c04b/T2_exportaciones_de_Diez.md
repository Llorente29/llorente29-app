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
