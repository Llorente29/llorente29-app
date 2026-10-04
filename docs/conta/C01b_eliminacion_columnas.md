# C01b · Tarea 6 · Eliminación de las columnas viejas del proveedor

Medido el 04/10/2026, producción en **solo lectura**. Las columnas son
`supplier.email`, `supplier.phone`, `supplier.address` y
`supplier.usual_vat_rates`. `notify_group` **se queda** (respuesta 1, decisión 2).

## Ficheros

| Fichero | Qué hace |
|---|---|
| `supabase/migrations/20261006T0140_c01b_elimina.sql` | Pasa tres guardas, copia las columnas en `c01b_columnas_eliminadas` y las borra. |
| `supabase/vuelta-atras/20261006T0140_c01b_elimina.down.sql` | Las devuelve con su tipo exacto y con sus valores, y comprueba que todo ha vuelto antes de quitar la copia. |
| `supabase/staging/sql/20261006_c01b_prueba_elimina.sql` | Prueba entera en ROLLBACK: foto de antes, eliminación, los lectores siguen funcionando, vuelta atrás igual a la foto. |

Guardas de la 0140 (si falla una, no se borra nada):

1. `compliance_docs_due` y `migrate_kitchen_core` son las de la 0120. Se comprueba por su md5, medido en staging: `7a8c769e…` y `ab2746d6…`.
2. Antes = después: cada email, teléfono y dirección viejos están en su sitio nuevo, y cada IVA viejo tiene su referencia.
3. La copia tiene una fila por cada proveedor con algo en esas columnas.

Tipos en producción, que la vuelta atrás reproduce:
- `email`, `phone` y `address` son `text` y admiten nulo.
- `usual_vat_rates` es `numeric[] not null default '{}'`.

## Quién las nombra

- **Código del repositorio.**
  - `src/` y `supabase/functions/` no leen `usual_vat_rates`.
  - En Cocina, email, teléfono y dirección solo se escriben ya en `supplier_contact` y en `supplier_proposal`.
  - Tablas generales («Los que usas») lee `usual_tax_rate_ids` desde la tarea 4.
- **Funciones de la base, en producción.**
  - Los únicos lectores son `compliance_docs_due` (`s.email`) y `migrate_kitchen_core` (`s.email`, `s.phone`, `s.address`). Los dos los sustituye la 0120, y en staging, con la 0120 aplicada, solo nombran el contacto (`c.email`, `c.phone`).
  - `confirm_goods_receipt` y `queue_ctb_order_claim` solo usan `notify_group`, que se queda.
  - `suggest_purchase_qty` y `propose_ai_action` no nombran ninguna de las cuatro.
- **Edge functions desplegadas: 69 de 69 revisadas.** Ninguna lee ni escribe las cuatro columnas.
  - `conta-vies-check` lee `id, tax_id, tax_id_type` y escribe los campos de la comprobación del NIF.
  - `folvy-ai` lee `id, name`.
  - `compliance-doc-notify` usa el campo `supplier_email` que devuelve `compliance_docs_due`. Desde la 0120 sale del contacto de administración o, si no hay, del principal.

## El analizador

Para, como debe, en:
- la **0120**, porque reemplaza dos funciones existentes;
- la **0140**, porque borra cuatro columnas existentes.

Los dos van en `autorizo`.

Al pasarlo aparecieron **dos huecos del propio analizador**, y por ellos la **0110** salía «sigue» aunque cambia datos (`update supplier`):

1. Un comentario `--` dentro de un `do $$ … $$` se comía el resto del bloque, porque el cuerpo se leía con todo en una línea.
2. No miraba las CTE que escriben (`with x as (insert/update/delete …)`).

Arreglados los dos, con sus pruebas. Medido con la misma vara (regla 31): las tandas ya aplicadas del **C00** y del **R02** dan **el mismo veredicto** con el analizador viejo y con el nuevo. Ninguna se analizó mal. Ahora la 0110 **para**, y va en `autorizo`, como ya preveía la respuesta 1.

## Orden en producción

1. **Tanda de datos:** 0100, 0110, 0120 y 0130, con `autorizo` de la 0110 y la 0120.
2. **Fusión del front**, con Vercel en READY. El front lee `usual_tax_rate_ids`, `invoicing_frequency`, `not_duplicate_confirmed_at` y las tablas de la 0130, así que **no se puede fusionar antes** que la tanda de datos.
3. **Comprobación antes = después** en producción, con `scripts/conta/c01b_antes_despues.sql`. Lee las columnas viejas, así que **va antes de la eliminación**.
4. **Tanda de eliminación:** 0140, con `autorizo`.
5. **Después:** regenerar `src/types/database.ts`, que todavía tipa las columnas viejas aunque nadie las lee.
