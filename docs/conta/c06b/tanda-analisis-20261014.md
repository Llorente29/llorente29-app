<!-- Medido en producción (solo lectura) el 14/10/2026 a las 08:32 UTC; CAMINO_* del workflow; analisis-tanda-viva.mjs --informe. -->
Análisis de la tanda viva contra el contexto de producción medido 2026-10-14T08:32Z (md5 de los 2 ficheros: los medidos).
  20261111T0500_c06b_cuenta_lectura.sql: sigue
  20261111T0510_c06b_cuenta_lectura_las_27.sql: AUTORIZO
  autorizo: 20261111T0510_c06b_cuenta_lectura_las_27.sql

## Qué hace cada fichero

Contra lo que existe en producción. **añade** pasa siempre; **cambia** (en caliente) pasa declarado en la cabecera y con prueba de staging, y en el camino del pedido además con `autorizo`; **destruye** solo con `autorizo`, y borrar o renombrar además sin usos y en su propia tanda.

### `supabase/migrations/20261111T0500_c06b_cuenta_lectura.sql` — sigue
- Crea (nuevo): nada
- **cambia** · reemplaza · funcion · `public.conta_diez_subcuentas(uuid,uuid,jsonb)` — reemplaza la función (misma firma)
  - declarado, prueba `supabase/staging/sql/20261111_c06b_cuenta_lectura_prueba.sql`

### `supabase/migrations/20261111T0510_c06b_cuenta_lectura_las_27.sql` — **AUTORIZO**
- Crea (nuevo): nada
- **destruye** · cambia_datos · tabla · `public.company_account` · update (dentro de un with) — update (dentro de un with) · 751 filas · bloqueo ROW EXCLUSIVE: las filas que toca
  - autorizo


