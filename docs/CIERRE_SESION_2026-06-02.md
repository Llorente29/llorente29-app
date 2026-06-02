# CIERRE DE SESIÓN — 2026-06-02

> **Sesión NO técnica de repo/BBDD.** Frente: **presencia de marca + comunicaciones**.
> Tres entregables cerrados: (1) **web pública folvy.app** publicada y operativa,
> (2) **correo @folvy.app** funcionando (buzones reales OVH), (3) **correo a HubRise enviado**.
> Este documento es autónomo: contiene todo lo necesario para retomar exactamente aquí.
> Anexo de `CONTEXTO_CLAUDE.md` (que sigue reflejando el estado técnico del 31/05).

---

## 0. CORRECCIÓN IMPORTANTE DE DATO (arrastrada desde el inicio del proyecto)

**El CEO se llama Julio Gª Colón (García Colón), NO "Julio Gascón".**
"Gascón" era un error arrastrado. En `CONTEXTO_CLAUDE.md §2` figura "Julio Gascón Colón" —
**corregir a "Julio Gª Colón"**. Usar este nombre en firmas, correos y documentos formales.
Cuenta Google admin del CEO: `jgcolon@idasal.com`.

---

## 1. WEB PÚBLICA DE MARCA — folvy.app (PUBLICADA Y OPERATIVA)

### 1.1 Qué es
Web de marca multipágina (NO es la app; la app sigue en `app.folvy.app`). Sirve para enseñar
Folvy a inversores, clientes, plataformas (Glovo/Uber/Just Eat) e integradoras (HubRise).

### 1.2 Las 7 páginas (todas bilingües EN/ES, mismo sistema de diseño, logos reales embebidos)
1. **index** (home): hero, mercado partido (Folvy une carta multicanal SIN food cost de
   Otter/Deliverect/Last vs escandallos SIN multicanal de tspoon/Gastrokaizen), módulos, Folvy AI,
   margen real, "para quién", visión, sección **"Profundiza"** (5 tarjetas → las 5 páginas de detalle).
2. **margen-real**: el diferenciador económico. Waterfall 81% aparente → 58% real (=23 pts:
   −18 comisión, −4 promos flash, −1 packaging). Economía por canal, método 3 capas, 4 audiencias
   (operador / plataformas con enfoque win-win / inversor / integrador).
3. **kitchen** ("Del albarán al margen"): viaje del dato. Stepper Albarán→Ingrediente→Proveedor→
   Escandallo→Margen. Ingrediente 3 capas (Caja 5kg→Kilo→Gramo, 0,006 €/g), proveedor que recalcula
   26 platos al subir 4%, escandallo Bacon Cheeseburger (coste 2,07 €/FC 24%/margen por canal),
   matriz de ingeniería de menús (SVG scatter: 24 estrellas/11 puzzles/30 vacas/7 perros).
4. **compras-inventario**: Disponible (3 capas, histórico de precios + recálculo) + Próximamente
   (predicción MRP de pedidos, AvT teórico-vs-real como pieza central, inventario que se cuadra solo).
   Badges "Disponible" (verde) / "Próximamente" (terracota). SIN "en construcción" (decisión de Julio).
5. **ia-equipo**: IA para personal poco formado. Ayudas invisibles (foto→escandallo, voz, conversión
   de unidades, idioma, foto del plato→semáforo), "un día con Pamela", valor de negocio.
6. **auditoria-visual**: exclusivo de mercado. Cocinero fotografía el plato → IA compara con
   referencia → semáforo. "Otros miran la basura (Winnow, en el cubo), Folvy mira el plato (en el pase)".
   Dashboard del encargado (consistencia por local). Badge Próximamente.
7. **plataforma**: roadmap completo. Núcleo Disponible (Kitchen/Sales/Team/Safety/Folvy AI) +
   Próximamente (Compras e Inventario, Auditoría visual, Delivery, Tienda propia, Catálogo
   bidireccional, Ofertas en plataformas, Reservas, TPV propio).

