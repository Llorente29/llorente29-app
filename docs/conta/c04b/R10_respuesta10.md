# C04b · Respuesta 10 — una sola regla para todas las plataformas (13/10)

**Sin importes**: el repositorio es público. Los importes están en el chat.

## 1 · Qué cambia

La regla es una para todas las plataformas, también Glovo: un asiento por
plataforma, local y día. Lleva una línea de venta por marca (7000000x), su
reembolso (7080000x) y el IVA (47700010).

- **0120**: Foodint Glovo pasa a `por_marca = false`, como Uber y Just Eat.
  La columna `conta_ventas_canal.por_marca` se queda para quien la necesite.
- **Nada más en la base.** La SQL (`conta_unidad_ventas`,
  `conta_propuesta_ventas_unidad`) y el núcleo (`unidadesDelDia`) ya se
  rigen por esa columna. Ni la 0100 cambia de funciones: solo el texto que
  recibe el front de antes, que ya no dice «y Glovo por marca».
- **Staging**: la 0125 (la regla de la empresa A) también pasa a todas por
  local.

## 2 · Octubre, rehecho en solo lectura (01/10–12/10, Foodint)

Misma consulta en línea de la R5 (el texto de `conta_propuesta_ventas_unidad`
con la regla de Foodint como lista fija), contra producción y en solo
lectura. El único cambio: ninguna plataforma por marca.

| | R5 (Glovo por marca) | **R10 (todas por local)** |
|---|---:|---:|
| Asientos | 105 | **50** |
| Sin propuesta | 0 | 0 |
| Descuadrados | 0 | 0 |
| Líneas de venta por marca (7000000x) | 167 | 167 |
| Local×día con el mismo cobro (430) que el asiento vivo, al céntimo | 24 de 24 | **24 de 24** |
| Saldo por local × día × cuenta × marca, igual al de la R5 | — | **179 de 179** |

Por local y día salen 1, 2 o 3 asientos (3, 16 y 5 de los 24): uno por cada
plataforma que vendió ese día. Las cifras de cobro están en el chat.

**Paridad SQL ↔ núcleo**: `scripts/conta/paridad-ventas-plataforma.ts`, con
`CANALES_POR_MARCA` vacío: **50 de 50 unidades iguales**. Compara las
unidades del día, las líneas, las razones, el porqué, la confianza, el
concepto y los pedidos.

## 3 · La comparación diaria con Diez

`compararDiaPorCuentas` ya suma por cuenta todos los asientos del día: el
Glovo de Diez (un asiento por marca) suma en la 430 de Glovo y en la
7000000x de cada marca, lo mismo que el asiento único de Folvy. No es
diferencia.

Lo que cambia es **el total del día: por saldo de cuenta**, no línea a línea.
Un lado con la 430 neta y el otro con cobro y reembolso en líneas separadas
daban totales distintos con los mismos saldos. Prueba nueva en
`tests/conta/diez/mapeo.test.ts` (y con el total de antes habría salido
«total» distinto).

**Por local no se puede**: las líneas de Diez no traen local ni analítica
(cuenta, importes, descripción, contrapartida, justificante, tercero). Se
compara el día, con los dos locales juntos.

## 4 · Apuntado para después del C04b

La pantalla del resultado por marca y por plataforma (ventas, reembolsos,
comisiones y margen), en su propio encargo con maqueta.
