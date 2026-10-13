# D01 · Facturas recibidas · Tarea 1: comprobaciones previas (13/10)

Rama `conta/d01-recibidas`, sacada de `main` en `9f9f5791` (con el C04b ya
fusionado). **Todo lo de aquí se ha hecho leyendo.** En producción solo se ha
consultado, siempre con la cuenta por delante (regla 9). No hay importes: el
repositorio es público.

Las maquetas están en `docs/conta/maquetas/d01/` (N22 Documentos y N23 Revisar; se llamaban N19 y N20, renombradas por la respuesta D01_1, punto 1).

## 0 · Antes de nada: tres cosas que chocan

1. **Los números de pantalla N19 y N20 ya están usados.**
   - N19 es «La liquidación mensual y su contraste» (`LiquidacionPage.tsx`).
   - N20 es «Cómo te factura» (`ComoTeFacturaPage.tsx`, `navegacion.ts:168`).
   - Propongo llamar a las nuevas **N22 Documentos** y **N23 Revisar factura**
     en código y capturas. → **P1**.
2. **No tengo dos documentos de referencia:**
   `claude/folvy-contabilidad-benchmark.md` y `claude/folvy-automatizar-entradas.md`.
   No están en el repositorio ni en esta sesión. El contraste es de la tarea 7
   y el resto no los necesita, pero hay que pasármelos.
3. **La norma** (RD 1619/2012, Ley 37/1992, RD 1624/1992, Orden EHA/962/2007,
   CCom 30, LGT 66, Ley 3/2004) se comprobará en el BOE y se citará literal en
   la tarea en que cada artículo se use: la lectura en la 2 y el asiento en la 5.
   Aquí no he dado ninguna por leída.

## 1 · Qué hay hoy en Compras

**Hay dos caminos que escriben las mismas tablas.**
- **El viejo, de Supply** (`/supply/facturas`, `supplierInvoiceService.ts`):
  - la persona crea la factura en `borrador`;
  - la casa con `run_invoice_match`;
  - la aprueba.
- **El nuevo, de Compras** (octubre). La base crea la factura sola desde el
  papel leído:
  1. al confirmar una recepción de Cocina, `_compras_camino_calcula` decide el
     camino (`goods_receipt_path.path`);
  2. si es `factura`, el disparador `trg_goods_receipt_path_factura` llama a
     `_compras_factura_desde_papel`;
  3. esa función crea la `supplier_invoice` en `en_revision`, con sus líneas y
     su enlace a la recepción (`supplier_invoice_receipt`);
  4. `SubirFactura.tsx` (Compras) hace lo mismo con un papel que llega sin
     recepción.

**Las tablas.** El esquema lo he leído en producción con `information_schema`.
- **`supplier_invoice`**:
  - `invoice_number`, `invoice_date`, `due_date`;
  - `tax_base_total`, `tax_total`, `grand_total`;
  - `withholding_rate_id`, `withholding_amount`, `vat_non_deductible`;
  - `raw_document_url`: en realidad es una **ruta** del bucket `receipt-uploads`;
  - `ai_session_id`, `journal_entry_id`, `payment_entry_id`, `company_id`,
    `location_id`;
  - `read_iban` e `iban_decision`;
  - `not_duplicate_confirmed_*`;
  - `paid_*`.
  - Los `CHECK`, leídos en producción:
    - `status ∈ (borrador, en_revision, aprobada, con_discrepancias, pagada, anulada)`;
    - `source ∈ (manual, ocr)`;
    - `doc_kind ∈ (invoice, credit_note)`;
    - `match_status ∈ (sin_match, ok, con_diferencias)`.
- **`supplier_invoice_line`**: el IVA va **por línea** (`vat_pct`, `line_amount`).
  No hay tabla de bases y cuotas por tipo.
- **`supplier_invoice_receipt`**: enlaza una factura con una o varias
  recepciones (N:M). Sirve tal cual para el casado.
- **`goods_receipt_ai_session`**: guarda lo leído (`parsed_result`) y todas las
  páginas (`input_files`).
- **`goods_receipt_path`**: el camino de cada recepción y sus preguntas.

**`ocr-albaran`** lee albaranes y facturas con el mismo prompt (Anthropic,
modelo `VISION_MODEL`).
- **Lee:** proveedor y NIF, número, fecha, tipo de papel, a nombre de quién,
  base, cuota y total, y líneas con su IVA.
- **No lee:**
  - el vencimiento;
  - el IBAN (`read_iban` existe y nadie lo escribe);
  - las bases y cuotas por tipo;
  - el recargo de equivalencia;
  - la retención;
  - si es una rectificativa.
