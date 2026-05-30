# ARRANQUE DE SESION - copia y pega esto al abrir una conversacion nueva

> **Por que existe:** el 30/05/2026 se perdio casi una sesion entera porque al abrir conversacion
> nueva el asistente arrancaba desde una copia vieja del contexto, no desde el repo. Esto lo evita:
> al abrir, se le ordena leer CONTEXTO_CLAUDE.md DEL REPO (la unica fuente de verdad versionada).

---

## El mensaje de apertura (copia el bloque de abajo tal cual)

```
Soy Julio Gascón, CEO de Folvy.

ANTES DE NADA, lee la fuente de verdad DEL REPO (no tu copia del Project Knowledge,
que puede estar desactualizada): pídele a Claude Code el contenido actual de
CONTEXTO_CLAUDE.md del repo C:\dev\llorente29-app (rama main). Lee con prioridad:
  - §0 (reglas operativas, incluida la regla de cierre)
  - §14 (estado de ejecución: qué llevamos construido y qué quedó pendiente)
  - §13 (hoja de ruta del editor: FASE A/B y la decisión A/B de merma)

Luego:
1. Confirma que has leído CONTEXTO_CLAUDE.md del repo.
2. Resúmeme en 5-10 líneas dónde estamos.
3. Dime cuál es el PASO 1 de hoy (el que dejamos escrito en §14).
4. NO toques nada hasta que yo confirme.

Reglas no negociables (recordatorio): archivos completos no diffs; pide el original
antes de modificar; la BBDD es la verdad (consulta information_schema, no supongas);
una instrucción por turno; marca 🖥️ PowerShell vs 🗃️ SQL Editor; indica siempre
COMMIT/ROLLBACK/build/push; pregunta en prosa, no con botones; yo decido cuándo cerrar.
```

---

## Qué pasa después de pegarlo
El asistente le pide a Claude Code el `CONTEXTO_CLAUDE.md` del repo, lo lee, te resume el estado
real y te dice el paso 1. Arrancas exactamente donde lo dejaste, sin reconstruir nada.

## Recordatorio del ritual de CIERRE (ver docs/CIERRE_SESION.md)
Cuando digas "cerramos", el asistente SIEMPRE:
1. Te prepara la actualización de CONTEXTO §14 + el paso 1 de la próxima sesión (Claude Code la commitea).
2. Te da el comando del verificador: `.\scripts\cierre-sesion.ps1`
3. No da la sesión por cerrada hasta que el script diga **CIERRE OK**.
