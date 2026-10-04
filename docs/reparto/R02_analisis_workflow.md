# R02 · Análisis con el analizador del workflow de producción

`scripts/conta/produccion/analizar.mjs`, el mismo que corre `aplicar-produccion-conta.yml`, sobre los siete
ficheros del R02 en su orden de aplicación. «Existentes» medidos en producción en solo lectura el 04/10
(`to_regclass` / `to_regprocedure`): tablas `brand`, `sale`; funciones `brand_price_grid`,
`dispatch_watchdog_scan`, `marca_reparte_propio`, `metrica_direcciones_de_reparto`, `resolve_dispatch`,
`tg_sale_service_type_por_interruptor`.

| Orden | Fichero | Analizador | Por qué |
|---|---|---|---|
| 1 | `20261005T0100_r02_brand_delivery_policy.sql` | sigue | solo crea |
| 2 | `20261005T0110_r02_filas_migradas.sql` | sigue | inserta en una tabla nueva |
| 3 | `20261005T0120_r02_lectores_de_la_resolucion.sql` | **PARA** | reemplaza 5 funciones de Cocina (+ los 2 feeds por `execute` dinámico, que el analizador marca como aviso) |
| 4 | `20261005T0130_r02_guardar_celdas.sql` | sigue | solo crea |
| 5 | `20261005T0140_r02_sugerencia_ia.sql` | sigue | solo crea |
| 6 (aparte) | `20261005T0210_r02_saneado_pedidos_abiertos.sql` | **PARA** | `update` sobre `sale` |
| 7 (aparte) | `20261005T0200_r02_elimina_interruptor_antiguo.sql` | **PARA** | borra `brand.own_delivery_enabled` y `marca_reparte_propio` |

Los tres que paran lo hacen a propósito: son los que Julio tiene que autorizar por separado (encargo §4).
El workflow de hoy no tiene forma de autorizar un fichero que PARA: ver el informe final (pendiente).

---



### `supabase/migrations/20261005T0100_r02_brand_delivery_policy.sql` — sigue
- Crea (nuevo): tabla `public.brand_delivery_policy`, indice `public.brand_delivery_policy`, disparador `public.brand_delivery_policy`, politica `public.brand_delivery_policy`




### `supabase/migrations/20261005T0110_r02_filas_migradas.sql` — sigue
- Crea (nuevo): nada




### `supabase/migrations/20261005T0120_r02_lectores_de_la_resolucion.sql` — **PARA**
- Crea (nuevo): nada
- **Para por:**
  - reemplaza · funcion · `public.tg_sale_service_type_por_interruptor()` — solo vat_rate_for puede reemplazarse
  - reemplaza · funcion · `public.resolve_dispatch(uuid)` — solo vat_rate_for puede reemplazarse
  - reemplaza · funcion · `public.dispatch_watchdog_scan(integer)` — solo vat_rate_for puede reemplazarse
  - reemplaza · funcion · `public.metrica_direcciones_de_reparto(uuid,integer)` — solo vat_rate_for puede reemplazarse
  - reemplaza · funcion · `public.brand_price_grid(uuid,uuid,jsonb)` — solo vat_rate_for puede reemplazarse
- Aviso, para que lo mire una persona:
  - dinamico · desconocido · `(execute dinámico)` · execute replace(d, viejo, nuevo)




### `supabase/migrations/20261005T0130_r02_guardar_celdas.sql` — sigue
- Crea (nuevo): nada




### `supabase/migrations/20261005T0140_r02_sugerencia_ia.sql` — sigue
- Crea (nuevo): tabla `public.delivery_policy_suggestion`, indice `public.delivery_policy_suggestion`, politica `public.delivery_policy_suggestion`




### `supabase/migrations/20261005T0210_r02_saneado_pedidos_abiertos.sql` — **PARA**
- Crea (nuevo): tabla `public.r02_saneado_registro`
- **Para por:**
  - cambia_datos · tabla · `public.sale` · update




### `supabase/migrations/20261005T0200_r02_elimina_interruptor_antiguo.sql` — **PARA**
- Crea (nuevo): tabla `public.r02_interruptor_antiguo`
- **Para por:**
  - borra · funcion · `public.marca_reparte_propio(public.brand)`
  - borra · columna · `public.brand` · drop column if exists own_delivery_enabled


