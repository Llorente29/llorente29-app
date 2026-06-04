# Folvy Supply — C3.5: enrutado de aprobación por reglas
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Cerrar C3 igualando la capa de control de R365: que QUIÉN puede aprobar una factura
dependa de reglas (importe / proveedor / local). Ej: hasta 500€ aprueba un manager;
por encima, solo admin. Hoy aprueba cualquiera con acceso al módulo; esto añade el gating.

## RECON (confirmado)
- Roles reales: **admin, manager, worker** (user_profiles.role, ligado a account_id).
- Función reutilizable: `current_user_is_admin_or_manager_of(p_account_id uuid)`.
- `current_user_is_admin` / `current_user_is_admin_of`.
- manager_permissions = permisos finos por pantalla (no aplica aquí; el enrutado es por importe).
- supplier_invoice ya tiene grand_total, supplier_id, location_id, approved_*.

## Modelo (nuevo, mínimo)
`invoice_approval_rule` — reglas por cuenta, evaluadas por prioridad:
- account_id, id, created_*.
- `min_amount numeric` / `max_amount numeric` (rango de importe; null = sin límite por ese lado).
- `supplier_id uuid` null = cualquier proveedor.
- `location_id uuid` null = cualquier local.
- `required_role text` ('admin' | 'manager') — rol mínimo que puede aprobar si la regla aplica.
- `priority integer` (orden de evaluación; la primera que casa manda).
- `active boolean`.
Default de fábrica si no hay reglas: cualquier manager/admin puede aprobar (comportamiento actual,
no rompe nada). Las reglas solo RESTRINGEN cuando existen.

## Lógica de evaluación (al intentar aprobar)
1. Buscar la regla activa de mayor prioridad cuyo rango de importe + proveedor + local
   casen con la factura (grand_total, supplier_id, location_id).
2. Si ninguna regla casa → required_role = 'manager' (default: manager o admin aprueban).
3. required_role = 'admin' → solo admin aprueba; 'manager' → admin o manager.
4. El usuario actual: si su rol no alcanza → bloquear aprobación con mensaje claro
   ("Esta factura (1.250 €) requiere aprobación de un administrador").

## Dónde vive
- Función SQL `invoice_required_role(p_invoice_id)` → devuelve el rol requerido (text).
  Pura lectura, NO security definer necesario (lee tablas con RLS del usuario). Evalúa reglas.
- `approveInvoice` (servicio) comprueba ANTES de aprobar: pide el rol requerido + el rol del
  usuario; si no alcanza, lanza error legible (no aprueba, no aplica costes).
  Para el rol del usuario: leer user_profiles del usuario actual en esa cuenta.
- UI: en el detalle, si el usuario no puede aprobar, el botón Aprobar se deshabilita con
  el motivo ("Requiere administrador"). Reglas se gestionan en un panel de ajustes (engranaje
  en la pestaña Facturas, como supply_settings).

## Esquema
- `invoice_approval_rule` (nueva) + función `invoice_required_role`.

## Decisiones (con recomendación)
1. Solo dos niveles: manager / admin (worker no aprueba nunca facturas). (Recomendado — simple y real.)
2. Sin reglas = manager o admin aprueban (no rompe el comportamiento actual). (Recomendado.)
3. Regla casa por importe + proveedor + local con prioridad; la 1ª que casa manda. (Recomendado.)
4. El gating se comprueba en el servicio (UX) Y conviene en la función SQL como verdad
   (defensa en profundidad). En C3.5 lo hacemos en servicio + función de lectura; el enforcement
   duro en RLS/trigger se puede añadir luego si se requiere auditoría estricta. (Recomendado:
   servicio + función ahora; trigger duro = frente futuro si lo pide el cliente.)

## UI de reglas (mínima)
- Panel "Reglas de aprobación" (engranaje en Facturas): lista de reglas + alta simple
  (rango importe, proveedor opcional, local opcional, rol requerido). Sin reglas = aviso
  "cualquier manager aprueba".

## Frentes futuros
- Enforcement duro por trigger/RLS (no solo UX) si se requiere control de auditoría estricto.
- Notificación al aprobador requerido (campana) cuando una factura espera su aprobación.
- Multi-aprobador / cadena (importe muy alto requiere 2 firmas).
