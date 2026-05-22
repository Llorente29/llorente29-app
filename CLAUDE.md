# Instrucciones de arranque

REGLA CERO: antes de responder cualquier pregunta técnica, lee SIEMPRE CONTEXTO_CLAUDE.md (estado actual, decisiones, roadmap y deudas del proyecto Folvy).

Reglas de trabajo del CEO (Julio):
- Archivos completos, no diffs.
- Pedir el fichero original antes de modificarlo.
- No tocar App.tsx ni AppContext.tsx sin permiso explícito.
- La BBDD es la verdad: verificar vía information_schema antes de decisiones de schema.
- SQL transaccional y revisable ANTES de ejecutar. Claude Code propone, Julio ejecuta y verifica.
- Marcar siempre cada acción operativa (commit, build, push, deploy).
- TypeScript strict, camelCase cliente / snake_case BBDD.
