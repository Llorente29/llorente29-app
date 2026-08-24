# Los dos bugs del PR #92 — arreglados

Fecha: 24/08/2026 · Solo front. Cero migraciones. `App.tsx` sin tocar.

## Bug 1 · «sin escandallo» en todos: la fuente del coste devolvía cero filas

Tenías razón y la causa está probada. El badge no evaluaba el escandallo:
evaluaba un mapa que **siempre** llegaba vacío.

`getMenuItemEconomics(brandId)` llama a la RPC `menu_item_economics`, y ésta
hace:

```sql
FROM menu_item mi
JOIN brand b          ON b.id = mi.brand_id
JOIN sales_channel sc ON sc.id = mi.channel_id   -- ← INNER JOIN
JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
```

Ese `JOIN sales_channel` es un INNER JOIN sobre `menu_item.channel_id`. Y en la
cuenta:

```
total vivos: 513 · con channel_id: 0 · sin channel_id: 513
```

**Las 513 filas tienen `channel_id` NULL**, así que la RPC devuelve **cero
filas para cualquier marca**. El mapa `economics` estaba vacío, `econ` era
`undefined`, `marginPct` salía `null` y el badge se pintaba en todos.

### Lo que arreglo

El coste de plato pasa a leerse **directamente de `recipe_item.computed_cost`**,
en una consulta en bloque (`listRecipeCosts`), igual que los alérgenos y los
canales. Y es lo correcto por dos motivos, no solo porque funcione:

- El margen de la fila es **de plato** (precio contra coste de escandallo). Lo
  que calcula esa RPC es margen **neto por canal**: comisiones, reparto,
  licencias. Es otro número, y además uno por canal, no por producto.
- Ya no depende de un campo (`channel_id`) que en esta cuenta nadie rellena.

### El badge ahora distingue tres estados, que antes eran uno

| Situación | Antes | Ahora |
|---|---|---|
| Sin receta enlazada | «sin escandallo» | **«sin escandallo»** |
| Con receta, sin costear | «sin escandallo» | **«sin costear»** (→ Recostear todo) |
| Con receta y coste | «sin escandallo» | **barra de margen** |

### Verificado con datos reales de Meraki Pita

De **31 productos vivos: 25 con receta y coste, 6 sin receta**. Los 25 pintan
barra; los 6 dirán «sin escandallo» **con razón**. Calculado con la misma
fórmula que usa la fila:

| Producto | PVP | Coste | Margen | Barra |
|---|---:|---:|---:|---|
| Pita BOWL Pollo: El Clásico Jugoso | 14,70 € | 1,8385 € | 87,5% | verde |
| Pita BOWL Ternera | 14,90 € | 1,8721 € | 87,4% | verde |
| Plato Mixto Gyros | 12,90 € | 1,6694 € | 87,1% | verde |
| The Spanakopita Twist | 9,90 € | 1,3941 € | 85,9% | verde |
| Patatas Clásicas Meraki | 5,50 € | 0,8229 € | 85,0% | verde |

### 🔴 Un aviso que sale de mirar esos números

**Esos márgenes son sospechosamente altos.** 87% de margen es un food cost del
12,5%, cuando lo normal en restauración está entre el 25% y el 35%. O los
escandallos de Meraki Pita están incompletos (les faltan ingredientes), o algún
coste de compra está por debajo de lo real. La pantalla ahora dice la verdad de
lo que hay en la BBDD; lo que hay en la BBDD conviene revisarlo. **No lo toco:
es tu dato, no mi bug.**

### El mismo fallo estaba en el header

El «margen medio» del header bebía del mismo mapa vacío, así que **salía «—»
siempre**. Ahora usa la misma fuente que la fila.

Y de paso: la columna de salud del escritorio pintaba `coste … · margen … · FC …`
dentro de un `{econ && …}`. Como `econ` nunca existía, **ese renglón no se ha
visto nunca**. Ahora enseña coste y food cost reales.

He retirado de esta pantalla la llamada a `getMenuItemEconomics`: era una
petición por cada cambio de marca que devolvía siempre cero filas. Sigue usándose
en la ficha del producto, donde el margen por canal sí es lo que se busca.

## Bug 2 · El visual: tenías razón, la elevación no estaba

No es Tailwind. Comprobado: `tailwind.config.js` usa `theme.extend.colors`, así
que la paleta por defecto **no** se sustituye y `emerald`/`amber`/`red` existen
en el build. **La causa es más simple: no lo implementé.** Puse `hover:bg-page`
—un cambio de fondo— y di por hecho el §2.5 sin escribirlo.

Lo que entra ahora:

- **Elevación real en hover**: la fila sube a `--shadow-md` con transición de
  150 ms y `z-10` para que la sombra no la recorte la fila de al lado. La tarjeta
  de la categoría descansa en `--shadow-sm`. Los dos niveles del §2.5.
- **Aire**: `py-4` en filas (era `py-3`), `px-5`, `gap-4`, y `mb-8` entre
  categorías (era `mb-6`).
- **Tipografía**: el nombre pasa a `15px semibold` (era `14px medium`); el
  precio, a `15px semibold` con `tabular-nums` y columna más ancha.
- **Badge Top 3 con fondo tinta** y texto sobre acento, como la maqueta — antes
  lo puse verde menta, que no era lo pedido.

## La maqueta que citas no está

`maqueta_gestor_menus_premium.html` **no existe en el repo ni en el disco de
esta sesión** — la busqué en todo el sistema de ficheros. Como el encargo de
ayer, llegó como salida de conversación, no como fichero. **No he podido
comparar contra ella**: lo que he hecho es aplicar el §2.2 y el §2.5 al pie de
la letra. Si la subes al repo, la contrasto punto por punto.

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint **6 avisos = los 6 del
baseline exacto** · tests `6 failed | 239 passed`, idéntico a `main`.

Sigue sin poder verificarse desde aquí lo visual en vivo: este entorno no abre
navegador contra producción. Lo que sí está comprobado contra datos reales es
**qué números va a pintar**, que es lo que fallaba.
