# Folvy — Ritual de cierre de sesión

**Cómo se cierra una sesión para que la siguiente empiece sin fricción.** Cuando Julio diga "cerramos" (o equivalente), Claude ejecuta este checklist completo, en orden, y entrega el prompt de arranque de la próxima sesión.

> **Quién lo dispara**: Julio decide cuándo cerrar (Claude no sugiere parar salvo riesgo técnico real). Al decirlo, Claude ejecuta este ritual entero.

---

## Checklist de cierre (Claude lo ejecuta en orden)

### 1. Estado técnico — ¿queda algo peligroso a medias?
- [ ] ¿Build verde y commiteado? Si hay algo sin commitear que rompa, avisar.
- [ ] ¿Push verificado (rev-list 0 0)?
- [ ] ¿Algún despliegue a medias (Edge Function, migración sin aplicar)?
- [ ] ¿`database.ts` regenerado si se tocó esquema?
- **Si algo está peligrosamente a medias, decirlo claro antes de cerrar.**

### 2. Seguridad — ¿quedó algo expuesto?
- [ ] ¿Se pegaron credenciales/tokens/keys en la sesión? → añadir a la lista de rotación pendiente y recordárselo a Julio.

### 3. Actualizar el GUION VIVO (`folvy_guion_vivo.md`)
- [ ] Mover lo cerrado hoy a "HECHO".
- [ ] Subir el siguiente frente a "AHORA".
- [ ] Si surgió un frente nuevo, colocarlo según su impacto comercial (🔴/🟠/🟡/🟢/⚪).
- [ ] Reordenar si algo cambió las prioridades.

### 4. Actualizar el ESTADO (`CONTEXTO_CLAUDE.md`)
- [ ] Reflejar lo construido hoy en §1 (estado vivo).
- [ ] Preservar head/tail byte a byte (terminadores CRLF/LF mixtos).
- [ ] Regenerar desde la fuente (BBDD+repo) si hubo cambios de esquema, no desde el relato.

### 5. Actualizar el MAPA COMPETITIVO (`folvy_competitive_map.md`) — solo si aplica
- [ ] Si el frente de hoy tocó un área, actualizar su veredicto (🟢/🟡/🔴).
- [ ] Si se verificó algo que estaba "verificar", confirmarlo.

### 6. Memorias — ¿alguna decisión nueva que preservar?
- [ ] Si Julio decidió algo estructural/estratégico, guardarlo en memoria.
- [ ] Si una memoria quedó obsoleta, actualizarla.

### 7. Generar el PROMPT DE ARRANQUE de la próxima sesión
Claude entrega, como último mensaje, un prompt listo para pegar que incluya:
- Quién es Julio + las reglas no negociables (resumen).
- El frente activo (frente 1 de AHORA del guion vivo) y por qué.
- Qué ficheros pedirá Claude para ese frente.
- El recordatorio de leer CONTEXTO §1 + guion vivo + mapa competitivo del área antes de tocar.
- Cualquier seguridad pendiente (rotaciones).

---

## Plantilla del prompt de arranque (Claude la rellena al cerrar)

```
Soy Julio Gª Colón, CEO de Folvy. Proyecto serio en desarrollo activo.

ARRANQUE:
1. Confirma que has leído CONTEXTO_CLAUDE.md (§1 estado vivo), folvy_guion_vivo.md (el frente activo) y la sección del mapa competitivo del área de hoy.
2. Resume en 5 líneas dónde estamos y cuál es el frente activo.
3. Aplica el RITUAL DE 4 PASOS antes de construir: RECON (BBDD+repo) → BENCHMARK (mapa competitivo del área) → DISEÑO para golear (aprobado por mí) → MEDIR contra el benchmark.
4. NO toques nada hasta que confirme.

FRENTE ACTIVO HOY: [Claude rellena: el frente 1 de AHORA + por qué es lo que más acerca a producción/ventas]

FICHEROS QUE NECESITARÉ: [Claude rellena: los del frente, en UN mensaje]

SEGURIDAD PENDIENTE: [Claude rellena: rotaciones u otras]

REGLAS NO NEGOCIABLES (resumen):
- Archivos COMPLETOS, nunca diffs. Pide el original ANTES de modificar.
- Una instrucción operativa por turno, marcada 🖥️ (PowerShell/bash) o 🗃️ (SQL Editor).
- Yo ejecuto, tú diseñas. Pide en UN mensaje todos los ficheros de un tramo.
- Marca SIEMPRE las operaciones (COMMIT/ROLLBACK, build, commit/push, verificar push con rev-list).
- RECON contra fuente primaria (BBDD+repo) antes de diseñar, no contra el CONTEXTO.
- DEUDA 0: benchmark del mejor ANTES de diseñar; no vender empate como victoria.
- Folvy es para TODA la hostelería, no solo dark kitchens.
- Yo decido cuándo cerrar; no me sesgues a parar por duración.

Empieza por el paso 1 del arranque.
```

---

## El ciclo completo (cómo encajan los documentos vivos)

```
ABRIR sesión
  → prompt de arranque me sitúa
  → guion vivo dice el frente activo
  → CONTEXTO §1 dice el estado exacto
  → mapa competitivo dice cómo golear en esa área

TRABAJAR el frente (ritual 4 pasos)
  → RECON (BBDD+repo)
  → BENCHMARK (mapa competitivo)
  → DISEÑO para golear (aprobado)
  → CONSTRUIR + MEDIR

CERRAR sesión (este ritual)
  → actualizar guion vivo (HECHO + siguiente)
  → actualizar CONTEXTO §1 (estado)
  → actualizar mapa competitivo (veredicto)
  → memorias (decisiones)
  → generar prompt de arranque de mañana
```

Una sola verdad por cosa: **estado** = CONTEXTO, **qué hacer** = guion vivo, **cómo golear** = mapa competitivo, **decisiones** = memorias, **código/datos** = BBDD+repo. Sin solape, sin contradicción.
