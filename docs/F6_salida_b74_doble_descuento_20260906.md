# F6 · Consecuencia esperada — B74: `sales_dashboard` restaba el descuento dos veces

Escrito **ANTES** de aplicar. **06/09/2026, 00:10 Madrid — fuera de la banda 12:15 → 23:45.**

---

## 1 · Qué está mal, y por qué es una cifra de dinero equivocada

`sales_dashboard` calcula
`net = total − refund_amount − discount_amount`.
Eso sólo sería correcto si `total` fuese bruto. **No lo es:** `sale.total` ya
lleva el descuento restado. Medido sobre los 415 pedidos con descuento de dos
semanas: **263 cumplen `total + descuento = Σ líneas` al céntimo y CERO cumplen
`total = Σ líneas`.** No hay lectura en la que `total` sea bruto.

**Y hay un segundo defecto que suma en dirección contraria:** la función filtra
`is_active` pero **no** `status <> 'cancelled'`, así que cuenta como venta
pedidos cancelados.

## 2 · Cuánto se mueve, medido antes de tocar

| ventana (fechas fijas, Europe/Madrid) | enseñaba | enseña ahora | diferencia |
|---|---|---|---|
| 24/08 00:00 → 31/08 00:00 | 10.846,36 € | **13.234,93 €** | **+2.388,57 €** |
| **06/08 00:00 → 05/09 00:00** (30 días cerrados) | **54.633,84 €** | **64.251,07 €** | **+9.617,23 € · +17,6 %** |

De esa corrección, **233,23 € (12 pedidos)** en la ventana de 30 días son
cancelaciones que se contaban como venta: van en dirección contraria, y por eso
hay que arreglar las dos cosas a la vez.

> **Corrección de método, 06/09.** La primera versión de esta tabla medía
> «últimos 30 días» y «semana en curso» — **ventanas relativas, que se mueven
> solas**. Julio verificó por su lado y le salió `+10.418,74 €` donde a mí
> `+10.409,61 €`: **25,57 € de diferencia que eran pedidos entrados entre las dos
> medidas**, no un desacuerdo. Una verificación con ventana relativa **no se
> reproduce**, así que las cifras que deciden algo se reescriben con fechas fijas.
> Los 11 cancelados sí cuadraron exactos en las dos medidas, porque esa parte no
> dependía del borde móvil.

**El número sube. Nadie ha vendido más:** se estaba enseñando de menos.

## 3 · Dónde se ve, y es más sitio del que decía el encargo

`sales_dashboard` no alimenta sólo la pantalla de Ventas. También el **Inicio**:
`ventasDelPeriodo.ts` la llama para AYER y de ahí salen **«Ticket medio»** y
**«Ventas por canal»**.

| día | ticket medio hoy | ticket medio real |
|---|---|---|
| 03/09 | 15,25 € | **20,12 €** |
| 04/09 | 16,37 € | **21,03 €** |
| 05/09 | 15,79 € | **21,35 €** |

**El ticket medio se enseña un 35 % por debajo**, en la primera pantalla que se
abre. Eso no estaba medido en el encargo y cambia la urgencia, no el arreglo.

## 4 · Qué se toca, y qué NO

**Se tocan dos cosas y ninguna más:**
1. `net` pasa a ser `total − refund_amount`. El `refund_amount` se mantiene aunque
   hoy sea 0,00 en el 100 % de las ventas: una devolución **debe** restar, y
   quitarlo sería cambiar la semántica aprovechando que el dato está vacío.
2. Se añade `coalesce(status,'') <> 'cancelled'`, en el bloque principal **y en el
   del periodo espejo** — con la misma regla en los dos lados (regla 31).

**NO se toca** (§7 del encargo: no se rediseña el dashboard):
- que agrupe `by_location` y `by_brand` **por nombre** en vez de por id. Hoy no
  cambia ninguna cifra —Foodint no tiene dos locales con el mismo nombre— pero
  queda declarado.
- el espejo `p_from − (p_to − p_from)`, que **desalinea una hora la semana del
  cambio de hora**. Medido: esa semana dura `7 days 01:00:00`.
- **No se añaden columnas de bruto/descuentos.** Serían útiles y son additivas,
  pero eso es rediseño y va con la pantalla delante.

`CREATE OR REPLACE`, no `DROP + CREATE`: **ni la firma ni el tipo de retorno
cambian**, así que no se crea sobrecarga (regla 2). Los grants sobreviven al
REPLACE y se comprueban **preguntando al motor**, no leyendo el ACL (regla 16).

## 5 · Cómo se verá si ha ido bien

- `sales_dashboard` para la semana 24→30/08 devuelve `kpis.net` = **13.234,93 €**,
  que es **exactamente** lo que da `report_sales` del generador. **Ése era el
  motivo de que B74 fuera antes que el lote 2**: si no cuadran, el primer cuadre
  lo hace Julio y encuentra él la diferencia.
- `has_function_privilege('authenticated', …, 'execute')` sigue siendo `true`.
- Una sola firma de `sales_dashboard`.
- Push a `supabase/migrations/`: **no dispara `build-apk` ni las edge functions**.
  No se publica OTA.

## 6 · Si sale mal

La función anterior está en el repositorio, en su migración. Revertir es un
`CREATE OR REPLACE` con el cuerpo viejo. **Ningún dato se toca**: `sales_dashboard`
es `STABLE` y sólo lee.

## 7 · Riesgo residual

1. **Nadie va a poder cuadrar el número nuevo contra un histórico**: los informes
   que alguien haya guardado de esta pantalla enseñaban 18,6 % menos. No hay
   histórico que reescribir —la función calcula en vivo— pero **si Julio tiene
   una cifra anotada de antes, no le va a cuadrar, y la buena es la nueva.**
2. **Los dos defectos que no se tocan** siguen ahí, declarados arriba.
