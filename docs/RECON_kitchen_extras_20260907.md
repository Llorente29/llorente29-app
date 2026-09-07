# RECON · Kitchen «Extras» — antes de la maqueta

**07/09/2026 · encargo de Julio · no se ha construido nada, no se ha tocado la BBDD**

Todo lo de abajo está medido contra Foodint (`51ad1792-…`) con `account_id` en cada
consulta (regla 9). Donde mi número no coincide con el del encargo, lo digo.

---

## 1 · Lo que bloquea el §2 tal y como está escrito

**`source = 'extras'` no se puede escribir.** La columna tiene un CHECK vivo:

```sql
modifier_recipe_impact_source_valid
  CHECK (source = ANY (ARRAY['human','ai','import']))
```

Un insert con `'extras'` falla. Hay dos salidas y **no son equivalentes**:

- **(a) Ensanchar el CHECK** para admitir `'extras'`. Barato, pero rompe el
  significado de la columna: `source` responde a **quién lo dijo** (una persona,
  la IA, una importación). `'extras'` responde a **dónde lo dijo**. Mezclar los
  dos ejes en una columna es la clase de cosa que dentro de tres meses hace que
  «¿cuántos los puso un humano?» deje de tener respuesta.
- **(b) `source = 'human'`** —porque lo dijo una persona— y la procedencia va
  aparte. `rationale` ya existe, es texto libre y hoy está para esto.

**Recomiendo (b).** Si lo que se quiere es poder contar «cuántos se arreglaron
desde la sección», eso es una columna nueva (`entered_from`) y una migración
declarada, no un valor colado en una columna que significa otra cosa. Decides tú.

---

## 2 · Las cifras del §1, comprobadas

| | encargo | medido | |
|---|---|---|---|
| extras que cobran | 120 | **120** | ✅ |
| con coste | 20 | **20** | ✅ |
| sin coste | 100 | **100** | ✅ |
| nombres distintos entre los 100 | 56 | **56** | ✅ |
| sin nada puesto | 99 | **98** | ✗ |
| puesto pero a cero | 1 | **2** | ✗ |
| opciones vendidas sin coste (30 d) | 35 | **34** | ✗ |
| veces vendidas (30 d) | 353 | **342** | ✗ |

**Los dos «puestos pero a cero» no son el mismo caso.** Uno es el que dices,
« Sweet Chili T» de Big Mike's (`add_item`, sale 0). El otro es **«Base Ternera
(Premium Selection)» de Milanesa House**, y es un `replace_item`: no es un extra
sin rellenar, es una sustitución cuyo cálculo da cero. En la pantalla no debería
decir lo mismo de los dos.

**El 35 sale de contar las ventas canceladas.** Con canceladas: 35 opciones y 344
líneas. Sin canceladas: 34 y 342. El 353 **no lo reproduzco** con ninguna
definición que he probado (`sold_at`/`created_at`, con y sin canceladas, líneas y
unidades — todas las cantidades son 1). La diferencia es del 3 % y no cambia el
argumento, pero no cuadra y no lo voy a maquillar.

**Dinero cobrado por ellos en 30 días: 539,50 €** (sin canceladas), que es la
cifra que pide el §2 y que el encargo deja sin número.

---

## 3 · Lo que la maqueta tiene que decidir: cuándo NO agrupar

Agrupar por nombre es una **escritura** sobre N filas. Si el agrupado se equivoca,
no pinta mal una etiqueta: escribe mal siete fichas. Medido sobre los 120:

- **34 nombres aparecen una sola vez.** Para ellos la sección no ahorra nada:
  son una fila y una copia.
- **32 nombres tienen copias.** Ahí está todo el ahorro.
- **Sólo 9 de los 56 grupos cruzan marcas.** La duplicación es sobre todo
  *dentro* de una misma marca — la misma salsa repetida en muchos platos. El
  «Todas» por defecto del §4 sigue estando bien, pero el ahorro no viene de
  cruzar marcas.
- **8 grupos son MIXTOS**: unas copias ya tienen coste y otras no
  (`bocadillo bacon queso`, `bocadillo club`…). El «usar el mismo que en Meraki»
  del §2 no es un caso raro: es 1 de cada 4 grupos con copias.
- **3 grupos tienen precios distintos**, y uno de ellos es la trampa:

