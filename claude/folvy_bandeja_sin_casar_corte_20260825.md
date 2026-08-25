# La bandeja de productos sin casar ya existía — lo que le faltaba era el corte

25-08-2026

## Lo que iba a hacer y por qué no lo hice

El encargo pedía construir una pantalla nueva, "Productos sin catalogar", con
impacto en euros, sugerencia automática, selector manual, "No es un producto",
"crear producto" y enlace al escandallo.

El RECON encontró que esa pantalla ya está en producción:

**Cocina → Cartas → casado de ventas** (`SalesExceptionsPage.tsx`, 1.451 líneas).

Y ya tiene, una por una, las piezas del encargo:

| Pedido en §2.2 | Estado |
|---|---|
| Impacto en euros por producto | ya (`BlindProduct.totalEur`, ordenado desc) |
| Sugerencia automática | ya (`suggestMatch`, con semáforo verde/ámbar) |
| Selector manual | ya (desplegable de candidatos, `doClassifyToTarget`) |
| "No es un producto" | ya (`ignore` / `delist` con motivo obligatorio) |
| Crear producto | ya (`create_dish_from_unmapped`, con anti-duplicado) |
| Enlazar / crear escandallo | ya (navega a `/kitchen/recetas?recipe=…` al crear) |

Construir una segunda bandeja habría duplicado 1.451 líneas y, peor, habría
dejado viva la primera. Así que el trabajo es el otro: lo que le falta.

## Lo que le faltaba: el corte

Tres botones de esa pantalla reprocesaban ventas sin ventana temporal.

```
resolve_unmapped_sales    → recast_lastapp_sales(cuenta) → TODAS las ventas
unignore_unmapped_sales   → recast_lastapp_sales(cuenta) → TODAS las ventas
create_dish_from_unmapped → reprocess_sale de todas las de ese producto
```

`create_dish_from_unmapped` se acotó el 28/07 — pero por *timeout*, no por
conteos. Nunca miró un conteo aprobado.

Medido hoy en Foodint:

```
ventas lastapp con raw_products ......... 7.197
por debajo del ultimo conteo aprobado ... 7.042   (195.185,32 €)
por encima del corte ....................   155
```

Es decir: quien pulsara "casar" en oficina le pasaba por encima a 98 conteos
aprobados y regeneraba consumo que un conteo físico ya había corregido. Es
exactamente A3 (641 ventas) a escala 11x, con la diferencia de que A3 lo lancé
yo a sabiendas y esto lo dispara cualquiera desde un botón.

`ignore` y `delist` sí eran inocuos: la función original sale con `RETURN`
antes del recast en esos dos casos. Verificado en `prosrc`, no supuesto.

## Lo que hace la migración

`20260825T2400_casado_ventas_corte_conteo.sql`. **Envuelve, no reescribe.**
Las tres funciones originales conservan su contrato exacto; al lado nacen tres
hermanas con corte, y la pantalla apunta a las hermanas.

```
_reprocess_product_sales_scoped   el corte, en un solo sitio
_create_dish_from_unmapped_core   el alta, extraida del bucle
resolve_unmapped_sales_scoped     ya existia; ahora usa el helper
create_dish_from_unmapped_scoped  nueva
unignore_unmapped_sales_scoped    nueva
```

El corte es el mismo que aplica `apply_inventory_count`: una venta anterior al
último conteo aprobado **de su local** no se toca.
`p_include_before_last_count = true` abre la puerta a quien sepa lo que hace.

Los dos helpers privados quedan revocados de `PUBLIC`, `anon` y `authenticated`
(mismo blindaje que `_resolve_unmapped_link_core`), y el helper del corte lleva
su propio guard de tenancy aunque sea privado.

## Verificación

Contrato preservado — la original y la hermana, sobre el mismo producto, con el
anti-duplicado disparando (por tanto sin mutar nada):

```
fn         creado  candidato                        similitud  repro  prot  eur
original   false   Quesatacos Birria de Pollo (DC)  0.61       —      —     —
scoped     false   Quesatacos Birria de Pollo (DC)  0.61       0      0     0
```

Lo que el corte protege, en los 6 productos de más peso de la bandeja:

| producto | € (30d) | ventas | protegidas | reprocesa | € protegidos |
|---|---:|---:|---:|---:|---:|
| QUESATACOS DE BIRRIA DE CERDO DC | 1.645,76 | 283 | 278 | 5 | 4.314,56 |
| PACK PA 2 (DC) | 1.391,90 | 54 | 50 | 4 | 2.289,90 |
| Birria + Tequeños (AMB) | 934,80 | 62 | 61 | 1 | 1.527,60 |
| Menú Doble Big Mikes (BM) | 683,70 | 73 | 68 | 5 | 1.240,20 |
| QUESABIRRIA DE POLLO (DC) | 625,50 | 190 | 189 | 1 | 2.696,60 |
| Burrito de cochinita (BB) | 567,60 | 88 | 84 | 4 | 1.302,90 |

Permisos, después:

```
_create_dish_from_unmapped_core   authenticated=false  anon=false
_reprocess_product_sales_scoped   authenticated=false  anon=false
_resolve_unmapped_link_core       authenticated=false  anon=false
create_dish_from_unmapped_scoped  authenticated=true   anon=false
resolve_unmapped_sales_scoped     authenticated=true   anon=false
unignore_unmapped_sales_scoped    authenticated=true   anon=false
```

## En pantalla

Al casar o crear, la pantalla dice lo que ha movido y lo que no:

> 5 ventas recalculadas. 278 anteriores al último conteo no se han tocado
> (4.314,56 €): ese stock ya lo corrigió un conteo físico.

Y al crear un plato, encadena con el cuello real: *"Ahora, el escandallo."* —
porque un plato recién creado sin receta sigue consumiendo cero.

## Lo que queda fuera y por qué

**`seedAndRecast` (admin → sembrar catálogo + recasar)** sigue llamando a
`recast_lastapp_sales` sin corte. Es el único camino que queda, y es
deliberado: su trabajo *es* recastear la cuenta entera después de sembrar el
catálogo, en alta de cliente. Ahí no hay conteos que proteger todavía. Pero si
alguien lo pulsa sobre Foodint hoy, reprocesa esas mismas 7.042 ventas.
Queda medido y anotado; tocarlo es decisión de Julio, no mía.

**Casar sin matrícula** (ingesta por nombre normalizado): deuda declarada,
descartada por Julio — 2 productos no justifican tocar la ingesta en tiempo
real, donde casar mal contamina ventas en el momento.
