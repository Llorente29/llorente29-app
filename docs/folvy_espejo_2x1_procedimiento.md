# Folvy — Procedimiento oficial del 2x1-ESPEJO (ciclo de vida completo, cero cadáveres)
**v1 · 05/07/2026 · Origen:** preguntas de Julio ("¿está creado? ¿se crea entero? ¿cómo vuelve?") tras el nacimiento de los primeros `kind='bogo'` del agente. Táctica validada ×6 (Meraki).

## Principio rector
**El espejo es PERMANENTE como ficha, INTERMITENTE como oferta.** Se crea UNA vez por plato; después solo se enciende (86-on) y se apaga (86-off). El plato original JAMÁS se toca. Al terminar una campaña no queda nada visible: cero cadáveres por construcción.

## Qué es
Un artículo nuevo en la carta del canal ("2x1 {Plato}", precio calculado por `preview_bogo_mirror_price`) sobre el que se aplica la promo 2x1 de la plataforma. El cliente paga 1 espejo y recibe 2 unidades. El precio del espejo sale de la fórmula (paridad de margen en € con la venta normal, con el suelo de margen % como mínimo duro) — nunca a ojo.

## Ciclo de vida
```
[1 sola vez]  CREAR FICHA ──────────────┐
                                        v
[cada campaña]  ENCENDER (86-on) → PUBLICAR 2x1 → ... → CANCELAR 2x1 → APAGAR (86-off)
                                        ^                                    │
                                        └────────── (espejo dormido) ────────┘
```

## Paso 1 — CREAR la ficha (una vez por plato; hoy humano, futuro importable)
En **Last** (publica la carta de Glovo), en la marca correspondiente:
- **Nombre:** `2x1 {nombre exacto del plato}` (convención fija — el robot lo localizará por este patrón).
- **Precio:** el `precio_espejo` de la propuesta del agente (p.ej. Burrito Colosal → 22,10€).
- **Foto:** la misma del plato original. **Descripción:** la del original + encabezado "¡2 UNIDADES! …".
- **Categoría:** la del original. **Nace DESHABILITADO** (86-off) si Last lo permite al crear; si no, se apaga inmediatamente tras crear.
En **Folvy** (tras el próximo import o alta manual): el `menu_item` espejo se casa con `mirror_of_item_id` → original (columna existente, del Shop/Ómnibus) y su escandallo = **subreceta 2× el plato base** → coste, margen real y consumo teórico verdaderos sin duplicar recetas. El KDS/ticket cantan "2x1" por el propio nombre.

## Paso 2 — ENCENDER + PUBLICAR (por campaña; destino: robot T5)
Al aprobar una campaña `kind='bogo'`: (a) 86-on del espejo (Last API: `PUT /catalogs/{id}/products/{id} {enable:true}` — conocida del frente catálogo); (b) publicar la promo 2x1 de Glovo apuntando SOLO al espejo (asistente 2x1 — manos pendientes de capturas de Julio, robot v3.19). Guardarraíl de pantalla/robot: **no publicar si el espejo no existe/está casado** — error claro, no silencio.

## Paso 3 — CANCELAR + APAGAR (fin de campaña; destino: robot)
Finalizar → robot cancela el 2x1 en Glovo (rutina `end` existente adaptada) → **86-off del espejo**. La carta queda EXACTAMENTE como antes.

## Política de duración (decisión 05/07)
El caso ×6 era 2x1 **permanente** → las campañas `bogo` del agente nacen con vigencia **30 días** (no 7): always-on de facto mientras la marca esté lejos del objetivo; el agente las renueva/releva según señal. Las PROPUESTAS bogo no aprobadas caducan a 48h como todas (higiene).

## Reparto de manos (hoy → destino)
| Paso | Hoy | Destino |
|---|---|---|
| Crear ficha | Julio en Last (checklist arriba) | Semi-auto (plantilla desde Folvy) |
| Casar en Folvy + subreceta 2× | Chat/SQL guiado | Importador |
| 86 on/off | Manual o SQL | Robot/Edge (API Last conocida) |
| Publicar/cancelar 2x1 | — (bloqueado) | Robot v3.19 (T5, capturas pendientes) |

## Guardarraíles
- El precio del espejo SOLO sale de la RPC (jamás a ojo; si el coste del plato cambia, la próxima propuesta lo recalcula).
- `bogo` sin espejo creado+casado → no publicable (rechazo claro).
- El original nunca cambia de precio ni de estado por esta táctica (Ómnibus-correcto por construcción: el espejo tiene SU historial de precio propio).
- Cedidas: jamás (regla general de plataforma).
