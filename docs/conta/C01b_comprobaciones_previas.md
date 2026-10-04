# C01b · Comprobaciones previas (tarea 1)

04/10/2026. Antes de escribir código. Producción solo leída (SELECT). Todas las cifras llevan su cuenta (regla 9).
Lo del código, leído en `main` = `52dd7ad` (C00 + R02 + estructura del C01).
**Hay 8 cosas que decidir, al final (§6). Paro aquí.**

Sin nombres ni direcciones reales de proveedores: el repositorio sigue siendo público.

## 1. Qué del C01 está ya en `main` y en producción

| Pieza | `main` | Producción |
|---|---|---|
| `supplier` ampliada: fiscal, pago, IBAN, `usual_vat_rates`, `ledger_account_code`… | sí | **sí**: 49 columnas; siguen las viejas `email`, `phone`, `address` y `notify_group` |
| `supplier_contact` (nombre, papel, teléfono, email, principal, notas) | sí | **sí**, con **0 filas** en todas las cuentas |
| `expense_category` | sí | sí |
| Pagos de factura | sí | sí, **como columnas** de `supplier_invoice` (`due_date*`, `paid_at`, `paid_method`, `paid_by*`), no como tabla aparte |
| `compliance_document` | sí | sí |
| Ficha del C01 (`conta/pages/FichaProveedorPage`, `ProveedoresPage`, `conta/apartados/*`, `proveedorService`) | **sí, pero sin ruta**: no se llega a ella desde ningún sitio | — |
| Movimiento de datos (email, teléfono y dirección a la fuente nueva) | no | no |
| `compliance_docs_due` leyendo del contacto | no | no: lee `supplier.email` |

La tanda del C01 entró por el workflow con `psql`, así que **no aparece** en `supabase_migrations.schema_migrations`. Lo que vale es lo que hay en la base (tabla de arriba).

## 2. Quién usa `supplier.email`, `.phone`, `.address`, `.notify_group` (y `.usual_vat_rates`)

Mismo criterio que el R02: manda lo desplegado.

### En la base de producción
| Objeto | Qué hace | Columna |
|---|---|---|
| `compliance_docs_due(integer)` | `left join supplier s` y devuelve `s.email` como `supplier_email` | email (lee) |
| `confirm_goods_receipt(uuid)` | `select notify_group into v_notify from supplier` | notify_group (lee) |
| `queue_ctb_order_claim(uuid)` | lo mismo, para pedidos | notify_group (lee) |
| `migrate_kitchen_core(uuid,uuid,boolean)` | al clonar la plantilla en una cuenta nueva, **copia** `email, phone, address` | las tres (lee y escribe) |
| Disparadores sobre `supplier` | solo `trg_supplier_updated_at` | ninguna |
| Crons | `compliance-doc-notify` llama a la función de borde del mismo nombre | email (indirecta) |

### Funciones de borde desplegadas (69, revisadas todas)
- **Ninguna lee ni escribe las cinco columnas en `supplier`.** Solo dos tocan la tabla: `folvy-ai` (`id, name`) y `conta-vies-check` (`tax_id*`).
- Dependencia indirecta: **`compliance-doc-notify`** manda el correo al `supplier_email` que le da `compliance_docs_due`.
- `ocr-albaran` extrae `supplier_phone/email/address` del albarán y los deja en la sesión de IA; los copia al proveedor el front (abajo).

### Front (`main`)
| Fichero | Uso |
|---|---|
| `kitchen/services/purchaseFormatService.ts` | lee las tres y `notify_group`; `createSupplier`/`updateSupplier` **escriben** email, teléfono y dirección |
| `kitchen/pages/SuppliersPage.tsx` (Cocina › Proveedores) | enseña y edita las tres |
| `supply/services/goodsReceiptService.ts` · `quickCreateSupplier` | **alta desde albarán**: escribe en el proveedor el email, el teléfono y la dirección leídos por el OCR |
| `supply/services/ctbNotifyService.ts` | depende de `notify_group = 'ctb'` (vía `confirm_goods_receipt`) |
| `conta/services/tablasService.ts`, `conta/tablas/usadas.ts`, `conta/lib/opcionesFicha.ts`, `conta/services/proveedorService.ts` | leen `usual_vat_rates` **como números** (cambia con §3 del encargo) |
| `purchaseOrderPdf.ts` | **no**: la dirección y el teléfono del pedido son del **local** |

## 3. Proveedores en producción

| Cuenta | Prov. (activos) | NIF | Email | Teléfono | Dirección (con CP) | Calle estructurada | `notify_group` | `usual_vat_rates` | Contactos | Facturas (vencim. · pagadas) | Documentos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Foodint** | 19 (14) | 5 | 1 | 3 | 4 (2) | 0 | 4 (`ctb`) | 0 | 0 | 1 (0 · 0) | 26 |
| Folvy Interno (plantilla) | 23 (19) | 3 | 1 | 2 | 2 (1) | 0 | 0 | 0 | 0 | 0 | 0 |
| Kitchen Grill LstQ | 0 | — | — | — | — | — | — | — | — | — | — |

