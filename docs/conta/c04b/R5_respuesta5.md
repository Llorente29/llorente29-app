# C04b · Respuesta 5 — informe (13/10)

Lo hecho y medido tras la respuesta 5 de Julio. **Sin importes**: el
repositorio es público. Los importes de las dos muestras están en el chat.

## 0 · Antes de nada: el cierre a las 2:00 ya está en producción

La 0170 y la 0175 están en el historial de producción, las dos del run real
38352237907, y Foodint guarda `02:00` (leído el 13/10, solo lectura). Esa
tanda queda congelada en las pruebas (`tests/conta/produccion/tanda-cierre-dos-20261012.txt`)
y el manifiesto vivo pasa a ser el de esta respuesta.

## 1 · La regla de ventas definitiva

Es la de R4 §2, con las cuatro respuestas de Julio:

| | Uber Eats | Just Eat | Glovo |
|---|---|---|---|
| Unidad | **un asiento por local y día** | **un asiento por local y día** | **un asiento por marca, local y día** |
| Concepto | «Ventas Uber · Foodint Alcalá» | «Ventas JustEat · …» | «Ventas Glovo · Meraki Pita · Foodint Alcalá» |
| Cliente (debe) | 43000002 | 43000003 | 43000001 |
| Ventas (haber) | **7000000x de cada marca** | **7000000x de cada marca** | **7000000x de la marca** |
| Reembolso al cliente (debe) | **7080000x de cada marca** | **7080000x de cada marca** | **7080000x de la marca** |
| IVA (haber) | **47700010** | **47700010** | **47700010** |

- **Glovo, por marca, como Uber y Just Eat**: no se copia el 70000000 de Diez.
- **Lovers Burgers en Glovo es Lovers Burgers en Alcalá**, como lo dice Folvy.
  Lo de «GLOVO French Tacos Club BAR» de Diez no se copia.
- **708 = reembolso de la plataforma al cliente** (mal servido o cancelado):
  la venta va **bruta** a 7000000x y el reembolso, **aparte**, a 7080000x de
  la marca, con su línea de IVA y contra la 430 de la plataforma, el día en que
  la plataforma lo liquida. La línea dice «Reembolso al cliente · *marca* ·
  pedido *código*».
- **El IVA, a 47700010** (la 477 del tipo de Folvy), no a 47700000.
- Lo de siempre no cambia: las marcas cedidas fuera (van por la liquidación
  del socio), un cancelado no es venta, la base pedido a pedido, y lo que no
  se puede proponer se dice con su porqué.
- **Una marca sin su subcuenta** no se esconde: va a la general y la propuesta
  lo dice en «Mira esto», con confianza Duda. Solo cuando se usa: sin
  reembolsos ese día, que falte la 708 no avisa.

**Las subcuentas.** De las nueve marcas propias, las nueve tienen su
7000000x (traídas de Diez el 12/10). De 708, seis; **Scandal Burgers, The
Urban Kebab y Dirty Burger no tenían**: la 0120 crea 70800003, 70800007 y
70800008 con el nombre al estilo de las de Diez («DEVOL. VENTAS …»).

**Los reembolsos, hoy.** Folvy los lee de las liquidaciones de las
plataformas (`channel_settlement_order.incidents_refund`). **Las cargadas
llegan a junio de 2026**: en octubre no hay ningún reembolso que asentar, y
los asientos de octubre salen sin línea de 708. Cuando se carguen las
liquidaciones de octubre, entran el día de la liquidación.

### Dónde vive

- **Base** (`20261020T0100`): `conta_ventas_canal` (qué canales van por marca)
  y `conta_ventas_marca` (la 7000000x y la 7080000x de cada marca), por
  empresa. Que una empresa tenga filas en `conta_ventas_canal` es lo que dice
  que usa esta regla; sin filas, todo es como antes. `sales_day_summary` gana
  `unit_key` (la unidad: canal, o canal:marca), y el cierre del día propone
  una vez por unidad: `conta_propuesta_ventas_unidad` y `conta_propuestas_ventas_dia`.
- **Núcleo** (`asientosPropuestos.ts`): `unidadesDelDia` y `ventasDelDia` con
  `unidad`. El botón «Proponer» del Libro hace lo mismo que el cierre.