### 1.3 Navegación (arreglada en esta sesión)
- Nav superior con **menú desplegable "Producto ▾"** que lista las 6 páginas con icono + descripción.
- Enlaces: Soluciones (→margen-real), Integraciones (→sección #conectado), **Para quién** (→#para-quien).
- **Menú hamburguesa en móvil** (#mobileMenu, JS toggle) — antes en móvil la nav se ocultaba sin
  alternativa; resuelto.
- Sección "Profundiza" (5 tarjetas) + footer como vías extra.
- Verificado: todas las páginas alcanzables desde la home; ninguna huérfana.

### 1.4 BUG ARREGLADO esta sesión
El **hero a medio animar** (título cortado/solapado, p.ej. en auditoria-visual: "...ificada antes de"
con hueco vacío debajo). Causa: la animación `reveal` (IntersectionObserver) se quedaba congelada.
**Fix aplicado a las 7 páginas:** `.phero .reveal,.hero .reveal{opacity:1!important;transform:none!important}`
→ el hero es visible siempre, no depende de la animación. El stepper de kitchen también se pasó de
fondo oscuro a claro (no se leía).

### 1.5 Dónde vive y cómo está desplegada
- **Repo:** `Llorente29/folvy-landing` (repo SEPARADO del de la app `llorente29-app`).
  Los 8 ficheros (7 .html + vercel.json) están en la **raíz** de ese repo.
- **Proyecto Vercel:** `folvy-landing` (en `llorente29's projects`), conectado a ese repo desde el 18/05.
  Root Directory = raíz. Framework = Other (sin build, HTML estático). Auto-deploy en cada push.
- **Dominio:** `folvy.app` (apex) ya estaba en ese proyecto → no se tocó DNS.
- **URLs limpias:** `vercel.json` con `{"cleanUrls": true, "trailingSlash": false}` → sirve
  `/kitchen`, `/margen-real`, etc. sin `.html`. Los enlaces internos ya apuntan sin `.html`.
- **Nombres de archivo publicados:** `index.html`, `margen-real.html`, `kitchen.html`,
  `compras-inventario.html`, `ia-equipo.html`, `auditoria-visual.html`, `plataforma.html`.
- Fuentes vía Google Fonts (CDN). Sin assets locales externos (logos embebidos en base64).
- Trabajo de Kitchen en `llorente29-app` quedó intacto sin commitear (no se mezcló).

### 1.6 Cifras de escaparate (cerradas, defendibles, contrastadas con el sector)
- Facturación 312.000 €/mes (Alcalá 118k, Pza Castilla 104k, Carabanchel 90k).
- Por canal: Sala/Local 96k, Glovo 82k, Uber 71k, Just Eat 63k. ~16.800 pedidos, ticket medio 18,40 €.
- Contribución/margen real mes: 108.000 € (34,6%). Food cost medio 29,4%. Margen medio 62%.
- **Margen real por canal: Local 68% · Just Eat 52% · Glovo 41% · Uber 38%** (Just Eat mejor por
  comisión ~15% vs Glovo/Uber ~30%; defendible con datos del sector confirmados por búsqueda).
- Por marca: Smash Brothers 64%, Lobbers 58%, Cloudtown (cedida) 44%.
- Ingeniería de menús: 24 estrellas / 11 puzzles / 30 vacas / 7 perros.
- Salud food cost: 168 objetivo / 39 ajustados / 8 sobre.
- Waterfall margen: 81% aparente − 18 pts comisión − 4 pts promos flash − 1 pt packaging = 58% real.
> **Son cifras de ESCAPARATE (marketing), realistas y coherentes, NO extraídas 1:1 de la BBDD.**

### 1.7 Cabos sueltos de la web
- **`www.folvy.app` da `DNS_PROBE_FINISHED_NXDOMAIN`** (el subdominio www no tiene registro DNS).
  `folvy.app` a secas SÍ funciona. Arreglo: Vercel → proyecto `folvy-landing` → Settings → Domains →
  Add `www.folvy.app` → aceptar redirección a `folvy.app`. (O añadir CNAME `www`→`cname.vercel-dns.com`
  donde se gestione el DNS.) PENDIENTE.
- **Optimización de peso (opcional):** los logos van en base64 dentro de cada HTML (home ~500KB).
  Se pueden sacar a `.png` aparte para acelerar carga. No hecho; Julio no lo pidió.

---

## 2. CORREO @folvy.app (FUNCIONANDO — buzones reales)

### 2.1 Historia del problema (para no repetir callejones sin salida)
- El dominio `folvy.app` está registrado en **OVH**. Tenía un **MX Plan gratuito** que **solo permite
  redirecciones, NO crear buzones** ("No puede crear cuentas de correo electrónico").
- Se intentó la vía **Google Workspace** (la cuenta del CEO `jgcolon@idasal.com` es Workspace):
  **DESCARTADA.** Es **G Suite legacy free** (Edición antigua de G Suite, gratis, activa desde 2013,
  **94 licencias disponibles / 6 asignadas**, dominio principal idasal.com). Doc oficial de Google
  confirma: *"Si tienes la edición gratuita heredada de Google Workspace, la opción 'Agregar un
  dominio' no está disponible."* → no deja añadir folvy.app ni como secundario ni como alias.
  Tampoco deja "Enviar como" SMTP externo por defecto ("Functionality not enabled").
- **Solución final adoptada:** contratar el **MX Plan de pago de OVH (MXPLAN 5)** → buzones reales.

### 2.2 Lo que está montado HOY
- **OVH MXPLAN 5** contratado y **Activo** (creado 02/06/2026). Coste **~5 € + IVA = 6,05 € AL AÑO**
  (anual, confirmado; el mensual es otro producto, Email Pro/Zimbra desde 1,59 €/mes). Capacidad 5
  cuentas. Webmail: **Roundcube**. DKIM activo.
- **Buzones reales creados:** `hello@folvy.app` y `partners@folvy.app` (cada uno con su contraseña;
  Julio las tiene apuntadas — NO están en este documento por seguridad).
- **Redirección que SE DEJA INTACTA:** `postmaster@folvy.app` → `jgcolon@idasal.com` (técnica estándar,
  no tocar). Las antiguas redirecciones de `hello@`/`partners@` ya no existen (no chocan con los buzones).

### 2.3 Datos de servidor OVH (para configurar en Gmail / móvil / Outlook)
- **Enviar (SMTP):** `ssl0.ovh.net` · puerto **465** · SSL · usuario = dirección completa · contraseña del buzón.
- **Recibir (IMAP):** `ssl0.ovh.net` · puerto **993** · SSL · mismos credenciales.
- **Recibir (POP3):** `ssl0.ovh.net` · puerto **995** · SSL (si se usa "Consultar correo de otras cuentas" en Gmail).

### 2.4 Estado de la integración con Gmail
- Julio indicó "ya funciona" (envío como `@folvy.app` resuelto, probablemente activando la palanca
  en admin.google.com → Aplicaciones → Gmail, o usando Roundcube/IMAP). **PENDIENTE de confirmar la
  prueba real** (enviar y recibir un correo de test).
- **PENDIENTE (Julio lo hará luego):** terminar de configurar en Gmail si quiere todo en su bandeja:
  - Recibir: Ajustes → Cuentas e importación → "Consultar el correo de otras cuentas" → POP3 (puerto 995 SSL).
  - Enviar: Ajustes → Cuentas e importación → "Enviar como" → SMTP `ssl0.ovh.net` 465 SSL.
  - El "Enviar como" pide un código de verificación que llega a `hello@folvy.app` (leer en Roundcube).

### 2.5 Nota sobre Resend (no confundir)
`CONTEXTO_CLAUDE.md §3` menciona Resend con dominio `folvy.app` verificado y remitente
`no-reply@folvy.app` para correo **transaccional de la app** (DKIM/SPF/DMARC/MX en OVH). Eso es
para emails automáticos del producto. Los buzones `hello@`/`partners@` de esta sesión son para
**correo humano/comercial**. Conviven; el MX del dominio apunta a OVH (correcto para ambos).

---

## 3. CORREO A HUBRISE (ENVIADO)

### 3.1 Qué es HubRise y por qué
Middleware francés (Sophia Antipolis) que conecta TPV, online ordering y plataformas de delivery
(Uber Eats, Deliveroo, Just Eat, etc.). Tiene **programa de partners con opciones gris/marca blanca**,
modelo de **reventa** (el partner crea/gestiona cuentas a nombre del cliente y factura con su margen),
precio **por local/mes** con descuento por volumen y tarifa especial multimarca. Candidato a ser el
**conector multi-POS / capa de catálogo y pedidos** de Folvy (frente estratégico TPV bidireccional).

### 3.2 El correo
- **Enviado a:** `contact@hubrise.com` (canal oficial para partners/resellers; ellos ofrecen también
  "Schedule a call" y formulario en hubrise.com/contact-us, pero se optó por email).
- **Desde:** `partners@folvy.app`.
- **Idioma:** inglés. **Firma: Julio Gª Colón / Folvy — folvy.app / partners@folvy.app.**
- **Sin llamada** (Julio no conversa en inglés fluido; todo por email — así se indicó en el correo).
- **4 puntos:**
  1. **(EL MÁS IMPORTANTE) Transición / dual-running:** ¿puede la misma marca convivir en Last.app y
     HubRise durante la migración, sin conflictos ni duplicación? **Y plan B:** si no es posible en
     producción, ¿hay **entorno test/sandbox** para montar toda la integración y probar con datos de
     test antes de pasar a real?
  2. Modelo de reventa marca blanca (quién es titular de cuenta y de la facturación; cómo es el acuerdo).
  3. Precio multimarca por local (5/7/10 marcas/local: cuota por local + alta por marca/plataforma +
     descuentos por volumen).
  4. Cobertura España: Glovo, Uber Eats, Just Eat — ingesta de pedidos Y publicación de catálogo/precios.

### 3.3 Próximo paso con HubRise
Esperar respuesta (días laborables). **Lo crítico a leer en su respuesta = la pregunta nº1**
(convivencia o sandbox), porque de eso depende cómo migrar Llorente29 sin romper producción.
Cuando respondan, interpretar y preparar contestación.

---

## 4. CONTEXTO ESTRATÉGICO (recordatorio del frente TPV/integración)
- **Integración TPV bidireccional en 2 fases:** Fase 1 = Folvy LEE del TPV (ventas+catálogo, mapeo
  por organizationProductId) — Last.app webhook YA en producción. Fase 2 = Folvy PUBLICA catálogo+
  precios. Dirección del catálogo **configurable por marca** (`catalog_source` 'folvy'|'pos'), no global.
- Llorente29 es mixto: marcas propias gestionables en Folvy, cedidas (Cloudtown) usan Last.app.
- Conector = capa genérica multi-POS; Last.app es el primer adaptador. **HubRise es un candidato a
  capa/segundo adaptador** — de ahí el correo.

---

## 5. PRÓXIMOS PASOS AL RETOMAR (de esta sesión)
1. **Confirmar prueba real del correo** `hello@`/`partners@folvy.app` (enviar+recibir un test).
2. **Arreglar `www.folvy.app`** en Vercel (Add domain → redirección al apex).
3. **Esperar/gestionar respuesta de HubRise** (foco en pregunta nº1: convivencia o sandbox).
4. (Opcional) Optimizar peso de la web (logos base64 → archivos).
5. **Actualizar `CONTEXTO_CLAUDE.md §2`**: nombre del CEO → "Julio Gª Colón" (no Gascón).

## 6. PENDIENTES TÉCNICOS HEREDADOS (del cierre 31/05, NO tocados hoy — siguen vigentes)
- `.gitignore` sin cerrar + 2 commits sin push en `llorente29-app` + trabajo de Kitchen sin commitear.
- Deuda seguridad: guard `auth.uid()` antes de recepción por webhook; rotar service_role key + tokens;
  activar PITR.
- Eslabón 1 de Compras (formatos + coste que fluye) construido/demostrado; siguiente: UI alta de
  compras + foto→IA del albarán; luego OC interna → recepción → AvT.
- Detalle completo en `CONTEXTO_CLAUDE.md §1` (estado 31/05).

---

## 7. ESTADO GLOBAL EN UNA FRASE
La APP (`app.folvy.app`) está en su estado técnico del 31/05 (frente Compras, eslabón 1 demostrado,
push pendiente). Hoy 02/06 se ha levantado en paralelo la **presencia de marca** (web `folvy.app`
publicada) y el **canal de comunicación** (`@folvy.app` operativo), y se ha **enviado el primer
contacto formal a HubRise**. Nada de la app se ha tocado.