- **Comprueba** la suma de líneas contra la base, con un 1 % de margen.

**«Cómo te factura»** (`ComoTeFactura.tsx`) es la forma de facturar del
proveedor (`invoicing_mode`: por entrega, albarán y luego factura, o
liquidación mensual). La propone a partir de sus últimos papeles.

**Repetidas: hay tres reglas distintas y ninguna en la base como restricción.**
- **Compras (SQL):** el mismo proveedor y el número normalizado
  (`upper(regexp_replace(n,'[^A-Za-z0-9]','','g'))`), o la misma sesión de lectura.
- **Supply (front):** el número exacto y el proveedor.
- **C01b (front, `lib/repetidas.ts`):**
  - «¿Repetida?»: número y total iguales;
  - «¿Posible repetida?»: fecha y total iguales con otro número.
- **El proponedor de asientos no mira repetidas.**
- **Propuesta:** **una sola regla, en la base**, para todos los caminos (tarea 2
  el núcleo, tarea 3 la base).

**El asiento de hoy** se arma en TypeScript (`facturaProveedor`,
`asientosPropuestos.ts:446`), y solo para facturas `aprobada`.
- **Las cuentas:**
  - el gasto es el enlace `gasto` del proveedor o el de su categoría;
  - el IVA va a la 472 del tipo (enlace `soportado`);
  - la retención va a la 4751;
  - el proveedor va a la 400 o la 410 (`hojaDeProveedor`).
- **No se propone** si el proveedor no tiene NIF, si es un socio de marca o si
  falta la cuenta de gasto.

## 2 · Las facturas de Foodint, y de dónde vinieron

Todo con la cuenta de Foodint (`51ad1792…`) y su empresa (`658728c0…`).

| Medida | Cuántas |
|---|---|
| `supplier_invoice` (es **toda** la tabla: no hay de otra cuenta) | **6**: 5 `en_revision` y 1 `aprobada`. Todas leídas por la lectura (`ocr`), todas con su papel. **Ninguna tiene asiento** |
| Líneas / enlaces con recepción | 12 / 5 |
| Asientos de compra en Diez, 2026 (serie 2, traídos y validados) | Por mes, de enero a septiembre: 171, 341, 370, 201, 197, 140, 324, 253, 855. **2.852** llevan IVA soportado (472); los proveedores son 41 subcuentas 400/410 |
| Papeles leídos en Cocina, últimos 60 días | 134: 115 albaranes, 10 albarán-factura y 9 facturas |
| Recepciones, últimos 30 días | 48: 45 leídas y confirmadas, 2 a mano y 1 anulada |
| Camino de las recepciones | 1 `factura`, 4 `factura · ficha_sin_forma`, 16 `liquidacion`, 2 `pendiente_factura` |

**Lo que dice esto:** hoy casi ninguna factura entra por Folvy. Se apuntan en
Diez. Lo que Cocina recibe son sobre todo albaranes, y la factura del mes llega
después por otro camino: correo o portal. **Esa es la bandeja que falta.**

**Para proponer la cuenta, el histórico de Diez enseña mucho.**
- De las 41 subcuentas de proveedor de 2026, **38 van siempre al mismo gasto**.
- **2.840 de 2.916 facturas (97 %) van a su gasto principal.**
- En Folvy, en cambio, solo 2 de los 60 proveedores activos tienen «Sus
  facturas se apuntan en».
- Propongo usar ese histórico como «lo aprendido», con su porqué («las N
  anteriores fueron a …»). → **P2**.

**Las fijas.**
- **12 proveedores** han facturado **todos** los meses de enero a septiembre.
- 4 de ellos, unas diez facturas o menos en nueve meses: son las fijas de
  verdad (alquiler, luz, teléfono, seguro).
- Son las candidatas a «esperada».

**El IVA:** Diez usa una sola 472 (`47200000`, en 2.852 asientos). La
retención aparece en 36. Folvy irá por tipo (`4720001x`), según el hecho de
Julio.

## 3 · El correo: cómo se reciben hoy las nóminas y qué falta

**Hoy (`supabase/functions/payroll-inbound/index.ts`):**
- **La entrada:** Resend recibe el correo y llama al webhook, que comprueba la
  firma svix con `RESEND_WEBHOOK_SECRET`.
- **A qué cuenta va:** se mira **solo** `to[0]` y se busca esa dirección
  **exacta** en `payroll_settings.inbound_address`, que es una por **cuenta**, no
  por empresa. Si no casa, contesta 200 y el correo **se pierde sin dejar rastro**.
