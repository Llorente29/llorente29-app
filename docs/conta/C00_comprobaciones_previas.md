# C00 · Comprobaciones previas (tarea 1)

> 02/10/2026. Rama `conta/c00-empresa-y-tablas`, creada desde
> `conta/c01-ficha-proveedor` (`559c92f`). Todo en **solo lectura**: SELECT en
> producción (`xzmpnchlguibclvxyynt`) y en staging-conta
> (`oseymswjlzplqoxrfjzi`), lectura del código y búsqueda en la web. No se ha
> escrito nada en ninguna base ni cambiado código.
>
> **Aviso de método (regla 5).** Desde este contenedor, el proxy de salida
> **bloquea** `boe.es`, `sede.agenciatributaria.gob.es`, `ine.es`,
> `datos.gob.es`, `datos.canarias.es`, `ec.europa.eu` y `registradores.org`.
> Lo que se dice de esas fuentes sale del **extracto del buscador**, no del
> texto leído entero, y va marcado **[extracto]**. Lo marcado **[leído]** se
> ha abierto de verdad. Ningún valor [extracto] entra en una tabla de serie
> sin leerlo antes en la fuente (ver bloqueo B1).

## Lo que necesito que decidas (por esto paro)

| # | Decisión | Lo que propongo |
|---|---|---|
| D1 | Cómo conviven los impuestos nuevos con `vat_rate`/`vat_category` (§4.2 del encargo) | Tabla de **impuestos por tipo** como única fuente del porcentaje, y `vat_category` (clases de producto de Cocina) apuntando a ella con vigencia. Detalle en §2.4 |
| D2 | Si el alta de la empresa puede **proponer** los datos que ya tiene la cuenta (`accounts.legal_name`, `cif`, `billing_address`) | Sí, como propuesta con origen «importado de los datos de tu cuenta», nunca creando la empresa sola. Detalle en §1.4 |
| D3 | Razón social a partir del NIF: la maqueta N1 dice «He buscado tu NIF… Del censo» y no hay fuente gratuita que lo haga | La persona escribe el nombre. Opciones de pago en §5 |
| D4 | El asesor en la maqueta N1 («Julián, tu asesor, lo está viendo», su comentario) no está en el encargo | No construirlo en el C00; dejar el hueco |
| D5 | La maqueta N3 abre en «Los que usas» y dice al pie que el resto está en «Todos». Choca con la **regla 7** de `CLAUDE.md` | Abrir siempre con todas las filas: primero las que usas, el resto debajo con la etiqueta «No lo usas». «Los que usas» queda como filtro que la persona elige |
| D6 | Plazos de pago 30/60/90: una factura tendría varios vencimientos, y hoy `supplier_invoice` guarda uno | En el C00, solo definir los plazos y la función pura que reparte los vencimientos. Guardarlos por factura va con pagos y cobros |
| D7 | Cómo leer las fuentes oficiales (BOE, AEAT, INE) | Abrir esos dominios en la red del entorno; o cargar los valores desde un workflow de GitHub Actions, que sí tiene salida. Ver B1 |

**Bloqueo B1, la red.** Para cargar los valores de serie (§4.4) y para el agente «Normativa al día» (§9.2) hay que leer BOE, AEAT e INE. Desde aquí no se puede. O se añaden al entorno los dominios `boe.es`, `www.boe.es`, `sede.agenciatributaria.gob.es`, `www.agenciatributaria.es`, `www2.agenciatributaria.gob.es`, `ine.es`, `www.ine.es`, `datos.gob.es`, `datos.canarias.es` y `ec.europa.eu` (menú del entorno de la sesión → Edit → Network access), o la descarga la hace un workflow en GitHub Actions y deja los ficheros en el repositorio con su fecha y su URL. Los agentes nocturnos van por Actions de todos modos.

---

## 1. Cuenta y usuarios

### 1.1 `accounts`
Producción, por `information_schema`: 41 columnas. Las fiscales son `name` (NOT NULL), `legal_name`, `cif`, `billing_email`, `billing_phone`, `billing_address` (jsonb, por defecto `{}`), `country` (NOT NULL, `'ES'`) y `currency` (`'EUR'`). El resto es de estado, Stripe y tienda.

