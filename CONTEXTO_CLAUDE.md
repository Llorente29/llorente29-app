# ANDY APP — Contexto para Claude

> **Propósito:** este documento es el "salvavidas" del proyecto. Si una conversación con Claude se queda sin contexto, abre una nueva conversación, pega el contenido de este archivo y dile: *"Continúa el desarrollo de Andy App. Lee este contexto y dime el estado actual antes de proseguir."*
>
> **Cómo mantenerlo:** al final de cada sesión productiva, pídele a Claude: *"Actualiza el CONTEXTO_CLAUDE.md con lo que hemos hecho hoy."*

---

## 1. Identidad del proyecto

**Andy App** — software de gestión de hostelería para 3 locales en Madrid.

- **Locales:** Foodint Alcalá, Foodint Carabanchel, Foodint Pza Castilla
- **Empleados totales:** ~20 entre los 3 locales
- **Stack:** React + TypeScript + Vite + Tailwind CSS
- **Modo:** PWA en GitHub Pages (no app nativa por ahora)

---

## 2. Infraestructura

### Repositorio principal
- **GitHub:** `github.com/Llorente29/llorente29-app`
- **Rama `source`:** código fuente que editamos
- **Rama `main`:** build compilado que sirve GitHub Pages
- **URL pública:** `https://llorente29.github.io/llorente29-app/`

### Flujo de despliegue (CRÍTICO — leer bien)
1. Editamos archivos en la rama `source` desde la web de GitHub
2. Al hacer commit en `source`, se dispara el workflow `deploy.yml`
3. El workflow compila con `npm run build` y publica `/dist` en la rama `main`
4. GitHub Pages sirve `main` automáticamente
5. **Settings → Pages está configurado como "Deploy from a branch → main / (root)"**
6. **Settings → Actions → Workflow permissions: Read and write** (imprescindible)
7. El `deploy.yml` está en `.github/workflows/deploy.yml` **en la rama `source`** (no en main)
8. Tiempo de deploy: ~1 minuto

### Webhook Last.app (otro repo)
- **GitHub:** `github.com/Llorente29/lastapp-webhook`
- **Deploy:** Vercel → `lastapp-webhook.vercel.app`
- **Variables de entorno (Vercel):**
  - `LASTAPP_TOKEN` (rotar — ver sección de seguridad)
  - `GOOGLE_MAPS_KEY` = `AIzaSyBNDI7ONEHb0h9JyAyNboFIR0DoPYIADUY`
- **Endpoints:**
  - `POST /api/webhook?days=N` → descarga bills de Last.app paginando offset/limit=100
  - `POST /api/geodata` → geocodifica con Photon/Nominatim (fallback)
  - `POST /api/geocode` → geocodifica con Google Maps (rápido, requiere key)
  - `/api/debug` → debug temporal
- **Function timeout:** 120s

---

## 3. ⚠️ SEGURIDAD CRÍTICA — PENDIENTE

**LASTAPP_TOKEN expuesto** en el código del webhook con fallback hardcodeado:
- `api/webhook.js:1` y `api/debug.js:1`
- Token expuesto: `247ef137-6740-4c9c-bc1e-5e9a70fbad43`

**ACCIONES PENDIENTES:**
1. Rotar el token en Last.app
2. Actualizar la env var `LASTAPP_TOKEN` en Vercel con el nuevo
3. Eliminar el fallback hardcodeado de `api/webhook.js` y `api/debug.js`

---

## 4. Estado de los módulos

### Personal (en revisión — siguiente fase)
**Estado actual:** funcional pero limitado a vista de gestor.
**Tiene:**
- Lista empleados con búsqueda y filtro por local
- Ficha empleado con 7 pestañas: Datos, Fichajes, Docs, Ausencias, Contrato, Disponibilidad, Bolsa horas
- Control Horario con fichajes, GPS, KPIs
- Calendario de Horarios con detección T1/T2/T3, libra automática, validación convenio (40h máx, 1.5 días descanso)
- Informes Gestoría con descarga TXT mensual

