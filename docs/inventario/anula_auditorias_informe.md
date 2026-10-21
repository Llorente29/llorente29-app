# Inventario: se anulan tres inventarios de seguridad viejos (0440)

Decisión de Julio del 21/10/2026. Rama `claude/autoconteo-anula-audits`, tanda propia, con «autorizo».

## Lo que se midió (producción, solo lectura, 21/10)

| Inventario | Del | Tipo | Estado | Contados | Piden motivo | Movimientos | Recontados y aprobados después |
|---|---|---|---|---|---|---|---|
| INV-00258 | 25/09 | audit | en_revision | 88 de 88 | 52 | 0 | 88 de 88 |
| INV-00259 | 25/09 | audit | en_revision | 92 de 92 | 45 | 0 | 91 de 92 |
| INV-00283 | 04/10 | audit | en_revision | 120 de 120 | 56 | 0 | 120 de 120 |

No estaban entre los 23 de la 0390 porque no son autoconteos: un inventario de seguridad pide motivo y
lo aprueba la oficina, y la noche de las 03:10 no los toca. Aplicarlos ahora metería cifras de hace
semanas por debajo de recuentos más nuevos.

**El producto sin recuento posterior:** «Caja Hamburguesa Chivuos» (embalaje, inactivo), en Foodint
Carabanchel. Contado 225 en INV-00259 con el sistema en −2; nunca ha tenido un recuento aprobado y no se
ha movido desde entonces (el libro sigue en −2). No frena la anulación (Julio, 21/10).

## La tanda

`supabase/migrations/20261130T0440_inventario_anula_auditorias_viejas.sql` — AUTORIZO (update):

- **Qué hace:** anula los tres por id y cuenta, con una nota. Guarda lo de antes en
  `public.inventario_anulacion_20261021` (cerrada a la API) para la vuelta atrás.
- **Guarda:** para entera si alguno no está como se midió (cuenta, tipo, estado, contadas y cero
  movimientos).
- **Stock:** no lo toca. Después de anular comprueba que siguen sin movimientos.
- **En staging** no hace nada (no está Foodint). Su prueba lo ejecuta entero sobre la cuenta A con
  `inventario_0440.esperado`, que solo vale en una base sin cuentas de producción.
- **Vuelta atrás:** `supabase/vuelta-atras/20261130T0440_inventario_anula_auditorias_viejas.down.sql`.
- **Cuenta:** `scripts/conta/produccion/cuentas/anula-auditorias.sql` (solo lee). Tiene que dar: los 3
  en «anulado», los movimientos de conteos de Foodint sin cambiar y la copia con 3 filas.

## Pruebas

- **Staging** (`supabase/staging/sql/20261130_inventario_anula_auditorias_prueba.sql`, ROLLBACK):
  1. tres inventarios de seguridad de A contados por `save_count_line`, más un cuarto fuera de la lista;
  2. con una fila que no cuadra, el fichero para entero (lo dice `LAST_ERROR_MESSAGE`) y no anula ni
     crea la copia;
  3. el real anula los tres con su nota y su copia, sin movimientos, y deja el cuarto intacto;
  4. la vuelta atrás los deja como estaban.
- **Contexto de producción** medido a las 21:47 UTC: solo `inventory_count`, nada del camino del pedido,
  nada registrado.
