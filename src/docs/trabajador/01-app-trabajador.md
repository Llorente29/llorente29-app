# 📱 La app de Folvy para trabajadores

> **¿Para quién es esto?** Para ti si trabajas en Folvy y vas a usar la app desde tu móvil.
>
> **¿Qué cubre?** Todo lo que puedes hacer: fichar, ver tu horario, pedir vacaciones, solicitar cambios de turno, descargar nóminas y más.

---

## 📋 Índice

1. [Primera vez: cómo entrar](#1-primera-vez-cómo-entrar)
2. [Pantalla de inicio (menú principal)](#2-pantalla-de-inicio-menú-principal)
3. [Notificaciones (campana 🔔)](#3-notificaciones-campana-)
4. [Fichar entrada y salida](#4-fichar-entrada-y-salida)
5. [Mi horario](#5-mi-horario)
6. [Solicitar cambio de turno](#6-solicitar-cambio-de-turno)
7. [Tablón de cambios](#7-tablón-de-cambios)
8. [Mis fichajes](#8-mis-fichajes)
9. [Mi bolsa de horas](#9-mi-bolsa-de-horas)
10. [Mis documentos](#10-mis-documentos)
11. [Mis vacaciones](#11-mis-vacaciones)
12. [Turnos abiertos](#12-turnos-abiertos)
13. [Preguntas frecuentes](#13-preguntas-frecuentes)
14. [Errores comunes](#14-errores-comunes)

---

## 1. Primera vez: cómo entrar

### 1.1 Abrir la app

Tu encargado/a te dará un **enlace** o te dirá cómo descargar la app. Lo más probable es que te diga: *"abre este enlace en tu móvil y añádelo a la pantalla de inicio"*.

📸 *TODO: añadir captura de cómo "Añadir a pantalla de inicio" en `docs/capturas/trabajador-instalar-app.png`*

### 1.2 Elegir modo Trabajador

La primera vez que abras la app, te preguntará **"¿Quién eres?"**. Pulsa **"Modo Trabajador"**.

📸 *TODO: añadir captura del selector inicial en `docs/capturas/trabajador-selector-modo.png`*

### 1.3 Login con tu nombre y PIN

1. Selecciona **tu nombre** de la lista
2. Introduce el **PIN de 4 dígitos** que te dio tu encargado/a
3. Pulsa **Entrar**

📸 *TODO: añadir captura del login en `docs/capturas/trabajador-login.png`*

> 💡 **No vas a tener que meter el PIN cada vez.** La app recuerda tu sesión. Solo tendrás que volver a meterlo si pulsas **"Salir"** o si tu encargado te cambia el PIN.

### 1.4 ¿Olvidaste tu PIN?

Pídeselo a tu encargado/a. Solo él puede verlo o cambiártelo.

---

## 2. Pantalla de inicio (menú principal)

Es lo primero que ves al entrar. Verás:

📸 *TODO: añadir captura de la home del trabajador en `docs/capturas/trabajador-home.png`*

### 2.1 Saludo arriba

Tu nombre con un saludo según la hora ("Buenos días / Buenas tardes / Buenas noches").

### 2.2 Iconos arriba a la derecha

- **🔔 Campana**: notificaciones (si tienes pendientes, verás un punto rojo)
- **Botón "Salir"**: cierra tu sesión

### 2.3 Aviso de jornada abierta

Si tienes una **entrada sin salida** (fichaste entrada y aún no has fichado salida), verás un banner verde *"Tienes una jornada abierta"*.

### 2.4 Menú de opciones

Una lista de botones grandes con todo lo que puedes hacer:

| Botón | Para qué |
|---|---|
| 🟢 **Fichar ENTRADA / SALIDA** | Marcar tu entrada o salida del trabajo |
| 📅 **Mi horario** | Ver tus turnos de la semana |
| 🪑 **Turnos abiertos** | Ver turnos que tu encargado ha publicado y a los que puedes ofrecerte |
| 🔄 **Cambios de turno** | Solicitar cambios o ver el tablón de cesiones |
| ⏰ **Mis fichajes** | Ver el historial de tus fichajes |
| ⚖️ **Mi bolsa de horas** | Ver tu saldo de horas (si está activado) |
| 📄 **Mis documentos** | Nóminas, contratos, certificados |
| 🏖️ **Mis vacaciones** | Pedir días libres y consultar saldo |

---

## 3. Notificaciones (campana 🔔)

Pulsa la **campana** arriba a la derecha para ver tus notificaciones pendientes.

📸 *TODO: añadir captura del panel de notificaciones en `docs/capturas/trabajador-notificaciones.png*

Te llegan notificaciones cuando:

| Evento | Notificación |
|---|---|
| ✅ Tu encargado **aprueba** unas vacaciones | Te lo dice con la fecha aprobada |
| ❌ Tu encargado **rechaza** unas vacaciones | Te lo dice con el motivo |
| 📅 Se **publica** un nuevo horario semanal | Te avisa para que lo revises |
| 💰 Se **cierra** la bolsa de horas | Te avisa con el saldo final |
| 🔄 Tu encargado **aprueba o rechaza** un cambio de turno | Te dice el resultado |
| 🙏 Un compañero te **pide un cambio** | Para que tú decidas |

Las notificaciones leídas desaparecen del contador.

---

## 4. Fichar entrada y salida

### 4.1 Antes de fichar

Asegúrate de:
- ✅ Estar **dentro del local** o muy cerca (la app valida tu posición GPS)
- ✅ Tener el **GPS activado** en tu móvil
- ✅ Estar conectado a **internet** (datos o WiFi)

### 4.2 Cómo se ficha

1. En la home, pulsa el botón **🟢 Fichar ENTRADA** (o **🛑 Fichar SALIDA** si ya tenías una entrada abierta)
2. La app comprueba tu ubicación GPS
3. Si estás dentro de la zona del local, **se ficha automáticamente**
4. Si estás fuera, te dirá *"Estás fuera del local"* y **no se fichará**

📸 *TODO: añadir captura de la pantalla de fichaje en `docs/capturas/trabajador-fichaje.png*

### 4.3 Si trabajas en varios locales

Si tu encargado te ha asignado **varios locales**, antes de fichar te preguntará en cuál estás. Selecciona el correcto.

### 4.4 Turno partido

Si tu turno tiene **descanso a media jornada** (turno partido):
- Fichas **entrada** al empezar
- Fichas **salida** antes del descanso
- Vuelves del descanso → **entrada** otra vez
- Al terminar la tarde → **salida**

Total: 4 fichajes.

---

## 5. Mi horario

Pulsa **📅 Mi horario** desde la home.

📸 *TODO: añadir captura de Mi horario en `docs/capturas/trabajador-mi-horario.png*

### 5.1 ¿Qué ves?

- **Selector de semana** arriba (puedes ir a semanas anteriores o futuras con las flechas ← →)
- **Total de horas** que harás esta semana
- **Tus horas contratadas** semanales
- Para cada día de la semana:
  - Si es **HOY**, está marcado en granate
  - Si tienes turno, ves: hora entrada, hora salida, nombre del turno (Mañana, Tarde, etc.) y total de horas
  - Si **libras** (no tienes turno), aparece *"Libre"*

### 5.2 Estado del horario

Arriba del todo verás un mensaje según el estado:
- *"Aún no se ha generado el horario de esta semana"* → tu encargado aún no lo ha hecho
- *"📝 El horario de esta semana está en borrador. Tu encargado lo está preparando"* → ya lo está montando, espera
- Sin mensaje = horario publicado, ya es definitivo

### 5.3 Botón "🔄 Solicitar cambio"

Si el horario está **publicado** y tienes un turno que no puedes hacer, puedes solicitar cambiarlo. Pulsa **"🔄 Solicitar cambio"** debajo del turno (ver siguiente sección).

---

## 6. Solicitar cambio de turno

Si necesitas que **alguien cubra tu turno** o **cambiarlo por otro**, tienes 3 opciones:

📸 *TODO: añadir captura del modal de solicitar cambio en `docs/capturas/trabajador-solicitar-cambio.png*

### 6.1 Tres tipos de cambio

| Tipo | Cómo funciona | Cuándo usarlo |
|---|---|---|
| 🚪 **Cesión** | Sueltas tu turno y cualquier compañero puede cogerlo | Te ha surgido algo y te da igual quién te cubra |
| 🙏 **Petición directa** | Pides a un compañero **concreto** que coja tu turno | Sabes que un compañero está disponible y necesitas pedírselo a él |
| 🔄 **Intercambio** | Propones cambiar TU turno por OTRO turno específico de un compañero | Quieres trabajar OTRO día en lugar de este |

### 6.2 Cómo solicitar (paso a paso)

1. Ve a **Mi horario**
2. Encuentra el turno que quieres cambiar
3. Pulsa **"🔄 Solicitar cambio"**
4. Elige el **tipo de cambio**:
   - **Cesión**: simple, no necesitas elegir nadie
   - **Petición directa**: elige un compañero
   - **Intercambio**: elige compañero y luego qué turno suyo te interesa
5. Escribe un **mensaje** (opcional, pero recomendado: explica por qué)
6. Pulsa **Enviar solicitud**

### 6.3 Después de enviar

- En tu horario, el turno mostrará un badge:
  - 🌐 **Abierta** (si es cesión: esperando que alguien la coja)
  - ⏳ **Pendiente del gestor** (si es intercambio o petición directa)
- También aparecerá en **Cambios de turno → Mis solicitudes**

### 6.4 Cancelar tu solicitud

Si cambias de opinión:
- En **Mi horario**, pulsa **"Cancelar solicitud"** debajo del turno
- O ve a **Cambios de turno → Mis solicitudes** y cancela desde ahí

> ⚠️ Solo puedes cancelar si la solicitud aún no ha sido aprobada por el gestor.

---

## 7. Tablón de cambios

Pulsa **🔄 Cambios de turno** desde la home.

📸 *TODO: añadir captura del tablón en `docs/capturas/trabajador-tablon-cambios.png*

Verás 2 pestañas:

### 7.1 Pestaña 🌐 Tablón

Aquí ves:

**🔔 Te lo piden a ti**: solicitudes que un compañero ha hecho **directamente para ti** (intercambios, peticiones directas).

Para cada una:
- Ves quién es, qué turno te pide
- Botones **❌ Rechazar** / **✅ Aceptar**

**🌐 Cesiones disponibles**: turnos que compañeros han **liberado** y cualquiera puede coger.

Para cada una:
- Ves quién es, qué turno cede, su mensaje
- Puedes escribir un mensaje opcional ("yo lo cojo")
- Pulsa **✋ Coger este turno**

> 💡 Cuando coges un turno, queda **pendiente de aprobación del gestor**. Hasta entonces, sigues con tu horario actual.

### 7.2 Pestaña 📜 Mis solicitudes

Tu historial de cambios:

- **Activos**: solicitudes pendientes (puedes cancelarlas)
- **Historial**: solicitudes aprobadas, rechazadas, canceladas
- **Todos**: todo junto

Cada solicitud muestra:
- Tipo de cambio
- Estado (🌐 Abierta / ⏳ Pendiente / ✅ Aprobada / ❌ Rechazada / ⊘ Cancelada)
- Turno afectado
- Notas tuyas y del gestor (si las hay)
- Fecha y hora

---

## 8. Mis fichajes

Pulsa **⏰ Mis fichajes** desde la home.

📸 *TODO: añadir captura de Mis fichajes en `docs/capturas/trabajador-mis-fichajes.png*

Verás el **historial completo** de tus fichajes:

- Agrupados por **día**
- Cada día muestra el **total de horas trabajadas**
- Para cada fichaje individual: hora exacta, tipo (entrada/salida), local

> 💡 Si has olvidado fichar alguna vez, **pídeselo a tu encargado** para que lo añada manualmente. Tú no puedes editar fichajes pasados.

---

## 9. Mi bolsa de horas

> ⚠️ Esta opción **solo aparece** si tu encargado la ha activado para los trabajadores.

Pulsa **⚖️ Mi bolsa de horas** desde la home.

📸 *TODO: añadir captura de Mi bolsa de horas en `docs/capturas/trabajador-bolsa-horas.png*

### 9.1 ¿Qué es la bolsa de horas?

Es la **diferencia** entre:
- Las horas que **TIENES QUE HACER** según tu contrato
- Las horas que **HAS HECHO** realmente

### 9.2 Cómo se calcula

- Si tu contrato dice 40h/semana y haces 42h una semana → **+2h** en tu bolsa (a tu favor)
- Si tu contrato dice 40h/semana y haces 38h una semana → **-2h** en tu bolsa (a favor de la empresa)

### 9.3 ¿Qué pasa con esas horas?

Depende de tu acuerdo con la empresa:
- Te las pueden **pagar** como horas extra
- Te las pueden **compensar** dándote días libres
- Pueden **acumularse** en el saldo y ajustar más adelante

Cuando se cierra un periodo (normalmente cada mes), te llega una notificación con el saldo final.

---

## 10. Mis documentos

Pulsa **📄 Mis documentos** desde la home.

📸 *TODO: añadir captura de Mis documentos en `docs/capturas/trabajador-mis-documentos.png*

### 10.1 ¿Qué hay aquí?

- **Nóminas** (subidas por tu encargado)
- **Contrato**
- **Bajas médicas** (las que tú has subido o tu encargado)
- **Certificados médicos**
- **Diplomas de formaciones**
- **Otros**

### 10.2 Descargar un documento

Pulsa cualquier documento → se descarga o se abre en tu móvil.

### 10.3 Subir un documento

Si te dan un parte de baja médica o un certificado, **súbelo tú mismo** así:

1. Pulsa **"+ Subir documento"**
2. Elige el **tipo** (baja médica, certificado, etc.)
3. Selecciona el archivo (PDF, JPG, PNG, WEBP, máximo 5MB)
4. Pulsa **Subir**

Tu encargado lo verá inmediatamente en tu ficha.

### 10.4 Borrar tus documentos

Solo puedes borrar **los documentos que has subido tú**. Los que ha subido tu encargado (como nóminas) no.

---

## 11. Mis vacaciones

Pulsa **🏖️ Mis vacaciones** desde la home.

📸 *TODO: añadir captura de Mis vacaciones en `docs/capturas/trabajador-mis-vacaciones.png*

### 11.1 Tu saldo

Arriba del todo ves:
- **Días disponibles**: cuántos días te quedan este año
- **Días aprobados**: ya gastados con vacaciones aprobadas
- **Días pendientes**: solicitados pero no aprobados aún

### 11.2 Solicitar vacaciones

1. Pulsa **"+ Solicitar"**
2. Elige el **tipo**:
   - **Vacaciones** (cuentan en tu saldo)
   - **Asuntos propios** (cuentan en saldo aparte)
   - **Baja médica** (no cuenta en saldo)
   - **Permiso por matrimonio** (15 días)
   - **Permiso por fallecimiento** familiar
   - **Mudanza**
   - **Otro permiso**
3. Selecciona **fecha de inicio** y **fecha de fin**
4. La app calcula los **días laborables** automáticamente
5. Escribe **notas** opcionales
6. Pulsa **Enviar solicitud**

### 11.3 Aviso de antelación corta

Si pides vacaciones con **menos de 30 días de antelación**, te aparecerá un aviso. Aún así puedes pedirlas, pero tu encargado puede tardar más en aprobarlas o rechazarlas.

### 11.4 Estados de tus solicitudes

| Estado | Qué significa |
|---|---|
| 🟡 **Solicitada** | Pendiente de respuesta de tu encargado |
| ✅ **Aprobada** | Tu encargado las aprobó. Te llega notificación. |
| ❌ **Rechazada** | Tu encargado las rechazó. Verás el motivo. |
| ⊘ **Cancelada** | Las cancelaste tú mismo |

### 11.5 Cancelar una solicitud

Si pediste algo por error o cambiaste de planes, puedes **cancelar** una solicitud que aún esté en estado "Solicitada". Pulsa **Cancelar** en la solicitud.

> ⚠️ Si ya está aprobada, ya no puedes cancelarla por tu cuenta. Pídeselo a tu encargado.

---

## 12. Turnos abiertos

Pulsa **🪑 Turnos abiertos** desde la home.

📸 *TODO: añadir captura de Turnos abiertos en `docs/capturas/trabajador-turnos-abiertos.png*

### 12.1 ¿Qué son los turnos abiertos?

Son turnos que tu encargado **ha publicado sin asignar a nadie** porque necesita cubrirlos. Por ejemplo: hay una baja inesperada, o un día de mucho trabajo y necesita refuerzo.

### 12.2 Cómo me ofrezco

1. Ve a **Turnos abiertos**
2. Verás los turnos disponibles con: día, hora, local, puesto
3. Si te interesa uno, pulsa **"Me ofrezco"**
4. Escribe un mensaje opcional
5. Pulsa **Enviar**

Tu encargado verá tu candidatura. Si te elige, te llegará una notificación y el turno aparecerá en tu horario.

### 12.3 Diferencia entre Turnos abiertos y Cambios de turno

Mucha gente los confunde:

| Turnos abiertos | Cambios de turno |
|---|---|
| Los **publica el encargado** | Los **inicias tú** |
| Son turnos **vacíos** que hay que cubrir | Es un turno **tuyo** que quieres librar |
| Te postulas como voluntario | Pides a alguien que te lo cubra |

---

## 13. Preguntas frecuentes

### ¿La app me cuesta dinero?

No. Folvy la pone tu empresa. No tienes que pagar nada por usarla.

### ¿Puedo usarla en cualquier móvil?

Sí. Funciona en cualquier móvil moderno con conexión a internet (Android o iPhone).

### ¿Tengo que tener el GPS encendido todo el rato?

No. Solo cuando vayas a fichar. Después puedes apagarlo.

### Si me quedo sin batería, ¿puedo fichar en otro lado?

Pídeselo a tu encargado/a. Él puede añadir tu fichaje manualmente desde su ordenador.

### ¿Mi encargado/a ve mi ubicación cuando ficho?

Solo se guarda **el local donde fichaste** y un punto GPS aproximado. No se rastrea tu ubicación cuando NO estás fichando.

### ¿Puedo cambiar mi PIN?

No por tu cuenta. Pídeselo a tu encargado/a.

### ¿Puedo entrar a mi cuenta desde el móvil de un compañero?

Sí, pero **NO debes hacerlo**. Tu cuenta es personal. Si entras en otro móvil, asegúrate de pulsar **"Salir"** al terminar.

### ¿Qué pasa si pierdo mi móvil?

Avisa a tu encargado/a. Él puede cambiarte el PIN para que nadie pueda entrar a tu cuenta.

### ¿Puedo descargar mi nómina como PDF?

Sí. En **Mis documentos**, pulsa la nómina y se descargará automáticamente.

### Cuando solicito vacaciones, ¿es definitivo?

No. Tu encargado/a tiene que **aprobarlas**. Hasta entonces aparece como "Solicitada". Te llegará una notificación con la respuesta.

### ¿Puedo ver el horario de mis compañeros?

No directamente. Solo ves tu propio horario. Pero cuando vas a hacer un **intercambio**, puedes ver los turnos del compañero específico con quien quieres cambiar.

---

## 14. Errores comunes

### "Estás fuera del local" cuando intento fichar

- Verifica que tienes el **GPS activado**
- Si estás dentro del local pero te lo dice, espera unos segundos y reintenta (el GPS a veces tarda en ajustar)
- Si sigue fallando, pídele a tu encargado que añada el fichaje manualmente

### "No puedo seleccionar mi nombre en el login"

Tu encargado/a no te ha **dado de alta** todavía o estás dado de baja. Pídeselo.

### "Mi PIN no funciona"

- Verifica que escribes los 4 dígitos correctos (no son 4 ceros por defecto)
- Si te has equivocado de empleado en el selector, vuelve atrás
- Si sigue sin funcionar, pídele a tu encargado/a que te lo cambie

### "No me llegan las notificaciones"

Las notificaciones aparecen en la **campana 🔔** dentro de la app. **No son push** (no te suenan en el móvil cuando la app está cerrada). Tienes que abrir la app para verlas.

### "He fichado salida pero sigo en la app como 'jornada abierta'"

Probablemente fallo de conexión cuando hiciste la salida. Vuelve a fichar salida con conexión a internet, o pídele a tu encargado/a que lo arregle manualmente.

### "Solicité vacaciones y no me han contestado"

Si tu encargado/a tarda mucho:
- Revisa que la solicitud está en estado "Solicitada" (no "Cancelada" por error)
- Habla con él/ella en persona, no todos están pendientes 24/7

### "Pedí un cambio de turno y desapareció"

Probablemente tu encargado lo **rechazó**. Ve a **Cambios de turno → Mis solicitudes → Historial** para verlo y leer el motivo.

---

**Última actualización:** 2026-05-10
**Versión de la app:** v4
