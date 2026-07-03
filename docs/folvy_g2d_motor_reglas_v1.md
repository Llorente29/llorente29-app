# G2d · Motor de Reglas — Diseño v1 (aprobado)

> "La campaña se enciende **sola**, con **límites**; el humano **ve** y puede **parar**."
> El terreno de Pleez con la verdad que Pleez no tiene (margen real + histórico propio).

## Principio
La regla **propone y ejecuta** cuando el histórico propio lo pide, dentro de límites duros.
Toda campaña que enciende una regla **nace** `origin='rule'`, aparece en el gestor como
cualquier otra y es **pausable/eliminable por humano** (kill switch).

## Decisiones aprobadas (Julio)
1. **Acción = crear-desde-plantilla** (la regla nace la campaña, `origin='rule'`).
   "Activar campaña pausada pre-construida" = segundo modo futuro, **no** v1.
2. **Cadencia**: `pg_cron */15` (lo pide el valle horario; los otros dos ni lo notan).
3. **Umbrales por defecto** (v1) — **editables por regla** en la UI (viven en `condition`):
   - `hourly_valley` `{weeks:4, dropPct:30, franjaHoras:2}`
   - `weak_brand` `{days:7, dropPct:25}`
   - `stalled_dish` `{days:7, stockMin:X, salesMax:Y}`
4. **Tope global**: **máx 3** campañas de regla activas simultáneas **por cuenta**
   (además de `max_active` por regla). El freno de mano.
5. **Visibilidad** (v1 mínimo, sin ir a buscarlo):
   - (a) banner/contador en la página de Campañas ("N campañas encendidas por reglas
     esta semana", leyendo `campaign_rule_firing` sin `acknowledged`).
   - (b) la fila de la regla en la sección Reglas: "disparó hace 2h → campaña X" (link).
   - (c) badge **"Automática (regla)"** en las campañas de regla de la lista.
   - El `acknowledge` se marca al ver/clicar el banner.
   - Push/campana al admin = **declarado** para cuando exista el canal de notificaciones
     admin (frente conocido, no v1).

## Modelo (sub-lote 1 · migración 2710)
- **`campaign_rule`**: `trigger_type` (`hourly_valley`/`weak_brand`/`stalled_dish`;
  extensible a `weather`/`event` en v2 **sin cambio de esquema**) · `condition` jsonb ·
  `action_template` jsonb (kind/value/scope/... de la campaña a nacer) · alcance opcional
  (`brand_id`/`location_id`/`menu_item_id`) · **límites**: `budget_max` **obligatorio**,
  `cooldown_minutes`, `max_active`, `duration_minutes` · `last_fired_at`.
- **`campaign_rule_firing`** (auditoría/visibilidad): `reason` jsonb (el "por qué":
  media/actual/caída), `coupon_id` (campaña encendida), `acknowledged_at`/`by`.
- RLS: miembros de la cuenta.

## Evaluador (sub-lote 2 · migración 2720)
`evaluate_campaign_rules()` (SECURITY DEFINER, `pg_cron */15`). Por cada regla activa:
1. **Límites** en orden: tope global (3/cuenta) → `max_active` por regla → cooldown.
2. **Disparador**:
   - **Valle horario** (v1): ventas de la franja `[now-franjaHoras, now)` vs media de esa
     misma franja+día de semana en las últimas N semanas; dispara si
     `current < mean*(1-dropPct/100)`.
3. **Encender**: nace una campaña `item_percent`/`bogo` desde `action_template`
   (`auto_apply=false`, se aplica por scope+ventana del motor de ofertas → no choca con el
   índice único de auto-por-kind), `origin='rule'`, `budget_max` de la regla, time-boxed
   (`ends_at = now + duration_minutes`); registra el disparo con `reason` y fija
   `last_fired_at`.

## Roadmap de sub-lotes
1. ✅ Modelo + auditoría (2710).
2. ✅ Evaluador + valle horario + cron (2720).
3. ⏳ Disparadores `weak_brand` + `stalled_dish` (ramas ya declaradas en el evaluador).
4. ⏳ UI de Reglas (crear/editar reglas con umbrales editables · badge "Automática" ·
   banner/contador de visibilidad · fila con "disparó hace 2h → X").

## Verificación
- `select public.evaluate_campaign_rules();` en el editor (postgres) tras crear una regla
  → devuelve nº de campañas encendidas; aparecen en el gestor con `origin='rule'`.
- Regresión: el motor de ofertas/cobro no se toca; las campañas de regla son ofertas
  normales con presupuesto.

## v2 (costura lista, no construida)
- `weather` (Open-Meteo) y `event` como nuevos `trigger_type` + ramas del evaluador.
- Segundo modo de acción: activar campaña pausada pre-construida.
- Notificación push/campana al admin.