- **Sin validación fiscal:** ningún CHECK sobre `cif`, y `billing_address` es un jsonb libre.
- **Filas:** 3. Folvy Interno (`legal_name='Folvy'`, sin CIF), Kitchen Grill LstQ (suspendida) y **Foodint**. Foodint, medido:
  `Llorente29 Food, S.L. · B56496938 · {"city":"Madrid","street":"Florencio Llorente, 29","province":"Madrid","postalCode":"28027"}`.
- **Seguridad por filas** (`pg_policy`):
  - `accounts_read_own` (lectura): sus cuentas, o administrador de plataforma.
  - `accounts_write_admin` (todo): **solo administrador de plataforma**.
  - `auth_admin_read_accounts`.

  O sea: **el administrador de Foodint no puede cambiar hoy ni su NIF ni su razón social.** Solo se cambian desde el panel de plataforma (`src/admin/pages/CuentaDetallePage.tsx:357`, `NuevaCuentaPage.tsx:127`).
- **Locales** (`locations`): solo `address` (texto libre) y `city`. Sin CP, provincia, NIF ni territorio fiscal.

### 1.2 Usuarios y cuentas
- **`user_profiles`:** `(user_id, account_id)` único, `role` ∈ admin/manager/worker y `active`. Un usuario puede estar en varias cuentas, una fila por cuenta. Hoy ninguno lo está.
- **Administrador de plataforma:** tabla aparte, `platform_admins` (1 fila).
- **Funciones de permiso:** `current_user_account_ids()`, `current_user_is_admin()`, `current_user_is_admin_of(acc)` y `current_user_is_admin_or_manager_of(acc)`. Todas SECURITY DEFINER.
- **`custom_access_token_hook`** pone en el token `folvy.*`: `current_account_id`, `active_accounts[]` (id, slug, role, profile_id) y `is_platform_admin`.
- **Para el C00:** la RLS de `company` y de sus tablas puede ser la de `supplier`, por `account_id` con estas funciones. «Solo lo ven los administradores» (`company_person`) sale de `current_user_is_admin_of(account_id)`.

### 1.3 Quién lee hoy los datos fiscales de la cuenta
- **Para cabeceras de PDF y Excel:**
  - el pedido a proveedor (`supply/services/purchaseOrderPdf.ts:119-187`);
  - APPCC y alérgenos (`complianceDocumentService.ts:472`, `allergenComplianceService.ts:149`);
  - registro de jornada, exportación a gestoría, formación y fichajes (`src/services/*Pdf/*Excel`);
  - `StaffPage`, `PlantillaPage`, `CoursesPage` y `ClockoutReminderReportPage`.
- **Funciones del servidor:** ninguna lee `cif` ni `legal_name` de la cuenta. `stripe-connect-onboard` solo lee `billing_email` y `country`.

### 1.4 Qué significa para la empresa del C00
- **La cuenta ya tiene una «empresa» implícita** (una razón social y un CIF), que usan los PDF. El encargo pide **varias empresas por cuenta** y que **ninguna nazca sola**.
- **Propuesta (D2):**
  - `company` es la fuente nueva.
  - `accounts.legal_name`/`cif` siguen como están para los PDF de hoy. Cambiar esos PDF para que lean la empresa va como pendiente.
  - El alta **propone** los datos de la cuenta, marcados «importado de tu cuenta». Solo se guardan si la persona sigue.

---

## 2. Impuestos que ya existen

### 2.1 Estructura (producción)
- **`vat_category`:** `code` UNIQUE, `name`, `sort_order` e `is_active`. Es **global**, sin `account_id`.
- **`vat_rate`:** `category_id` (FK a la categoría), `rate`, `equivalence_surcharge`, **`valid_from`/`valid_to`** y `note`.
  - **Ya tiene vigencias y recargo.**
  - **No tiene** territorio (IGIC/IPSI), referencia legal estructurada (va como texto en `note`) ni guarda contra solapes: `vat_rate_for` los tapa con `ORDER BY valid_from DESC LIMIT 1`.
- **`family_vat_default`:** `family_name` UNIQUE → `vat_category_id`. Global, y se cruza con `recipe_family.name` **por nombre y sin cuenta** (regla 9).
- **Seguridad por filas:** las tres tienen lectura `true` para `authenticated` y ninguna política de escritura.
- **Quién apunta a ellas:** `recipe_item.vat_category_id`, `supplier_invoice_line.vat_category_id` y `family_vat_default`. A `vat_rate` no apunta nadie.

