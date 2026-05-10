# 👤 Personal — Manual del Gestor

> **¿Para quién es esto?** Para ti si gestionas el equipo de uno o varios locales.
>
> **¿Qué cubre?** Todo lo relacionado con tus empleados: alta, baja, datos, contratos, formaciones, horarios, vacaciones y reportes.

---

## 📋 Índice

1. [Introducción](#1-introducción)
2. [Cómo entrar al módulo](#2-cómo-entrar-al-módulo)
3. [Pestaña Insights](#3-pestaña-insights)
4. [Pestaña Empleados](#4-pestaña-empleados)
5. [Crear un empleado nuevo](#5-crear-un-empleado-nuevo)
6. [Ficha del empleado: 7 pestañas](#6-ficha-del-empleado-7-pestañas)
   - [Datos](#61-datos)
   - [Fichajes](#62-fichajes)
   - [Documentos](#63-documentos)
   - [Ausencias](#64-ausencias)
   - [Formaciones](#65-formaciones)
   - [Contrato](#66-contrato)
   - [Disponibilidad](#67-disponibilidad)
7. [Dar de baja un empleado](#7-dar-de-baja-un-empleado)
8. [Reactivar y eliminar](#8-reactivar-y-eliminar)
9. [Avisos y banners](#9-avisos-y-banners)
10. [Preguntas frecuentes](#10-preguntas-frecuentes)
11. [Errores comunes](#11-errores-comunes)

---

## 1. Introducción

El módulo **Personal** es el corazón de la gestión de tu equipo. Aquí controlas todo lo que tiene que ver con tus empleados:

- 👥 **Quién está contigo y quién no** (altas, bajas, contratos)
- 📅 **Cuándo trabaja cada uno** (horarios, disponibilidad)
- 🏖️ **Cuándo descansa** (vacaciones, bajas médicas)
- 🎓 **Qué cualificaciones tiene** (formaciones obligatorias por ley)
- 📄 **Su documentación** (nóminas, contratos, certificados)
- 📊 **Estadísticas y alertas** (cumpleaños, contratos por vencer, etc.)

Todo se guarda en la nube y se sincroniza al instante entre todos los dispositivos.

---

## 2. Cómo entrar al módulo

1. Abre Foodint en tu ordenador o tablet
2. Si te pregunta el modo, pulsa **"Modo Gestor"**
3. En el menú lateral izquierdo, pulsa **👤 Personal**

📸 *TODO: añadir captura del menú lateral con Personal seleccionado en `docs/capturas/personal-menu-lateral.png`*

Verás dos pestañas en la parte superior:
- **📊 Insights**
- **👥 Empleados**

Por defecto se abre **Insights** (la pantalla de resumen y estadísticas).

---

## 3. Pestaña Insights

Esta pestaña te da una **visión general** del estado de tu plantilla. Está pensada para que cada vez que entres a Personal veas de un vistazo lo más importante.

📸 *TODO: añadir captura de la pestaña Insights completa en `docs/capturas/personal-insights.png`*

### 3.1 KPIs (los 5 contadores grandes de arriba)

| Contador | Qué significa |
|---|---|
| 🟢 **Trabajando ahora** | Empleados que tienen una entrada de fichaje sin salida (es decir, están en el local) |
| 🤒 **Bajas activas** | Empleados con baja médica vigente hoy |
| 🏖️ **Vacaciones este mes** | Empleados de vacaciones aprobadas en algún día del mes actual |
| 🎓 **Formaciones por renovar** | Formaciones que van a caducar en menos de 30 días o ya caducadas |
| 📉 **Bajas últ. 12 meses** | Empleados que se fueron en el último año (rotación) |

### 3.2 Cumpleaños del mes

Lista de empleados que cumplen años este mes. Si hay alguno que cumple HOY, aparece resaltado en amarillo con la palabra "HOY".

> 💡 Si está vacío, asegúrate de haber rellenado las **fechas de nacimiento** en cada ficha de empleado (pestaña Datos).

### 3.3 Aniversarios laborales

Empleados que cumplen X años en la empresa este mes. Calculado a partir de la **fecha de alta**.

### 3.4 Eventos próximos (30 días)

Te avisa de **fines de contrato** y **fines de periodo de prueba** que vencen en los próximos 30 días.

Cada evento tiene un color según la urgencia:
- 🟡 **Amarillo**: faltan 16-30 días
- 🟠 **Naranja**: faltan 8-15 días
- 🔴 **Rojo**: faltan 0-7 días

Esto es **clave** porque si no avisas de la no renovación con la antelación legal, puede haber problemas con la gestoría.

### 3.5 Distribuciones (3 gráficos con barras)

- **📊 Por local**: cuántos empleados tienes en cada uno de tus locales
- **📋 Por contrato**: cuántos hay con cada tipo de contrato
- **💼 Por puesto**: cuántos hay con cada puesto

### 3.6 Listas detalladas

Si hay datos relevantes, aparecen listas adicionales:
- **🤒 Bajas médicas activas hoy**: quiénes están de baja, desde y hasta cuándo
- **🏖️ Vacaciones este mes**: quién está de vacaciones, fechas y cuántos días
- **📉 Bajas últimos 12 meses**: empleados que se fueron, tipo de baja y fecha

---

## 4. Pestaña Empleados

Aquí ves el **listado** de toda tu plantilla y puedes filtrar/buscar.

📸 *TODO: añadir captura del listado de empleados con filtros en `docs/capturas/personal-listado.png`*

### 4.1 Buscador

Arriba a la izquierda tienes un campo **"🔍 Buscar nombre, DNI, puesto..."**. Escribe lo que sea y filtra al instante.

### 4.2 Filtros

Hay 3 filtros desplegables:

| Filtro | Qué hace |
|---|---|
| **Local** | Solo empleados de un local concreto |
| **Estado** | Solo activos / solo bajas / todos |
| **Contrato** | Solo de un tipo de contrato |

> 💡 Por defecto se muestra **"Activos"** para que no te despisten los empleados ya dados de baja.

### 4.3 Tarjetas de empleado

Cada empleado aparece como una tarjeta con:

- **Avatar** (foto si tiene, o inicial sobre fondo granate)
- **Nombre completo**
- **Puesto · Local · Contrato**
- **Indicadores** según su estado:
  - 📅 **Baja**: empleado dado de baja
  - 🟢 **Trabajando**: tiene una jornada abierta ahora mismo
  - 🟡/🟠/🔴 **Caduca contrato/prueba**: alerta de vencimiento

Pulsa cualquier tarjeta para abrir la **ficha completa** del empleado.

---

## 5. Crear un empleado nuevo

1. En la pestaña Empleados, pulsa el botón **"+ Nuevo Empleado"** (arriba a la derecha)
2. Se crea un empleado vacío y se abre su ficha
3. Rellena al menos los **datos básicos** (nombre, DNI, local, contrato)
4. Pon un **PIN de 4 dígitos** si quieres que pueda fichar y entrar en su app
5. Pulsa **Guardar**

📸 *TODO: añadir captura del modal de empleado vacío en `docs/capturas/personal-nuevo-empleado.png`*

> ⚠️ **Importante**: si el empleado va a fichar en kiosko o usar su app personal, **debe tener PIN**. Sin PIN no puede acceder.

---

## 6. Ficha del empleado: 7 pestañas

Al pulsar en una tarjeta de empleado, se abre un **modal grande** con su ficha completa. Tiene **7 pestañas** en la parte de arriba:

📸 *TODO: añadir captura del modal con las 7 pestañas en `docs/capturas/personal-ficha-pestañas.png`*

| Pestaña | Para qué |
|---|---|
| 👤 **Datos** | Información personal y profesional |
| ⏰ **Fichajes** | Historial de entradas y salidas |
| 📄 **Docs** | Nóminas, contratos, certificados |
| 🏖️ **Ausencias** | Vacaciones y bajas médicas |
| 🎓 **Formaciones** | Formaciones obligatorias y certificados |
| 📋 **Contrato** | Tipo, salario, horas, fechas |
| 📅 **Disponibilidad** | Días/franjas en las que puede trabajar |

### 6.1 Datos

Información básica del empleado:

- **Foto**: pulsa el círculo para subir una foto. Se comprime automáticamente.
- **Nombre completo**
- **DNI / NIE**
- **Fecha de nacimiento**: importante para que aparezca en cumpleaños del mes
- **Teléfono y email**
- **Local principal** (donde trabaja habitualmente)
- **Locales asignados** (si puede fichar en varios locales)
- **Puesto y departamento**
- **PIN** de 4 dígitos para fichar

📸 *TODO: añadir captura de la pestaña Datos en `docs/capturas/personal-datos.png`*

### 6.2 Fichajes

Historial completo de **entradas y salidas** del empleado.

- Agrupados por día
- Cada fichaje muestra: hora, tipo (entrada/salida), local donde fichó, GPS si lo tiene
- Puedes **añadir un fichaje manual** con el botón de arriba (útil si se les ha olvidado fichar)

📸 *TODO: añadir captura de Fichajes en `docs/capturas/personal-fichajes.png`*

### 6.3 Documentos

Aquí guardas:
- **Nóminas** (tú las subes, el trabajador las descarga)
- **Contratos**
- **Bajas médicas** (sube el parte cuando lo entregue)
- **Certificados médicos**
- **Formaciones** (diplomas)
- **Otros**

**Para subir un documento:**
1. Pulsa **"+ Subir"**
2. Elige el tipo
3. Selecciona el archivo (PDF, JPG, PNG, WEBP, máx. 5MB)
4. Pulsa **Subir**

📸 *TODO: añadir captura de Documentos en `docs/capturas/personal-documentos.png`*

> 💡 El trabajador también puede subir documentos desde su app. Aparecen aquí marcados como subidos por él.

### 6.4 Ausencias

Vacaciones, asuntos propios, bajas médicas, permisos.

**Saldo del año** arriba del todo: ves cuántos días tiene disponibles.

**Botón "+ Solicitar"** para crear una ausencia desde aquí (sin necesidad de que la pida el trabajador).

**Lista** con cada ausencia: tipo, fechas, días, estado, notas.

Para cada ausencia **pendiente**, puedes:
- ✅ Aprobarla
- ❌ Rechazarla (con motivo)

📸 *TODO: añadir captura de Ausencias en `docs/capturas/personal-ausencias.png`*

> ⚠️ Si apruebas vacaciones que dejarían menos de 2 personas trabajando ese día, te aparecerá un aviso. Tú decides.

### 6.5 Formaciones

Aquí registras todas las **formaciones obligatorias y recomendadas** del empleado para cumplir con la normativa.

**Resumen "Cumplimiento legal X/5"** arriba del todo: te dice cuántas formaciones obligatorias tiene cubiertas.

**Catálogo de formaciones que puedes registrar:**

| Formación | Obligatoria | Caducidad recomendada |
|---|---|---|
| 🍴 Manipulador de alimentos | ✅ Sí | 4 años |
| ⛑️ Prevención Riesgos Laborales (PRL) | ✅ Sí | 3 años |
| 🧼 Plan APPCC / Higiene | ✅ Sí | 1 año |
| 🚨 Alérgenos | ✅ Sí | 1 año |
| ⚖️ Igualdad y acoso laboral | ✅ Sí | 2 años |
| 🚑 Primeros auxilios + DESA | Recomendada | 2 años |
| 🔥 Extinción de incendios | Recomendada | 1 año |
| 🥜 Manipulador especial alérgenos | Recomendada | 4 años |
| 📚 Otra formación personalizada | - | - |

**Para añadir una formación:**

1. Pulsa **"+ Añadir formación"**
2. Elige el tipo del catálogo
3. **Fecha de emisión** (cuándo la sacó)
4. **Fecha de caducidad** (se autocompleta según el tipo, puedes cambiarla)
5. **Entidad emisora** (opcional, ej: "Cámara de Comercio Madrid")
6. **URL del certificado** (opcional, enlace al PDF si lo tienes en Docs)
7. **Notas** (opcional)

**Estados de cada formación:**
- ⛔ **Caducada**
- 🔴 **Caduca urgente**: 0-7 días
- 🟠 **Caduca crítico**: 8-15 días
- 🟡 **Caduca pronto**: 16-30 días
- ✅ **Vigente**: más de 30 días
- ∞ **No caduca**

📸 *TODO: añadir captura de Formaciones en `docs/capturas/personal-formaciones.png`*

### 6.6 Contrato

Datos contractuales del empleado:

- **Tipo de contrato** (Indefinido, Temporal, Formación, Prácticas...)
- **Salario** mensual bruto
- **Horas semanales** contratadas
- **Fecha de alta** (cuándo entró en la empresa)
- **Fecha fin contrato** (si es temporal)
- **Periodo de prueba**: días de duración. Al rellenar la fecha de alta + estos días, se calcula automáticamente cuándo termina el periodo de prueba.

📸 *TODO: añadir captura de Contrato en `docs/capturas/personal-contrato.png`*

> ⚠️ Si el contrato o el periodo de prueba está cerca de vencer, aparecerá un **banner amarillo/naranja/rojo** en la pantalla principal de Personal.

### 6.7 Disponibilidad

Aquí indicas qué días y franjas puede trabajar el empleado.

> ⚠️ **NOTA IMPORTANTE**: Esta pestaña tiene **un bug conocido** en la sincronización con el generador de horarios. Por ahora, configura la disponibilidad pero verifica que coincida con los horarios que se generan.

📸 *TODO: añadir captura de Disponibilidad en `docs/capturas/personal-disponibilidad.png`*

---

## 7. Dar de baja un empleado

Cuando un empleado se va de la empresa (despido, fin de contrato, baja voluntaria), tienes que **darlo de baja** correctamente.

### 7.1 Pasos

1. Abre la ficha del empleado
2. Pulsa el botón **"📅 Dar de baja"** (en el header del modal)
3. Se abre el modal de baja con:
   - **Tipo de baja**: voluntaria, no renovación, despido, jubilación, fin contrato, otro
   - **Fecha de baja**: por defecto hoy
   - **Motivo libre**: descripción opcional
4. Pulsa **"Dar de baja y notificar a gestoría"**

📸 *TODO: añadir captura del modal de baja en `docs/capturas/personal-baja-empleado.png`*

### 7.2 Email automático a gestoría

Tras pulsar el botón, se abre **Gmail en una pestaña nueva** con un email pre-rellenado a tu gestoría con todos los datos:
- Nombre del empleado
- DNI
- Fecha de baja
- Tipo de baja
- Motivo

Solo tienes que **revisar y enviar**.

> 💡 La dirección de email de la gestoría se configura en **Avisos > Gestoría**.

### 7.3 Qué pasa con el empleado

Cuando lo das de baja:
- Aparece como **inactivo** en el listado
- Sale de los filtros de "Activos" (por defecto no se ve)
- Su PIN deja de funcionar (ya no puede fichar ni entrar a su app)
- Sus fichajes, documentos y ausencias **NO se borran** (quedan para auditoría)
- Se cuenta en "📉 Bajas últimos 12 meses" en Insights

---

## 8. Reactivar y eliminar

### 8.1 Reactivar un empleado

Si un empleado vuelve a la empresa:

1. Cambia el filtro de Estado a **"Bajas"** o **"Todos"**
2. Abre su ficha
3. Pulsa **"♻️ Reactivar"**
4. Vuelve a estar activo, su PIN funciona de nuevo

### 8.2 Eliminar permanentemente

⚠️ **Acción IRREVERSIBLE.** Solo si te equivocaste creando un empleado de prueba.

1. Abre la ficha del empleado dado de baja
2. Pulsa **"🗑️ Eliminar permanente"**
3. Te pedirá **doble confirmación**
4. Si confirmas, se borran TODOS sus datos: fichajes, documentos, ausencias

> 🚫 **No uses esto** con empleados reales. La baja es suficiente y conserva el histórico.

---

## 9. Avisos y banners

### 9.1 Banner de eventos próximos

Si hay empleados con **contrato o periodo de prueba** que vence pronto, aparece un banner amarillo/naranja/rojo arriba del listado de empleados. Pulsa cualquiera para abrir directamente la ficha.

### 9.2 Notificaciones automáticas

Los siguientes eventos generan **notificación in-app** (campana 🔔):
- Empleado solicita vacaciones → te llega a ti
- Empleado solicita cambio de turno → te llega a ti
- Empleado tiene formación caducando pronto → te llega a ti

---

## 10. Preguntas frecuentes

### ¿Por qué no veo a un empleado?

Lo más probable es que esté **dado de baja** y el filtro de Estado esté en "Activos". Cambia el filtro a "Bajas" o "Todos".

### ¿Puedo cambiar el local de un empleado?

Sí. Abre su ficha, pestaña Datos, y cambia el **Local principal** o añade locales asignados.

### Un empleado tiene contrato a 40h pero esta semana hace 38h. ¿Hay problema?

No con respecto a este módulo, pero sí en la **Bolsa de Horas** se le creará saldo negativo. Lo gestionas desde ahí.

### ¿Cómo añado una formación que no está en el catálogo?

Elige el tipo **"📚 Otra formación"** y rellena el nombre y los datos manualmente.

### ¿Las formaciones avisan automáticamente cuando caducan?

Sí. Cuando una formación está a 30 días o menos de caducar, aparece en:
- Insights > "🎓 Formaciones por renovar"
- KPI numérico arriba

### ¿Puedo subir un Excel con todos mis empleados de golpe?

Aún no. Está en la lista de pendientes (importar CSV). Por ahora hay que crearlos uno a uno.

### Tengo un empleado en 2 locales, ¿cómo lo configuro?

En su ficha → Datos → **"Locales asignados"** marca todos los locales donde puede trabajar. Su PIN funcionará en cualquier kiosko de esos locales.

### El empleado dice que su PIN no le funciona

1. Verifica que su empleado **está activo** (no dado de baja)
2. Verifica que su **PIN está bien escrito** (4 dígitos)
3. Verifica que **el local del kiosko** está entre sus locales asignados
4. Si todo está bien, puede ser un problema de geofencing (estar fuera del local)

---

## 11. Errores comunes

### "No se ha podido guardar el empleado"

Suele ser un problema de conexión a internet. Verifica la conexión y reintenta.

### "Email no se abrió tras dar de baja"

Si tu navegador no tiene Gmail asociado, el email de gestoría puede no abrirse automáticamente. Prueba copiando manualmente los datos o usa Chrome con tu cuenta de Gmail iniciada.

### "Veo un empleado dos veces en el listado"

Puede que se haya creado por duplicado por error. Comprueba sus DNIs (deben ser únicos). Si hay duplicado, da de baja al que está vacío.

### "No se actualiza la información en otros dispositivos"

Foodint sincroniza en tiempo real. Si no ves los cambios, recarga la página (F5) en el dispositivo afectado.

---

**Última actualización:** 2026-05-10
**Versión del módulo Personal:** v4 (BATCH 1 + BATCH 2 + Cambios de turno)
