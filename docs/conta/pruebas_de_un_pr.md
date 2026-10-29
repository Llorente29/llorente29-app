# Qué e2e lleva un PR

> Regla de Julio, 26/10/2026, metida en el #340. Sustituye a la del W04
> (22/10), «la entera si toca lo común». Vale para todas las sesiones: A, B, C,
> D y Claude Code.

## La regla

**La entera no corre en ningún PR, nunca.** Corre solo de noche sobre `main`
(03:00 de Madrid) y cuando Julio pone la etiqueta `e2e-entera` en un PR.

En cada push de un PR corre esto (`scripts/e2e/area.mjs`, `queCorre`):

| Qué toca el PR | Qué corre |
|---|---|
| Siempre | Su **zona**: la carpeta de su rama (`conta/b02-…` → `tests/e2e/conta/b01`) o la de lo que toca (inventario), y el juego común (`c00/marco`, `rls`). Más **cada `.spec.ts` que cambia el PR**. |
| Lo común (el marco, el menú, `module.tsx`, el diseño, el arranque de la app, `package.json`…: `LO_COMUN_SUMIED` y `LO_COMUN_AMBOS`) | Además, **la rápida de pantallas**: `tests/e2e/conta/humo/pantallas.spec.ts`. Abre cada pantalla de Sumied una vez, en ordenador y en móvil. Como mucho 10 min. |
| Pedidos, cocina o reparto (`PEDIDOS`) | Además, **la corta** (`reparto/direccion-falta` y `reparto/quien-reparte`, 91 s). |
| Una tanda | Además, su prueba de staging en ROLLBACK, el ensayo y el real (W01). |
| La etiqueta `e2e-entera` | La entera, en 2 trozos. |

Todo va en un trozo, fichero a fichero (`scripts/e2e/por-fichero.sh`).

## Lo que bloquea y lo que no

- **Un fallo en una prueba de la zona del PR bloquea siempre.** La zona es la
  carpeta de su rama, la de lo que toca, las que cambia el PR y, si toca
  pedidos, la corta.
- **Un fallo POR TIEMPO en una prueba que no es de la zona no bloquea
  fusionar.** Lo mismo vale para el juego común o la rápida de pantallas. Se
  apunta como aviso en el run («Fuera de la zona, por tiempo») y en su resumen,
  y el trozo sale en verde. Lo mira la entera de la noche, que corre todo.
- «Por tiempo» es lo que dice Playwright cuando se acaba una espera sin
  encontrar lo que busca:
  - «Test timeout of … exceeded»;
  - «Timeout … exceeded»;
  - «TimeoutError»;
  - «element(s) not found».

  Si el fallo ve otra cosa, bloquea igual, aunque también diga «Timed out»: un
  texto o un número que no cuadra («Expected … / Received …») o un error de la
  página.
- La regla solo vale en la e2e de un push. Una e2e lanzada a mano o la de la
  noche no la usan: allí todo fallo bloquea.

## Por qué

El 26/10 la entera corría en casi todos los PR, porque tocar el menú o
`module.tsx` cuenta como «lo común». Una entera son unos 75 min en 2 trozos y
1,3 h en uno. Además cae por tiempo en pruebas que el PR no ha tocado: las 5 de
esa mañana (`c01b/flujos`, `c04/libro`, `b01/pantallas`, `b01/conciliar` y
`compras`) salieron en verde al repetirlas con staging tranquilo.

## Cuánto tarda, medido con el #339

El #339 (PC01 · Entrega 2) toca `package.json`, `module.tsx`,
`esqueleto/productos.ts` y `estilo/index.ts`, que son lo común, y cambia 4
pruebas.

- **Con la regla de antes:** la entera, 74 min (run 40305042124, de 10:08 a
  11:22 UTC, en un trozo).
- **Con la de ahora, 7 ficheros:**

  | Fichero | Por qué | Segundos |
  |---|---|---:|
  | `s01/esqueleto` | la cambia el PR | 286,5 |
  | `d01/catcher` | la cambia el PR | 31,6 |
  | `n5/anchos-compras` | la cambia el PR; sin medir, cuenta como la mediana | 39,4 |
  | `pc01/pagos` | la cambia el PR; nueva, cuenta como la mediana | 39,4 |
  | `c00/marco` | juego común | 18,4 |
  | `rls` | juego común | 4 |
  | `humo/pantallas` | la rápida, medida en la e2e 40328678034 (33,7 + 33,6) | 67,3 |
  | **Total** | | **486** |

  Son unos **8 min de pruebas**. Con la preparación (build, navegador y
  carril: unos 4 min) y el arranque de cada fichero (unos 5 s cada uno), salen
  **unos 12–13 min** de reloj.

Los segundos son los de `tests/e2e/tiempos/` (uno por prueba, W12), con la misma vara para
todos.

## Dónde vive

- `scripts/e2e/area.mjs`: qué corre (`queCorre`, `HUMO`, `CORTA`,
  `specsTocadas`) y qué es de la zona (`propias`).
- `.github/workflows/e2e-staging-conta.yml`: el plan pasa `propias` y `zona` a
  los trozos.
- `scripts/e2e/por-fichero.sh`: el fichero a fichero y lo que no bloquea.
- `tests/e2e/conta/humo/pantallas.spec.ts`: la rápida. Las pantallas salen de
  `CONTA.rutas` (las que no llevan parámetros) y del índice de Ajustes, así que
  una pantalla nueva entra sola.
- Las pruebas: `tests/unit/e2e/area.test.ts` y `tests/unit/e2e/cola.test.ts`.
