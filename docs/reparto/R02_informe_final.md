# R02 · Quién reparte · Informe final

Encargo: `docs/reparto/encargo_R02_quien_reparte.md` · Respuesta 1: `docs/reparto/R02_respuesta_1.md`.
Nada se ha aplicado en producción. Allí solo he leído (SELECT). Los interruptores de Lovers y Smash siguen como estaban.

## 1. Qué cambia, en una frase

Quién reparte deja de ser un interruptor por marca y pasa a ser **una celda por marca × plataforma** (× local si
hace falta), con **una sola resolución** (`resolve_delivery_by`: local → marca → «Si no dices nada» del local →
«Si no dices nada» de la cuenta → plataforma). La leen la entrada del pedido (HubRise y Last), el despacho, el
vigía, la métrica de direcciones, la rejilla de precios y los dos feeds de la cocina.

## 2. Capturas

En `docs/reparto/capturas/r02/`, junto a la maqueta v2 (`docs/reparto/maquetas/r02/R1Reparto.png`):

- `quien-reparte-ordenador.png` · `quien-reparte-movil.png` — la pantalla.
- `cocina-ordenador.png` · `cocina-movil.png` — la etiqueta en la tarjeta del pedido (ámbar y gris, nada rojo del reparto).
- `COMPARACION.md` — las diferencias con la maqueta, una a una, y por qué.

Las hace el e2e en staging-conta con datos inventados, y se rehacen en cada ejecución.

## 3. Resultados de las pruebas

| Prueba | Dónde | Resultado |
|---|---|---|
| Unitarias, todo el repositorio | `npx vitest run` | **139 ficheros, 2065 pruebas, verde** |
| · de reparto | `tests/unit/modules/reparto/` | 18. La resolución se prueba contra la configuración REAL de Foodint (54 celdas): **0 diferencias** |
| Cero diferencias, simulando con la misma función antes y después | staging, `20261005_r02_prueba_cero_diferencias.sql` | HubRise **72/72 iguales**. Last: 51 cambian **a propósito** (decisión 2: la regla nueva vale también para Last). `service_type` = resolución en todos |
| Resolución: capas, R01, RLS, entrada del pedido | staging, `…_prueba_resolucion.sql` | 21 comprobaciones, verde |
| Sugerencia de Folvy | staging, `…_prueba_sugerencia.sql` | «Pita del Sur · uber · 7A1F1, 7A1F2, 7B000», verde |
| Feeds de la cocina | staging, `…_prueba_feeds.sql` | 7B000 = own/true, 7B001 = platform/false, verde |
| Vuelta atrás completa | staging, `…_prueba_vuelta_atras.sql` | Las guardas paran cuando deben. Todas las vueltas atrás corren. **md5 de las 8 funciones = producción**. Acaba en ROLLBACK |
| Rejilla de precios | producción, solo lectura | 198 combinaciones. **Ningún precio cambia**. Cambian 12 `policy_allowed`, todas de Smash y Lovers, que es lo que se quería |
| Filas migradas | producción, solo lectura, Foodint | 54 celdas (21 «Nosotros», 33 «Plataforma»), **0 diferencias** con la regla de Julio |
| E2E | staging-conta, Playwright, ordenador y móvil | Verde (ver §6): pantalla, guardar y Deshacer, cocina ámbar/gris sin rojo, cambiar desde la etiqueta, cuenta B sin ver ni tocar A, sugerencia «No» |

## 4. Ficheros SQL, en el orden de aplicación

**De noche** (fuera de 12:15–00:30): la 0120 cambia funciones que están en el camino del pedido (el disparador de
entrada y `resolve_dispatch`).

| # | Fichero | Qué hace | Analizador del workflow |
|---|---|---|---|
| 1 | `20261005T0100_r02_brand_delivery_policy.sql` | Tabla, RLS y `resolve_delivery_by` | sigue |
| 2 | `20261005T0110_r02_filas_migradas.sql` | Una fila por celda que reproduce el interruptor (`migrated`, «del interruptor antiguo») | sigue |
| 3 | `20261005T0120_r02_lectores_de_la_resolucion.sql` | Los 5 lectores + los 2 feeds pasan a la resolución | **PARA** (reemplaza funciones de Cocina) |
| 4 | `20261005T0130_r02_guardar_celdas.sql` | Las funciones con las que guarda la pantalla (incluye el arreglo R01) | sigue |
| 5 | `20261005T0140_r02_sugerencia_ia.sql` | Sugerencia de Folvy y su registro | sigue |

**Aparte, cada uno con su visto bueno:**

| # | Fichero | Cuándo | Analizador |
|---|---|---|---|
| 6 | `20261005T0210_r02_saneado_pedidos_abiertos.sql` | Justo después de la 5, en la misma noche | **PARA** (`update` sobre `sale`) |
| 7 | **`20261005T0200_r02_elimina_interruptor_antiguo.sql` — el de ELIMINACIÓN** | **Después** de fusionar el front y con Vercel en READY | **PARA** (borra columna y función) |

La 7 lleva su guarda: se para si queda alguna función que lea `own_delivery_enabled` o llame a
`marca_reparte_propio`. Antes de borrar, guarda los valores en `r02_interruptor_antiguo`.

Vueltas atrás, en `supabase/vuelta-atras/`, en orden **0210 → 0200 → 0140 → 0130 → 0120 → 0110 → 0100**. Las de
0100, 0110 y 0120 llevan su `.down.guarda.sql`. Todas probadas en staging (§3).

