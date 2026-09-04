# B59 (L0b) — Por qué no casan, y por qué los dos niveles «no reconcilian»

**04/09/2026** · RECON medido, sin arreglos aplicados · Encargo L0b §1 y §4

> El §1 pedía la distribución de causas **con la consulta, no con una hipótesis**. Salieron
> dos cosas que cambian el encargo: el 8,1 % no es el número, y el §4 no es un descuadre.

## §1 · El 8,1 % divide por un denominador que no es de nadie

`match_status` ya distingue tres estados, y el reparto es limpísimo:

| estado | líneas | rango de `order_date` |
|---|---:|---|
| `sin_origen` | **6.080** | 2026-01-01 → **2026-06-11** |
| `casada` | **537** | 2026-06-12 → 2026-06-30 |
| `sin_casar` | **21** | 2026-06-12 → 2026-06-30 |

Y la primera venta de Foodint en Folvy, **en cualquier canal**, es del **12/06/2026**
(Glovo, Uber y Just Eat empiezan los tres ese día).

**La frontera es exacta y no es casualidad.** Todo lo anterior al 12/06 es `sin_origen`
porque describe pedidos que ocurrieron **antes de que Folvy existiera en esa cuenta**. No
hay nada que casar: no es un fallo del algoritmo, es que no hay contraparte.

Sobre el periodo que Folvy **puede** cubrir:

```
537 casadas / (537 + 21) = 96,2 %
```

**Ya está por encima del objetivo del ≥ 95 % del encargo.** El 8,1 % sale de dividir
537 entre 6.638, metiendo en el denominador 6.080 líneas de enero a junio. Es la familia
de la regla 9: un porcentaje que no es de nadie, porque mezcla dos poblaciones.

⚠️ **Consecuencia para el encargo:** «llevar el casado de 8,1 % a ≥ 95 %» no es trabajo de
casado — ya está hecho. Lo que queda es decidir **qué se hace con las 6.080**: o se
etiquetan como fuera de alcance y se sacan de todo indicador, o se decide importar
histórico de las plataformas para tener contraparte. Es decisión de producto, no de código.

### Las 21 que sí son trabajo real

| forma del código | líneas | fecha | qué es | incidencias |
|---|---:|---|---|---:|
| `add-14080694`, … | **17** | 15/06 | prefijo `add-`: **no es un pedido**, es una línea de ajuste de la liquidación | 0,00 € |
| `101680272750`, … | **3** | 12/06 | Glovo, sólo dígitos, del **primer día**: pedidos anteriores al arranque de la ingesta | 0,00 € |
| `#F7C21` | **1** | 30/06 | almohadilla + alfanumérico. **Casa por dígitos**: `hay_venta_solo_digitos = true` | 0,00 € |

- Las **17 `add-`** no deberían intentar casar: hay que reconocerlas como ajuste y darles
  su propio `match_status` (`ajuste_no_pedido`), no dejarlas como fallo de casado.
- Las **3 del 12/06** son el borde de la ingesta. Se etiquetan como `sin_origen`, que es
  lo que son.
- **Sólo 1 de 6.638 es un problema de formato de código.** El encargo temía prefijos,
  ceros y sufijos: hay uno. La normalización por dígitos lo resuelve.
- **Ninguna de las 21 tiene `incidents_cost` distinto de cero.** Casarlas no cambia ni un
  euro del indicador de incidencias. Importa para L4 (colgar reclamaciones), no para el
  número.

> Una línea (`#F7C21`) no aparece al agrupar por `channel_settlement`: su `settlement_id`
> no resuelve. Es un caso de uno, anotado.

## §4 · Los dos niveles SÍ reconcilian. Es un signo

El encargo decía «liquidación dice 1.764 €, desglose dice 2.105 €, hay que saber por qué».
El porqué es mecánico:

| caso | liquidaciones | € en juego |
|---|---:|---:|
| 1. Cuadran tal cual | **195** | 0,00 € |
| 2. **Misma magnitud, signo opuesto** | **26** | 973,26 € |
| 3. Liquidación sin detalle importado (0 líneas) | **26** | 790,78 € |
| 4. Otra cosa | **0** | — |

**Ni una sola liquidación descuadra en magnitud.** El importador escribe
`channel_settlement.incidents_cost` en **negativo** y
`channel_settlement_order.incidents_cost` en **positivo**. Ejemplo real
(`I170326000245703`): nivel liquidación −115,55 €, nivel pedido +115,55 €, «diferencia»
−231,10 € — que es exactamente el doble, la firma inconfundible de un signo cambiado.

Las 26 del caso 3 son otra cosa distinta y también acotada: liquidaciones cuyo detalle por
pedido nunca se importó. 790,78 € sin desglose.

**Ningún indicador de incidencias debe salir hasta arreglar el signo**, y arreglarlo es
una convención, no un misterio: decidir en qué signo se guarda un coste y aplicarlo en los
dos niveles. Recomendación: coste **positivo** en los dos (un coste es un coste), y que el
signo lo ponga la pantalla.

## Lo que este RECON NO ha hecho

- **§2 (Uber y Just Eat)** — necesita una liquidación real de cada una delante. Sin el
  documento no se puede localizar el campo, y adivinarlo es justo lo que no se hace.
  Sigue en pie el dato del encargo: 0,00 € en 127 liquidaciones de Uber y JE.
- **§3 (cron + vigía calibrado)** — no empezado.
- **§5 (`sale.refund_amount`)** — no investigado. Sigue NULL en 9.254 de 9.254.
- **Nada aplicado.** Todo lo de arriba son consultas de lectura.
