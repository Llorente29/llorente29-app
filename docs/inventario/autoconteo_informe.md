# Autoconteo: se aplica solo, entero y con cualquier diferencia

Encargo de Julio del 21/10/2026. Rama `claude/exciting-cray-eik036`.

## Lo que se midió (producción, solo lectura, 21/10)

- `cron_autoclose_daily_counts` (03:10 UTC) **no ha aplicado ni un conteo en su vida**:
  `close_inventory_count` y `apply_inventory_count` empiezan con `belongs_to_account()`,
  que a esa hora, sin usuario, da `false`. El cron cogía la excepción, la bajaba a
  `raise warning` y pg_cron contaba «succeeded» (12 de 12 las últimas noches).
- Debajo, una segunda traba: el cron iba en modo parcial, que deja fuera las líneas
  que piden motivo y deja el conteo en «en_revision» para siempre.
- 23 conteos atascados (16 en revisión con algo contado, INV-00316 contando y 6 sin
  nada contado). En 15 de los 17 con algo contado, todo lo pendiente se volvió a contar y
  aprobar después: aplicarlos con su fecha descuadraría el stock de hoy.

## Lo que decidió Julio

1. Anular los 23 (los 16, los 6 sin contar e INV-00316, que se vuelve a contar).
2. El autoconteo se aplica al terminarlo en la tablet, entero, sin motivos ni oficina. Si
   no se termina, el cron de las 03:10 UTC lo cierra y lo aplica con lo contado; el cierre
   de rezagados al generar se queda como red. Las apartadas no se aplican.
3. La pantalla enseña la hora real en que se aplicó.
4. Avisos: pg_cron en rojo, vigía con incidencia en GitHub y aviso en la pantalla.

## La tanda

| Fichero | Qué hace | Analizador |
|---|---|---|
| `20261129T0390_autoconteo_anula_atascados.sql` | Anula los 23 por id y cuenta; **para si alguno no está como se midió**. Copia lo de antes para la vuelta atrás. No toca el stock. | AUTORIZO (update) |
| `20261129T0400_autoconteo_se_aplica_entero.sql` | Núcleos sin guarda; `cycle` sin motivos; tablet y red aplican entero; procedimiento de la noche con COMMIT por conteo y error al final; aviso; vigía. | AUTORIZO (las llama un cron) |

`audit` y `full` no cambian: siguen pidiendo motivo, y la noche no los toca.

### Manifiesto para `supabase/produccion/aplicar.txt` (cuando Julio dé el turno, después de la 0380 de P)

```
# AUTOCONTEO · el autoconteo se aplica solo, entero y con cualquier diferencia
# (rama claude/exciting-cray-eik036; encargo de Julio del 21/10).
#   1. 0390 — ANULA los 23 autoconteos atascados (update, AUTORIZO). Para si
#      alguno no está como se midió el 21/10. No toca el stock.
#   2. 0400 — CAMBIA en caliente close/apply/autoclose y el cron de las 03:10
#      (AUTORIZO: las llama un cron), AÑADE los núcleos, el procedimiento de la
#      noche, la lectura de la pantalla y la del vigía, y tres columnas.
# Ninguna función que desplegar a mano.
cuenta: scripts/conta/produccion/cuentas/autoconteo.sql
supabase/migrations/20261129T0390_autoconteo_anula_atascados.sql
supabase/migrations/20261129T0400_autoconteo_se_aplica_entero.sql
```

Y `supabase/produccion/vuelta-atras.txt`:

```
cuenta: scripts/conta/produccion/cuentas/autoconteo.sql
supabase/vuelta-atras/20261129T0400_autoconteo_se_aplica_entero.down.sql
supabase/vuelta-atras/20261129T0390_autoconteo_anula_atascados.down.sql
```

Los dos `autorizo`: `20261129T0390_autoconteo_anula_atascados.sql` y
`20261129T0400_autoconteo_se_aplica_entero.sql`.

**Turno dado el 21/10** (la de Compras, 0350–0370, ya aplicada). Vuelto a medir en producción a las 15:58 UTC,
con la misma vara que la guarda de la 0390: **23 filas, 23 existen, 23 cuadran** (cuenta, `cycle`, estado y
contadas), ninguna tocada desde el 20/10 a las 21:29 UTC. Ninguna de las dos está en el historial.

### Lo que dice la cuenta hoy (antes)

| Medida | Antes (21/10) |
|---|---|
| los 23 de la 0390 | contando:6 · en_revision:17 |
| autoconteos de Foodint | anulado:47 · aprobado:153 · contando:5 · en_revision:15 |
| movimientos de stock de conteos de Foodint | 3577 · −5664724,6850 (tiene que quedar igual) |
| funciones del conteo | apply 3d4931518da5 · autoclose 057040e8cb22 · close 8b4c2d76e22f · cron 50320afc9226 |
| orden del cron | `10 3 * * * select public.cron_autoclose_daily_counts();` |