- **Los adjuntos:** se piden a la API de Resend y se guardan **solo los PDF**;
  las fotos se descartan (línea 92). Van al bucket `employee-documents` y se
  pasan a `payroll-extract`.
- **La dirección en producción:** hay una sola. Está en un subdominio
  `*.resend.app` (el de Resend), **no** en `in.folvy.app`. En el repositorio no
  está escrito cómo se dio de alta el dominio de entrada (MX, webhook).
- Hay 13 nóminas en `payroll_inbox`.

**Lo que falta para «facturas de cada empresa»:**
1. **Una dirección por empresa.** Haría falta una tabla nueva (o columnas
   nuevas en `company`) con la dirección, la empresa y si está activa. Hay que
   mirar todos los destinatarios (`to` y `cc`), no solo el primero.
2. **El formato.** Está por decidir `facturas+<empresa>@…` (con `+`) o
   `facturas-<empresa>@…`, y en qué dominio. → **P3**. Hay que probar si Resend
   conserva el `+` en `data.to`.
3. **Una función de entrada nueva**, con `verify_jwt = false` en
   `config.toml`, o una rama dentro de `payroll-inbound`. Propongo una nueva
   (`conta-facturas-entrada`) para no tocar las nóminas, que funcionan.
4. **Los adjuntos:** PDF **y** fotos, al bucket `receipt-uploads`, que es el
   que lee la lectura.
5. **Guardar cada correo**, también el que no casa con ninguna empresa y el que
   solo trae un enlace («Falta el PDF: el correo trae un enlace»). Repetido, por
   `email_id`.
6. **Para «Pedírsela»,** el modelo es `compliance-doc-notify`: Resend, desde
   `no-reply@folvy.app`, con registro de lo enviado. Poniendo de
   `reply_to` la dirección de facturas de la empresa, la respuesta del
   proveedor entra sola en la bandeja.

## 4 · Qué se puede reutilizar del R15

- **El bucket `conta-documentos`:** es privado y solo admite PDF. Las fotos de
  las facturas son JPEG o PNG. Además, `journal_entry_document.kind` solo admite
  `resumen_ventas` (`CHECK`, leído en producción). Propuesta:
  - el original se queda donde entra, en `receipt-uploads`, como hoy en Cocina:
    no se duplica nada;
  - **al apuntar**, el documento se copia en PDF a `conta-documentos` (una foto
    se convierte a PDF en el navegador) y se enlaza al asiento con un tipo
    nuevo, `factura_recibida`;
  - ampliar ese `CHECK` es «cambiar en caliente», y va con su cabecera y su
    prueba de staging. → **P4**.
- **El envío** (`diezEnviar.ts`) tiene sus frenos genéricos: C0008 cerrado,
  C0001 vetada, sin documento no se envía, nunca dos veces, comprobar si Diez
  guarda documentos, 3 intentos. **Esto se reutiliza entero.**
- **La factura de Diez es otra.** `diezFactura.ts` solo sabe hacer la
  **emitida** de Uber. La **recibida** (serie 2) hay que medirla en la C0009, en
  solo lectura, como el molde del R13. Va en la tarea 5.
- **`external_send`** sirve tal cual: `kind = 'factura'`, con sus columnas
  `document_*`.

## 5 · Qué tiene la ficha del proveedor para proponer la cuenta

**Lo que hay:**
- **El gasto:** el enlace `company_account_link` con `role = 'gasto'`, o el de
  su categoría.
- **El IVA habitual:** `usual_tax_rate_ids`.
- **La retención:** `irpf_withholding_pct`. Es un porcentaje, no un tipo.
- **El local habitual:** `default_location_id`. Solo se edita desde Cocina, y
  en Foodint ningún proveedor lo tiene puesto.
- **El pago:** forma y plazo (`payment_method`, `payment_terms_days`,
  `payment_fixed_days`) e IBAN.
- **Lo aprendido:** `supplier_learning` (gasto, IVA, retención, pago, IBAN) y
  `journal_correction` (las correcciones al proponer).

**Lo que no hay:**
- **El contacto de facturación.** `supplier_contact.role` admite `orders`,
  `sales`, `admin`, `delivery` y `other`, y no tiene «facturación». Sin él,
  «Pedírsela» no sabe a quién escribir. → **P5**.
- **«Traída de factura · por completar».** Hoy solo existe «Traída de
  {programa}», la que crea la importación del C02c (`supplier.import_id`). Dar
  de alta un proveedor desde lo leído es nuevo. Encaja con lo que ya hay de
  datos por confirmar (`supplier_proposal`).
- **Hoy, sin proveedor no hay factura.** `compras_factura_desde_papel` exige un
  proveedor que exista.

