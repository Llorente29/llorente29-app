# 📌 ESTADO ACTUAL — RETOMAR MAÑANA

> **Fecha de cierre:** 2026-05-11 noche
> **Sesión:** continuación 2 de la maratoniana v4

---

## ✅ Lo que está HECHO y FUNCIONANDO

### FASE 1 del sistema Auth — COMPLETA

- ✅ 3 tablas creadas en Supabase: `user_profiles`, `manager_locations`, `security_audit_log`
- ✅ Supabase Auth configurado con Magic Link
- ✅ 2 cuentas admin creadas:
  - `jgcolon@idasal.com` (UID `e298629b-9d34-4d62-9a00-ff7c3fa29a1a`)
  - `llorente29food@gmail.com` (UID `a1d49759-a308-4b0b-a083-3f3c489f7fa9`)
- ✅ SMTP propio configurado con Resend + dominio folvy.app
  - DNS records verificados en OVH (DKIM, MX, SPF)
  - Emails llegan desde `noreply@folvy.app`
  - Region: Ireland (eu-west-1)
  - API key generada y guardada en Supabase
  - Rate limit interno configurado a 60 seg entre emails al mismo user
- ✅ Archivos modificados/creados en GitHub `source`:
  - `src/services/authService.ts` (NUEVO) — con `emailRedirectTo` desde `window.location`
  - `src/pages/LoginPage.tsx` (NUEVO)
  - `src/lib/supabase.ts` (MODIFICADO) — con `flowType: 'implicit'` + `detectSessionInUrl`
  - `src/App.tsx` (MODIFICADO) — wrapper AuthenticatedApp + routing por rol
- ✅ URLs Supabase:
  - Site URL: `https://llorente29.github.io/llorente29-app/`
  - Redirect URLs: 3 configuradas

### Tests pasados end-to-end
- ✅ Login con Magic Link → entra a la app gestor
- ✅ Logout → vuelve a LoginPage
- ✅ Cerrar pestaña y reabrir → sigue logueado (persistencia OK)

---

## 🚧 Lo que está PENDIENTE

### Pendiente CRÍTICO antes de meter trabajadores reales

#### 🚨 FASE 2: Personal protegido (RLS)
- Activar RLS en `employees`, `documents`, `vacations`, `employee_formations`, `clock_entries`
- Crear políticas para admin/manager/worker
- UI: ocultar salarios para manager, filtrar listado de empleados por sus locales asignados
- Botón "Crear empleado" / "Dar de baja" / "Eliminar" solo visible para admin
- 3-4 horas de trabajo concentrado

#### 🚨 FASE 3: Resto módulos protegidos
- RLS en `schedules`, `shift_templates`, `hours_balance_*`, `shift_swap_requests`, etc.
- Filtrado por local del manager en cada pantalla
- 5-7 horas

#### 🚨 FASE 4: UI de gestión de roles
- Página "Configuración → Usuarios y roles" solo para admin
- Crear/editar/desactivar usuarios desde la app
- Asignar locales a managers
- 2-3 horas

### Pendiente menor

#### 🐛 Bug Disponibilidad (legacy)
- UI desincronizada con scheduler tabla `employee_availability`
- No bloqueante, diferir

#### 🧹 Limpiar datos de prueba
- SQL preparado, no ejecutado
- Hacer cuando FASE 2 esté lista (antes de meter trabajadores reales)

#### 📚 Manuales de resto módulos
- Existe Personal (gestor) y Trabajador completo
- Faltan: Fichaje, Horarios, Vacaciones, Cambios, Bolsa, Turnos abiertos, Insights, Gestoría, Zonas pedido, Locales

#### 📸 Capturas reales para los manuales
- Todas marcadas como TODO en los .md

---

## ⚠️ Cosas importantes a recordar

### RLS - aviso vivo
Tras crear cualquier tabla nueva en Supabase, **ALWAYS** ejecutar:
```sql
ALTER TABLE x DISABLE ROW LEVEL SECURITY;
```
Supabase re-activa RLS por defecto aunque se incluya DISABLE en el CREATE TABLE script. Hubo bug hoy por esto.

### Configuración SMTP Resend en Supabase
- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: API key Resend (re_...)
- Sender: `noreply@folvy.app`
- Min interval: 60 seg

### Configuración cliente Supabase
Crítica para Magic Link:
```typescript
auth: {
  detectSessionInUrl: true,
  persistSession: true,
  autoRefreshToken: true,
  flowType: 'implicit',  // ← IMPORTANTÍSIMO para Magic Link en GH Pages
  storage: window.localStorage,
}
```

### URLs
- Site URL Supabase: `https://llorente29.github.io/llorente29-app/`
- Redirect URLs Supabase:
  - `https://llorente29.github.io/llorente29-app/`
  - `https://llorente29.github.io/llorente29-app/**`
  - `http://localhost:5173/**`

### sendMagicLink en authService.ts
Construye `emailRedirectTo` desde `window.location.origin + pathname` para evitar problemas con el Site URL del panel.

---

## 🎯 Cómo retomar mañana

Abrir sesión nueva con Claude y decirle:

> *"Continúo el desarrollo de Folvy. Lee `CONTEXTO_CLAUDE_v5.md` (raíz del repo) y `docs/PLAN_AUTH_ROLES.md`. Ayer cerramos con FASE 1 de auth completa y funcionando. Hoy queremos atacar FASE 2: Personal protegido con RLS. Antes de tocar nada, dime el plan paso a paso."*

Mostrarle también este archivo `ESTADO_AUTH_FASE1_COMPLETA.md` si lo subes al repo.

---

**Última actualización:** 2026-05-11
**Sesión:** Auth FASE 1 completa
**Próxima:** Auth FASE 2 (Personal protegido)
