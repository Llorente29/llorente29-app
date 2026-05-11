# 🔐 PLAN: Sistema de Auth + Roles + Permisos

> **Estado:** Pendiente de implementación.
> **Última actualización del plan:** 2026-05-10
> **Autor:** Sesión maratoniana v4

---

## 🎯 Resumen ejecutivo

El sistema actual de Foodint **NO tiene control de acceso real**:
- Cualquiera con la URL accede al modo gestor
- El "modo trabajador" se elige libremente, no se valida
- Cualquier trabajador podría pulsar "Modo Gestor" y ver TODO

**Antes de meter trabajadores reales en la app**, hay que implementar un sistema de autenticación + roles que garantice que cada usuario solo ve y hace lo que le corresponde.

---

## 👥 Decisión de roles

**3 roles iniciales + sistema extensible para más en el futuro:**

| Rol | Quién | Acceso resumido |
|---|---|---|
| `admin` | Dueño / gerencia | Todo. Crea empleados, edita salarios, ve todo, gestiona roles |
| `manager` | Encargado de local | Operativa de SUS locales. NO ve salarios. NO da de alta empleados |
| `worker` | Trabajador | Solo SU información. Su horario, sus fichajes, sus docs, sus vacaciones |

**Roles futuros previstos** (cuando se necesite, no ahora):
- `jefe_cocina`: gestiona la sección cocina de un local
- `jefe_sala`: gestiona la sección sala de un local
- `contable`: solo accede a reportes financieros y gestoría
- `head_office`: gestor multi-local pero sin admin (varios locales sin ver salarios)

---

## 🔑 Decisión de autenticación

**Magic Link (Supabase Auth)**

- Trabajador introduce su email
- Le llega un enlace
- Pulsa el enlace y entra a la app con sesión activa
- Sesión dura 7 días

**Ventajas:**
- Sin contraseñas que recordar
- Más seguro que email+password (no se filtran)
- Cero gestión de "olvidé mi contraseña"

**Limitaciones:**
- El usuario necesita acceso al email en su móvil
- No funciona offline (la primera vez)

**Excepción:** el **kiosko de fichaje** sigue usando PIN (es un caso especial donde el dispositivo es compartido y necesita login rápido).

---

## 📋 Matriz de permisos por módulo

> **Leyenda:** ✅ Acceso total · ⚠️ Acceso parcial/condicionado · 👁️ Solo lectura · ❌ Sin acceso

| Módulo / Función | Admin | Manager | Worker |
|---|---|---|---|
| 📊 Dashboard / Insights | ✅ Todo | ⚠️ Solo sus locales | ❌ |
| **PERSONAL** | | | |
| Listado de empleados | ✅ Todos | ⚠️ Solo sus locales | ❌ |
| Crear empleado | ✅ | ❌ | ❌ |
| Editar datos básicos | ✅ | ⚠️ Sus locales | ❌ |
| Editar contrato y salario | ✅ | ❌ | ❌ |
| Ver salario propio | — | — | ✅ Solo el suyo |
| Ver salarios de otros | ✅ | ❌ | ❌ |
| Subir documentos a otros | ✅ | ⚠️ Sus locales | ❌ |
| Subir documentos propios | ✅ | ✅ | ✅ |
| Ver/descargar docs de otros | ✅ | ⚠️ Sus locales | ❌ |
| Ver/descargar docs propios | ✅ | ✅ | ✅ |
| Aprobar vacaciones | ✅ | ⚠️ Sus locales | ❌ |
| Pedir vacaciones propias | — | ✅ | ✅ |
| Aprobar formaciones | ✅ | ⚠️ Sus locales | ❌ |
| Dar de baja empleado | ✅ | ❌ | ❌ |
| Reactivar empleado | ✅ | ❌ | ❌ |
| Eliminar permanente | ✅ | ❌ | ❌ |
| **FICHAJE / HORARIOS** | | | |
| Ver fichajes de todos | ✅ | ⚠️ Sus locales | ❌ |
| Ver fichajes propios | ✅ | ✅ | ✅ |
| Generar horarios | ✅ | ⚠️ Sus locales | ❌ |
| Ver mi horario | ✅ | ✅ | ✅ |
| Editar plantilla turnos | ✅ | ⚠️ Sus locales | ❌ |
| **BOLSA DE HORAS** | | | |
| Ver bolsa de todos | ✅ | ⚠️ Sus locales | ❌ |
| Ver mi bolsa propia | ✅ | ✅ | ✅ |
| Cerrar periodos | ✅ | ⚠️ Sus locales | ❌ |
| Configurar bolsa | ✅ | ❌ | ❌ |
| **CAMBIOS DE TURNO** | | | |
| Solicitar cambio | — | — | ✅ |
| Aprobar cambio | ✅ | ⚠️ Sus locales | ❌ |
| Ver historial todos | ✅ | ⚠️ Sus locales | ❌ |
| **TURNOS ABIERTOS** | | | |
| Crear turno abierto | ✅ | ⚠️ Sus locales | ❌ |
| Postularse a turno | — | — | ✅ |
| Asignar candidato | ✅ | ⚠️ Sus locales | ❌ |
| **OTROS MÓDULOS** | | | |
| Insights por local | ✅ Todos | ⚠️ Sus locales | ❌ |
| Locales (gestión) | ✅ | ❌ | ❌ |
| Informes Gestoría | ✅ | ❌ | ❌ |
| Zonas de Pedido | ✅ | ⚠️ Sus locales | ❌ |
| Configuración global | ✅ | ❌ | ❌ |
| Gestión de roles | ✅ | ❌ | ❌ |
| Audit log (futuro) | ✅ | ⚠️ Sus locales | ❌ |