### 2.2 Filas (medido hoy en producción, catálogo global entero)
6 tipos, 5 categorías y 16 familias.

| Categoría | % / recargo | Vigencia |
|---|---|---|
| `aceite_oliva` | 2,00 / 0,26 | 01/10/2024 → 31/12/2024 |
| `aceite_oliva` | 4,00 / 0,50 | 01/01/2025 → |
| `alimento_basico` | 4,00 / 0,50 | 01/01/2025 → |
| `alimento_general` | 10,00 / 1,40 | 01/01/2025 → |
| `bebida_alcoholica` («Bebida o azúcar») | 21,00 / 5,20 | 01/01/2025 → |
| `no_alimentario` | 21,00 / 5,20 | 01/01/2025 → |

- **No hay** exento, 0 %, IGIC ni IPSI, ni ningún tipo anterior a 10/2024. Una factura de 2024 no encuentra tipo.
- **Staging-conta tiene las tres tablas vacías** (0, 0 y 0). Hay que sembrarlas en la tarea 4.
- El 21 % está repetido en dos categorías y el 4 % también. Un cambio del tipo general obligaría hoy a editar varias filas.

### 2.3 Quién las usa
- **SQL:**
  - `vat_rate_for(uuid, date)`, que llaman `run_invoice_match`, `vatService.ts:50` y `purchaseOrderPdf.ts:160`;
  - `propose_vat_category` y el disparador `trg_recipe_item_propose_vat` (sobre `recipe_item`, al cambiar la familia).
  - 0 vistas y 0 crons.
- **Pantallas:**
  - ficha de artículo de Cocina (`ItemVatSelector`, `vatRateService.ts`);
  - revisión de albaranes (`ReceiptOfficeReview.tsx:166`);
  - facturas de proveedor (`supplierInvoiceService.ts:155-232`);
  - PDF del pedido.
- **`ocr-albaran`** no consulta las tablas: el modelo extrae `vat_pct` y la función valida por base imponible.
- **El camino del pedido no lee estas tablas.** Lo que sí lee `upsert_pos_sale` es la **columna** `menu_item.vat_rate`, con `coalesce(…, 10)`. Las 646 cartas de Foodint están al 10 %.

### 2.4 Porcentajes escritos a mano (no se hablan entre sí)
- `supply/lib/lineCost.ts:50`: `TIPOS_IVA = [4, 10, 21]`.
- `conta/apartados/DatosFiscales.tsx:26`: `[0, 4, 5, 10, 21]`. El 5 % no está en `vat_rate`.
- `kitchen/services/channelRateService.ts:18`: `SERVICE_VAT_PCT = 21`. Su propio comentario pide moverlo a un modelo versionado.
- `menuItemService.ts` y `KitchenSettingsPage.tsx`: `?? 10`.
- **El ticket impreso desglosa siempre al 10 %** (`native/print/ticketRenderer.ts:169`, `total / 1.10`), y también `ZonasPedidoPage.tsx`.

### 2.5 Propuesta para D1: una sola fuente del porcentaje

Hoy `vat_rate` mezcla dos cosas: **qué tipo es** (general, reducido, superreducido…) y **a qué producto se aplica**. La maqueta N3 enseña una fila por **tipo**, con su historial («10 % desde 01/09/2012 · 8 % del 01/07/2010 al 31/08/2012»).

**A. Tabla nueva de impuestos por tipo, con puente (la que recomiendo)**
- `tax_rate`: tipo, sistema (IVA/IGIC/IPSI), territorio, %, recargo, vigencia, `legal_ref`, `verified_at`, cuentas indicadas y modelo donde se declara. Es la que pinta N3.
- `vat_category` pasa a decir **qué tipo** le toca, con vigencia: un puente `vat_category_rate`.
- `vat_rate_for(uuid, date)` se reescribe para leer por ese camino, con **la misma firma y el mismo resultado**. Se demuestra con las 6 filas de hoy, antes y después (regla 31).
- `vat_rate` se queda (las migraciones solo añaden), sin escritura nueva, y una prueba de cumplimiento comprueba cada noche que coincide con lo derivado hasta que se retire.
- **Ventajas:**
  - un cambio del tipo general es **una fila**;
  - IGIC e IPSI encajan por territorio;
  - el aceite al 2 % es un tipo temporal con su norma.

