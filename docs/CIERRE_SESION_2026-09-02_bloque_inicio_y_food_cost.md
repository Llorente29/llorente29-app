# ACTA — 02/09/2026 · Bloque «las cuatro del dinero» y lo que salió de ellas

**Rama:** `claude/inventory-count-false-shrinkage-2b4jbp` · **10 commits** ·
`bc96e71c` → `17ee748e`

> **Cómo leer esta acta.** El 02/09 por la mañana este proyecto se llevó una
> lección con nombre propio —«El acta que afirmó más de lo que había»— porque un
> commit declaró arreglado algo que era un no-op. Así que aquí cada afirmación
> lleva **cómo se comprobó**, y lo que no se comprobó se dice. Lo que quedó
> abierto está en §5, no escondido entre lo hecho.

---

## 1 · LO QUE SE CONSTRUYÓ

**El mosaico del Inicio queda en 20 tarjetas de 21.** Las cuatro del bloque del
dinero: *Food cost medio*, *Margen del mes*, *Vendido sin coste* y
*Liquidaciones CTB*.

La que falta es **«Puntos de pedido»**, y falta **a propósito** (frente 10): el
punto lo calcula el sistema desde el consumo, y el consumo fiable empieza el
30/07. Con cinco semanas de histórico saldría una media de agosto disfrazada de
criterio. Está escrito en `p2Cards.ts` y en el fichero de frentes para que quien
la coja sepa que coge un frente, no una tarjeta.

**Estado de las tarjetas al cierre** (Foodint, 30 días, leído de la RPC):

| | |
|---|---|
| Food cost medio | **22,3 %** · cobertura 95,2 % (96,6 % del dinero) · **0 marcas marcadas** |
| Margen del mes | septiembre en curso, sin delta (regla 2 del espejo) |
| Vendido sin coste | cobertura 91,7 % · 7.490 € sin costear |
| Liquidaciones CTB | 3 documentos, los tres de junio · **2 meses cerrados sin liquidar** |

---

## 2 · LO QUE SE APLICÓ EN LA BASE — siete migraciones, todas verificadas por EFECTO

Regla 12, estrenada esta noche: se comprueba el estado, no que el comando pasara.

| Migración | Qué hace | Verificado con |
|---|---|---|
| `…T2100_home_vendido_sin_coste` | RPC nueva de la tarjeta | `has_function_privilege`: `authenticated` sí, `anon` no · 1 firma |
| `…T2200_food_cost_denominador_por_unidad` | Food cost por unidad de venta | Antes/después de las 4 claves y de `by_brand` |
| `…T2300_f0_5_cerrar_grants_tablas_sin_rls` | `revoke` sobre 13 tablas + 2 | `has_table_privilege` antes y después + guarda `do $$` que aborta |
| `…T2310_food_cost_ingreso_total_en_salud` | La prueba en euros de la cobertura | 73.573/76.181 = 96,6 %, la cifra que acompaña |
| `…T2320_retirar_list_costless_sold_products` | Retira la función que decía cero | Guarda antes del `drop` · después: **0 firmas** |
| `…T2330_bandera_sospechosa_umbral_40` | Umbral alto 60 → 40, provisional | 68 observaciones · 1 bandera · máximo 33,1 % |
| `…T2340_barrido_ve_los_combos` + `…T2345` (ids) | El barrido ve los combos y publica | Ejecutado el propio barrido: 181/181/299 |

**Comprobación final, esta noche, de las cuatro a la vez:**

```
home_vendido_sin_coste           1 firma        food_cost_dashboard      1 firma
list_costless_sold_products      0 firmas ✔     umbral > 40              true ✔
sale_line_cost_sweep  →  TABLE(examinadas, reparadas, rechazadas) ✔
anon lee _backup_permission_sets_20260814 ........... false ✔
authenticated escribe social_n2_usage .............. false ✔
anon ejecuta home_vendido_sin_coste ................ false ✔
```

---

## 3 · LAS CINCO MEDIDAS QUE CAMBIARON UNA DECISIÓN

Esto es lo que de verdad pasó esta noche. No fue construir cuatro tarjetas.

