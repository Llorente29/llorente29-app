# Folvy — PROTOCOLO DE TRABAJO EN REMOTO (15 días sin el PC principal)

> **17/08/2026 · v3.** Julio trabaja desde un portátil ~15 días. Objetivo: **que no se pierda nada y
> que no se duplique nada.** Este documento manda mientras dure.
>
> ⚠️ **v1** partía de una premisa falsa —que Code corría en el PC de Julio— y se preocupaba del
> riesgo equivocado. Corregida el 17/08 con la comprobación de entorno.
> ⚠️ **v2** llevaba una ventana de despliegue inventada (11:00). Corregida en la v3 con datos.

---

## 0. Dónde corre Code — el dato que lo cambia todo

**Code NO corre en el PC ni en el portátil de Julio.** Corre en un **contenedor Linux efímero en la
nube**, que **clona el repo de cero al arrancar cada sesión** y **se recicla tras un rato de
inactividad**.

1. **Dónde esté Julio da igual.** El repo de trabajo es **GitHub**.
2. **El riesgo real no es el viaje: es el contenedor.** Ese disco desaparece y no vuelve. **Todo se
   empuja a `origin` en cuanto existe.** Nada se acumula en local "para el final".
3. **`node_modules` no sobrevive.** Cada sesión nueva necesita `npm install` antes de `tsc -b` o
   `vite build`. Está **permitido** y no hay que consultarlo.

---

## 1. El puente: el repo es lo único que Code ve

**Los documentos del proyecto de claude.ai son INVISIBLES para Code.** Entre el 16 y el 17/08 esto
bloqueó el trabajo **cinco veces**.

> **Regla, endurecida el 17/08: ningún encargo declara «contexto obligatorio» un documento de
> claude.ai.** O el contenido va dentro del encargo, o no se cita. Si un documento debe persistir,
> se le pasa el contenido y **Code lo commitea él mismo en `claude/` del repo**.

| Artefacto | Canónico | Copia |
|---|---|---|
| Decisiones, diseños, encargos, hallazgos | **Proyecto claude.ai** | `claude/` del repo, **con fecha en cabecera** |
| Código, migraciones, tipos | **Repo** | — |
| Verdad viva del sistema | `folvy_mapa_sistema.md` (**repo**) | resumen en el proyecto al cerrar |

**Si difieren, manda el proyecto para decisiones y el repo para código.** Sin fecha no se sabe cuál
es la vieja — eso costó ocho horas el 15/08 con la paleta archivada.

---

## 2. Ritual de arranque (cada sesión, sin excepción)

1. Leer `claude/folvy_arranque_prompt.md` y `claude/folvy_indice.md`.
2. Leer el registro de frentes (§4).
3. **No dar nada por vigente de memoria.** Comprobar contra el proyecto, el repo o la BBDD.
4. Si hay que compilar: `npm install` primero.

## 3. Ritual de cierre (obligatorio aunque la sesión dure diez minutos)

1. **Qué se hizo**, con su verificación — o declarando explícitamente lo NO verificado.
2. **Qué queda abierto**, y quién lo desbloquea.
3. **Qué se decidió y por qué** — para no re-litigarlo.
4. **Deudas nuevas**, cada una con su **disparador**.

---

## 4. Registro de frentes — estado al cierre del 17/08

### Cerrado y verificado

- Módulo HubRise, backend completo (F1 + 2.0–2.7), certificado en laboratorio y producción.
- Pre-audit de HubRise **cerrado por Antoine el 05/08**. No se le debe respuesta. Tope: **5 locales vivos**; el nº 6 dispara auditoría.
- **PR #81 mergeada a `main`** el 17/08 (`14a9f73`, merge normal). Pipeline verde (run 141).
- **Carabanchel conectado a HubRise** el 17/08 a las 09:12 — paso 0, con el módulo `kind='location'`. Verificado: `external_location_id=1b6p8-2`, `location_id=92d7656e…`, `ei.location_id` **no NULL** (el trigger quedó esquivado), token presente. **La identidad de `1b6p8-2` quedó confirmada por la API de HubRise**, no por captura.
- **Rediseño de `EditPricesModal`** + **pantalla de reconciliación de marcas** + **panel de catálogos**, mergeados a `main` el 17/08 (`84553f2`). **Pipeline verde (run 142, 10:55), OTA publicada** — dentro de ventana.
- `hubrise-catalog-create` **v1 desplegada** (crea y mapea, **sin publicar**).

