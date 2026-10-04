# C01b · Informe final: ficha de proveedor en el estilo nuevo y cierre del C01

Rama `conta/c01b-ficha-proveedor`, PR #143. Encargo en `docs/conta/encargos/encargo_C01b_ficha_proveedor.md` y decisiones en `C01b_respuesta_1.md`.

**Nada de esto está en producción.** Producción solo se ha leído, siempre en solo lectura.

## 1. Qué hay, tarea a tarea

| Tarea | Qué | Dónde |
|---|---|---|
| 1 | Comprobaciones previas | `docs/conta/C01b_comprobaciones_previas.md` |
| 2 | Movimiento de datos (0100–0120 + down), lecturas a la fuente nueva, semillas, antes = después | `supabase/migrations/20261006T01{00,10,20}_*`, `scripts/conta/c01b_antes_despues.sql`; staging 37192967088 |
| 3 | Núcleo: repetida (contra los 179 números de albarán reales de Foodint), aprendizaje, plazo > 60 | `src/modules/conta/lib/{repetidas,aprendizaje}.ts`, `tests/unit/modules/conta/nucleoC01b.test.ts` |
| 4 | Ficha y lista nuevas, ordenador y móvil; pantallas viejas borradas; capturas | `src/modules/conta/proveedor/`, `docs/conta/capturas/c01b/COMPARACION.md` |
| 5 | «Lo que he aprendido», «Cambiar», «No es repetida», «Lo que ha hecho Folvy» (0130 + down) | `20261006T0130_c01b_aprendizaje.sql`; staging 37195827926 |
| 6 | Eliminación de las columnas viejas (0140 + down), analizador, búsqueda en lo desplegado | `docs/conta/C01b_eliminacion_columnas.md`; staging 37196540632 |
| 7 | E2E de flujos A y B, RLS, contraste, comprobación del agente, este informe | `tests/e2e/conta/c01b/`, `docs/conta/C01b_contraste.md` |

**Borrado** (decisión 6). Del núcleo, los servicios y el hook se reutiliza todo. Se borra:
- `src/modules/conta/apartados/*`
- `src/modules/conta/components/*` (`FichaContexto` pasa a `proveedor/contexto.ts`)
- `src/modules/conta/pages/FichaProveedorPage.tsx` y `ProveedoresPage.tsx`
- `src/modules/conta/conta.css`
- `src/modules/kitchen/pages/SuppliersPage.tsx` (su «Migrar artículos» pasa a `kitchen/proveedores/ArticulosQueLeCompras.tsx`)
- la e2e `c00/proveedores-de-siempre.spec.ts`, que comprobaba justo la pantalla vieja

## 2. Medidas

- **Repetida, población real.** 179 números de albarán de Foodint, leídos en solo lectura y guardados como índices, sin nombres. Normalizar no junta nunca dos números distintos. Con el mismo importe salen exactamente `01`, `AV260559511` y `T2826/1092`. «0» repetido no cuenta.
- **Aprendizaje, población real.** Foodint tiene hoy **1** factura aprobada (IVA 4 y 21) y **0** pagadas. Con eso Folvy no aprende nada, y la prueba lo dice.
- **Antes = después (staging).** 0 faltan en todas las cuentas. El clonado de la plantilla da 3 proveedores con la función vieja y 3 con la nueva. Tras la vuelta atrás, los md5 de las funciones son los de producción.
- **Eliminación (staging, en ROLLBACK).** Tras la vuelta atrás, cada valor de las cuatro columnas es igual a la foto de antes.
- **Analizador:** tres huecos arreglados (ver §4). Las tandas ya aplicadas del C00 y del R02 dan **el mismo veredicto y el mismo informe** con el analizador viejo y con el nuevo.
- **Lo desplegado:** 69 de 69 edge functions revisadas; ninguna nombra las cuatro columnas.
- **Comprobación nueva del agente** (IVA de proveedor apunta a un `tax_rate` vigente, decisión 8): en staging, 2 referencias y 0 problemas. En producción la consulta no falla aunque la columna aún no exista.

