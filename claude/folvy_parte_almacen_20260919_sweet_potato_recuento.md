# PARTE DE ALMACÉN · Un recuento que miente: Sweet Potato Fries

**19/09/2026.** Sale de la revisión de los formatos de compra. **Es un dato que
hay que corregir, no código.** Aquí no se arregla nada: se deja escrito con la
base delante para que lo corrija quien toca almacén.

## La frase, que es lo que importa

> **Hoy, en el recuento, «Sweet Potato Fries» se cuenta en bolsas de 2,5 kg que
> no existen. Quien cuenta ve bolsas de 2 kg. Cinco bolsas reales se apuntan
> como 12,5 kg cuando son 10.**

## Lo medido

Cuenta **Foodint** (`51ad1792-6629-4ef7-833a-b57b09a86710`) — regla 9: sin
`account_id` la cifra no sería de nadie.

| | |
|---|---|
| Artículo | **Sweet Potato Fries**, se gasta en **g** |
| Lo que dice el proveedor | Cloudtown, ref `220202001`: **«BONIATO BASTON CAJA 5 BOLSAS DE 2 KG CONG»** |
| Lo que hay guardado | **Caja 10.000 g = 4 × Bolsa de 2.500 g** |
| El otro proveedor | Coheldi, «BONIATO 11X11 PREFRITO MCCAIN», mismo árbol: Caja 10.000 g = 4 × 2.500 g |
| Y lo que lo hace grave | ese formato tiene **`use_in_count = true`** |

El **total no miente**: 4 × 2.500 y 5 × 2.000 son los mismos 10.000 g, y por eso
el coste por gramo está bien y el sello «No cuadra» no salta (y hace bien en no
saltar: no es el formato el que está mal, es el desglose).

**Lo que miente es el desglose, y el desglose es justo lo que se usa para
contar.** El operario abre el recuento, ve «Bolsa», cuenta bolsas físicas de
2 kg y Folvy las multiplica por 2.500.

## El error, con números

| bolsas contadas | lo que hay de verdad | lo que apunta Folvy | desvío |
|---|---|---|---|
| 1 | 2.000 g | 2.500 g | +25 % |
| 4 | 8.000 g | 10.000 g | +2 kg |
| 5 | 10.000 g | 12.500 g | +2,5 kg |

Siempre **+25 % de stock fantasma** en este artículo. Y como el recuento
aprobado es el corte con el que se reprocesa el consumo (regla 6), el error no
se queda en la foto: ancla lo que venga detrás.

## Qué habría que corregir

1. **El desglose del árbol**: `qty_per_parent` 4 → **5**, y el contenido de la
   pieza 2.500 → **2.000 g**. El total de la caja (10.000 g) **no cambia**, que
   es lo que permite corregirlo sin mover ni un coste ni un movimiento.
2. **Ojo con la guarda**: `trg_recipe_item_purchase_format_immutable` bloquea
   cambiar `qty_in_base`. Aquí el de la CAJA no cambia (sigue 10.000), pero el
   de la PIEZA sí (2.500 → 2.000), y esa pieza puede tener movimientos. Si los
   tiene, no se edita: se archiva y se crea la versión nueva, que es lo que
   hace `archiveAndReplacePurchaseFormat` y lo que explica ahora la pantalla C.
3. **Antes de tocar nada, mirar qué recuentos ya aprobados lo usaron**, porque
   esos ya están anclados con el número inflado y corregir el formato no los
   corrige hacia atrás.

## Cómo se confirma antes de aplicar

```sql
-- 1 · el árbol de hoy, con la cuenta
select f.id, f.name, f.qty_in_base, f.qty_per_parent, f.use_in_count,
       p.name as pieza, p.qty_in_base as contenido_pieza
from recipe_item_purchase_format f
join recipe_item ri on ri.id = f.item_id
left join recipe_item_purchase_format p on p.id = f.parent_format_id
where ri.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and ri.name = 'Sweet Potato Fries'
  and f.is_active and f.archived_at is null;

-- 2 · ¿tiene movimientos la PIEZA? (si sí, se archiva y se sustituye)
select public.purchase_format_has_stock_movements('<id de la Bolsa de 2.500>');

-- 3 · qué recuentos ya aprobados lo contaron con el número inflado
--     (los de antes NO se corrigen solos: quedan anclados)
```

## De dónde salió

De cruzar el texto del proveedor con el formato guardado mientras se escribía la
regla «No cuadra» (encargo de formatos, 19/09). **La regla no lo sella**, y hace
bien: el total cuadra. Esto solo se ve mirando el desglose contra la frase del
proveedor, y hoy no hay ningún vigía que lo mire.

**Detector para la próxima:** si el texto del proveedor dice «CAJA **N** X DE
**M**» y el árbol guardado dice otro par (N', M') con N×M = N'×M', el coste está
bien y **el recuento está mal**. Son dos cosas distintas y solo una salta.

## Lo que NO se ha hecho

Nada. Ni una escritura. Esto es un parte, y lo ejecuta quien toca almacén.
