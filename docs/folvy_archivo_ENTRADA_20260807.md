## 07 ago 2026 — TEAM: de cimiento a módulo completo, en producción

Sesión larga y densa. **Todo mergeado a `main` (b7957e4) y desplegado.** Detalle en `folvy_team_estado.md`.

**Fases cerradas**: F0 (seguridad/multi-tenencia) · F1 (+F1.5 pausas y nocturnidad) · F2 (balance de horas:
los cierres mensuales dejan de dar cero) · F3 (calendario de festivos, Madrid capital) · F4 (4 pantallas de
gestión, Code) · F5 (PDF de registro de jornada RD 8/2019 + export a gestoría con incidencias) ·
F7 comparador de cobertura · F8 visibilidad del trabajador · F10 generador con disponibilidad inferida.

**Lo que más valor tiene**: (1) el comparador de cobertura reveló que en Alcalá faltan 54 h-persona y sobran
22 la misma semana — no falta plantilla, está mal colocada; (2) `employee_availability` pasó de 0 a 75 filas
infiriendo del historial, sin pedirle nada a nadie — los líderes del mercado admiten que sus formularios
envejecen y nadie los rellena; (3) el export a gestoría avisa de lo que impide cerrar el mes con confianza.

**Deuda de rendimiento cerrada de raíz**: 5 funciones repetían la misma agregación de ventas (520 ms por
llamada; ~25 llamadas al montar Calendario → 500 intermitentes; empeorando con cada venta). `sales_hourly_agg`
+ trigger incremental → 520 ms → 122 ms (4,3×), verificado idéntico fila a fila.

**8 bugs de producción cazados**, ninguno del trabajo de hoy: `NULL = ANY()` que hacía invisible la fila
global de `app_settings`; el admin real no podía guardar su configuración aunque el PATCH devolviera 204;
la bolsa de horas ignoraba el flag global; una entrada huérfana que inventaba 11,4 h; la bomba de
rendimiento; `setUnavailable` sin `account_id`; propuestas de empleados de otro local; y una celda de PDF
que se pisaba con la fila siguiente.

**Errores propios pagados** (registrados como reglas): asumir nombres de columna, dar "Alcalá" por municipio
cuando es una calle de Madrid capital, desmentir un hallazgo real con una fórmula sin validar, y dejar caer
F10 de la lista de pendientes tras empezarlo. → dos reglas nuevas en `folvy_estado.md`.

**Queda para mañana**: prueba de humo en producción · F9 botón de pausa en kiosko (sin él el PDF legal sale
con la columna descanso vacía) · F6 pantalla de cumplimiento · F8 portal · F7.2/7.3/7.5/7.6 · F11.