---

## 🏗️ Arquitectura técnica

### Tablas nuevas en Supabase

```sql
-- Perfil extendido del usuario (vincula auth.users con employees)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id UUID UNIQUE REFERENCES employees(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'worker',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CHECK (role IN ('admin', 'manager', 'worker'))
  -- En futuro añadir: 'jefe_cocina', 'jefe_sala', 'contable', 'head_office'
);

-- Locales asignados al manager
CREATE TABLE manager_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_profile_id, location_id)
);

-- Audit log de cambios de rol y permisos críticos
CREATE TABLE security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id),
  target_user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,        -- 'role_change', 'login', 'permission_denied', etc.
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Row Level Security (RLS) en Supabase

> ⚠️ **IMPORTANTE**: A diferencia del resto de tablas del proyecto (que tienen RLS desactivado), las tablas críticas DEBEN tener RLS activado para que la seguridad funcione.

**Tablas que NECESITAN RLS activado:**
- `employees` (admin ve todo, manager solo sus locales, worker solo a sí mismo)
- `documents` (idem)
- `vacations` (admin todo, manager su local, worker propio)
- `clock_entries` (idem)
- `hours_balance_periods`, `hours_balance_movements`
- `shift_swap_requests`
- `open_shifts`, `open_shift_requests`
- `schedules`, `shift_templates`
- `employee_formations`
- `employee_notifications`

**Ejemplo de políticas RLS para employees:**

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Admin ve todo
CREATE POLICY admin_all_employees ON employees
FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Manager ve empleados de sus locales asignados
CREATE POLICY manager_select_employees ON employees
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles up
    JOIN manager_locations ml ON ml.user_profile_id = up.id
    WHERE up.user_id = auth.uid() 
      AND up.role = 'manager'
      AND ml.location_id = employees.location_id
  )
);

-- Worker ve solo su propio empleado
CREATE POLICY worker_select_own_employee ON employees
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE user_id = auth.uid() AND employee_id = employees.id
  )
);
```

> 💡 Patrón similar se aplica a TODAS las tablas críticas.

---

## 🚪 Flujos de uso

### Setup inicial del admin

1. Tú (futuro admin) entras a Supabase Dashboard
2. **Authentication → Users → "Add user"**
3. Te invitas con tu email (recibes email)
4. Vas a la app → introduces tu email → Magic Link
5. Sistema detecta que NO hay ningún user_profile creado → te crea como `admin` automáticamente
6. A partir de aquí, todo se gestiona desde la app

### Día a día: crear trabajador

