# C01 · Ficha de proveedor completa — comprobaciones previas (sección 2)

01/10/2026. Hechas antes de escribir una línea de código, como pide el encargo.
**Resultado: hay discrepancias con el encargo, así que no se ha escrito código.**
Las decisiones que hacen falta están al final.

Todo lo que viene de la base se ha medido el 01/10 con `account_id` delante
(regla 9). Lo del código, leído en `origin/main` = `f58ce1d`.

---

## 0. Antes de las comprobaciones: dos cosas que no casan con el encargo

### 0.1 Las maquetas no han llegado
`Proveedor.dc.html` y `ProveedorMovil.dc.html` no venían adjuntas al encargo y
no están en el repositorio. Las únicas `*.dc.html` del repo son las de
`claude/maqueta/modificadores/`. La sección 6 dice «lo construido tiene que
ser fiel a la maqueta»: sin ella, la pantalla no se puede empezar.

### 0.2 Los «42 proveedores» son de dos cuentas
| Cuenta | Proveedores | Con NIF | Con dirección | Con email | Con teléfono | `notify_group` |
|---|---|---|---|---|---|---|
| Foodint (producción) | **19** | 5 | 4 | 1 | 3 | 4 (`ctb`) |
| Folvy Interno (plantilla) | 23 | 3 | 2 | 1 | 2 | 0 |
| **Las dos** | 42 | 8 | 6 | 2 | 5 | 4 |

Las cifras del encargo (42 · 8 · 6 · 2) son las de **toda la tabla**: suman el
catálogo plantilla. De Foodint son 19 · 5 · 4 · 1. Facturas de proveedor en
toda la base: **1** (Foodint, `status = 'aprobada'`).

---

## 2.1 Cómo sale Folvy en móvil y tablet

- **Capacitor 8, sí** (`capacitor.config.ts`, `appId: 'app.folvy.pos'`,
  `webDir: 'dist'`).
- **OTA con el plugin de Capgo, pero autoalojado, no Capgo Cloud.**
  - `@capgo/capacitor-updater` con `autoUpdate: false`.
  - El paquete (`bundle-N.zip` + `bundle.json`) lo publica
    `.github/workflows/build-apk.yml` en el bucket `apps` de Supabase Storage.
  - La tablet lo baja y lo aplica por su cuenta: `src/native/appUpdate.ts` y
    `src/components/UpdateGate.tsx`.
- **Android hoy: sí, APK firmado**, por `build-apk.yml`.
  - Sólo se compila en nativo con un push a `main` que lleve `[apk]` en el
    mensaje o que toque `android/` o `capacitor.config.ts`.
  - Se publica como `apps/folvy.apk`, para instalar a mano. **No hay subida a
    Google Play.**
- **iOS hoy: no.** No hay carpeta `ios/`, ni `@capacitor/ios`, ni proyecto de
  Xcode, ni firma de Apple, ni ningún trabajo de macOS en la CI. Además, el
  plugin propio de impresión (`EscposPrinterPlugin.java`) sólo existe en Java.
- **Mismo código en web y nativo: sí.** Vercel y la app salen del mismo
  `src/` con `vite build`. Las ramas nativas se deciden en ejecución con
  `Capacitor.isNativePlatform()`.
- **Cámara.**
  - `@capacitor/camera` **no está instalado**, y el manifiesto de Android no
    pide el permiso `CAMERA`.
  - El lector de QR usa el Code Scanner de ML Kit a través del plugin propio
    (en nativo) y `getUserMedia` (en web).
  - «Foto factura» (sección 6, móvil) necesita un cambio nativo: o el permiso
    `CAMERA` para que funcione `<input capture>` en el WebView, o el plugin de
    cámara. Cualquiera de los dos obliga a un **APK nuevo**; con OTA no basta.

## 2.2 Interruptor por cuenta

**Existe y es genérico, pero está dormido.**

- **Tabla `feature_flags`:** clave `(account_id, feature_key)`, con `enabled`,
  `source` (`subscription | trial | manual_grant | internal`) y `expires_at`.
  - RLS: la lee el propio usuario; la escribe sólo un administrador.
  - **Filas hoy: 0.**
- **En el front:** `src/platform/feature-gate/featureGateService.ts` y
  `useFeatureGate.ts`.
  - API: `gate.has(key)`, `hasAny`, `hasAll`.
  - `App.tsx` la carga al entrar, y **nadie en `src/` la consulta**.
- **Catálogo comercial:** `modules` → `submodules.features` (jsonb) →
  `subscription_items`. Ninguna función pasa las suscripciones a
  `feature_flags`.
- **Propuesta:** usar `feature_flags` tal cual, con la clave
  `conta.supplier_ledger` (o la que se decida), dada de alta a mano
  (`source = 'manual_grant'`). No se crea ningún mecanismo nuevo.

## 2.3 Usos de `supplier.email`, `phone`, `address` y `notify_group`

### En el código (`src/`)
| Dónde | Qué hace | Lee / escribe |
|---|---|---|
| `kitchen/services/purchaseFormatService.ts:52-120` (`rowToSupplier`, `supplierInsertToRow`, `supplierUpdateToRow`) | El único mapeador del proveedor | lee y escribe email, phone y address; lee notify_group |
| `kitchen/pages/SuppliersPage.tsx:329-354, 423-443, 598+` | La ficha de hoy y el alta | lee y escribe |
| `supply/services/goodsReceiptService.ts:1981-2004` (`quickCreateSupplier`) | Alta rápida desde la recepción, con lo leído del albarán | escribe |
| `supply/pages/GoodsReceiptForm.tsx:1151-1170` | Rellena esa alta con lo leído | escribe (a través de lo anterior) |
| `supply/pages/SupplyOrderDetailPage.tsx:139-143` | `notifyGroup === 'ctb'` activa «reclamar a CTB» | lee notify_group |