**B. Ampliar `vat_rate`**
- Añadir `tax_system`, `territory`, `legal_ref` y un EXCLUDE contra solapes.
- Es menos cambio, pero el porcentaje sigue repetido por categoría y la pantalla N3 tendría que agrupar filas para enseñar «IVA general».

**En las dos opciones:**
- **Exento, intracomunitario e inversión del sujeto pasivo no son tipos: son tratamientos de la operación.** Van en un catálogo pequeño, que sustituye al CHECK `supplier_vat_regime_check` del C01.
- **Los documentos guardan una foto** (`vat_pct` y recargo copiados) además de la referencia. Una factura no cambia porque cambie la ley.

**Riesgo medido:** ningún disparador de venta, consumo o stock lee estas tablas. Un `ALTER` sobre `vat_category` toma un cierre exclusivo breve y `recipe_item` la referencia, así que va **fuera de la banda** de 12:15 a 00:30. `menu_item.vat_rate` y `upsert_pos_sale` **no se tocan en el C00**.

---

## 3. De dónde salen hoy, en la ficha del C01, el IVA, el régimen, la forma de pago y el plazo

**Todo está escrito en la pantalla; nada sale de una tabla.**

| Dato | En la pantalla | En la base |
|---|---|---|
| Casillas de IVA 0/4/5/10/21 | `DatosFiscales.tsx:26`, `TIPOS_IVA` | `supplier.usual_vat_rates numeric[]`, sin relación con ninguna tabla: acepta cualquier número |
| Regímenes de IVA (6) | `conta/types.ts:103`, `VAT_REGIME_LABEL` | CHECK `supplier_vat_regime_check` con los mismos 6 |
| Formas de pago (4) | `conta/types.ts:96`, `PAYMENT_METHOD_LABEL` | CHECK `supplier_payment_method_check` y `supplier_invoice_paid_method_check` con las mismas 4 |
| Plazo | Un número de días (`Pago.tsx:110`) más días fijos del mes | `payment_terms_days` (0–365) y `payment_fixed_days smallint[]` |

- **Para la tarea 7:** sacar formas y regímenes a tabla obliga a cambiar los dos lados, la lista de la pantalla y el CHECK de la base.
- **Sobre el plazo:** `calcularVencimiento` (`conta/lib/cifras.ts:88`) da **un** vencimiento: plazo más días fijos. «30/60/90» son tres vencimientos (D6).

---

## 4. La IA de Folvy hoy

### 4.1 Cómo funciona
- **La burbuja:** `src/modules/folvy-ai/components/FolvyAIBubble.tsx`, montada una vez en `src/shell/Shell.tsx:327`.
- **La llamada:** `folvyAIService.ts:85-104` llama por streaming (SSE) a la función **`folvy-ai`**, con el JWT del usuario.
  - Manda `account_id`, `module`, `surface`, `context` y `history`.
  - El historial vive solo en el cliente.
- **El servidor:** `supabase/functions/folvy-ai/index.ts` llama a la API de Anthropic con `fetch` y `ANTHROPIC_API_KEY`.
  - **Modelo:** `FOLVY_AI_MODEL` del entorno, o el del agente, o `claude-sonnet-4-6` por defecto (`:23`, `:710`). Hasta 5 vueltas de herramientas.
  - **Agentes por módulo** (`AGENTS`, `:608`): `kitchen`, `supply` y un generalista para el resto. **Añadir un agente `conta` es una entrada nueva.**
- **Qué puede leer:** las herramientas usan el **JWT del usuario**, así que manda la RLS.
  - Leen `sale_line`, `menu_item`, `supplier`, `locations`, `recipe_item`, `stock_movement` y `article_supplier`, más dos RPC.
  - El `account_id` llega en el cuerpo y no se contrasta con el token; lo frena la RLS.
  - El *service role* solo se usa para escribir el registro.