**Falta (decidido en sesión 2026-05-07):**
- App móvil del trabajador (fichaje, mi horario, vacaciones)
- Geofencing en fichaje (200m del local)
- Notificaciones push
- Intercambio de turnos entre empleados
- Bolsa de horas automática
- Turnos abiertos para cobertura rápida

### Zonas de Pedido (FUNCIONAL — recién terminado)
**Tiene:**
- Subida CSV de Last.app (separador `,`, columnas: Ubicación, Dirección del cliente, Total, Fuente, Hora de creación, Marca virtual)
- Geocodificación direcciones con Google Maps API + cache localStorage
- 5 pestañas: Mapa, Barrios, Comparativa, Solape, Rentabilidad
- **Solape:** análisis distancia recorrido vs local dominante (factor urbano ×1.40)
- **Rentabilidad:** comparativa Coste Rider (genérico, antes "Jelp") vs Glovo 15% (reparto propio) y 30% (Glovo repartidor)
- Datos cargados: 1271 entregas geocodificadas

### Módulos en stub (PENDIENTES de migrar)
- Programadas
- Plantillas
- Auditorías
- Historial

### Módulos funcionales
- Dashboard, Tareas, Incidencias, Fichas Técnicas, Análisis de Ventas, Predicción Personal, Inventario, Locales

---

## 5. Decisiones técnicas/de negocio importantes

### IVAs (todo se trabaja sin IVA en cálculos)
- Importe pedido al cliente: **IVA 10%** (alimentación) → base = importe / 1.10
- Envío cobrado al cliente: **IVA 10%** → base = €4.50 / 1.10 = **€4.09 sin IVA**
- Coste Rider (Jelp/proveedor): ya viene **sin IVA** en factura
- Comisión Glovo: aplicada sobre **base imponible sin IVA**

### Tarifa Rider actual (proveedor Jelp, plan por volumen)
- 0–3 km ruta (≈2 km recta): **€5.75**
- 3–5 km ruta (≈3.5 km recta): **€5.95**
- +€0.50 por cada 500m a partir de 5 km

### Comisiones Glovo
- **15%** si reparto propio (tú pones el repartidor)
- **30%** si Glovo gestiona también el reparto

### Punto de rentabilidad reparto propio (ticket €20)
- Hasta **~12 km en ruta** (≈8.5 km línea recta) sigue siendo más barato que Glovo 15%
- Conclusión: con radios actuales de 3.5 km línea recta, **todos los pedidos son rentables**

### Coordenadas locales (fijas en código)
- Foodint Alcalá: `40.4346, -3.6528` (C/Florencio Llorente 29)
- Foodint Carabanchel: `40.3912, -3.7399` (C/Camichi 4)
- Foodint Pza Castilla: `40.4698, -3.6928` (C/Cañaveral 75)

### Códigos postales recomendados por local (analizado en sesión)
- **Alcalá:** 28002, 28022, 28026, 28027, 28028, 28030, 28032, 28037, 28047
- **Carabanchel:** 28025, 28038, 28040, 28044, 28047 (sur)
- **Pza Castilla:** 28016, 28029, 28033, 28034, 28036, 28046

---

## 6. Convenciones del código

### Estructura de carpetas
```
src/
  pages/             ← una página por ruta (ZonasPedidoPage.tsx, etc.)
  components/ui/     ← Button, Card, Input, Select…
  context/           ← AppContext.tsx (estado global)
  services/          ← lógica de negocio (deliveryZones.ts, etc.)
  types/             ← tipos compartidos (DeliveryRecord, etc.)
```

### Claves de localStorage
- `andy-delivery-v1` → registros de entregas
- `andy-delivery-zones-v1` → configuración de zonas/radios
- `andy-geo-cache` → caché de geocodificación direcciones
- `andy-geodata-csv-date` → fecha último CSV cargado

### Tipos clave
```ts
interface DeliveryRecord {
  id: string; locationId: string; locationName: string
  date: string; amount: number; source: string; barrio: string
  lat?: number; lng?: number; address?: string
  distanceKm?: number; closestLocationId?: string
}
interface DeliveryZoneConfig {
  locationId: string; radiusKm: number; lat: number; lng: number
}
```