### El hallazgo que salvó a Alcalá

`hubrise-catalog-publish` **sólo acepta `brand_id`** y selecciona `brand_hubrise_catalog` **sin
filtro de local**; `hubrise-brand-connect` la llama así. Reutilizarla para Carabanchel **habría
republicado el catálogo `j99jm` de Alcalá en producción**. Por eso existe una función nueva y
estrecha. Verificado leyendo el código desplegado.

### Carabanchel — dónde está de verdad

| Capa | Estado |
|---|---|
| Conexión Folvy ↔ HubRise | ✅ hecha y verificada |
| Bridges en HubRise | ✅ **15 creados** (6 marcas propias × plataformas con escaparate), nombres corregidos |
| Activación de los bridges | ❌ **ninguna** — requiere trámite con soporte |
| Catálogos por marca | ❌ 0 |
| Mapeos de marca | ❌ 0 |
| Pedidos recibidos | 0 |

**Las 15 conexiones apuntan al catálogo genérico `Foodint · bnnpd`.** El bridge **también empuja el
menú hacia la plataforma**: activar una así puede publicar el menú equivocado en un escaparate vivo.
**Ninguna se activa antes de tener su catálogo y estar reapuntada.**

**Un bridge no se crea: se solicita.** Uber es autoservicio; Glovo y Just Eat van por correo
(Janaina / `support@hubrise.com`), con plazo de terceros.

### 🔴 La decisión que gobierna todo y sigue sin tomarse

El formulario de activación avisa: **Glovo rechaza la conexión si la tienda sigue en otro TPV o
middleware.** Los escaparates de Foodint están en **Last.app** (Alcalá, 14 días: **597 ventas por
Last.app frente a 84 por HubRise**).

**Activar un bridge no añade un canal: sustituye al que hay.** Es una migración de producción, marca
por marca, con facturación viva. **Decisión de negocio de Julio, sin marcha atrás barata.**

### Espera a Julio (sólo él puede)

- **La decisión de migración desde Last.app** (arriba). Bloquea todo lo demás de Carabanchel.
- **Captura desaturada de los tres estados** del modal de precios — la primera mirada humana al rediseño ya desplegado.
- **Ensayo del panel de catálogos** en `/_admin/hubrise` (laboratorio) y el `dry_run` de scope sobre Alcalá.
- Email de **Janaina** sobre pausa por marca virtual.
- Banner de **VAT intracomunitario** de la cuenta HubRise.
- Los **9 turnos de Marlón Mafla** dentro de su semana de vacaciones (3–9 ago).

### Deudas declaradas el 17/08

| Deuda | Disparador |
|---|---|
| **Folvy no puede operar sobre la cuenta de un cliente.** Ningún usuario pertenece a dos cuentas; el único platform admin sólo está en el laboratorio; la RLS sigue siendo por cuenta. | **Cliente 2.** Es Fase 0. |
| **449 ventas sin marca atribuida en Kitchen Grill LstQ** (6 claves, una viva el 16/08). La rentabilidad por marca de esa cuenta está incompleta. | Triaje con la pantalla de reconciliación. |
| **Bandas de salud del margen** sin definir. `foodCostStatus === 'over'` es un sustituto interino; el ámbar no aparecerá hasta que haya escandallos. | Cuando haya escandallos. |
| **`sales_channel.color` a NULL** en las 3 cuentas. Fallback por nombre ya puesto; poblar la columna lo convierte en dato. | Cuando se quiera; ya no bloquea. |
| **`sw.js:62`** — `event.respondWith(fetch(req))` sin `.catch()`: no-op que sólo añade un modo de fallo. Ruido de consola, no fallo funcional. | Cuando Julio pueda mirar una tablet. **No se toca en remoto.** |
| **`hubrise-catalog-create` desplegada no es byte a byte lo del repo** (cabecera y acentos), por falta de `SUPABASE_ACCESS_TOKEN` en el contenedor. | El v2 se despliega desde el repo. |
| **El traductor del navegador traduce los nombres de las conexiones de HubRise** («Bendito Burrito» → «Burrito Bendito»). El nombre es clave de mapeo. | Desactivar traducción en `manager.hubrise.com`. **Hecho.** |