## Pruebas

- **Staging** (`supabase/staging/sql/20261129_autoconteo_prueba.sql`, ROLLBACK): tablet como
  `authenticated` (aplica entero, la «revisar» y la −80 % entran, la apartada no, diferencia
  guardada), rezagado, la noche (aplica, anula el vacío, apunta el roto con su aviso, no toca el
  de seguridad), pantalla, cuenta B, vigía, el de seguridad sigue pidiendo motivo, y la regla 10:
  cerrar una venta, recibir un albarán, apuntar una merma, aprobar un recuento y un autoconteo
  después. **Sin correr todavía**: el workflow de staging solo arranca por push en `conta/**` o
  `reparto-**`, o a mano (Run workflow, modo «aplicar», en esta rama).
- **Fuera de transacción** (`tests/inventario/autoconteo-noche.sh`, en una base de juguete con las
  columnas de producción): la noche con un conteo roto acaba en ERROR (pg_cron en rojo) y aun así
  deja confirmado lo bueno; la 0390 para con una fila tocada y anula 23 sin ella; las dos vueltas
  atrás dejan las cuatro funciones con la huella md5 de producción. En verde.
- **Unitarias**: textos de oficina contra 60 líneas reales de Foodint, y el vigía. 4.938 en verde.
- **Build** exacto y en limpio, lint igual a los dos lados (76 errores y 9 avisos antes y después).

## La e2e (tests/e2e/inventario/autoconteo.spec.ts)

Ordenador y móvil, en el carril de cada ejecución:

1. **La tablet**: el trabajador de prueba cuenta sus tres productos (10 → 4, 20 que cuadra, 30 → 2,
   que pide mirarlo otra vez) y ve «El stock ya está al día». La base: aprobado, `al_terminar`,
   ajustes −6 y −28, diferencias guardadas.
2. **La pantalla de conteos**: el administrador abre ese recuento y ve «Aplicado al terminar el
   recuento, a las …, lo terminó Trabajador de Prueba», «Faltaban 28 ud; quedan 2 ud» y «Ver los 1 que
   cuadran», sin motivos ni «Aprobar».
3. **El aviso**: un autoconteo de ayer con el fallo apuntado sale en rojo en Almacén; se abre, se
   cierra y «Aplicar entero (1 contados)» lo aplica; el aviso se va.

Semilla: `supabase/seeds/conta/seed_autoconteo_e2e_staging.sql` (el trabajador
`a.trabajador@prueba.folvy.test` con ficha en Norte · Centro, tres artículos con 10, 20 y 30 ud, y
`e2e_autoconteo_preparar`, que solo existe en staging). Va en el manifiesto de staging detrás de la 0400.

Cambios en lo común, aprobados por Julio el 21/10:
- `scripts/e2e/carril/comun.sql`: el trabajador en la lista de usuarios de la plantilla.
- `scripts/e2e/area.mjs`: zonas por fichero; tocar `src/modules/supply/`, `src/pages/trabajador/`,
  `tests/e2e/inventario/` o la semilla añade `tests/e2e/inventario` a la e2e de un push.
- `scripts/conta/capturas.mjs`: `docs/inventario/capturas` con dueño «inventario», que es la rama sin
  frente que toca inventario.

No cambia el workflow: se lanza a mano (Run workflow en la rama, `pruebas = tests/e2e/inventario`),
**después** de la tanda de staging. Antes, el clon del carril de esta rama para: busca un usuario
que aún no está.

## Capturas

`docs/inventario/capturas/`: la tablet al terminar (aplicado, faltan compañeros, error), la
pantalla de un autoconteo aplicado en ordenador y en móvil, y el aviso de la pantalla de
inventario en ordenador y en móvil. Pintadas con las piezas de verdad
(`tests/inventario/capturas/banco.tsx`).

## Roces con el inventario, dichos antes

- Cada autoconteo aplicado pasa a ser «el último conteo aprobado»: el corte de la regla 6 se
  mueve cada día.
- Una línea contada dos veces que sigue sin cuadrar (`needs_review`) **también se aplica**, con el
  último número. `save_count_line` todavía dice en un comentario «no se aplica solo»: con la
  regla nueva, sí.
- Un autoconteo sin nada contado se **anula** solo («nadie contó nada»), en vez de aprobarse vacío.
- La función vieja `cron_autoclose_daily_counts` se queda sin uso y falla diciendo por qué; se
  borra en otra tanda.
- Front y base: la tanda va **antes** de fusionar. El front nuevo lee tres columnas que crea la 0400.