- **Qué puede hacer: nunca escribe directamente.** Propone con `propose_ai_action` (SECURITY DEFINER, exige ser administrador de la cuenta) una fila `proposed` en **`ai_action`**, con `summary`, `args`, `effect_preview` y `rollback_hint`. La persona confirma, y `commit_ai_action` ejecuta y deja `executed` o `failed`.
- **Cómo se registra:**
  - `ai_interaction` guarda cada turno (modelo, herramientas, tokens);
  - `ai_action` es el libro de acciones;
  - `ai_memory` existe pero tiene 0 filas.
  - En producción: 51 interacciones (Foodint 24, la última el 02/08) y 10 acciones.

### 4.2 Lo que falta para las reglas 3 y 4 del encargo (medido)
- **No existe rechazar.** «Cancelar» solo cambia el estado en pantalla (`useFolvyAI.ts:312`), y la fila se queda `proposed` para siempre.
- **No existe deshacer.** El estado `rolled_back` existe, pero ninguna función lo escribe, y `rollback_hint` es texto libre.
- La propuesta no guarda `session_id`.
- La confirmación dice «Hecho.» sin contenido, en contra de la regla 8.
- **El registro miente en dos sitios:**
  - el saludo de apertura (`surface='opening'`) no cabe en el CHECK de `ai_interaction` y se pierde en silencio;
  - en streaming el estado se guarda siempre como `ok`.

### 4.3 Qué se reutiliza en el C00
- **El chat, el servicio y la tarjeta de acción.** `FolvyAIActionCard` ya permite ajustar argumentos antes de confirmar.
- **El agente `conta`.**
- **`ai_action` como registro**, añadiéndole rechazar, deshacer de verdad (con la entidad destino y el valor anterior estructurados) y `session_id`.
- **«De dónde sale cada dato»** necesita una tabla nueva de origen por campo (persona / IA / importación, motivo y fecha). El patrón validado en la base es el de `modifier_recipe_impact` y `mapping_proposal`: `source`, `confidence`, `rationale` y `confirmed_by/at`.
- **Lo que no se toca en el C00:** la burbuja del resto de Folvy y los fallos de 4.2 que no son de contabilidad. Van a pendientes.

---

## 5. Razón social y domicilio a partir del NIF

**No existe una fuente pública, gratuita y legítima que dé razón social y domicilio partiendo solo del NIF.**

- **AEAT, servicio «Calidad de datos identificativos» (VNifV2)** [extracto; librería documentada [leído] en github.com/marxgavilan/es-aeat-vnif]:
  - **valida un par NIF + nombre** que tú envías y, si se parece, devuelve el nombre del censo;
  - no busca solo por NIF y no da domicilio;
  - exige certificado electrónico (personal, de representante o de sello);
  - coste no publicado, sin verificar.
  - Sirve para **comprobar** lo que escribe la persona, no para autocompletar.
- **VIES** no devuelve nombre ni dirección para España [extracto, fuentes secundarias; la FAQ oficial no se pudo abrir].
- **Registro Mercantil:** nota informativa a unos 2,10 € más extras por asiento [extracto]. Es manual, con certificado, y no tiene API abierta a terceros (solo por convenio).
- **BORME en datos abiertos (BOE):**
  - API gratuita del sumario diario [extracto];
  - no es un buscador por NIF, y no está comprobado que los anuncios lleven el NIF;
  - licencia del BOE: citar la fuente con enlace.
- **Privados** [extracto, precios a 02/10/2026]:
  - **APIEmpresas.es**: gratis hasta 100 consultas, 15 €/mes por 3.000; declara como fuente el BORME y el Registro Mercantil. Condiciones de reutilización sin leer.
  - **eInforma (Informa D&B)**: API por NIF, precio no publicado.
  - **OpenCorporates** no sirve para España: sus datos son históricos, de antes de 2011.
  - **LibreBORME** ya no funciona.

**Conclusión (D3):** en el C00, **el nombre lo escribe la persona** y la IA no lo inventa. La frase de la maqueta «He buscado tu NIF: sois…» solo puede decirse si se contrata un proveedor. Si quieres, se valida después con VNifV2 usando el certificado de la empresa, en un encargo aparte.

---

## 6. Catálogos oficiales (IAE y CNAE)