1. Tú (admin) → Personal → **"+ Nuevo empleado"**
2. Rellenas datos: nombre, DNI, **email**, contrato, etc.
3. Pulsas **"Crear y enviar invitación"**
4. Sistema:
   - Crea registro en `employees`
   - Crea `auth.users` con su email (Supabase Auth)
   - Crea `user_profiles` con `employee_id` + `role='worker'`
   - Envía email de invitación con Magic Link
5. Trabajador recibe email → pulsa enlace → entra a la app con su rol

### Día a día: crear manager

1. Tú (admin) → Configuración → Roles → **"+ Nuevo manager"**
   (o bien, desde el empleado: "Promover a manager")
2. Eliges el empleado (debe existir antes)
3. Asignas locales que gestionará
4. Sistema:
   - Cambia el `role` en su `user_profile` a `manager`
   - Crea entradas en `manager_locations` para cada local asignado
5. Le llega notificación de cambio de rol

### Día a día: trabajador entra a la app

1. Trabajador abre la app
2. Pantalla de login: introduce su email
3. Le llega Magic Link
4. Pulsa → entra a la app
5. Sistema detecta `role='worker'` → carga `TrabajadorApp.tsx`
6. Solo ve su información

### Día a día: manager entra a la app

1. Manager abre la app
2. Login con su email
3. Sistema detecta `role='manager'` → carga la app del gestor
4. Pero al consultar empleados, **RLS filtra automáticamente** solo los de sus locales
5. Salarios y otras pantallas sensibles **ocultas en UI** (segunda capa de seguridad)

---

## 📅 Plan de implementación por fases

### 🚧 FASE 1: Cimientos (3-4 sesiones)

**Objetivo:** que la app exija login y diferencie admin/worker básico.

- [ ] Crear tabla `user_profiles` en Supabase
- [ ] Crear tabla `manager_locations` en Supabase
- [ ] Crear tabla `security_audit_log` en Supabase
- [ ] Configurar Auth en Supabase (Magic Link, dominio del enlace, plantillas de email en español con branding Foodint)
- [ ] Servicio `authService.ts` con: login, logout, getCurrentUser, getCurrentProfile
- [ ] Componente `LoginPage` con email + Magic Link
- [ ] Modificar `App.tsx` para requerir auth antes de renderizar nada
- [ ] Diferenciación básica: admin/manager → app gestor / worker → TrabajadorApp
- [ ] Crear primer admin automáticamente si no hay ninguno
- [ ] Logout real (botón "Salir" cierra sesión Supabase + redirige)

### 🚧 FASE 2: Personal protegido (2-3 sesiones)

**Objetivo:** que el módulo Personal respete los permisos.

- [ ] RLS activado en `employees`, `documents`, `vacations`, `employee_formations`, `clock_entries`
- [ ] Políticas para admin/manager/worker en cada tabla
- [ ] UI: ocultar salario para manager
- [ ] UI: filtrar listado de empleados por locales asignados al manager
- [ ] UI: workers NO ven nunca el módulo Personal completo (solo sus subpantallas en TrabajadorApp)
- [ ] Botón "Crear empleado" solo visible para admin
- [ ] "Dar de baja" solo para admin
- [ ] "Eliminar permanente" solo para admin
- [ ] Crear empleado dispara invitación por email

### 🚧 FASE 3: Resto de módulos (3-5 sesiones)

**Objetivo:** proteger horarios, bolsa, cambios, reportes.

- [ ] RLS en `schedules`, `shift_templates`, `hours_balance_*`, `shift_swap_requests`, `open_shifts`, `open_shift_requests`, `employee_notifications`
- [ ] Filtrado UI: manager solo ve sus locales en cada vista
- [ ] Esconder pantallas administrativas del menú lateral según rol (Informes Gestoría, Configuración global, etc.)
- [ ] Bloqueo a nivel servicio: validar permiso antes de cada operación crítica
- [ ] Probar exhaustivamente: ¿puede un manager forzar URL y editar empleado de otro local?

### 🚧 FASE 4: Gestión de roles + UI (1-2 sesiones)

**Objetivo:** que el admin pueda gestionar roles desde la app.

