# Nota para Code — Calendario: llamadas concurrentes al montar

## Lo que se ha arreglado (BBDD, 07/08) — ya está en producción
Los 500 intermitentes de Calendario tenían causa raíz en BBDD, no en el frontend: 5 funciones repetían la
misma agregación pesada de ventas. Medido en `team_labor_requirement`:

| | Antes | Después |
|---|---|---|
| Planning | 251 ms | 32 ms |
| Execution | 269 ms | 90 ms |
| **Total** | **520 ms** | **122 ms** (4,3× más rápido) |

Solución: tabla `sales_hourly_agg` + trigger incremental + `team_demand_profile` leyendo de ahí.
Verificado idéntico fila a fila contra línea base (196 filas / 11.657 unidades) y contra ventas crudas en
el mismo instante (6.261 = 6.261, 0 celdas distintas).

**Con esto el reintento que añadiste como mitigación ya no debería dispararse.** Puedes dejarlo (no molesta)
o quitarlo, a tu criterio.

## Lo que NO se ha arreglado (es frontend, tuyo)
**Calendario sigue disparando ~25 llamadas concurrentes al montar.** Eso sigue siendo incorrecto aunque
ahora cada llamada sea 4× más rápida:
- Con más locales o más histórico, vuelve a saturar.
- Con clientes en conexiones lentas, sigue siendo una avalancha.

Recomendación (no urgente, ya no rompe): agrupar las llamadas de demanda en una sola por pantalla, o
escalonarlas, o cachear en cliente lo que no cambia entre renders. Si ves timeouts intermitentes en otras
partes de esa pantalla, la causa es esta.

## Efecto colateral positivo
`team_demand_forecast`, `team_demand_by_hour` y todo lo que llame a `team_demand_profile` mejora
automáticamente, porque la reescritura fue en la función BASE de la cadena.

## Pendiente menor (optimización fina, NO deuda grave)
Los CTE `ppt` y `loc_days` de `team_labor_requirement` todavía escanean ventas crudas (~47 ms de los 122 ms
que quedan). Pasarlos al agregado lo bajaría a ~60 ms. No corre prisa.