- **Sin duplicar**: la clave es día:local:unidad (índice único de la 0110).
  Un día asentado entero a la antigua no se rehace por unidades, y con la
  regla nueva el día entero se **niega con su porqué** («Las ventas se
  asientan ahora por plataforma… Recarga la página»): así el front de antes,
  mientras no se publique el nuevo, no puede dejar un asiento al lado de los
  de cada plataforma. Descartar una unidad descarta esa unidad, no el día.

## 2 · Los 22 de octubre (hoy 24), rehechos

El cierre del día propuso dos más el 12/10: son **24** asientos del día entero,
del 01/10 al 12/10, Alcalá y Carabanchel.

**Marcas cedidas: ninguna.** Medido en producción, solo lectura: los 24 llevan
**457 ventas, 0 de marcas cedidas, 0 sin marca y 0 de otra cuenta**; sus
líneas de venta son de las nueve marcas propias y nada más. Las 457 son
exactamente las ventas cerradas de las marcas propias de octubre. Así que no
pueden salir dos veces con la factura mensual a Cloudtown (43000004 /
70500000): esa factura, en el histórico de Diez, es de servicios (705) y no
lleva ventas de plataforma. *(Un nombre a vigilar: «Milanesa House» es propia
y «Milanesa Haus» es cedida. Folvy las separa bien por la marca, no por el
nombre.)*

**Rehechos con la regla, en solo lectura y sin aplicar** (la consulta es el
mismo texto que `conta_propuesta_ventas_unidad`, con la regla de Foodint
como lista fija):

| | Medido |
|---|---|
| Días×local | 24 (los mismos de los 24 asientos de hoy) |
| Asientos nuevos | **105** (uno por plataforma; Glovo, uno por marca) |
| Sin propuesta | 0 |
| Que descuadren | 0 |
| Cobro de cada día, contra el asiento de hoy | **igual al céntimo en los 24** |
| Tickets de cada día, contra el de hoy | iguales en los 24 |
| Confianza | Probable en los 105 (base calculada: los pedidos no traen la base) |

**La misma vara a los dos lados** (regla 31): el núcleo del botón contra la
base, sobre la población real (1.760 pedidos de octubre, cedidas y
canceladas incluidas): **105 de 105 asientos iguales**, línea a línea
(cuenta, debe, haber, concepto y marca), razones, porqué, confianza, concepto
y pedidos (`scripts/conta/paridad-ventas-plataforma.ts`; el volcado, fuera
del repositorio).

**Las dos muestras** (12/10), en el chat con sus importes:

1. **Alcalá · «Ventas Uber · Foodint Alcalá»**: cobra Uber (43000002) ·
   ventas de seis marcas, cada una a su subcuenta (70000011 Lovers Burger,
   70000006 Bendito Burrito, 70000001 Milanesa House, 70000002 Meraki Pita,
   70000004 Smash Brothers, 70000003 Scandal Burger) · IVA a 47700010. Fuera,
   un cancelado.
2. **Carabanchel · «Ventas Uber · Foodint Carabanchel»**: un ticket de
   Bendito Burrito a 70000006 · IVA a 47700010. Fuera, 18 pedidos de marcas
   cedidas, dicho en el porqué.

**Cómo se aplica, cuando Julio lo diga** (`supabase/produccion/aplicar.txt`):

| Fichero | Qué hace | Analizador (contra producción, 13/10) |
|---|---|---|
| 0100 | la regla, la unidad y las cuatro funciones del proponedor | sigue (cambia en caliente, declarado con su prueba de staging) |
| 0110 | el índice único por unidad | **autorizo** |
| 0120 | Foodint: Glovo por marca, las 18 subcuentas de marca, las tres 708 nuevas | sigue |
| 0130 | retira los 24 del día entero (copia en `_retirado_ventas_por_plataforma`) | **autorizo** |
| 0140 | `conta_lectura` lee el registro del cierre del día (el agente, §8) | sigue |

Después, el cierre del día (a los :07) propone los 105. La vuelta atrás
devuelve las cuatro funciones byte a byte (md5 medido) y el índice de antes.

**Lo que se ha probado y dónde**, para que se sepa qué vale cada cosa:

