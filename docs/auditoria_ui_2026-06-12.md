# Auditoría de UI — botones muertos y funciones a medias

> **Fecha:** 2026-06-12 · **Rama:** `saneamiento/auditoria-ui` · **Alcance:** todo `src/`
> **Método:** barrido por módulo (5 pasadas: Kitchen, Supply, Team, Safety, Sales/Connect/Admin/Shell)
> verificando el código real de cada `<button>`/clicable + corroboración por `grep`
> (`onClick` vacío, `alert('próximamente')`, `TODO`, `próximamente`, `no implementado`).
> **Este documento SOLO inventaría. No se arregló nada** (los arreglos los prioriza Julio).

## Resumen ejecutivo

La UI está **en muy buen estado para presentar a cliente**: **0 hallazgos bloqueantes**.
Todos los botones de acción auditados llaman a un service/RPC/Edge real; los formularios
persisten; el patrón "IA propone → humano confirma" está implementado de forma defensiva
(nada se aplica solo). Lo único encontrado son **placeholders cosméticos con etiqueta
honesta** ("próximamente"/"plan Pro") y **un checkbox que guarda estado pero aún no se usa**.

| Severidad | Nº |
|---|---|
| 🔴 Bloquea (botón muerto / acción que promete y no cumple) | **0** |
| 🟡 Cosmético (placeholder honesto / estado guardado sin usar) | **8** |

**Módulos en `src/modules/`:** `appcc`, `configuracion`, `folvy-ai`, `integrations`,
`kitchen`, `mapping` (**vacío**), `multitenancy`, `personal`, `supply`, `ventas`.
Más `src/pages/` (Team), `src/shell/` (Home/nav), `src/admin/` (admin) y `src/components/`.

---

## Kitchen

| Pantalla | Elemento | Texto | Problema | Severidad | Fichero:línea |
|---|---|---|---|---|---|
| KitchenDashboardPage | Nota al pie del dashboard | "Pendiente de cablear: movimientos de precio (7 días) y alérgenos automáticos" | Texto honesto de deuda (no es botón ni acción); declara qué dato aún no se calcula | 🟡 cosmético | `src/modules/kitchen/pages/KitchenDashboardPage.tsx:210` |

Resto del módulo (recetas, escandallos, ingredientes, menú, proveedores, ajustes,
modificadores, IVA, familias): **sin hallazgos**. Todos los CRUD persisten y la asistencia
IA es campo-a-campo con confirmación humana.

> Nota Frente 2: el botón "Completar con IA" de la ficha de ingrediente SÍ funciona, pero
> deja la ficha a medias (no asigna familia ni IVA ni retira "sin terminar"). Eso NO es un
> botón muerto — es alcance incompleto, y se aborda en el Frente 2 de este encargo.

## Supply

**Sin hallazgos.** Pedidos, recepciones (incl. el form de 1.955 líneas), facturas,
inventario, conteos, merma y autoinventario: todos los botones de acción
("Guardar pedido", "Confirmar", "Registrar merma", "Nuevo conteo"…) llaman a services/RPC
reales (`createPurchaseOrder`, `confirmReceipt`, `registerWaste`, …). Los empty-state
("Sin pedidos", "Sin recepciones") llevan su botón de alta activo.

## Team (Folvy Team / Personal)

| Pantalla | Elemento | Texto | Problema | Severidad | Fichero:línea |
|---|---|---|---|---|---|
| KioskoFichajePage (modal config) | Checkbox | "Pedir foto al fichar (próximamente)" | Guarda `draft.requirePhoto` pero el flujo de fichaje nunca lo usa para exigir/validar la foto | 🟡 cosmético | `src/pages/KioskoFichajePage.tsx:523` |

Resto (StaffPage, Fichajes, Ahora mismo, Solicitudes, Turnos abiertos, Cambios,
Calendario, Plantillas, Informes, Bolsa de horas, HomeEmpleado, tabs de personal):
**sin hallazgos**. Aprobar/rechazar, fichar, exportar CSV, cerrar período, etc. llaman a
services reales.

## Safety (APPCC)