### 3.1 · La función que se llamaba igual que el problema y devolvía cero
`list_costless_sold_products` iba a ser la fuente de «Vendido sin coste».
Devolvía **0 filas** habiendo **118 productos y 11.522 €** vendidos sin costear:
exige que el `recipe_item` enlazado no tenga coste, y el agujero está un paso
antes. **No fallaba: aprobaba.** Se midió antes de cablearla. Retirada.

### 3.2 · El `where` que habría bajado el food cost 4,6 puntos
El frente 14 —escrito por mí— proponía quitar las líneas de modificador y combo
del denominador. Medido antes: **27,4 % → 22,8 %**, porque 1.411 de esas líneas
aportan **2.880 € de coste real**. Un cambio que baja el food cost dice que el
negocio va mejor de lo que va.
**El fallo real era otro:** un combo pone su precio en la línea PADRE (581 de
605 combos, 13.229 €) y su coste en las HIJAS. La función metía el coste de las
hijas en el numerador y tiraba el ingreso del padre del denominador.
**27,4 % era 22,3 %**, y por marca hasta **46,3 % → 18,9 %**.

### 3.3 · El motor que ya estaba escrito
El frente 16 —también mío— pedía construir el motor de combos. `compute_sale_line_cost`
**ya suma los componentes y escribe el total en el padre**. Lo roto era el
reparador nocturno: su `join recipe_item` tira a los combos, porque un combo no
tiene receta propia. **Un `where`, no un motor.**

### 3.4 · Las 606 que no eran 131
Al medir el alcance antes de escribir: no 131 líneas sino **606**, en **tres
cuentas**, hasta el **07/06**. Y **598 de ellas (98,7 %) se costearían con una
receta tocada después de la venta**, sin `recipe_item_version` con el que
hacerlo bien (0 filas). Decisión de Julio: **solo lo reciente y arreglo hacia
delante**. 133 reparadas, **473 antiguas intactas**.

### 3.5 · La bandera que no podía sonar
Al desaparecer las marcas «sospechosas» la tentación era celebrarlo. Julio pidió
probarla. **68 observaciones, máximo 33,1 %, listón en 60**: muerta. Bajada a
**40 %, declarada provisional en el propio SQL**, con la dependencia de A7
nombrada — el día que exista `target_food_cost_pct`, el umbral pasa a ser
relativo y deja de envejecer solo.

---

## 4 · LO QUE SE CORRIGIÓ DE LO YA ESCRITO

**Dos frentes míos tenían la medida bien y la conclusión invertida** (14 y 16).
De ahí sale la **regla 11**: un frente que propone un arreglo lleva medida su
consecuencia; sin ella no está terminado, está apuntado.

**Dos herramientas dejaron de servir como prueba** — están en una caja al
principio de `folvy_frentes_abiertos.md`:

1. **`pg_stat_statements` no ve dentro de las funciones** (`track = 'top'`).
   Demostración: 173 incrementos de `claim_n2_budget` que no aparecen. Tumba una
   frase de mi propio RECON del frente 19.
2. **Los contadores de `pg_stat_user_tables` no cubren la vida de la base.**
   Demostración aritmética: 40 filas con `n_tup_ins = 6`. Tumba «`n_tup_upd = 0`,
   luego nadie ha escrito nunca», que estaba en la lista maestra.

**`tsc --noEmit` no comprueba nada aquí** y la regla ya estaba escrita desde el
PR #47: la repetí. Añadido `npm run typecheck`. Los **once documentos de agosto**
que declaran «`tsc --noEmit` limpio» quedan anulados por una línea en el fichero
de reglas — **no se reescriben**.

**Regla 12**, de las tres órdenes que salieron verdes sin cumplirse esta noche
(despliegue, `--noEmit`, `REVOKE` sin ser concedente) más la cuarta ya conocida
(el editor SQL de Supabase): **se verifica el efecto, nunca que el comando pasó.**

---

## 5 · LO QUE QUEDA ABIERTO — y no está entre lo hecho