### En la base (funciones vivas, medido en `pg_proc`)
| Función | Uso |
|---|---|
| `compliance_docs_due` | lee `s.email` |
| edge `compliance-doc-notify` | manda con Resend al **email del proveedor** el aviso de ficha técnica caducada. **Es el único envío automático que usa el email del proveedor.** |
| `confirm_goods_receipt` | lee `notify_group` y, si es `ctb`, encola en `ctb_notification_queue` |
| `queue_ctb_order_claim` | lee `notify_group` para lo mismo |
| `migrate_kitchen_core` | menciona `s.email` (migración antigua de núcleo, fuera del camino vivo) |

### Lo que NO los usa
- **Los pedidos a proveedor no salen con estos datos.**
  `purchaseOrderPdf.ts` sólo lee el nombre del proveedor; el envío es a mano
  (compartir por la web o WhatsApp).
- `ctbNotifyService`, `supplierInvoiceService` y `folvy-ai` sólo leen id,
  nombre y NIF.

### Lo que cambia respecto al encargo
- **`notify_group` no es un dato de contacto.** Marca a qué grupo de avisos
  pertenece el proveedor (los 4 de Cloudtown con `ctb`), y la cola se trabaja
  a mano por el grupo de WhatsApp.
  - El punto 4.3 no lo pasa a contactos, y propongo **dejarlo como está**.
  - Lo que sí pasaría a `supplier_contact` (papel `admin`) es el destinatario
    del aviso de `compliance-doc-notify`.
- **7.7 pide comprobar que «los pedidos y avisos que usaban esos datos siguen
  funcionando».** De pedidos no hay ninguno. De avisos hay **uno**, el de ficha
  técnica caducada.

## 2.4 Qué devuelve la lectura automática

- **La lectura:** la hace la edge `ocr-albaran` (lee albaranes **y**
  facturas). Guarda el resultado en
  `goods_receipt_ai_session.parsed_result->'document'`.
- **Los enlaces:** `goods_receipt.ai_session_id` y
  `supplier_invoice.ai_session_id`. Este último no tiene clave ajena.

| Dato del emisor | ¿Lo extrae? | Clave |
|---|---|---|
| NIF | **Sí** | `supplier_tax_id` |
| Razón social | **Sí** | `supplier_name` (el prompt lo pide como razón social) |
| Dirección | **Sí**, en un solo texto | `supplier_address` (domicilio fiscal, no el de entrega) |
| Teléfono y email | Sí | `supplier_phone`, `supplier_email` |
| **IBAN** | **No** | no está ni en el prompt ni en el tipo |

**Consecuencia para 5.4:** hoy se puede proponer el NIF, la razón social y la
dirección. Para proponer el **IBAN** hay que ampliar el prompt de
`ocr-albaran`, y eso toca una edge function que no está en el alcance escrito.

## 2.5 `analysis_account`

- **Qué es:** una tabla de la base inicial: un árbol de «cuentas de análisis»
  (estilo Tspoon), por cuenta, con `code`, `name`, `parent_id` y
  `account_type`.
- **Dónde se usa:** tiene un servicio CRUD
  (`multitenancy/services/analysisAccountsService.ts`) que **no importa
  ninguna pantalla**. Ninguna edge la usa y ninguna tabla tiene
  `analysis_account_id`.
- **Conclusión:** no se usa en ningún sitio. No se toca.

---

## Otras cosas medidas que afectan al plan

- **Dónde vive la ficha hoy.** `/kitchen/proveedores`, en el módulo Cocina:
  lista y detalle en `SuppliersPage.tsx`, el detalle en un cajón y sin ruta
  propia. **No existe un menú «Compras»**: las migas «Compras › Proveedores ›
  nombre» de la maqueta no tienen dónde apoyarse.
- **Migraciones «primero en local o en una rama de Supabase» (7.1).**
  - En local no se puede: el Docker de este entorno arranca, pero la política
    de red bloquea la descarga de la imagen de Supabase.
  - Una **rama de Supabase** sí se puede crear desde aquí, pero **tiene coste**
    y necesita tu confirmación.
- **Pruebas de extremo a extremo y de RLS (7.3 y 7.4).**
  - El repo no tiene Playwright como dependencia; las pruebas son Vitest.
  - Para entrar en la app hacen falta **usuarios de prueba**, y para la RLS
    dos de cuentas distintas. Hoy no tengo ninguno, y no voy a fabricar
    sesiones con cuentas reales.
- **RLS de `supplier`:**
  - SELECT con `belongs_to_account(account_id)`.
  - UPDATE y DELETE con `current_user_is_admin_or_manager_of(account_id)`.
  - INSERT con `with check`.
  - Las tablas nuevas copiarían esto.
- **`compliance_document.doc_family`** tiene un CHECK con 9 familias. Añadir
  `bank_ownership_certificate` es **DROP + ADD del CHECK**, que toma
  `ACCESS EXCLUSIVE`; fuera de banda.