- **IAE** (RDL 1175/1990):
  - el texto está en el BOE consolidado (BOE-A-1990-23930), pero no es un fichero de datos;
  - **fuente propuesta: ISTAC `CL_IAE`**, con secciones, divisiones, agrupaciones, grupos y epígrafes en CSV, XLSX o JSON, y API en `datos.canarias.es` [extracto];
  - licencia CC BY 4.0 por defecto en los datos del Gobierno de Canarias [extracto]. Falta confirmar la ficha concreta;
  - alternativa: el «Listado de actividades económicas» de la AEAT en xlsx (para el pre-303), sin comprobar si cubre la tarifa entera.
- **CNAE:**
  - **la vigente es la CNAE-2025** (Real Decreto 10/2025, BOE-A-2025-616, en vigor desde el 16/01/2025) [extracto, varias fuentes]. Hay una contradicción entre extractos sobre si la CNAE-2009 queda derogada, y la resolverá el texto del BOE;
  - fuente: **INE**, estructura en xlsx y **correspondencia CNAE-2009 ↔ CNAE-2025**;
  - licencia CC BY 4.0, citando «Fuente: INE» con la fecha [extracto].
- **IAE ↔ CNAE:** el INE no publica correspondencia. La AEAT tiene un **buscador** que relaciona epígrafes con CNAE-2025 «desde el 1 de enero de 2026», pero no un fichero descargable [extracto]. La relación es de muchos a muchos.
- **Consecuencia para la maqueta:** los códigos que enseña (CNAE 5610, 5621) hay que comprobarlos contra la **CNAE-2025** cuando se pueda leer la fuente. Puede que sean de la 2009.
- **Propuesta:** IAE desde ISTAC `CL_IAE`, CNAE-2025 desde el INE, y la correspondencia IAE → CNAE construida **solo con lo que diga el buscador de la AEAT**, con fecha y referencia. Lo que no esté ahí no se deduce, y la persona lo elige a mano.

---

## 7. Tipografías y colores

**Geist y Geist Mono**
- **Licencia:** SIL OFL 1.1 [leído, LICENSE.txt del repositorio de Vercel]. Uso comercial permitido.
- **El paquete npm `geist` es solo para Next.js** (`peerDependencies: next`) [leído].
- **Propuesta:** `@fontsource-variable/geist` y `@fontsource-variable/geist-mono` (OFL, versión 5.3.0) [leído]. Las letras van **dentro de la app**, sin Google Fonts: sin depender de un tercero en tiempo de ejecución, y funcionan en las tablets aunque falle la red.
  - Se importan **solo desde el componente raíz del módulo de contabilidad**.
  - Aunque Vite deje la regla `@font-face` en el CSS común, el navegador **solo descarga una letra cuando algo en pantalla la usa**. Como `font-family: 'Geist Variable'` solo se aplica dentro del contenedor del módulo, el resto de Folvy no descarga nada.
- Hoy el C01 carga Fraunces e Inter desde Google Fonts en `index.html`. Con el estilo nuevo, Fraunces deja de hacer falta (pendiente quitarla cuando el C01 termine encima del C00).

**Colores en un único sitio**
- Un fichero, `src/modules/conta/estilo/tokens.css`, con variables CSS con nombre (`--c-texto`, `--c-azul`, `--c-ia`…), colgadas solo del contenedor del módulo.
- Ningún componente lleva un hex escrito. Cambiar un color es cambiar una línea.
- **Contraste medido** (WCAG):

| Combinación | Contraste |
|---|---|
| Texto sobre fondo | 16,29 |
| Apoyo sobre blanco | 5,81 |
| Apoyo sobre fondo | 5,41 |
| Blanco sobre azul (botón) | 5,17 |
| Azul sobre azul suave (menú activo) | 4,53 |
| Verde oscuro sobre verde suave | 4,92 |
| Ámbar | 6,11 |
| Texto sobre verde IA | 10,82 |

  Todas pasan el 4,5:1. **El verde de la IA (`#2EE6A8`) sobre blanco da 1,62**: en las maquetas solo se usa de **fondo** con texto oscuro, nunca como color de letra, y así se mantendrá.
- **Tonos de las maquetas que no están en la tabla del encargo** (les pondré nombre en el mismo fichero):

