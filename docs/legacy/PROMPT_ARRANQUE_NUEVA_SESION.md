# PROMPT DE ARRANQUE PARA NUEVA SESIÓN

Copia y pega este texto al iniciar la próxima sesión con Claude, junto con el fichero CONTEXTO_CLAUDE_v19.md adjunto.

---

```
Hola Claude. Soy Julio Gascón, CEO de Foodint. Trabajamos juntos en un proyecto SaaS multi-tenant para hostelería.

Te adjunto el fichero CONTEXTO_CLAUDE_v19.md con toda la historia del proyecto y especialmente la sesión del 16 de mayo de 2026, que fue larga y crítica.

Antes de hacer nada, por favor:

1. Lee el CONTEXTO_CLAUDE_v19.md ENTERO. Especialmente:
   - La sección "Parte 3 — Conversación estratégica" — es la más importante.
   - La sección "DEUDA TÉCNICA CONOCIDA" — hay puntos críticos que arrastro desde hace varias sesiones.
   - La sección "PRÓXIMOS PASOS" — define qué tenemos que hacer en esta sesión.

2. Confirma que has entendido lo siguiente sin que yo te lo recuerde:
   - Mi visión: Foodint = Operating System completo de hostelería, modular, multi-cuenta. No un simple ERP.
   - El módulo "Stock" se llamará de otra forma (a decidir).
   - Hay 1 cliente activo (Llorente29) y 1 cliente esperando + cartera. Todos piden Stock.
   - La deuda CRÍTICA es: sistema de routing real + modularización top-level del UI. Sin esto no se vende.
   - El cliente 2 puede vender con Personal + APPCC mientras Stock se construye.

3. La acción comprometida para HOY:
   Hacer la investigación honesta y completa de competidores que me prometiste al final de la sesión anterior.

   Productos a investigar:
   - Apicbase
   - Marketman
   - Cookbook
   - Tspoon (ya lo conozco, pero quiero análisis estructurado)
   - Combatte
   - Mapal
   - Toast (USA, gigante)
   - Square for Restaurants
   - Lightspeed Restaurant

   Para cada uno quiero, mínimo:
   - Categoría / qué hace bien
   - Modelo de cobro y precios públicos
   - Diferenciador principal
   - Qué hace bien que Foodint pueda aprender
   - Qué hace mal o no cubre que sea oportunidad para Foodint
   - Resumen ejecutivo en una frase

   Y al final:
   - Recomendación de posicionamiento para Foodint
   - Qué módulos priorizar para diferenciarnos
   - Qué módulos NO tiene sentido replicar y conviene integrar
   - Riesgos del camino que llevo

4. No quiero generar código en esta sesión. Es investigación + estrategia. Si surgen tareas técnicas, las apuntamos para sesión siguiente.

5. Reglas que ya conoces y siguen vigentes:
   - Yo decido cuándo cerrar la sesión.
   - Cuando me pidas modificar un fichero, pídemelo primero si no lo tienes y pásame el fichero completo modificado (NO diffs).
   - Sé directo, profesional, sin pelotismo. Avísame si me equivoco.
   - El objetivo siempre es producto "profesional, estable y vendible".

Cuando hayas leído el contexto y confirmes que lo has entendido, empezamos.
```

---

## NOTAS PARA TI (Julio) — NO PEGAR ESTO AL ARRANCAR

**Antes de la próxima sesión:**

1. **Renombra el fichero**: añade el bloque `CONTEXTO_CLAUDE_v19_bloque_a_añadir.md` al final de tu `CONTEXTO_CLAUDE_v18.md` y guárdalo como `CONTEXTO_CLAUDE_v19.md`. Borra el v18.

2. **Si quieres**, antes de arrancar puedes hacer las pruebas pendientes:
   - Probar el fix de TOKEN_REFRESHED dejando la app abierta >50 min
   - Crear alguna marca real en BrandsPage para Llorente29 (si lo necesitas)
   - Confirmar que el manifest.json no te bloquea nada urgente

3. **Para la sesión nueva**:
   - Cabeza fresca, mejor primera hora de la mañana o tras descansar
   - Reserva 1-2 horas de calidad (la investigación de competidores es trabajo serio)
   - Ten papel/notas para apuntar decisiones de posicionamiento

4. **Lo que NO debes esperar de la próxima sesión**:
   - Que se escriba código del módulo "Cocina" (es prematuro)
   - Que se decida la arquitectura final (necesita la investigación primero)
   - Una sola sesión que resuelva todo el roadmap (son varias sesiones encadenadas)

5. **Lo que SÍ puedes esperar**:
   - Mapa claro del mercado en el que compites
   - Recomendación honesta de posicionamiento
   - Decisión sobre qué módulos priorizar y cuáles diferir
   - Un plan de las siguientes 4-6 sesiones

**Buen descanso. Has hecho mucho hoy.**
