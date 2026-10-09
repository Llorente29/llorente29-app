# Parte · TPV Sala · S2 (mover y juntar) · 08/10/2026

Rama `claude/affectionate-albattani-6lv2af`, reiniciada desde `main` tras fusionar
[#164](https://github.com/Llorente29/llorente29-app/pull/164). **Nada de S2 en producción.**

## Antes de S2: S1 en staging, ensayo completo

`claude/sql/20261008_tpv_sala_s1_ensayo_staging.sql`, ejecutado en staging con las funciones REALES
(revertido con un error final que lleva los resultados): **21 de 21**. Incluye dos comprobaciones nuevas:
- **E6c**: reimprimir un envío cuyas líneas están todas anuladas trae `lineas = null` (no `[]`); el
  render del ticket ya hace `order.lineas || []`.
- **E11b**: el ticket de una venta de Mostrador no lleva datos de mesa.

Comprobado también: producción tiene la parte A (4 tablas, RLS, 2 políticas cada una) y no la B.

## S2

**Base** — `supabase/migrations/20261009T0050_tpv_sala_s2_mover_y_juntar.sql` (vuelta atrás en
`supabase/vuelta-atras/`). **Fuera de banda** (columnas en `sale` y `sale_fire`); pensada para la misma
ventana, justo detrás de B. Aborta si falta B o si es banda.

- `sale.merged_into_sale_id`, `sale_fire.origin_fire_id` / `origin_table_name`, tabla `sale_table_move`
  (quién movió qué y cuándo: cambio, junta o líneas, con importe y comensales).
- `pos_table_move(cuenta, mesa)`: libre → la cuenta pasa entera; ocupada → se juntan en la del destino
  (envíos renumerados detrás y con su mesa de origen, líneas con sus mismos `id`, anulaciones, comensales
  sumados; la juntada queda `cancelled` «Juntada con la mesa N», recogida y apuntando a la otra).
- `pos_table_move_lines(líneas, mesa, comensales)`: a ocupada se suman; a libre la abre con ellas. Lo
  enviado llega en un envío con su hora y su mesa de origen.
- Si algo de lo movido estaba en cocina: aviso «CAMBIO DE MESA» / «MESAS JUNTAS» en la impresora de cocina
  (documento compuesto: lo imprime cualquier paquete).
- No deja mover una cuenta cobrada ni juntar con una mesa cobrada sin recoger. Juntar o mover líneas anula
  «Pide la cuenta» (la impresa ya no vale).

**Front** (maqueta, pantalla 4): banda azul «La mesa 4 se cambia. Toca a cuál va.» con «No cambiar nada»;
cada mesa dice qué pasa al tocarla («Pasar aquí», «Caben solo N», «Juntar con la N», «Sale de aquí»,
«Sin recoger»). Entradas: «Cambiar de mesa» en la cabecera de la mesa, «Mover o juntar mesas» en la Sala
(elige primero cuál) y «Llevar a otra mesa» en la ficha de una línea (sin enviar o enviada). Sin arrastrar.
Captura lado a lado: `claude/capturas_tpv_sala_s1/4_mover_juntar.png`.

## Comprobado

- **Staging, funciones reales: 9 de 9** (`claude/sql/20261009_tpv_sala_s2_ensayo.sql`): cambiar a libre,
  juntar (6 comensales, 2 envíos, el segundo «de la M5»), consumo entero en la que recibe y 0 en la
  juntada, línea a mesa libre y de vuelta (consumo 1/1 y luego 0/2), no deja con cobradas, 4 movimientos
  apuntados.
- **El ensayo en staging cazó un fallo que el local no veía**: `stock_movement` tiene clave única por
  (línea, ingrediente). Al mover una línea, el destino se recalculaba ANTES de que el origen soltara su
  movimiento → 23505 y la operación entera abortada. Arreglado: primero el origen, luego el destino. El
  Postgres local no lo reproduce ni con la clave puesta (le falta el disparador de consumo de `sale`):
  dicho para que nadie dé el local por suficiente con el stock.
- Local (A + B + S2): 9 de 9; vuelta atrás de S2 y otra vez arriba: limpio.
- Lint: rama 1374 · `origin/main` 1375. Pruebas sin `dist/` a los dos lados: 10 fallidas / 2520 bien en
  los dos, las mismas 10 (capturas). `npm run build` limpio: verde.
- Regla 10: S2 mueve consumo entre ventas (cierre de venta ensayado); no toca albaranes, mermas ni
  recuentos. Riesgo dicho: si una línea movida tuviera movimientos protegidos por un recuento aprobado
  entre medias (corte), el origen no los soltaría y el destino chocaría. En una mesa del mismo servicio no
  pasa; si pasa, la operación aborta entera y lo dice, no deja nada a medias.

## Esta noche (00:30–12:15), en este orden

1. Ensayo S1 en producción (`claude/sql/20261009_tpv_sala_s1_ensayo.sql`, con B pegada) → todo `true`.
2. Ensayo S2 en producción (`claude/sql/20261009_tpv_sala_s2_ensayo_produccion.sql`: B + S2 + ensayo en
   una ejecución) → 9 `true`.
3. Aplicar B y después S2.
4. Fusionar el PR de S2 → Vercel READY.

## Hallazgo de paso (no tocado)

`tailwind.config.js` tiene DOS claves `fontSize` en `theme.extend`: la segunda pisa a la primera, así que
los tamaños `xs…3xl` personalizados no se aplican (rigen los de Tailwind). Ya estaba así.