## 3. Cómo se despliega (encargo §9)

1. **Julio prueba la vista previa** de la rama, con las cuentas A y B.
   - Va contra staging-conta: variables de vista previa limitadas a esta rama, creadas el 04/10.
   - **Hasta ese momento las vistas previas de esta rama apuntaban a producción.** No consta que se abrieran. Los despliegues anteriores a esas variables no deben usarse.
2. **Tanda de datos.** Workflow de producción, ENSAYO y luego REAL, con `supabase/produccion/aplicar.txt` (0100, 0110, 0120 y 0130). En el campo **`autorizo`**: `20261006T0110_c01b_datos.sql 20261006T0120_c01b_lectores.sql`.
   - El workflow solo aplica entre las 00:30 y las 12:15 de Madrid. La 0110 escribe en `supplier` en todas las cuentas: que vaya de noche.
3. **Antes = después en producción**, en solo lectura: `scripts/conta/c01b_antes_despues.sql`. Tiene que dar 0 faltan en todas las cuentas.
4. **Fusión del front** (la hace Julio), con Vercel en READY y `npm run build` limpio antes.
5. **Tanda de eliminación** (0140), sola, con `autorizo` `20261006T0140_c01b_elimina.sql`, y la comprobación de lo desplegado del día.
6. **Después:** regenerar `src/types/database.ts`.

La vuelta atrás de la tanda de datos está en `supabase/produccion/vuelta-atras.txt`: los cuatro `.down.sql` al revés, probados en staging.

## 4. Pendientes y hallazgos (fuera del encargo, o para decidir)

1. **Analizador de producción: tres huecos, arreglados en esta rama.**
   - (a) Un `--` dentro de un `do $$` se comía el resto del bloque.
   - (b) No miraba las CTE que escriben.
   - (c) Un `case … then … else` partía la sentencia y el `insert` de detrás no se veía.

   Por eso la 0110 salía «sigue» y cambia datos. Ahora **para** y va en `autorizo`, como ya preveía la respuesta 1. Ninguna tanda ya aplicada cambia de veredicto. El arreglo llega a `main` con este PR: hasta entonces, el analizador de `main` tiene los tres huecos.
2. **Tipo de gasto, retención e IBAN no se aprenden todavía.** Una factura hoy no los guarda. Llegan con la pantalla de apuntar facturas (C02); mientras, «Cambiar» los fija a mano.
3. **IBAN nuevo en una factura.** Pennylane lo detecta y para el pago. Propuesta para el C02 (contraste).
4. **«Cómo factura» en la pantalla vieja era `iva_incluido_en_linea`.** Se conserva, en Pago, y se añade `invoicing_frequency` (cada cuánto factura).
5. **«Artículos que le compras»** es por dentro la pieza de Cocina de siempre, con su letra. Rehacerla en el estilo nuevo queda pendiente.
6. **La entrada «Clientes y proveedores» del menú de contabilidad** sigue sin ruta. La ficha vive en Cocina (decisión 7), y desde Compras se llega a ella.
7. **`migrate_kitchen_core`** solo admite una llamada por transacción (tablas temporales «on commit drop»). Es así en producción y no lo cambia el C01b.
8. **En staging, el usuario de los workflows no puede usar `session_replication_role`.** Las semillas entran como el administrador de A, con su JWT.
9. **El modo `vuelta_atras` del workflow** solo admite `*.down.sql`. Una vuelta atrás con guardas aparte (`*.down.guarda.sql`) no se puede lanzar.
10. **El PR #137 ya estaba fusionado** (05:09) cuando llegó el encargo. Su nota va como comentario, apuntando aquí.
11. **E2E en rojo que no vi a tiempo.** Las e2e de las tareas 2 y 3 salieron en rojo porque la semilla del C01b añadía la repetida y la RLS esperaba una sola F-2026-0915. Lo vi en la tarea 4 y está arreglado. Desde entonces, verde.
