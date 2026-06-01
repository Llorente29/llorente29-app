# Folvy — Diseño del Portal del Trabajador (móvil) + Kiosko

**Última actualización:** 1 de junio de 2026
**Estado:** Pieza 1 (acceso por enlace/QR) **construida y verificada**. Resto en diseño.
**Cliente lab:** Llorente29 (Pamela y equipo).
**Documentos relacionados:** `folvy_auth_model.md`, `CONTEXTO_CLAUDE.md`.

> Este documento se reescribió contra **código real leído**, no contra el manual `01-app-trabajador.md` (que estaba desactualizado). Donde antes había suposiciones, ahora hay verdad verificada.

---

## 0. Lo que de verdad existe hoy (verificado en código)

Casi todo el portal del trabajador **ya está construido y funciona**. El trabajo restante es mayormente **revestir + renavegar**, no construir features.

- **Acceso/login:** modelo **C1** = usuario + contraseña, con email sintético interno `{username}@empleado.folvy.app` (el trabajador nunca lo ve). Edge Function `manage-employee` (`create`, `set_password`, `grant_access`, `deactivate`/`reactivate`, `delete_permanent`, y ahora `generate_access_link`). Cliente PKCE (`detectSessionInUrl`, `flowType: 'pkce'`).
- **Fichaje con GPS (YA EXISTE):** `FichajeEmpleado.tsx` pide ubicación, calcula distancia (`distanceMeters`), radio **200m** (`RADIUS_M`), auto-selecciona el local más cercano si hay varios, deshabilita el botón si estás fuera, distingue entrada/salida (`nextClockType`) y detecta jornada abierta. **No es construcción nueva: solo cosmética pendiente.**
- **Portal completo funcionando:** horario (con cruce de medianoche), turnos abiertos (postularse), cambios de turno (cesión/petición directa/intercambio + tablón), mis fichajes, bolsa de horas (condicional), documentos (subir/descargar 5MB, 7 tipos), vacaciones (7 tipos con saldo y aviso de antelación).
- **Marca YA aplicada:** el portal usa los tokens reales (`bg-page`, `text-accent` navy, `bg-card`, `font-display` Fraunces, semánticos). **NO hay que recolorear** salvo el home (ver §3.1).
- **Notificaciones:** solo campana (`NotificationBell`), **no push**. Envío unidireccional encargado→empleado (`SendMessageModal`). **No hay mensajería bidireccional.**
- **Gating de rol en `App.tsx`:** worker puro (`role==='worker'` + `employeeId`) → `TrabajadorApp`; encargado dual → Shell + "Ver como trabajador".

---

## 1. Pieza 1 — Acceso por enlace/QR (CONSTRUIDA Y VERIFICADA)

**Objetivo (cumplido):** el trabajador recibe su acceso por **enlace/QR**, **sin depender de email**, entra **sin teclear nada**, y el encargado puede **reenviarlo** si lo pierde o cambia de móvil.

**Por qué así (mercado + caso real):** el estándar (Factorial, 7shifts) es invitación por enlace donde el empleado fija contraseña. Se descartó "que el trabajador cree usuario/contraseña" porque la población de hostelería rompe esa suposición (sin email, contraseñas olvidadas). El enlace mágico es **más simple que el estándar**: no crea ni recuerda nada. Se descartó dejar elegir usuario (colisiones; el username está incrustado en el email sintético C1).

**Arquitectura (verificada de punta a punta):**
1. `manage-employee` -> acción `generate_access_link` (solo admin, **con verificación cross-tenant** vía `location_id -> account_id`). Llama a `admin.generateLink({type:'magiclink'})` **sin enviar correo** y devuelve `token_hash`.
2. `employeeAuthService.generateAccessLink(employeeId)` (cliente).
3. `AccesoTrabajadorPanel.tsx` (en alta y en ficha del empleado): arma `${origin}/acceso?token_hash=...&type=magiclink`, lo pinta como **QR** (lib `qrcode`) + **copiar enlace** + **reenviar**.
4. `AccesoClaimPage.tsx` (ruta pública `/acceso`): canjea con `verifyOtp({token_hash})` — **NO depende de PKCE** (por eso funciona con enlaces de servidor) — y al iniciar sesión navega a `/`, donde `App.tsx` enruta al portal por rol.
5. `App.tsx`: ruta pública `/acceso` (tras `/reset-password/confirm`).

**Entrega multicanal:** QR para escanear, o copiar-enlace para WhatsApp/SMS. Email opcional, nunca obligatorio. Commit local `17ec37c`.

**Notas de seguridad:** el enlace es credencial de un solo uso, caduca según el OTP expiry de Auth, no se audita su valor. El `generate_access_link` cierra cross-tenant igual que `grant_access`.

---

## 2. Marca (tokens reales de Folvy)

