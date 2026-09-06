# F6 · Consecuencia esperada — B80: un canal sin nombre tumbaba la ficha entera

Escrito **ANTES** del push. **06/09/2026, 11:45 Madrid — fuera de la banda
12:15 → 23:45, con 30 minutos de margen.**

> ## ⚠️ INCIDENTE CAUSADO POR MI ARREGLO DE HACE UNA HORA
>
> B79 hizo que `menu_item_economics` dejara de devolver cero filas. Todo lo que
> se apoyaba —sin saberlo— en que ese cero no llegara nunca, se rompió.

---

## 1 · La causa, y NO es la del §2 del encargo

El encargo apuntaba al impacto `none` sin destino de «Solo un disco de carne», y a
la parte de pantalla de B73a. **Lo he comprobado y no es eso.** El código de
modificadores no tiene ni un `.toLowerCase()` en la ruta que pinta grupos →
opciones; `ImpactSummary` resuelve nombres con `?? 'ficha no encontrada'` y
`kindChip` devuelve `null` si no hay ficha. Un impacto `none` sin destino se pinta
bien.

**La traza sí encajaba, pero con otra pantalla.** Dos `map` anidados y una función
que baja a minúsculas son, en realidad:

`src/modules/kitchen/components/RecipeEscandalloTab.tsx`

```
2604   {group.rows.map((e) => {                    ← el map interior
2605     const Icon = channelIcon(e.channelName)   ← ybt
...
 179   function channelIcon(name: string) {
 180     const n = name.toLowerCase()              ← aquí
```

Es la pestaña **Escandallo**, que es **la que se abre por defecto** al pulsar un
plato — de ahí que reventara la ficha entera y no una pestaña concreta. Julio leyó
la traza como «grupos → opciones»; es «grupos de marca → filas de canal». Misma
forma, otra pantalla.

## 2 · Por qué llevaba meses mal sin fallar nunca

`channelIcon` declaraba `name: string` y recibía `string | null`. **El tipo mentía
desde el primer día** — y no falló nunca porque **la función no se ejecutaba
jamás**: `menu_item_economics` devolvía **cero filas** para todas las marcas de
todas las cuentas (el INNER JOIN contra `menu_item.channel_id`, vacío en las 584
filas), así que `group.rows` estaba siempre vacío y el `map` no iteraba.

Al arreglar la RPC esta mañana empezaron a llegar filas — con `channelName` a
**NULL**, porque el catálogo no tiene canal asignado. **Ningún dato es inválido.
El código lo era, y no se sabía.**

> **La lección, y es de las caras:** arreglar un cero silencioso aguas arriba
> **destapa todo lo que se apoyaba en que ese cero no llegara nunca**. Un tipo que
> nunca se ejecuta no se comprueba solo. Cuando una consulta pasa de 0 a 564
> filas, lo que hay que revisar no es la consulta: es **todo lo que la consume**.

## 3 · El arreglo

- `channelIcon` sale del componente a **`src/modules/kitchen/lib/iconoDeCanal.ts`**
  con la firma honesta `string | null | undefined`, y sin nombre devuelve el icono
  neutro (bolsa): no se afirma que sea local ni delivery, **porque no se sabe**.
  Va a `lib/` para poder probarla sin pintar nada — y porque un fichero de
  componente que exporta funciones rompe el fast refresh (lección de B72).
- Donde se pintaba el nombre del canal, ahora pone **«sin canal»** en cursiva en vez
  de dejar el hueco. Igual en `EconomiaTab`, que tenía el mismo hueco mudo.
- **3 pruebas** con los cinco canales REALES de la cuenta (Glovo, JustEat,
  Mostrador, Shop, Uber) **más el null**, que también es real y es el de hoy.

**Barrido de los demás consumidores de `menu_item_economics`**, para no dejar otro
igual: `EconomiaTab` (arreglado), `kitchenDashboardService` (agrupa por canal pero
descarta antes las filas con `netMarginPct` nulo, que hoy son todas → no llega a
leer el nombre), `menuEngineeringService` y las dos pantallas de B79 (ya
guardadas). `platformOffersService` y `priceGridService` salen de
`brand_price_grid`, que sí tiene canales reales.

## 4 · Lo que puede salir mal

- **Que el icono neutro se lea como «es Mostrador»**. Por eso el texto de al lado
  dice «sin canal» explícitamente: el icono no es la única señal.
- **Que haya un tercer sitio que no he encontrado.** El barrido es por `grep` de
  `channelName`, no por ejecución. Si aparece otra pantalla en blanco, es de esta
  familia y se arregla igual.
- **Que el §2 del encargo tuviera razón además de yo.** No lo creo —lo he mirado—
  pero si «Solo un disco de carne» sigue dando problema, es OTRO fallo y hay que
  medirlo aparte, no meterlo aquí.

## 5 · Verificación

1. Abrir **«Budapest»** → la ficha se pinta. Y los otros 7 productos del grupo.
2. En el bloque de canales de Escandallo: el icono neutro y **«sin canal»**.
3. 3 pruebas nuevas, con `null` incluido.
4. `npm run build` verde (B42). Lint **idéntico** a `main`: 1363 (1061 · 302).