---

## 5. Ramas: no dejar crecer la pila

- **Merge normal, nunca squash.** El squash rompe la línea y fabrica el conflicto que evitamos.
- Lo certificado por captura se mergea. **Lo no verificado no se mergea ni se apila más.**
- Una rama por encargo. Nunca empujar a una ya mergeada.

---

## 6. Qué se puede hacer, y qué no

**Sí, todo desde el navegador:** verificar en previews de Vercel por captura · panel de Supabase ·
consola de HubRise · correo · diseñar, decidir, escribir encargos y maquetas.

**No, o con extremo cuidado:**

- **Regla de las 5 etapas intacta**: commit → push → PR/merge → deploy → **verificado en vivo**.
- **Ningún despliegue de `hubrise-webhook`** — camino vivo de pedidos de Alcalá.
- **Nada que exija estar delante de una tablet o del local.**

### 🕐 Ventana de despliegue — corregida el 17/08 con datos

> **Los despliegues tienen que estar TERMINADOS a las 12:15.**
> **Prohibido 12:15 → 23:45.**

El límite **no es la hora de pulsar, es la hora a la que tiene que estar acabado** — pipeline y OTA
incluidos.

Evidencia (30 días de Foodint, hora local):

| Hora | Ventas | Días con venta |
|---|---|---|
| 11 | 0 | 0 de 30 |
| 12 | 3 | 2 de 30 |
| **13** | **266** | **30 de 30** |
| 21 | 455 | 30 de 30 |

Entre las 03:00 y las 12:00 no hay prácticamente nada. **La restricción no son las ventas: son los
fichajes de las 12:30.** Julio confirma que nadie usa la app antes de las 12:45, salvo fichajes.

⚠️ La v2 de este protocolo decía «11:00 → 23:45». **Ese 11:00 no salía de ningún dato** — era un
colchón inventado que se coló como regla. Corregido.

---

## 7. Reglas que no se relajan

- **Inventario antes de construir.** Ninguna tarea empieza escribiendo código.
- **Verificar, no deducir** — contra BBDD, código desplegado o doc oficial.
- **Distinguir lo verificado de lo no verificado** en cada informe. `NO_RESUELTO` es salida legítima.
- **Un `location_id` o un `brand_id` nunca se identifica por su nombre.** El laboratorio replica los
  nombres de producción: hay dos «Foodint Carabanchel» y dos «Bendito Burrito». Siempre por UUID.
- **El silencio sólo es resultado** si antes se ha provocado el ruido y se ha visto llegar.
- **Todo andamiaje temporal nace con su disparador de borrado escrito.**
- **Nada es HECHO** hasta verificado en vivo.
- **Toda pantalla nueva de cara al cliente se maqueta y se aprueba antes de construirse.**
- **Empujar a `origin` en cuanto exista.** El contenedor de Code es efímero.
- **Nada que Julio tenga que hacer por consola del navegador es producto.** Si hace falta una acción,
  se construye un botón.

---

## 8. Al volver

1. Repasar este registro contra la realidad — **no fiarse de él**, comprobar.
2. Fusionar lo que quede apilado, en orden.
3. Tomar la decisión de Last.app antes de tocar un solo bridge más.
4. Retomar lo que exigía presencia física.