| # | Qué | Estado |
|---|---|---|
| **B44 / f.22** | El food cost del pasado **se reescribe solo**: agosto, 71,7 % de las líneas movidas, **−5,46 %**. El agregado engaña (99 €, 0,6 %) por compensación entre poblaciones distintas | Medido. Bloqueado por `recipe_item_version` a 0 filas |
| **f.16c** | **299 rechazadas** = cola de Casado. Hoy solo salen por `cron.job_run_details` | Falta la pantalla |
| **f.16c** | **473 líneas padre** anteriores a la ventana | Intactas a propósito |
| **B43 / f.23** | `social_n2_usage` es un contador mutable: no se puede auditar | Puerta cerrada; la forma, no |
| **B45 / f.24** | `spatial_ref_sys`: **desde este rol no se puede** revocar | Grant inerte (4 funciones `SECURITY DEFINER`) |
| **A7** | `kitchen_settings.target_food_cost_pct` sin fila para Foodint | Ahora tiene consumidor: el umbral del 40 % |
| **f.10** | «Puntos de pedido» | Aplazada hasta 2-3 meses de histórico |
| **f.18** | Las tres pantallas de Ventas no leen la URL | Drills sin filtro de local, a propósito |
| **f.13** | 16 `no-explicit-any` en `ventas/services` | Deuda medida, sin tocar |

**Y una pregunta que no tiene respuesta y no la va a tener:** ¿alguien manipuló
el contador de `social_n2_usage`? **No hay evidencia de que sí, y no se puede
demostrar que no.** Sin trigger de auditoría ni histórico de fila, un `UPDATE`
malicioso y un incremento del agente son la misma operación.

---

## 6 · CRITERIO F2 — la banda, escrita antes de volver a usarla

Julio paró a mitad de bloque porque estaba aplicando la ventana de despliegue
por corazonada. Queda en el registro de excepciones:

> **La banda protege LA OPERACIÓN** —edge functions, front que llega a tablets y
> TPV, publicación de cartas, cocina, pedidos, escaparate—. **Los informes no son
> la operación.** Una migración que solo redefine una función sin consumidor
> operativo, y un `revoke` sobre objetos que nadie lee, quedan fuera —
> verificados antes y después, **decididos antes del cambio**, anotados en el
> registro. **Nunca argumentados a posteriori.**

Las siete migraciones de la noche se decidieron bajo ese criterio y están
anotadas allí con su justificación.

---

## 7 · VERIFICACIÓN DE CIERRE

```
Working tree ........................ limpio
Rama ................................ claude/inventory-count-false-shrinkage-2b4jbp
Sincronía con origin ................ 0 / 0
Commits del bloque .................. 10  (bc96e71c → 17ee748e)
npm run build ....................... ✓ built in 10,60 s   (exit 0)
npm run typecheck  (tsc -b) ......... ✓                    (exit 0)
Pruebas ............................. 622 pasan / 628
```

**Los 6 rojos son PREEXISTENTES y ajenos a este bloque:** 5 de mapeadores de
`multitenancy` (`brandsService`, `salesChannelsService`) y 1 de `routes.test.ts`.
Estaban rojos al empezar y siguen igual; **no se han tocado y no se han
arreglado**, y se dicen aquí para que nadie los cuente como daño de esta noche
ni los dé por resueltos.

**Lo que NO se ha verificado, y se dice:** ninguna de las cuatro tarjetas se ha
visto renderizada en un navegador. La comprobación ha sido de tipos, de pruebas
unitarias, de build y de las RPC contra la base. **La pantalla no se ha abierto.**

---

## 8 · POR AQUÍ SE EMPIEZA LA PRÓXIMA

1. **B44** — decidir si se llena `recipe_item_version`. Sin eso, el food cost de
   cualquier mes cerrado seguirá moviéndose solo y nadie podrá reconstruirlo.
2. **Las 299 rechazadas a la pantalla de Casado.** El número ya existe; falta
   dónde se lee.
3. **A7** — el objetivo de food cost por cuenta, que convierte el umbral
   provisional en uno que no envejece.

Lo demás está en `claude/folvy_frentes_abiertos.md`, con la caja de las dos
herramientas al principio. **Leerla antes de medir nada.**