| Token | Valor | Uso |
|---|---|---|
| `page` | `#F5F4F0` | Fondo |
| `card` | `#FFFFFF` | Tarjetas |
| `border-default` | `#E0DDD6` | Bordes |
| `text-primary` | `#0C0A09` | Texto |
| `text-secondary` | `#6B6760` | Texto secundario |
| `accent` (navy) | `#1E3A5F` / hover `#162E4A` / bg `#EDECE6` | Acento estructural: banda superior, iconos, nav activa |
| `terracota` | `#D67442` / hover `#C25F2E` / bg `#FAEFE6` | CTA destacado (fichar) |
| `success` | `#3F5C2F` / bg `#E2E8DA` | En regla / en curso / ubicación OK |
| `warning` | `#BA7517` / bg `#FAEEDA` | Pendiente |
| `danger` | `#A32D2D` / bg `#FAECEC` | Error / fichaje olvidado |
| Display | **Fraunces** | Saludo, cifras, títulos |
| Sans | Inter | Cuerpo |

**Decisión:** navy en **banda superior** en cada pantalla (coherente con el Folvy de gestión). Terracota = CTA fichar. **Sin gradientes** (el home aún arrastra `from-emerald-*`: pendiente de quitar, ver §3.1).

---

## 3. Diseño del portal (pendiente de construir, post Pieza 1)

### 3.1 — Reskin del home + navegación (PENDIENTE)
- **Home actual:** dos botones grandes con **gradientes verdes** (APPCC) y azul (Mi Portal). Quitar gradientes -> banda navy + tarjetas planas en marca.
- **Inicio adaptativo:** antes de fichar -> fichar al frente; fichado -> tareas APPCC al frente + cronómetro de jornada viva (reutiliza el evento `clock_in` existente).
- **Navegación por bottom-tabs** (Inicio · Fichar · Tareas · Más), sustituyendo el patrón actual de `onBack`. Extensible.

### 3.2 — Fichar (REVESTIR, no construir)
GPS ya funciona (radio 200m, auto-local, distingue entrada/salida). Solo cosmética: banda navy, confirmación de ubicación visual, hora grande. El **aviso de fichaje olvidado** sí es nuevo (no existe hoy; el manual dice "pídeselo al encargado"); verificar `notificationsService` antes de construir.

### 3.3 — Tareas (APPCC)
`MisChecklistsPage` ya existe (filtra por asignación o sin asignar). Revestir e integrar en pestaña.

### 3.4 — Más (portal completo)
Agrupado: Mi jornada (fichajes, horario, bolsa) · Turnos (mis turnos, abiertos, cambios) · Gestión (solicitudes, documentos) · Comunicación (mensajes = **bandeja de avisos**, no chat). Todo ya construido; falta agrupar + revestir.

### 3.5 — Onboarding (RESUELTO por Pieza 1)
El acceso del trabajador nuevo es el enlace/QR (§1). Pendiente complementario: instalación **PWA** (icono en pantalla de inicio; Android auto, iOS manual con instrucciones). Sin app nativa.

---

## 4. Decisiones de producto y legales

- **Geolocalización: SÍ** (ya implementada). Puntual al fichar, no rastreo continuo. Legal (minimización RGPD).
- **Biometría: NO.** Reconocimiento facial/huella ilegal para fichar en España (Guía AEPD nov-2023). Folvy NO la implementa -> **argumento de venta** (cumple por diseño).
- **"App descargable" = PWA**, no nativa. Push en iOS limitado; declarado.
- **Mensajería v1 = bandeja de avisos** (encargado->trabajador), no chat. Bidireccional = pieza futura.
- **Kiosko:** PIN en dispositivo compartido del local, intacto. Es vía rápida, convive con el acceso por enlace al móvil personal.

---

## 5. Estado de piezas

| Pieza | Estado |
|---|---|
| **1. Acceso por enlace/QR** | **Construida y verificada** (commit `17ec37c`) |
| 2. Reskin home (gradientes->navy) + bottom-tabs | Pendiente |
| 3. Inicio adaptativo + fichar vivo | Pendiente |
| 4. Fichar (revestir GPS existente) | Pendiente |
| 5. Bandeja de avisos + missed-punch | Pendiente (verificar lógica antes) |
| 6. PWA instalable | Pendiente |

---

## 6. Deudas y ajustes declarados (vivos)

- **`exitLabel` del worker:** el trabajador que entra por enlace ve "Volver a gestión" en vez de "Salir" (cosmético, en `TrabajadorApp`/`HomeEmpleado`). Ajuste fino.
- **OTP expiry de Auth:** revisar/subir si se quiere que el enlace valga horas (para "lo mando por WhatsApp y lo abre luego"). Config de Supabase, sin código.
- **`xlsx` (SheetJS):** vulnerabilidad high preexistente (Prototype Pollution + ReDoS), sin fix upstream. Migrar/aislar en sesión de mantenimiento. No introducida por esta pieza.
- **Drawer / SuppliersPage:** ediciones del Drawer sin cerrar (decisión lateral vs pantalla completa pendiente con datos reales). En working tree, sin commitear.
- **`.gitignore` + push:** bloqueante. Hay 3 commits locales por delante de `origin/main` sin empujar; el `.gitignore` debe cerrarse antes de cualquier `push` (datos de cliente en working tree). NO usar `cierre-sesion.ps1` hasta entonces.
- **`folvy_e8_pasos_inteligentes_diseno.md`** suelto en raíz; mover a `docs/` en limpieza.
