# GP · El portal del cliente de la gestoría · Tarea 1: comprobaciones previas

**Code 3 · 09/11/2026 · solo lectura.** Rama `conta/gp-portal-cliente`, sacada de
`main` en `3e8774f` (#526). Producto: Sumied.

Leído: la maqueta `Portal.dc.html` del tablero «Sumied · Clientes y cuotas
(maqueta)» (las dos vistas y los dos casos), el código de `main` y las
migraciones. **No he consultado la base**: el esquema sale de las migraciones;
en la tarea 2 se comprueba contra `information_schema` con `conta_lectura`
antes de escribir nada.

---

## 0 · Lo que no he encontrado: `zonas_de_codes.md`

No está en `main`, en ninguna rama ni en Drive. Hasta tenerlo, trabajo con
esta zona, sacada del encargo y de lo que ha fusionado cada uno:

| | Code 1 (G05, cobro y factura) | Code 2 (GD, cuenta demo) | Code 3 (GP, portal) |
|---|---|---|---|
| Base | `conta_recibo*`, `conta_cobro_*`, `customer_invoice`, la numeración, Verifactu | la siembra de «Gestoría Demo» (`scripts/conta/gd/`) | tablas `conta_portal_*` (nuevas) |
| Funciones | `conta-cobro`, `conta-gocardless-*`, `conta-verifactu`, `conta-venta-correo`, `_shared/cobro/*` | `conta-gd-*` | `conta-portal-*` (nuevas) |
| Pantallas | Cobros, factura | — | `src/modules/conta/portal/` (nueva) y, en la ficha del cliente, solo lo del portal |

Lo de Code 1 **solo se lee**. Donde el portal necesita que Code 1 escriba algo,
lo pido en §6.

---

## 1 · Usuarios externos y enlace mágico: qué existe

| Qué | Dónde | ¿Vale para el portal? |
|---|---|---|
| Personas de una empresa con permiso (`user_profiles`, una fila por empresa) | `invitar-persona` (DM1) | **No.** Le abriría Sumied entero dentro de la gestoría. El cliente no puede ser un usuario de la cuenta de la gestoría. |
| Enlace de acceso generado en el servidor y canjeado con `verifyOtp` (`?token_hash=…&type=magiclink`) | `AccesoClaimPage.tsx`, `/acceso`, portal del trabajador | **Sí, el mecanismo.** Es el enlace mágico que pide el encargo: el servidor lo genera (`generateLink`), lo manda con la marca y la página lo canjea. Lo que cambia es adónde lleva y qué ve. |
| Código de un solo uso al correo, guardado con hash, con caducidad e intentos | `customer_otp` (`20260702T1600_customer_login.sql`) | **Sí, el patrón para firmar** (punto 9): mismo diseño, en una tabla propia del portal. |
| Invitación por token a la asesoría | `tax_advisor_invitation`, `AceptarAsesoriaPage.tsx` | El patrón de «Invitar al portal»: token con caducidad, una página que dice quién invita y un solo botón. |
| Páginas sin cuenta con token | `pagar.html` → `conta-pago` (tarjeta y Bizum con Stripe, o el TPV Redsys; con la puerta `EN_LA_DEMO`), `mandato.html` | `pagar.html` es la candidata para «Pagar con tarjeta o Bizum» (§5). |
| Marca | `marcaPortal.ts`, `MARCAS` | Es la marca del **producto** (Sumied o Folvy), no la de cada gestoría. `pagar.html` ya pinta el color de la empresa (`--marca`). El logo de la gestoría está por ver en la tarea 2. |
| Enlace cliente ↔ su cuenta en Sumied | `conta_gestoria_cliente.cuenta_propia_account_id` | Es por donde el portal llega a sus documentos, impuestos y nóminas (§2). |

**Lo que falta:** la identidad del cliente. Propuesta para la tarea 2: una tabla
`conta_portal_acceso` (usuario, gestoría, empresa emisora, cliente `party_id`,
permiso «todo» o «facturas_documentos», quién invitó, cuándo, revocado). El
cliente **no recibe ninguna tabla de Code 1 por RLS**: el portal lee solo con
funciones `security definer` que sacan el cliente de `auth.uid()`, una por
pantalla (la regla de velocidad, como la lista rápida del G04). La prueba de
staging entra como persona del cliente A y pide lo del cliente B: tiene que
fallar en cada función y en cada tabla `conta_portal_*`.

---

## 2 · Documentos del cliente, buzón de entrada y lo que deja la gestoría

- **Buzón de entrada:** `conta-facturas-entrada` (webhook de Resend). Guarda el
  fichero en `receipt-uploads` de la cuenta, lo lee con `ocr-albaran` en modo
  factura y lo apunta con las funciones de la 0220. Lo que no es PDF ni foto va
  a `conta-entrada`; las nóminas, por `payroll-inbound` / `employee-documents`.
  La lógica vive en `_shared/facturasEntrada.ts`. **El portal sube por ese
  mismo camino** (una función que llama a lo mismo que el correo, con la sesión
  del portal en vez de la firma de svix), en la empresa propia del cliente.
- **Condición:** el cliente tiene que tener su cuenta en Sumied
  (`cuenta_propia_account_id`). En la demo, Talleres Ruiz la necesita sembrada.
  Un cliente sin cuenta propia: el portal no enseña «Subir» y lo dice, no lo
  esconde (regla 7).
- **Impuestos presentados:** `tax_return`, con el justificante en
  `conta-documentos` (`conta_impuesto_justificante_guardar`, I01).
- **Nóminas y seguros sociales:** `payroll_inbox` / `employee-documents`.
- **Mensajes:** **no hay nada.** Ni tabla ni almacén. Es todo nuevo:
  `conta_portal_mensaje` y sus adjuntos en un almacén propio.

---

## 3 · Peticiones, incidencias y trabajadores: qué se puede usar

- **Alta y baja:** existe `conta_solicitud` (G01: `alta`/`baja`, `pedida` →
  `hecha`/`rechazada`) y la gestoría ya la cierra con `conta_gestoria_alta_empleado`
  y `conta_gestoria_baja_linea`, que cambian la línea del recibo. Es justo la
  decisión del 06/11 (el cliente pide, la gestoría hace). **Le faltan** el DNI
  o NIE, la fecha, el tipo de contrato y las horas: tres o cuatro columnas que
  admiten nulos (pasa siempre). Pregunta 7.
- **«No estoy de acuerdo»:** la lista «Pendiente de revisar» sale de
  `conta_gestoria_diferencia`, que pide una `lectura_id` obligatoria (la lectura
  de Bitrix24 y GoCardless) y cuyo `CHECK` de tipos amplía Code 1. **No vale.**
  Propongo una tabla propia (`conta_portal_incidencia`) que la lista lea junto
  a las diferencias. Lo que sí es de Code 1 es **parar el recibo**
  (`conta_recibo.parado`): pregunta 4.
- **El recibo y por qué cambia:** `conta_recibo` ya trae `lineas`, `cambios`,
  `anterior_cent`, `cargo_el` y su estado. Solo se lee. La factura,
  `invoice_id` → `customer_invoice`, con el PDF del G05.
- **Lo que tienes que hacer:** hoy vive en `g04/modelo.ts` y `g04/Clientes.tsx`.
  Peticiones, mensajes e incidencias del portal entran ahí en la tarea 4.

---

## 4 · Correo

`send-email` con plantillas y la marca de la empresa, el freno
`CORREO_MARCA_ABIERTOS` y, en la demo, `_shared/puertaDePruebas.ts`: el correo
de una demo va solo a `CORREO_BUZON_PRUEBAS`. Los cinco avisos del punto 10 son
cinco plantillas nuevas por ese camino. El del día 2 («recibo próximo») está
pegado al cobro: pregunta 8.

---

## 5 · GoCardless: qué pide el devuelto y qué pide cambiar de cuenta

**Lo que hay hoy en Sumied:** el lector solo hace `GET` (`customers`,
`mandates`, `subscriptions`, `payments`, `events`, `creditor_bank_accounts`).
La única escritura es `POST /payments`, de Code 1 en `conta-cobro`, y solo con
una conexión de **pruebas**. Los avisos al instante llegan por
`conta-gocardless-aviso`. **No se lee `customer_bank_accounts`**: los cuatro
últimos dígitos de la cuenta llegan con el nº 41 de Code 1.

| Pantalla | Qué pide GoCardless | Notas |
|---|---|---|
| **«Que lo pasen de nuevo»** | `POST /payments/{id}/actions/retry` (con `charge_date` opcional). | Solo para un pago `failed`, con el mandato aún activo; no para `charged_back` ni `cancelled`. GoCardless limita los reintentos: el número exacto lo mido en el sandbox. Si el devuelto fue porque se canceló el mandato, el botón no sale y la pantalla lleva a «Cambiar de cuenta». |
| **«Pagar con tarjeta o Bizum»** | **GoCardless no cobra con tarjeta ni con Bizum.** Su pago al momento es *Instant Bank Pay*: un `billing_request` con `payment_request` y un `billing_request_flow` cuya `authorisation_url` lleva al cliente a pagar desde la app de su banco. Si va en España y en euros, lo mido en el sandbox. | Decisión de Julio, pregunta 2. Pagado por aquí, el recibo devuelto queda como cobrado por otra vía (`conta_gc_cobro_otra_via`, G04) y no se reintenta. |
| **«Cambiar de cuenta»** | `POST /billing_requests` con `mandate_request` (`scheme: sepa_core`) y `links.customer` del cliente que ya existe, y después `POST /billing_request_flows` → `authorisation_url` (la página de GoCardless; en la demo, la del sandbox). | Al completarse llega el mandato nuevo (eventos `billing_requests`/`mandates`). El viejo se cancela (`POST /mandates/{id}/actions/cancel`) **cuando el nuevo está activo**; lo que ya salió con el viejo sigue. El cobro del mes siguiente tiene que usar el nuevo: es lógica de Code 1 (`conta_recibo.mandato_gc_id`), pregunta 3. En pantalla nunca «mandato»: «Cambiar de cuenta» y «firmas una domiciliación nueva desde el móvil», como la maqueta. |

**La puerta:** cualquier escritura del portal en GoCardless lleva la misma
puerta que `conta-cobro`: solo con una conexión de pruebas. **Nada contra el
GoCardless real de QBO.**

---

## 6 · Preguntas para Julio (lo que necesito antes de la tarea 2)

1. **`zonas_de_codes.md`:** ¿dónde está? Hasta verlo, trabajo con la zona del §0.
2. **«Pagar con tarjeta o Bizum».**
   - **A (recomendada):** el enlace de pago de Sumied que ya existe (`pagar.html`
     → `conta-pago`, Stripe con tarjeta y Bizum, con la puerta de la demo). Es
     lo que dice el botón de la maqueta, y está hecho. Pide una conexión de
     Stripe de pruebas en «Gestoría Demo» y que el devuelto tenga su factura.
   - **B:** *Instant Bank Pay* de GoCardless, como dice el encargo. El botón
     tendría que decir «Pagar ahora desde tu banco», porque ni tarjeta ni Bizum.
3. **Las escrituras en GoCardless** («Que lo pasen de nuevo», «Cambiar de
   cuenta»): ¿las hago yo en una función `conta-portal-gocardless`, que usa
   `_shared/cobro/gocardless.ts` sin cambiarlo y la misma puerta, o las pone
   Code 1? Y en los dos casos, Code 1 decide con qué mandato sale el cobro
   siguiente.
4. **Parar el recibo** con «No estoy de acuerdo» escribe en `conta_recibo`, de
   Code 1. Propongo que Code 1 deje una función (`conta_cobro_parar(recibo,
   motivo)`) y que el portal la llame.
5. **`App.tsx`:** el portal necesita una ruta pública (`/portal`) y que, después
   del enlace mágico, una persona del portal vaya ahí y no a Sumied. ¿Me das
   permiso para tocar `App.tsx` en eso, y solo en eso? La otra salida es una
   entrada aparte (`portal.html`, como `pagar.html`), que no toca `App.tsx`
   pero sí `vite.config.ts`.
6. **Datos de la demo:** la siembra de Code 2 tiene a Talleres Ruiz en Getafe,
   con Tomás Ruiz Herrero de contacto, tres trabajadores (Adrián, Sergio y Raúl)
   y una cuota de 150. La maqueta enseña a Antonio Ruiz, Pinto, cuatro
   trabajadores (con el alta de Pedro) y 157,30 €. El portal enseña lo que
   haya en la base. ¿Mando la siembra de Code 2 y cambio los nombres de la
   historia del congreso, o Code 2 ajusta su siembra a la maqueta?
7. **`conta_solicitud`** (G01): ¿la amplío yo con las columnas del alta, o es de
   otra zona?
8. **El aviso del día 2** («recibo próximo con su desglose»): ¿lo manda Code 1
   con el cobro, o yo, leyendo su recibo?

---

## 7 · Plan hasta el 16/11

El congreso es el **martes 17/11**. El plan deja el lunes 16 de colchón. Cada
tanda en producción pide su ensayo en verde y **el real lo lanza Julio, de una
en una**: marco el día en que le llega cada una.

| Día | Tarea | Qué queda hecho | A Julio |
|---|---|---|---|
| **Lun 09/11** | 1 | Este informe. | Las 8 preguntas. |
| **Mar 10/11** | 2 | Base: `conta_portal_acceso`, invitación, mensajes y adjuntos, peticiones de la gestoría con fecha, firma con código, incidencias; las columnas del alta; una función de lectura por pantalla; RLS. Prueba de staging en ROLLBACK, también la de otro cliente. Tanda `sumied/conta-gp-portal-cliente`. | **Tanda 1** (base): ensayo en verde → real. |
| **Mié 11/11** | 2 | Funciones: entrar (enlace mágico con la marca), subir (al buzón), firmar (código al correo o al móvil, PDF firmado), GoCardless (sandbox) según la respuesta 3. En staging. | Despliegue en staging. |
| **Jue 12/11** | 3 | El armazón móvil primero, con la marca y «Funciona con Sumied». Inicio (los dos casos), Facturas (buscador, año, ZIP), Pagos. | — |
| **Vie 13/11** | 3 | Documentos (subir con foto), Trabajadores (pedir alta y baja), Mensajes, Tu cuenta, Firmar. Medida de menos de 1 s por pantalla, en el navegador, con los datos de la demo. | — |
| **Sáb 14/11** | 4 | En la gestoría: «Invitar al portal» en la ficha; peticiones, mensajes e incidencias en su lista y en «Lo que tienes que hacer». Los cinco avisos por correo (en la demo, al buzón de pruebas). | **Tanda 2** (lo que pida la tarea 4), si hace falta. |
| **Dom 15/11** | 5 | Siembra de Talleres Ruiz para el portal, e2e de punta a punta (entrar → pagar el devuelto → «No estoy de acuerdo» → subir → pedir el alta → la gestoría la hace → el recibo cambia → mensaje → firmar), capturas en ordenador y en móvil. | Siembra en la demo. |
| **Lun 16/11** | — | Colchón: arreglos, fusión, **Vercel READY** y un ensayo general de Julio con el guion del congreso. Nada nuevo después de las 20:00. | Real de lo último que quede, fusión. |

### Lo que entra para el congreso

Los 11 puntos del encargo, con estos límites:

- la firma es la **aceptación con código de un solo uso** (quién, cuándo, desde
  dónde y el PDF firmado);
- GoCardless y los pagos, **solo en el sandbox**;
- el portal va en `app.sumied.com` con la marca de la gestoría (logo, colores,
  nombre);
- «Pedir un cambio de datos» crea una petición a la gestoría, no cambia los
  datos;
- los mensajes se actualizan al abrir la pantalla y avisan por correo.

### Lo que no entra

- La firma electrónica avanzada: va con la hoja de encargo, después.
- El portal en el dominio propio de cada gestoría (la maqueta dice «puede ir»).
- Los mensajes en tiempo real y los avisos *push* al móvil.
- Pasar peticiones o mensajes a Bitrix24.
- Cualquier escritura en el GoCardless o el Bitrix24 reales de QBO.

### Riesgos

- **Depende de Code 1:** el nº 41 (los dígitos de la cuenta), parar el recibo,
  con qué mandato sale el cobro siguiente y el PDF de la factura. Si el 12/11
  no están, el portal enseña lo que haya y lo dice. No se inventa nada.
- **Depende de Code 2:** la siembra de «Gestoría Demo», con la cuenta propia de
  Talleres Ruiz (sin ella no hay buzón ni documentos).
- **Tandas:** dos reales en una semana, cada uno lanzado por Julio. Si uno se
  retrasa, se come el colchón del 16.
- **Correo del enlace mágico en la demo:** sale por `send-email` al buzón de
  pruebas. Si el freno de la marca está cerrado, Julio entra con el enlace de
  la respuesta (fuera de producción), como en `invitar-persona`.