- En un **Postgres 16 local** con las tablas de producción (su estructura,
  leída de producción) y las funciones tal cual (md5 iguales a producción),
  pero **sin las políticas, los disparadores ni los datos reales**: la tanda
  entera, de antes a después y vuelta atrás; los caminos (repetir, front de
  antes, descartar una unidad, un pedido tardío de otra plataforma, un pedido
  abierto en una), y la prueba de staging y su ensayo, las cinco partes en
  verde.
- **En staging, todavía no**: el workflow de staging corre al empujar a
  `conta/**`, y esta rama no lo es. Corre al llevar esto a `conta/c04b-diez`.

**Un hallazgo del analizador, arreglado**: leía la firma de una función hasta
el primer paréntesis, también si estaba dentro de un valor por defecto
(`p_quien text default 'Folvy (cierre del día)'`). La 0100 salía BLOQUEA por
«crearía una sobrecarga» de `conta_proponer_dias` que no existía. Ahora salta
comillas y paréntesis anidados; con su prueba, y las 140 de antes, iguales.

## 3 · Las diferencias de Uber (Meraki Pita, Mila's Sandwiches, Lovers Burger)

Medido día a día y marca a marca, septiembre, Alcalá, Uber: Diez (7000000x
de cada día) contra Folvy (la venta de esa marca ese día, sin IVA). De 84
días×marca, **62 cuadraban** como se medían en R4. Las diferencias salen de
tres sitios, y ninguna es un reembolso:

1. **Pedidos de otro día (la mayoría).** Folvy fecha la venta por la hora del
   pedido; el informe de Uber que usa Diez, por la de la **entrega**. Un pedido
   de las 23:28 que se entrega pasadas las 00:00 está en Folvy el día D y en
   Diez el D + 1. Salen **por parejas** (lo que le falta a un día lo tiene el
   siguiente, al céntimo o a dos céntimos del redondeo del día) y se
   compensan dentro del mes. Mirándolo con el día del cierre del pedido en
   vez del de la venta, cuadran **76 de 84**; los que no, son pedidos que el
   local cerró tarde a mano (uno de las 14:07 cerrado a las 00:03) y que Uber
   entregó el mismo día. Folvy no guarda la hora de entrega de Uber.
2. **Pedidos que Folvy no da por venta y Uber cobró.** Uno que Folvy cerró
   como **no confirmado** (Mila's Sandwiches, 14/09) y dos **cancelados** (uno
   de Meraki Pita con hora de cierre, 12/09, y uno de Lovers Burger, 18/09)
   están en Diez como venta: Uber los pagó. Es el caso «no confirmado que la
   liquidación paga» del cierre del día: Folvy lo asienta aparte cuando llega
   la liquidación, y las de 2026 cargadas llegan a junio.
3. **Dos importes sin pedido en Folvy** (Meraki Pita 06/09, Lovers Burger
   18/09): ni un pedido de Folvy de ese importe, en ningún estado, canal o
   local, en tres días alrededor. Lo más probable es un **ajuste de la
   plataforma**. Sin el informe de Uber de esos días no se puede decir más.

**Lo que pide a Julio:** ¿el día de una venta de Uber es el del pedido (como
Folvy) o el de la entrega (como el informe que usa Diez)? Para la ley, el
de la factura simplificada, que Folvy emite con el pedido; pero si Diez
compara por día, estos pedidos saldrán como diferencia de un día al siguiente
mientras no se decida. La comparación diaria (§4) los enseña tal cual: no los
esconde ni los da por buenos.

## 4 · La comparación diaria sabe lo que se ha decidido

`compararDiaPorCuentas` (`diezMapeo.ts`), núcleo puro con sus pruebas:

- compara el **total del día** (debe y haber) y **cada cuenta de cliente**
  (430) por su saldo;
- las ventas (700), los reembolsos (708) y el IVA repercutido (477) se
  comparan **por el total de la familia**: si cuadra y solo cambia la
  subcuenta (Glovo a 70000000 en Diez y a 7000000x en Folvy; IVA a 47700000
  en Diez y a 47700010 en Folvy), **no es diferencia**: se dice como «cambio
  decidido», con qué subcuentas tiene cada lado;