| Pantalla | Elemento | Texto | Problema | Severidad | Fichero:línea |
|---|---|---|---|---|---|
| FieldRenderer (campo de checklist) | Campo tipo "firma" | "Firma manuscrita — disponible en plan Pro" | Tipo de campo no disponible, renderizado deshabilitado/informativo (no es un botón roto) | 🟡 cosmético | `src/modules/appcc/components/FieldRenderer.tsx:228` |

Resto (Dashboard, Hoy, Incidencias, Informes, Auditorías, ejecución, plantillas,
onboarding, modales): **sin hallazgos**. "Completar y firmar", "Generar PDF",
"Aplicar correctiva", "Crear auditoría"… todos con service real.

## Sales / Connect / Admin / Shell

| Pantalla | Elemento | Texto | Problema | Severidad | Fichero:línea |
|---|---|---|---|---|---|
| HomeGeneral | Métrica | "Solicitudes — / próximamente" | Sin fuente de datos aún; muestra "—" honesto (no inventa). No accionable | 🟡 cosmético | `src/shell/home/HomeGeneral.tsx:111` |
| HomeGeneral | Métrica | "APPCC hoy — / próximamente" | Sin fuente de datos aún; "—" honesto. No accionable | 🟡 cosmético | `src/shell/home/HomeGeneral.tsx:118` |
| HomeGeneral | Tarjeta resumen Team | "Detalle de turnos próximamente" | Línea informativa; el detalle de turnos aún no se resume aquí | 🟡 cosmético | `src/shell/home/HomeGeneral.tsx:135` |
| HomeGeneral | Tarjeta resumen Safety | "Resumen APPCC próximamente" | Línea informativa; el resumen APPCC aún no se conecta | 🟡 cosmético | `src/shell/home/HomeGeneral.tsx:143` |
| AdminHomePage | Tarjetas de navegación | "próximamente" (deshabilitadas) | Tarjetas con `to: null` deshabilitadas a propósito; secciones admin aún no cableadas | 🟡 cosmético | `src/admin/pages/AdminHomePage.tsx:15,89` |

Connect (integraciones/marketplace/detalle de conector), Multitenancy (marcas/locales/
cuentas), Shell (topbar, bottom-nav, sidebar, selectores), Folvy-AI (chat) y
`src/components/` (NotificationBell, selectores): **sin hallazgos**. CRUD y navegación
completos.

`src/modules/mapping/` está **vacío** (carpeta sin contenido funcional) — no es UI rota,
pero conviene saberlo para no referenciarla.

---

## Lectura para Julio (priorización)

- **Nada bloquea la demo a Llorente29.** No hay botones que el cliente pueda pulsar y no
  pasar nada con texto que prometa acción.
- Los 8 cosméticos son **placeholders honestos** salvo **uno con matiz**: el checkbox
  "Pedir foto al fichar" del Kiosko (Team) **sí se puede marcar** y guarda el estado, pero
  no exige la foto al fichar. Riesgo: un gerente cree que activó una medida de control que
  no existe. Recomendación: deshabilitar el checkbox (o quitarlo) hasta implementarlo, o
  cablear la validación de foto en el flujo de fichaje. **Es el más "engañoso" de los 8.**
- El resto (HomeGeneral "próximamente", AdminHome deshabilitadas, firma "plan Pro",
  nota del dashboard) son transparencia de roadmap, no fallos.

## Cobertura y método

- Barrido sistemático de **todos** los módulos bajo `src/modules/` + `src/pages/` +
  `src/shell/` + `src/admin/` + `src/components/`, leyendo el handler real de cada botón.
- Corroboración por patrones (`onClick={() => {}}`, `alert('…')`, `TODO`, `próximamente`,
  `no implementado`). Los `alert(...)` encontrados son **manejo de error legítimo**
  (`AprobarCambioModal`, `TablonCambiosView`), no falsas promesas. Los `TODO` restantes
  viven en **documentación** (`src/docs/**`), no en código de UI.
- Si aparecen más casos al usar la app en vivo, añadirlos aquí (documento vivo).