| Tono | Uso |
|---|---|
| `#C9D0DC` | borde de los campos y botones blancos |
| `#EEF1F5` / `#2B3648` | píldora neutra («Principal», «303 IVA») |
| `#1F4B3C` | texto de apoyo sobre verde suave |
| `#B9EFD8`, `#8FE3C2` | bordes verdes |
| `#C9D7FF`, `#C5D3FF`, `#FFD9A8`, `#E5D4FF`, `#D9F2C4` | pasteles de las iniciales |
| `#F1F3F6` | fondo de lo pendiente |

---

## 8. staging-conta y el workflow de aplicar SQL

Medido el 02/10/2026:

| | staging-conta | producción |
|---|---|---|
| Cuentas | 2, las de prueba (`prueba-norte`, `prueba-sur`) | — |
| Foodint / Folvy Interno | 0 / 0 | — |
| Usuarios | 3 (A, B y el de Julio) | — |
| Perfiles | 3 | — |
| Proveedores | 5 | — |
| Facturas | 5 | — |
| Contactos | 4 | — |
| Crons | 0 | — |
| Migraciones | **536**, última `20261002060718` | **534**, última `20260927095235` |

- La diferencia de migraciones son las 2 del C01. **Producción no ha recibido ninguna migración desde la copia**, y `main` no tiene commits nuevos respecto a la base de esta rama.
- **Staging tiene vacías `vat_rate`, `vat_category` y `family_vat_default`** (§2.2).
- **Edge functions en staging:** `check-account-status` v59, `conta-vies-check` v1 y `folvy-ai` (en la lista, `verify_jwt = true`).
- **Workflows sin cambios desde el C01:** `aplicar-staging-conta.yml` (último cambio en `00a0d0d`) y `e2e-staging-conta.yml` (`0f7b62a`).
- La primera tanda de esta rama es **de solo lectura**: `supabase/staging/sql/20261002_c00_estado_staging.sql` comprueba todo lo de arriba y aborta si algo no cuadra.
  - Va por el workflow para que la medida quede escrita en su resumen.
  - Se probó antes por el conector: pasa.
  - Además evita que, al nacer la rama, se relance la tanda anterior (el acceso de Julio, que la guarda 3 abortaría).

---

## 9. Maquetas

- Subidas a `docs/conta/maquetas/c00/`, con su `LEEME.md`.
- **Lo que choca y necesita decisión:** D3 (el NIF que «busca» la razón social), D4 (el asesor) y D5 (regla 7 en N3).
- **El menú de la maqueta** enseña Inicio, Por hacer, Documentos, Bancos, Clientes y proveedores, Pagos y cobros, Facturas que emites, Impuestos, Cómo va tu negocio, Libros y Ajustes.
  - Según el encargo, solo se muestran las que existan. En el C00 serán **Ajustes** (Tu empresa y Tablas generales) y **Clientes y proveedores** (la ficha del C01).
  - Inicio no se construye.
- **La sugerencia de N2** («Desde septiembre repartes a domicilio… Lo veo en tus ingresos de Glovo y Uber Eats») es **fundamentable con datos reales** de una cuenta con ventas por canal. En staging-conta no hay ventas, así que allí se probará con una sugerencia de prueba, como prevé §6.2.

---

## 10. Hallazgos fuera del C00 (van a pendientes; no se tocan)

1. **El ticket impreso desglosa siempre al 10 %** (`ticketRenderer.ts:169`, `ZonasPedidoPage.tsx`).
2. **Alta de envases probablemente rota.**
   - `createPackagingItem` (`recipeItemService.ts:674`) inserta `vat_category_source = 'default'`, y el CHECK de producción solo admite `proposed`/`confirmed`.
   - En la base hay 0 filas con `'default'`, lo que cuadra con que falle siempre.
   - **No ejecutado**: hay que confirmarlo en una transacción revertida.
3. **Folvy AI:** no se puede rechazar ni deshacer, el saludo no se registra, el streaming siempre dice `ok` y la confirmación es «Hecho.» (§4.2).
4. **`enrich-ingredient`:** su registro falla siempre por el CHECK de `kind` (0 filas).
5. **`ocr-albaran`:** sus 315 sesiones siguen en `pending_review`.
6. **`accounts.cif`** no se valida y el administrador de la cuenta no puede cambiarlo.
7. **`family_vat_default`** se cruza por nombre de familia sin cuenta (regla 9).
8. **El 5 % de las casillas de IVA del C01** no existe en `vat_rate`. Se quitará cuando las casillas lean la tabla (tarea 7).
