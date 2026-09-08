# La comprobación de cinturón del §19, medida — y una corrección al §8

**08/09/2026 · nada aplicado · lectura pura.**

## 1 · La respuesta: NO, el descarte no usa el puntero muerto

`brands_skipped_empty` marca una marca como «sin carta en Last» sólo si **ningún
catálogo de `catalogMap` se le atribuyó**, y `catalogMap` sale de
`/catalogs?locationId=` — la lista autoritativa. **El `.default` ya no se lee en
ninguna parte del descarte.** Las 11 propias salen `skipped_empty` porque de verdad
no tienen carta en Last, como dices en el §19.

## 2 · Y de paso, una corrección al §8: `brands[].catalogs` NO está muerto

El §8 concluyó que el puntero «viene vacío para las 20 marcas». **Medido sobre el
espejo —que usa la misma `collectBrandChannelByCatalog`— eso no es exacto:**

| catálogos vivos de Foodint | 55 |
|---|---|
| con marca **atribuida por el recorrido** | **54** |
| que cayeron al nombre del catálogo | **1** (`Lobbers`) |
| marcas distintas de verdad | 19 |

Lo que estaba vacío era **la clave `.default` en concreto**, no `brands[].catalogs`
entero: los catálogos cuelgan de las claves de CANAL. El código viejo no fallaba
porque el objeto viniera vacío — fallaba porque **leía una sola clave de un objeto
que tiene varias**.

Importa para el futuro: `brands[].catalogs` **sigue siendo buena fuente** para la
etiqueta de marca y canal, que es exactamente para lo que la usa
`resolveLocationCatalogs`. El arreglo está bien planteado.

## 3 · «Van Van» no era un artefacto: es una marca de verdad

Estaba la duda de si salía en `brands_unresolved` por un fallo de atribución. **No:**
el recorrido la identifica correctamente como marca «Van Van», con dos catálogos
—«Van Van Chicken Bar (Delivery Parnert Digital)» de GLOVO y de UBER—. Es una marca
real de Last que Foodint no sirve, así que tu decisión (descartarla) es la buena y no
tapa ningún fallo.

**Hecho:** «van van» entra en `DISCARDED_BRANDS` con el motivo escrito. Deja de salir
en `brands_unresolved` y pasa a contarse en `brands_discarded`, que es su sitio.

## 4 · El riesgo residual que tu pregunta destapa — y que sí existía

Tu instinto era bueno aunque la causa fuera otra. Hay un camino por el que **una
cedida SÍ podría acabar descartada**, y hasta hoy era invisible:

Si el recorrido falla para un catálogo, `info.brand` **cae al NOMBRE DEL CATÁLOGO**.
Entonces pasan dos cosas a la vez, en dos sitios distintos del informe:

1. la marca de verdad no recibe ningún catálogo → sale en **`brands_skipped_empty`**,
   con toda la cara de «no tiene carta en Last»;
2. el nombre del catálogo aparece como marca fantasma → sale en
   **`brands_unresolved`**.

Y **nada dice que las dos son el mismo catálogo**. `catalogs_without_brand` no lo
caza, porque sólo cuenta las marcas VACÍAS y el último recurso la deja llena.

**Hecho:** `CatalogInfo` gana `brandFromWalk`, y el informe gana
`catalogs_brand_por_nombre` con el catálogo y el nombre que se usó como marca. Si esa
lista no está vacía, hay filas de `skipped_empty` y de `unresolved` que son la misma
cosa — y ahora se ve. Hoy sería 1: `Lobbers`, que además resuelve porque el catálogo
se llama igual que la marca.

Es la regla 7 otra vez: no se esconde, se cuenta.

## 5 · El cadáver de etiqueta, medido — y una guarda que le falta al paso ②

El §19 lo apunta de pasada. Medido, es más grande de lo que suena:

| marcas | platos activos con `external_source='lastapp'` | sin etiqueta |
|---|---|---|
| **propias** (8) | **206** | **0** |
| cedidas (9) | 283 | 24 |

**Ni un solo plato activo de una marca propia está sin la etiqueta de Last.** Los 206
son la foto de junio, de cuando las propias aún vivían allí.

**Y de ahí sale una guarda que el paso ② necesita, y que hoy no tiene:** cuando el
importador pase a upsert de verdad, lo único que distingue «esta fila es de una cedida,
Last manda» de «esta fila es de una propia, Folvy manda» **NO es `external_source`** —
las dos lo llevan a `lastapp`. Es `brand.ownership_type`.

Si el upsert se escribe filtrando por `external_source`, actualizaría filas de propias
en cuanto un identificador coincidiera, y estaría pisando lo que Julio mantiene en
Folvy: exactamente lo que la decisión 1 prohíbe. **El filtro tiene que ser por tipo de
marca, y va escrito antes de tocar una línea de upsert.**

Hoy el riesgo es bajo —las propias no están en Last, así que sus identificadores no
aparecerían— pero «hoy no coincide» no es una guarda: es una coincidencia.

## 6 · Lo que NO he tocado

**El upsert real y la marca por id no están en esta entrega.** Son el grueso del paso
② y quiero hacerlos con las dos cifras a los dos lados, no de pasada. Esto de aquí es
la comprobación que pediste, «Van Van», y la guarda de arriba, que eran cerrables hoy.

**Corrijo lo que había escrito aquí hace un momento:** dije que la pregunta de las
propias «es del camino de HubRise». Con tu §19 corregido, es falso — **HubRise es
salida, no entrada**. Para una propia no hay importación que arreglar: Folvy es la
verdad, y si un grupo nuevo no aparece es porque **no hay dónde crearlo**. O sea que la
respuesta a las propias no es una RECON de otro camino: es la pantalla del §3, el
encargo original.