## 6 · Qué falta para una empresa sin Cocina

- **No hay ninguna marca de «usa Cocina».** La única puerta es el permiso
  `feature_flags.conta`. Que «compra con Cocina» solo se deduce de que tenga
  artículos de proveedor (`article_supplier`) o recepciones.
- **Las tablas sirven:** `supplier` y `supplier_invoice` son de Supply, pero no
  exigen recepción. La factura puede existir sin ella (`location_id` y
  `ai_session_id` admiten nulos).
- **Lo que hoy obliga a pasar por Cocina:**
  - la ficha del proveedor vive en `/kitchen/proveedores/:id`, con sus migas
    «Cocina › Proveedores»;
  - «Subir factura» lleva a `/supply/facturas`;
  - el local habitual solo se edita desde Cocina.
- **Propuesta:** el casado con recepciones y «De Cocina» se encienden si la
  empresa tiene recepciones en los últimos 90 días. Si no, la bandeja solo
  tiene Subir y Correo. Que esto lo decida un dato y no un interruptor a mano es
  de Julio. → **P6**.
- **C06 ya midió** que el alta de una cuenta siempre siembra Cocina. Eso es
  suyo (§7).

## 7 · Choques con B y con C

**B (`conta/b01-bancos`).**
- Hoy solo tiene documentos: ninguna migración y ningún código.
- **Espera** de A una función de lectura: «`banco_facturas_recibidas_pendientes(company)`
  o similar» (su B01, §5).
- La haré yo en la tarea 3, con este contrato estable y su prueba:
  - entra la empresa (y una fecha de corte opcional);
  - sale, por factura: id, proveedor (id, nombre, NIF), número, fecha,
    vencimiento, total, lo pendiente, IBAN leído, el asiento y el estado.
  - **Si B la quiere con otro nombre o con más columnas, que lo diga ahora.**
- B planea que el banco rellene `paid_at` y `payment_entry_id`. No choca con
  nada de A.

**C (`conta/c06-sola`).**
- Hoy solo tiene documentos.
- **El menú:** `MENU_CONTA` ya tiene la entrada `documentos` con `ruta: null`
  (`navegacion.ts:214`). Mi cambio es **una línea**: ponerle la ruta. C piensa
  reordenar `MENU_CONTA`, así que la ruta la añado yo y el sitio en el menú lo
  decide C.
- **La ficha del proveedor fuera de `/kitchen`** para una empresa sin Cocina es
  cosa de C (menú y marca) o mía (Documentos). → **P7**.
- **El importador de Diez:** no lo toco.

## 8 · Preguntas para Julio

- **P1 · Números de pantalla.** ¿N22 Documentos y N23 Revisar factura, para no
  chocar con N19 (liquidación) y N20 (Cómo te factura)?
- **P2 · Lo aprendido de Diez.** ¿Uso el histórico de Diez (97 % de las
  facturas a su gasto principal) para proponer la cuenta de gasto, diciendo
  «las N anteriores fueron a …»? ¿O solo lo que esté en la ficha?
- **P3 · La dirección de correo.** ¿En qué dominio? Hoy las nóminas están en
  un `*.resend.app`. ¿Y con qué formato: `facturas+<empresa>@` o
  `facturas-<empresa>@`? El alta del dominio y del webhook en Resend la tienes
  que hacer tú; yo te dejo los pasos.
- **P4 · El documento al apuntar.** ¿Vale copiar el PDF a `conta-documentos`
  al apuntar, convirtiendo la foto a PDF, y ampliar el tipo de
  `journal_entry_document` a `factura_recibida`? El original se queda en
  `receipt-uploads`.
- **P5 · El contacto de facturación.** ¿Añado el papel `billing`
  («Facturación») a los contactos del proveedor? Es ampliar un `CHECK`.
- **P6 · Usa Cocina.** ¿Lo decide el dato (recepciones en 90 días) o prefieres
  un ajuste de empresa?
- **P7 · La ficha del proveedor en una empresa sin Cocina.** ¿La saca C de
  `/kitchen` dentro del C06, o la llevo yo dentro del D01?
- **P8 · La lectura.** Para el vencimiento, el desglose por tipo, el recargo,
  la retención y la rectificativa, ¿extiendo `ocr-albaran` (la usa Cocina) con
  un modo «factura» que no cambie lo que devuelve hoy? ¿O hago una función nueva
  que reutilice su código? Recomiendo el modo: es un solo sitio que mantener y
  Cocina no nota nada.

**Paro aquí**, como pide el encargo. Sigo con la tarea 2 (lectura y repetidas,
núcleo puro con pruebas) cuando lo digas.