**Orden de la puesta en marcha:**
1. 1–5 de noche.
2. 6 el saneado.
3. Fusión del front, comprobada en Vercel READY.
4. 7 la eliminación.

El front necesita que existan las funciones de la 4 y la 5. Fusionarlo antes deja la pantalla sin poder guardar.

## 5. Lista de pedidos saneados

La da la propia 0210 al aplicarse: sale la lista de qué pedido cambia y a qué, y lo de antes queda en
`r02_saneado_registro`. Solo toca pedidos **vivos** de HubRise y Last. No toca las 72 ventas «abiertas» que ya
terminaron. En staging cambió lo esperado: 7B000 perdió la alarma roja (sigue «Nosotros», sin dirección → ámbar)
y 7B001 pasó de «Nosotros» a «la reparte Glovo». Los 13 de Uber en rojo y los 431 de la comprobación previa
entran ahí si siguen abiertos al aplicar. La lista de verdad es la de esa noche, no una de hoy.

## 6. Lo que salió en el camino (ya corregido)

- **Los feeds de la cocina llamaban a `marca_reparte_propio`.** No estaba en el encargo. Si se hubiera borrado la
  función, la cocina se habría quedado sin pedidos. Lo arregla la 0120, que solo cambia esa expresión; la guarda
  de la 0200 busca también a quien llame a la función. En staging pasó, y en producción no se tocó nada.
- **La guarda de la 0200 paró en staging** porque un comentario de `resolve_dispatch` nombraba la columna. Quité
  la mención del comentario.
- **La primera ejecución e2e** cazó que la sugerencia de Folvy quedaba a 0 de ancho en la columna de 360 px.
- **Las capturas** cazaron dos defectos más: celdas pegadas con el «!» tapado, y la opción marcada cortada
  («Platafor…»). Los dos corregidos y medidos con la letra de verdad. De paso: las columnas ya cuadran entre
  filas, y en pantallas de 1000 a 1280 px la columna de la derecha baja debajo de la tabla, porque si no la tabla
  se cortaba.
- **La vista previa de Vercel de esta rama habría ido contra producción**: no tenía variables propias y cogía
  las generales. Creé las dos de la rama (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` de staging-conta, solo
  `preview` y solo `reparto-r02-marca-plataforma`), como en el C00 y el C01.

## 7. Pendientes (fuera del encargo, sin tocar)

1. **El workflow de producción no tiene cómo autorizar un fichero que PARA.** El R02 tiene tres (0120, 0210 y
   0200). Hace falta un mecanismo con dos cerrojos, como el de la prohibida: nombrar el fichero y escribir su
   nombre entero. Sin eso, esos tres no se pueden lanzar desde el workflow.
2. **`tg_auto_dispatch` lleva escrita la URL de producción de `catcher-dispatch`.** En staging dejé los locales en
   despacho `manual` para que un pedido de prueba no llame a producción. Hay que sacarla a configuración.
3. **`hubrise-webhook` (la prohibida) no se toca.** Sigue leyendo `channel_delivery_policy` para su primera
   suposición, y el disparador de entrada la corrige con la resolución. Funciona, pero hay dos sitios que deciden.
   Unificarlo es pasar por la puerta, otro día.
4. **Marcas propias en Last.** Last manda su `pickupType` y la regla nueva lo pisa con la celda. Hoy las 2.662 de
   Last son de cedidas; si una propia entra por Last, manda la celda. Es lo decidido (decisión 2), pero conviene
   vigilarlo la primera semana.
5. **Las 72 ventas de Foodint en `status='open'` que ya terminaron** (desde el 15/08).
6. **`types/database.ts`** sigue listando `own_delivery_enabled` hasta que se aplique la 0200 y se regeneren los tipos.
7. **El repositorio es público.** El PR #140 sale en un buscador público (visto al hacer el contraste). Hay que
   pasarlo a privado tras revisar `docs/` y `claude/`; ya estaba apuntado del C00.
8. **staging-conta aparece «Unhealthy»** en Supabase (apuntado del C00, sin mirar aún).
9. **La cabecera de Pedidos en el móvil** se monta: los botones de sonido y refrescar tapan «Pedidos». Ya estaba así.
10. **Agentes del C00:** cada noche saldrán en rojo mientras la empresa de prueba de la cuenta B de staging tenga la
    ficha incompleta (modelo 200 y depósito). Son datos inventados.

## 8. Contraste

`docs/reparto/R02_contraste.md`: Otter, Deliverect y Last. Tres cosas que hacen mejor y cuatro que hacemos mejor,
con fuentes.

## 9. Lo siguiente es tuyo

1. Abrir la vista previa de la rama:
   `https://folvy-app-git-reparto-r02-marca-plataforma-llorente29s-projects.vercel.app`, con
   `a.admin@prueba.folvy.test` (cuenta A de las semillas; la clave, la de siempre de staging).
2. **Antes de tocar nada, mirar la franja de arriba**: tiene que decir «base de pruebas staging-conta». Si dice
   otra cosa, no se toca nada. Yo comprobé la configuración (las dos variables de la rama), no el JS publicado.
3. Ajustes › Quién reparte, y Folvy Orders › Pedidos con el local Norte Centro.
4. Después, ensayo y real en el orden del §4, y la fusión.
