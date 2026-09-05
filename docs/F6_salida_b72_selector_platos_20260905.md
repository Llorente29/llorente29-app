# F6 · Consecuencia esperada — B72, el selector de «Definir» deja llegar a los platos

Escrito **ANTES** del push. **18:45 Madrid del 05/09/2026.**

> **No se empuja ahora.** La banda prohibida es 12:15 → 23:45 y son las 18:45.
> Este cambio vive bajo `src/`, así que el push a `main` dispara `build-apk.yml`
> y **publica bundle OTA a las tres estaciones**. Sale después de las 23:45.

---

## 1 · Qué sale

| fichero | qué es |
|---|---|
| `src/modules/kitchen/components/ModifierImpactsTab.tsx` | el selector: carga el catálogo entero, etiqueta, ordena y cierra el «Crear como nuevo» |
| `src/modules/kitchen/lib/catalogPick.ts` | **nuevo.** Las reglas puras, fuera del componente para poder probarlas |
| `tests/unit/modules/kitchen/selectorDePlatos.test.ts` | **nuevo.** 42 pruebas con las fichas y los grupos reales de Foodint |

Nada de base, nada de edge function, nada de esquema.

## 2 · Qué estaba roto, medido

Una línea: `ModifierImpactsTab.tsx`, el cargador filtraba
`r.type === 'raw' || r.type === 'recipe'`. En la cuenta hay **392 fichas**:

| tipo | total | vivas | ¿la enseñaba? |
|---|---|---|---|
| `raw` | 167 | 133 | ✅ |
| `dish` | **158** | **152** | ❌ |
| `packaging` | 63 | 55 | ❌ |
| `recipe` | 3 | 3 | ✅ |
| `tool` | 1 | 1 | ❌ |

El selector ofrecía **136 fichas vivas de 392**. Con B72 ofrece **288** (los
`packaging` y `tool` siguen fuera a propósito — ver §6).

Y había un segundo síntoma que el encargo no sabía: **los 15 impactos `bundle`
ya confirmados apuntan a un `dish`**, y `ImpactSummary` resolvía el nombre contra
esa misma lista filtrada. No lo encontraba y caía al literal `'ingrediente'`. O
sea: quince impactos correctos en la base **se pintaban «+ ingrediente · 1»**.
Eso también se arregla aquí, sin tocar un solo dato.

## 3 · Qué cambia el usuario en pantalla

1. **Los platos salen.** «Patatas Clásicas» encuentra `Patatas Clásicas Meraki`.
2. **Cada fila lleva su etiqueta**, `plato` o `ingrediente`, en el desplegable, en
   la ficha ya elegida y en el resumen del impacto ya guardado. Buscando
   «patatas» salen `Patatas Bastón` (ingrediente, 0,0022 €/g) y
   `Patatas Clásicas Meraki` (plato, 0,876 €) **visiblemente distintas**.
3. **El orden depende de lo que pregunte el grupo.** «¿Quieres acompañar con unas
   patatas?» → platos primero. «Extra Salsa» → ingredientes primero, como hoy.
   Es **solo orden**: las dos clases salen siempre (regla 7).
4. **El tope de 8 filas ahora se declara.** Si casan más, lo dice: «Y 12 fichas
   más que también casan». Antes recortaba en silencio, y con la lista al doble
   eso ya no es honesto (regla 7).
5. **«Crear como nuevo» tiene tres salidas y ninguna calla** (regla 8):
   - el nombre existe y se puede elegir → **no ofrece crear**, ofrece la que hay;
   - existe pero no es elegible (envase, utensilio, ficha retirada) → **no crea**
     y dice cuál es y por qué;
   - no existe en ninguna parte → crear, como hasta hoy.
   La comprobación va contra el catálogo **entero**, no contra lo que el
   desplegable enseña. Ésa era exactamente la trampa: cuando el filtro escondía
   la ficha, la guarda decía «no existe» y ofrecía duplicarla.

## 4 · Qué NO cambia, y conviene decirlo

- **El envase sigue sin sumar.** Comprobado en la base, no de memoria:
  `_impact_cost`, `compute_sale_line_cost` y `preview_modifier_impact_cost` **no
  mencionan `packaging_cost`** (`pg_get_functiondef ilike '%packaging_cost%'` →
  `false` en las tres). Por eso guardar `Patatas Clásicas Meraki` con 1 ud dará
  **0,876 €** y no 1,100 €. Eso es B73 y va con su medición delante.
- **Ni esquema, ni `modifier_option.recipe_item_id`, ni los cinco impactos de
  «Si, con patatas»**: los define Julio cuando esto esté vivo.
- **Los ingredientes van igual que hoy.** Está probado a propósito: en un grupo
  de ajuste el ingrediente sigue saliendo primero.
- El «crear al vuelo» sigue naciendo `raw`, sin coste y marcado «sin terminar».

## 5 · Cómo se verá si ha salido bien

- GitHub Actions: **una** ejecución de `Build & publish Android APK + OTA bundle`
  en verde, y **ninguna** de `Desplegar edge functions`.
- En «Si, con patatas» de Lovers Burgers, «Patatas Clásicas» → sale
  `Patatas Clásicas Meraki` marcada **plato**.
- Guardada con 1 ud → **0,876 €**. Si sale 1,100 €, alguien ha tocado el envase.
- Los impactos `bundle` ya confirmados dejan de decir «+ ingrediente» y dicen el
  nombre del plato.

## 6 · Riesgo residual, declarado

1. **`packaging` (63 fichas) y `tool` (1) siguen fuera del desplegable.** Es
   deliberado: un modificador «con caja extra» sería legítimo, pero meter envases
   aquí se cruza con B73, que es justo la discusión de si el envase cuenta. **Queda
   anotado como deuda**, no como olvido. Lo que sí hacen ya: frenan el duplicado.
2. **El orden se decide por palabras del nombre del grupo.** La lista sale de los
   107 nombres reales, con un veto para los que nombran el plato solo para pedir
   una parte («Escoge la base de tu bocata»). **Ese veto lo cazó la prueba, no
   yo**: mi primera lista clasificaba ese grupo como «pide un plato». Un fallo
   aquí cuesta un reordenamiento, nunca una fila escondida.
3. **Las 6 pruebas rojas de siempre siguen rojas** — `routes.test.ts` (1),
   `brandsService.mappers` (2), `salesChannelsService.mappers` (3). No son de este
   cambio: fallan igual en `origin/main`. **654 verdes de 660** (eran 612 de 618;
   las 42 nuevas son de aquí).
4. **Lint idéntico a `origin/main`**: 3 errores y 4 avisos en el fichero, los
   mismos de antes, ninguno añadido. Medido a los dos lados.
5. **La verificación en pantalla no la he hecho yo.** No tengo sesión en la app:
   los puntos 1, 3 y 4 del encargo necesitan el navegador de Julio. Lo que sí está
   probado es la regla que los decide, con las fichas reales.

## 7 · Si sale mal

El bundle anterior sigue publicado. Revertir es un push que deshaga estos tres
ficheros; `mandatory = false`, así que ninguna tablet lo coge en servicio.