- [ ] Página "Configuración → Usuarios y roles" solo para admin
- [ ] Listado de usuarios con su rol y locales asignados
- [ ] Cambiar rol de un usuario (admin → manager, etc.)
- [ ] Asignar/quitar locales a un manager
- [ ] Reenviar invitación a un usuario
- [ ] Desactivar usuario (sin borrar)
- [ ] Audit log básico de cambios de rol

### 🚧 FASE 5: Refinamiento (1-2 sesiones)

**Objetivo:** pulir UX y casos edge.

- [ ] Pantalla "¿Eres tú quien envía el enlace?" cuando llega el Magic Link
- [ ] Trabajador puede cambiar su propio email
- [ ] Notificación cuando hay cambio de rol
- [ ] Avisar al user antes de cerrar sesión si tiene cambios sin guardar
- [ ] Manejar caso "usuario sin user_profile" (raro pero posible)
- [ ] Plantilla de email de invitación bonita con branding Foodint

---

## ⚠️ Riesgos y consideraciones

### Riesgo 1: Romper la app durante migración
La introducción de auth puede romper temporalmente lo que ya funciona. **Solución:**
- Hacer la migración en una rama aparte
- Probar exhaustivamente antes de merge a `source`
- Tener un "modo dev" que salta auth (solo en localhost)

### Riesgo 2: Empleados sin email
Algunos trabajadores reales pueden NO tener email habitual. **Soluciones:**
- Crear cuenta tipo `usuario@foodint.es` para ellos
- O permitir login alternativo con teléfono SMS (más adelante)

### Riesgo 3: Manager malicioso
Un manager podría intentar editar URLs para acceder a otros locales. **Solución:**
- RLS en Supabase es la barrera FINAL (servidor)
- UI esconde, pero no es seguridad real
- Auditar accesos sospechosos en `security_audit_log`

### Riesgo 4: Coste Supabase Auth
- Supabase Auth gratuito hasta **50.000 usuarios mensuales activos**
- Tu caso (8-20 trabajadores) está MUY por debajo
- Magic Link envía emails desde Supabase (incluido en el plan)

### Riesgo 5: Empleados se quedan sin acceso al email
Si pierden acceso al email asociado, no pueden entrar. **Solución:**
- Admin puede cambiar el email de cualquier usuario
- O reenviar Magic Link a un email temporal

### Riesgo 6: Sesión perdida en kiosko
El kiosko es un dispositivo compartido. **NO usa Auth**, sigue con PIN. Configuración aparte.

---

## 🔄 Migración de datos actuales

Como vamos a hacer limpieza de datos antes de implementar esto, el escenario es:

1. **Limpiar todos los datos de pruebas** (sesión actual)
2. **Implementar FASE 1** (próximas sesiones)
3. **Crear empleados nuevos** con email desde la app, que automáticamente generan user_profile

Si por alguna razón se decide migrar empleados existentes en lugar de borrar:
1. Cada empleado existente debe tener `email` válido
2. Para cada uno, crear manualmente en `auth.users` y `user_profiles`
3. Enviar invitaciones por lotes

---

## 📚 Recursos / Referencias

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Magic Link Auth](https://supabase.com/docs/guides/auth/auth-magic-link)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Auth UI React](https://supabase.com/docs/guides/auth/auth-helpers/auth-ui)

---

## 🎯 Cómo empezar la próxima sesión

Si abres una sesión nueva con Claude para implementar esto:

> *"Lee `CONTEXTO_CLAUDE_v4.md` y `docs/PLAN_AUTH_ROLES.md`. Vamos a empezar la FASE 1 del sistema de auth. Antes de tocar nada, dime qué necesitas saber del estado actual de la app y empieza por el paso 1 de la FASE 1."*

El próximo Claude debería:
1. Leer ambos documentos
2. Pedirte que crees las tablas de Supabase con el SQL proporcionado
3. Generar los archivos uno a uno como hemos hecho hasta ahora

---

**Última actualización:** 2026-05-10
**Estado:** Plan documentado, sin implementar
**Siguiente paso recomendado:** FASE 1, paso 1 (crear tabla `user_profiles`)
