# Folvy — ESTADO (leer esto primero)

> **Actualizado**: 07 ago 2026 (noche)

## 🔄 CÓMO OPERAR (esto no cambia entre sesiones)
- **APERTURA**: lee este doc (`folvy_estado.md`) → frente activo + estado. Si necesitas más: `folvy_frentes.md` (todo lo abierto) · `folvy_indice.md` (mapa de todos los docs) · **`folvy_mapa_sistema.md` (inventario técnico verificado contra BBDD)** · **el `*_estado.md` del área**. **Reglas no negociables: `folvy_reglas.md`.** Cómo golear: `folvy_competitive_map.md`.
- **CIERRE**: cuando Julio diga *"cerramos"*, sigue el ritual: actualizar este estado + el `*_estado.md` del área + `folvy_frentes.md` + `folvy_indice.md` + `folvy_mapa_sistema.md` si hubo hallazgos + entrada en el archivo mensual. NO tocar `folvy_guion_vivo.md` ni `CONTEXTO_CLAUDE.md` (archivados).
- **VERDAD TÉCNICA**: la BBDD por MCP + el repo, NUNCA un doc. RECON contra fuente primaria antes de diseñar. **Todo hallazgo de RECON que contradiga/amplíe un doc → se escribe en `folvy_mapa_sistema.md` en el momento.**
- **⚠️ REGLA (30/07): NO fiarse del "Success" del SQL editor.** Verificar cada objeto creado con query independiente. Una sentencia por Run en operaciones críticas. Guard `DO` en cada migración.
- **⚠️ REGLA (06/08) — NO DESTRUCCIÓN**: nada se elimina, oculta ni renombra sin inventario previo y **aprobación explícita de Julio**. Lo que parece suciedad suele ser una decisión tomada. Todo encargo lleva arriba **"decisiones vigentes que este encargo NO revisa"** con fecha y doc.
- **⚠️ REGLA (06/08) — ARRANQUE CON ÍNDICE**: antes de diseñar en un área, abrir `folvy_indice.md` y leer **todos** los docs de esa sección.
- **⚠️ REGLA NUEVA (07/08) — VALIDAR TODA FÓRMULA NUEVA**: ninguna función de cálculo se usa para decidir hasta validarla contra casos con resultado conocido a mano, incluidas las FRONTERAS. Esta sesión una fórmula sin validar estuvo a punto de despriorizar un hallazgo real (nocturnidad).
- **⚠️ REGLA NUEVA (07/08) — LOS PENDIENTES NO SE CAEN**: cada cierre lleva la lista COMPLETA de pendientes del área. Esta sesión F10 se empezó, se verificó viable y se dejó caer sin volver a listarlo.
- **ANTES DE ABRIR UN FRENTE**: `project_search` + `conversation_search` + RECON en BBDD.

---

## ✅ RECIÉN CERRADO (07/08) — TEAM: DE CIMIENTO A MÓDULO COMPLETO (en producción)

Sesión larga. **Todo mergeado a `main` (b7957e4) y desplegado.** Detalle en `folvy_team_estado.md`.

- **F0–F5 cerradas**: seguridad/multi-tenencia, saneado del dato (+pausas y nocturnidad), balance de horas
  (los cierres ya no dan cero), festivos de Madrid capital, las 4 pantallas de gestión, y **F5 legal**:
  PDF de registro de jornada (RD 8/2019) + export a gestoría con incidencias.
- **F7 comparador de cobertura**: requerido vs asignado hora a hora con coste real de nómina. Reveló que
  en Alcalá **faltan 54 h-persona y sobran 22 la misma semana**: no falta plantilla, está mal colocada.
- **F8 visibilidad del trabajador**: 4 flags + resolutor único `worker_portal_visibility`.
- **F10 generador**: `employee_availability` pasa de **0 a 75 filas** infiriendo del historial
  (nadie rellena nada), + `propose_schedule` con preferencias BLANDAS y motivo explicable.
- **Deuda de rendimiento CERRADA de raíz**: 5 funciones repetían la misma agregación de ventas
  (520 ms/llamada, ~25 llamadas al montar Calendario → 500 intermitentes, y empeorando con cada venta).
  `sales_hourly_agg` + trigger incremental → **520 ms → 122 ms (4,3×)**, verificado idéntico fila a fila.
- **8 bugs de producción cazados** que ya estaban ahí y nadie veía (ver `folvy_team_estado.md`).

---

## 🔨 PENDIENTE INMEDIATO (mañana se termina Team)

1. **🔴 PRUEBA DE HUMO EN PRODUCCIÓN** — el merge fue al final y no se probó en vivo.
   Cocina/kiosko (fichar entrada+salida) → Plantilla (Natacha +23,68 h) → Cierre de mes (incidencias).
2. **🔴 F9 botón de Pausa en kiosko** — el backend está, pero nadie puede fichar pausa: por eso el PDF
   legal sale con "descanso" VACÍO y el export marca "sin descansos registrados" a los 6.
3. **🔴 F6 pantalla de Cumplimiento** — motor listo; el benchmark la llama "la que justifica el precio".
4. **🟠 F8 portal del empleado (PWA)** · **F7.2/7.3/7.5/7.6 cuadrante** · **F11 armonización**.
5. **🟠 Tareas de Julio**: rellenar `account_gestoria_config` (3 filas vacías) · caso Mirlenys (−83,3 h) ·
   rellenar `contract_type` · decidir plantillas duplicadas · verificar convenio con la asesoría.

**La lista COMPLETA de pendientes de Team está en el prompt de arranque y en `folvy_team_estado.md`.**

---

## 🎯 FRENTE ACTIVO — FOLVY TEAM (remate final)
Doc de área: `folvy_team_estado.md`. Encargo: `ENCARGO_CODE_team_completo.md` (12 fases) + los encargos
por fase generados el 07/08 (F4, F5, F10, cobertura, visibilidad).

## ⚠️ COORDINACIÓN
Hay **más de un agente con acceso de escritura** al working tree. El 07/08 apareció un commit directo de
otra sesión mientras Code trabajaba (sin conflicto). Confirmar quién puede commitear autónomamente antes
de trabajar en paralelo.

## 🚧 BLOQUEOS EXTERNOS
- HubRise: plan/pago pendiente (tope 5 pedidos). Bridge que no reenvía estado a Uber.
- Ingesta de reseñas sin feed vivo.

## 🔧 DEUDA / PENDIENTES MENORES
- **🔴 Seguridad**: rotar `OFFERS_AGENT_SECRET` + `PUSH_AGENT_SECRET` + credenciales sandbox Catcher +
  secretos internos de triggers · bucket `delivery-proof` PÚBLICO · `HUBRISE_ACCESS_TOKEN` global ·
  `external_integration.access_token` en texto plano.
- Condición de carrera en `refresh()` de Calendario (sin guard de respuesta obsoleta).
- Calendario dispara ~25 llamadas concurrentes al montar (ya no rompe, pero es incorrecto).
- Optimización fina: `ppt`/`loc_days` de `team_labor_requirement` aún escanean ventas crudas (~47 ms).
- Flags de visibilidad son GLOBALES, no por cuenta → mover antes de cliente 2.