- lo demás, cuenta a cuenta;
- **solo desde el 01/10/2026**: antes no hay cambio decidido y todo se compara
  cuenta a cuenta.

Aún no corre contra nada: no hay asientos de Folvy de octubre en Diez para
comparar. Sus pruebas son de ejemplos hechos a mano; la prueba contra la
población real será la primera comparación de verdad.

## 5 · Al enviar a Diez, primero las subcuentas que Diez no tenga

`diezSubcuentas.ts` + `ClienteDiez.crearSubcuenta` (`POST /api/subcuentas/add`,
en la lista de escrituras del cliente). Antes de enviar un asiento: se lee el
plan de Diez, se crea lo que falte **con el mismo código y nombre que en
Folvy**, y se vuelve a leer: cada una tiene que estar, con su nombre, o falla.

- Frenos: 8 dígitos como el plan de Diez; el nombre no se recorta (60 como
  máximo, el de Diez); la que ya está con otro nombre no se toca y se dice; si
  hay un freno, no se crea ninguna. Y los del cliente: en la C0008, solo con
  `escribirEnReal`.
- Las de octubre que Diez no tiene: **47700010** y **70800003, 70800007 y
  70800008** (las 7000000x de las nueve marcas ya están: vienen de Diez).

**La prueba en la C0009, preparada y sin lanzar**:
`scripts/conta/diez/prueba-c0009-subcuentas.ts`, por el workflow de la C0009
con un commit que empiece por `[prueba-c0009:subcuentas]` en
`conta/c04b-diez`. Crea esas cuatro en la C0009, las lee de vuelta y dice
cuáles estaban. Esta rama no la dispara.

## 6 · La analítica: espera

De acuerdo con la propuesta (tabla aparte por línea, origen «Diez», fuera de
la huella; sin local, «Sin local»). **No se construye todavía**: espera a la
lectura asiento a asiento (julio–septiembre de 2026). Cuando se construya, el
filtro de local de Libros, mayor y sumas y saldos será **el mismo componente
que el de Ventas**, no uno nuevo.

## 7 · Diseño del asiento de ventas

- En cada línea, la **marca con su nombre junto a la subcuenta**
  (`pastillasDeLinea`): «70000002 · Meraki Pita», no un código suelto. Antes,
  una línea de marca propia decía «Marcas propias».
- El reembolso se lee como tal: «Reembolso al cliente · *marca* · pedido
  *código*», y su IVA, «IVA del reembolso *código*».

## 8 · Lo que queda dicho y no hecho

- **El agente del Libro** («día sin asiento») mira el día, no la unidad: no
  da falsas alarmas, pero no ve una unidad que falte si otra del mismo día
  tiene asiento. Se afina cuando `conta_ventas_canal` esté en producción (si
  se hace antes, la medición de antes de la tanda fallaría). `conta_lectura`
  ya podrá leerla (0100).
- **El orden de publicar**: la base antes que el front. El front nuevo lee
  `conta_ventas_canal` y `conta_ventas_marca`; publicado antes que la 0100,
  el Libro no podría leer su contexto.
- **El agente en rojo de la empresa B de pruebas** (commit aparte). El rojo es
  `dia_sin_asiento`: un pedido del 04/10 de la empresa B de staging, sin
  resumen ni asiento 186 h después de su cierre (run 52 del cumplimiento
  nocturno, 12/10). **Desde esta sesión no se puede leer staging** (solo
  producción), así que el porqué no está medido. Lo más probable: la empresa B
  no tiene el IVA de sus ventas (la prueba del cierre del día la usa así a
  propósito) y el cierre apunta «Falta el IVA…» cada hora. Lo que se ha
  arreglado es que **el aviso lo diga él mismo**: lleva lo que apuntó el cierre
  la última vez (`sales_day_proposal_log`: sin propuesta y por qué, fallo…).
  `conta_lectura` lo puede leer con la 0140 (solo un permiso); hasta entonces
  el agente sigue corriendo como antes (lo comprueba antes de leerlo). El
  rojo **no se ha quitado**: con el porqué a la vista, la siguiente noche dirá
  si es la empresa B sin IVA (y entonces se le da su IVA en staging) o otra
  cosa.