- **Lo que se mueve es poco:** en Foodint, 1 email, 3 teléfonos y 4 direcciones (2 con CP; las otras 2 son cortas, con una coma, tipo «calle, población»).
- **Documentos de Foodint:** 26, de los que solo **6 tienen proveedor** (2 proveedores), y **ninguno de esos tiene email**. `compliance_reminder_log` de Foodint: **0 envíos**. Cambiar de dónde saca el email `compliance_docs_due` no cambia ningún correo que salga hoy.
- **`usual_vat_rates` está vacío en todas las cuentas**: pasar a referencias de `tax_rate` no tiene filas que convertir en producción.

## 4. Qué hace la pantalla vieja (Cocina › Proveedores) que la maqueta no enseña

| La pantalla vieja | En la maqueta | Propuesta |
|---|---|---|
| **Listado** con búsqueda por nombre/CIF, nº de artículos, píldora «incompleto» sin CIF, «Nuevo proveedor» | solo hay ficha | listado en estilo nuevo, con el % de ficha en vez de «incompleto» (§6.1) |
| **Registro sanitario** (RGSEAA) | no sale | en Datos fiscales (§6.1) |
| **«Cómo factura»** (`iva_incluido_en_linea`: IVA dentro del importe de línea o al pie) | no sale | en Contabilidad; lo usa la lectura de albaranes (§6.1) |
| **Notas** | no sale | en Datos fiscales, al final (§6.1) |
| **Archivar** | no sale | en «Editar», con confirmación (§6.1) |
| **Migrar artículos a otro proveedor** (y archivar el origen) | en el bloque «Artículos» | igual, dentro del bloque |
| Por artículo: **principal**, **precio pactado**, precio, quitar | bloque «Artículos que le compras» | se mantiene entero, en estilo nuevo |

## 5. Semillas de staging

| Caso que pide el encargo | Lo hay | Dónde |
|---|---|---|
| Con email y sin email | sí | Hermanos Ruiz, Carnes Sur / Panadería Luna, Limpiezas Brillo |
| Con dirección libre | **solo con CP**; **falta una sin CP** | Hermanos Ruiz |
| Facturas pagadas y por pagar | sí | Hermanos Ruiz (3 pagadas, 1 por pagar), Carnes Sur (1 por pagar) |
| **Repetida** (mismo número e importe) | **no** | — |
| **Con documentos** | **no** | — |
| **Con artículos** (para «Artículos que le compras» y «Migrar») | **no** | — |

Los que faltan los añado en la tarea 2, con datos inventados y la forma de los reales.

## 6. Lo que necesito que decidas

1. **Lo de la pantalla vieja que no está en la maqueta (§4).** ¿Vale la propuesta? En concreto: el **listado** en estilo nuevo (la maqueta no lo dibuja); y **registro sanitario, «Cómo factura», notas y archivar**, donde digo.
2. **`notify_group`** no es un dato de contacto, es una marca de negocio («avisar a la central», `ctb`), y la leen dos funciones del camino de las recepciones y los pedidos. Propuesta: **se queda en `supplier`**, no se elimina, y se enseña en «Cómo le pagas» o «Contactos» como «Avisar a la central al recibir». ¿O la quieres en otro sitio?
3. **¿A quién manda `compliance_docs_due` los documentos?** Propuesta: el contacto con papel «administración»; si no hay, el principal. Hoy no cambia ningún envío (§3).
4. **La plantilla (Folvy Interno).** Sus 23 proveedores también tienen email, teléfono y dirección viejos, y `migrate_kitchen_core` los copia a cada cuenta nueva. Propuesta: el movimiento de datos **incluye la plantilla**, y `migrate_kitchen_core` pasa a copiar contactos y dirección estructurada. Es la función del alta de cuentas: no está en el camino del pedido, pero la toca este encargo.
5. **El alta desde albarán** (`quickCreateSupplier`) pasa a crear el contacto principal y la dirección propuesta «por confirmar», en vez de escribir las columnas viejas. ¿De acuerdo?
6. **La ficha del C01 que está en `main` sin ruta.** Propuesta: aprovechar su núcleo y sus servicios (NIF/IBAN/VIES, completitud, contactos), y **borrar sus pantallas** al hacer las nuevas. Así no queda código sin uso que parezca vivo.
7. **Quién la ve.** «Compras › Proveedores» pasa a ser la ficha nueva para todas las cuentas, Foodint incluida. Hoy está en el menú de **Folvy Kitchen** («Proveedores», ruta `/kitchen/proveedores`, encargado con el permiso `show_proveedores`). ¿Se queda ahí, con la ficha nueva dentro y los mismos permisos, o la mueves al menú de Folvy Supply?
8. **`usual_vat_rates` a referencias de `tax_rate`**: en producción no hay filas que convertir. El cambio toca a la vez el C00 (tablas generales, «usadas»), que hoy lo lee como números. ¿Va en este encargo, como dice §3, o aparte?