> **`tiras de pollo kentucky (4 uds)`** — 3 copias, 3 marcas (Dirty Burger,
> Mila's Sandwiches, Scandal Burgers), a **1,90 € y a 6,50 €**. Mismo nombre,
> más del triple de precio. Casi seguro no son la misma cosa: una es un añadido
> y la otra una ración entera. **Aplicarle un coste a las tres sería un error
> escrito en la base.**

Y el mismo caso dentro de una marca: **`base ternera (premium selection)`**, dos
copias en Milanesa House, a 1,50 € y a 2,50 €.

**Propuesta:** que el precio distinto no sea una nota al pie sino una **puerta**.
Si las copias no cobran lo mismo, la fila no ofrece «Decir qué lleva» para todas:
enseña las copias con su precio y se elige a cuáles se aplica. El §2 dice «si las
copias tienen precios distintos, se dice»; yo diría que decirlo no basta cuando
la diferencia es de 1,90 a 6,50.

---

## 4 · Un choque de nombres que conviene resolver antes, no después

El esquema **ya tiene** `modifier_group.group_type = 'extras'`. Reparto real:

| group_type | grupos | opciones que cobran |
|---|---|---|
| `choice` | 45 | **68** |
| `extras` | 12 | **47** |
| `cross_sell` | 1 | 5 |
| `removal` | 6 | 0 |

La definición del §2 —«lo que el cliente añade **o elige** y paga aparte»— incluye
los `choice` a propósito, y es la definición correcta para lo que se quiere
arreglar. Pero entonces una pantalla llamada **«Extras»** enseña 120 cosas de las
que **sólo 47 son `extras`** para la base. Quien mire la BBDD dentro de seis meses
va a leer dos cosas distintas con la misma palabra.

No lo decido yo. Las salidas que veo: llamar a la sección otra cosa
(«Lo que se cobra aparte»), o dejar «Extras» y aceptar que la palabra de pantalla
y la de la base no son la misma — pero entonces que quede escrito.

---

## 5 · Dos cosas del código que hay que tocar sí o sí

**(a) `upsertImpact` supone un impacto por opción.** En
`modifierImpactService.ts:339` hace `.maybeSingle()` filtrando por
`modifier_option_id`. La base **no** tiene índice único ahí — sólo la primaria —
así que permite N. Hoy funciona por suerte: **0 opciones tienen más de un
impacto** (40 impactos, máximo 1 por opción).

Esto muerde en cuanto la sección escriba el segundo. Un extra real —«lleva pan,
carne y salsa»— son tres impactos. En el momento en que exista, la pestaña
«Modificadores» del plato, que el §2 dice que se queda, **revienta** al leerlo.
O se decide que un extra es un solo impacto (y entonces se pone el índice único
que lo haga verdad), o se arregla `upsertImpact` antes de escribir nada.

**(b) La escritura en N copias no puede ser un bucle desde el navegador.** El §2
pide una sola transacción (regla 13). El servicio de hoy escribe fila a fila
desde el cliente: si falla la quinta de siete, quedan cuatro puestas y tres no,
sin nada que lo deshaga. Hace falta una RPC que reciba la lista y escriba dentro
de una transacción, con su guarda de permiso.

**Lo que sí se sostiene:** `recipe_item` es **por cuenta, sin marca**. Un «yogur
griego» sirve a las siete copias aunque estén en marcas distintas. La premisa de
la sección es correcta.

---

## 6 · El sitio en el carril no existe tal y como se describe

El §2 dice «entre Platos y Cartas». En el carril real **Cartas es el segundo y
Platos el octavo**, con cinco cosas en medio:

```
Resumen · Cartas · Casado · Disponibilidad · Informes de disponibilidad ·
Ingredientes · Proveedores · Platos · Precios · Rentabilidad ·
Ingeniería de menús · Ofertas · Reglas de ofertas · Ajustes
```

Hace falta un sitio concreto. Mi sugerencia: **detrás de Casado**, que es la
pantalla con la que comparte patrón y oficio (las dos son «arreglar en bloque lo
que está a medias»), y deja el bloque de coste —Platos, Precios, Rentabilidad—
sin partir.

---

## 7 · Lo que hace falta de ti para poder maquetar

1. **`source`**: ¿(a) ensanchar el CHECK o **(b)** `'human'` + procedencia aparte?
2. **Precios distintos**: ¿nota al pie, o puerta que obliga a elegir copias?
3. **El nombre de la sección**, sabiendo que `extras` ya significa otra cosa.
4. **El sitio en el carril**, con la lista real delante.
5. **¿Un extra es un impacto o varios?** Es lo que decide si hay que arreglar
   `upsertImpact` o poner un índice único.

Con eso maquetas y yo construyo. Nada de esto se toca hasta entonces.