### Reglas TypeScript estrictas (heredadas de tsconfig)
- `noUnusedLocals: true` → toda variable declarada se usa o se elimina
- `noUnusedParameters: true` → idem para parámetros
- `noImplicitAny: true` → tipar siempre
- **NO** funciona poner `_` delante para suprimir el error → eliminar la variable directamente

---

## 7. Plan de fases — Módulo Personal (FASE ACTUAL)

Decidido en sesión 2026-05-07 tras analizar mercado (Combo, Sesame, Shiftbase, Workant, Factorial).

### Fase 1 — Fichaje operativo móvil ⬅️ **EMPEZAMOS AQUÍ**
- [ ] Manifest PWA + iconos para "instalar como app"
- [ ] Service worker básico para offline
- [ ] Login/PIN del empleado
- [ ] Pantalla principal trabajador: botón grande "Fichar entrada/salida"
- [ ] Geofencing 200m del local asignado
- [ ] Foto opcional al fichar
- [ ] Recordatorio push si no ficha al inicio de turno
- [ ] Vista "Mi horario de la semana"

### Fase 2 — Autoservicio del trabajador
- [ ] Mis vacaciones (solicitar, pendientes, disponibles)
- [ ] Mis documentos (nóminas, contrato)
- [ ] Intercambio de turnos con compañeros + visto bueno encargado
- [ ] Notificaciones push para todos los eventos

### Fase 3 — Operativa del encargado mejorada
- [ ] Panel "ahora mismo" en tiempo real
- [ ] Bolsa de horas automática (saldo +/-)
- [ ] Turnos abiertos publicables al equipo
- [ ] Aprobaciones unificadas (vacaciones + cambios + incidencias)

---

## 8. Cómo trabajar con Claude (instrucciones para el próximo Claude)

1. **Lee este archivo completo antes de hacer nada.**
2. **Pregunta al usuario el estado** antes de empezar (ej: "¿En qué punto de la Fase 1 estamos?").
3. **No reinventes lo ya construido.** Si algo está en este documento como "funcional", se usa, no se rehace.
4. **Edición de archivos en GitHub:**
   - El usuario edita en la rama `source` desde la web de GitHub
   - Tu rol es generar el código completo del archivo y dárselo en `/mnt/user-data/outputs/`
   - El usuario hace: lápiz ✏️ → Ctrl+A → borra → pega contenido → commit a `source`
5. **Cuando un build falle:** suele ser por TypeScript estricto (variable no usada, import no usado). Eliminar, no marcar con `_`.
6. **Versionar los archivos** que generes con sufijo `_vN.tsx` para que sea fácil rastrear.
7. **Al terminar una sesión productiva:** ofrece actualizar este `CONTEXTO_CLAUDE.md` con los cambios.

---

## 9. Última versión del código clave (referencia)

- `src/pages/ZonasPedidoPage.tsx` — v17 desplegado (con Coste Rider en lugar de Jelp)
- `src/services/deliveryZones.ts` — funciones de geocoding, stats, simulación de radios

Si necesitas la última versión exacta de un archivo, pídela al usuario o consulta GitHub:
`https://github.com/Llorente29/llorente29-app/blob/source/src/pages/ZonasPedidoPage.tsx`

---

## 10. Bitácora de sesiones (resumen)

### 2026-05-07 — Construcción Zonas de Pedido + análisis Personal
- Configurado workflow GitHub Actions `deploy.yml` (con varias iteraciones de fix)
- Construido módulo completo Zonas de Pedido (5 pestañas)
- 17 versiones de `ZonasPedidoPage.tsx` con fixes de TypeScript
- Análisis de comparativa con software de mercado para módulo Personal
- Decisión: empezar Fase 1 (fichaje móvil) en próxima sesión
- Creación de este documento como sistema de recuperación

---

**Última actualización:** 2026-05-07
