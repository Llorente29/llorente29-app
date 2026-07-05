# ENCARGO_CODE — Pestaña "Objetivos" en Ofertas (brand_channel_target usable)
**Fecha:** 05/07/2026 · **Origen:** sesión Chat (etapa Crecimiento) · **Prioridad:** ALTA — la tabla gobierna al agente y hoy solo se edita por SQL = deuda inaceptable (regla deuda-0).

## Contexto
Hoy entró en producción la **etapa Crecimiento** (migración `20260705T1600_growth_targets.sql`, commit `8432eeb`): el agente de ofertas ya no decide contra el pico histórico sino contra **objetivos en pedidos/día por marca×canal×LOCAL** que pone el operador (tabla `brand_channel_target`, sembrada con los números de Julio: 48 filas). La señal es `agent_sales_signal_v2(p_account_id)` → `(brand_id, channel_name, location_id, location_name, target_daily, sales_7d, avg_28d, peak_daily)` (GRANT a authenticated ya puesto). **Falta la UI**: ver y editar objetivos sin SQL.

## Dónde
`PlatformOffersPage.tsx` (Kitchen → Ofertas) gana una **pestaña/sección "Objetivos"** junto a las campañas (mismo patrón de pestañas que ya use la página; si no tiene, un toggle de vista arriba). Es SU casa: el objetivo y la campaña que lo persigue, juntos.

## Qué se ve (una tabla por canal, Glovo primero; Uber visible con aviso "brazo pendiente de Uber")
Filas = marca propia × local. Columnas:
1. **Marca** · **Local** (nombre corto, sin prefijo "Foodint ").
2. **Objetivo** (pedidos/día) — **editable inline** (mismo patrón que la pestaña Niveles de Almacén: click → input → Enter/blur guarda). Vacío = sin objetivo (el agente NO empuja esa combinación).
3. **Ahora (7d)** = `sales_7d` de la señal v2.
4. **% del objetivo** con semáforo: <15% rojo (urgente — el agente propondrá artillería) · <umbral de recuperación ámbar · resto verde.
5. **Pico 12m** (informativo, gris — dejó de ser la vara el 05/07).

Fuente de datos: `agent_sales_signal_v2` para las combinaciones CON objetivo + completar la matriz con las combinaciones marca-propia×local×canal SIN objetivo (celda de objetivo vacía, editable → al teclear se crea).

## Cómo se guarda
- UPDATE/INSERT directo a `brand_channel_target` vía supabase client (RLS `belongs_to_account` ya lo permite a authenticated). Clave única `(account_id, brand_id, channel_id, location_id)` → **upsert** con `onConflict` sobre esa clave. `target_daily >= 0` (CHECK en BD); 0 o vacío = borrar la fila o dejarla a 0 (equivalen: la señal filtra `target_daily > 0`) — preferible **borrar** al vaciar, para no acumular ceros.
- `brand_channel_target` NO está en `database.ts` (regla vigente: NO regenerar; cast puntual `as never` como en `locationDispatchService`).
- `channel_id`: resolver por nombre desde `sales_channel` de la cuenta (Glovo/Uber).

## Reglas de la casa
- Marcas cedidas (`ownership_type='licensed'`) NO aparecen (jamás en plataforma).
- Nada de `window.confirm` (no aplica aquí, pero por si acaso: `ConfirmDialog`).
- `npm run build` verde antes de commit; commit descriptivo + push (rev-list 0 0).

## Verificación
1. La pestaña muestra las 8 marcas propias × 3 locales × Glovo/Uber con los objetivos sembrados (Meraki 10/15, Dirty 3/3, etc.).
2. Editar un objetivo inline → `select target_daily from brand_channel_target where ...` refleja el cambio.
3. Vaciar un objetivo → la fila desaparece de la tabla en BD.
4. Una combinación sin objetivo muestra celda vacía editable; al teclear un valor se crea la fila.
5. Los % y semáforos cuadran con `sales_7d/target_daily`.
