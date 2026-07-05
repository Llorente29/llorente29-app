# Folvy · Motor de Ofertas Inteligente
### El primer agente de promociones que decide con el margen real de cada plato
**Informe comercial y técnico · Julio 2026**

---

## 1. El problema que resuelve

Las promociones en Glovo, Uber Eats y Just Eat son **obligatorias para competir**: el algoritmo de las plataformas premia con visibilidad y ranking a los establecimientos con ofertas activas. Pero su gestión manual produce dos fugas de dinero opuestas y simultáneas:

- **Por defecto:** promos que no se ponen por olvido → ventas perdidas y caída en el ranking.
- **Por exceso:** promos que se dejan puestas por comodidad, sin medir, canibalizando margen — o descuentos aplicados a platos que **ya pierden dinero** sin que nadie lo sepa.

Las herramientas de promociones existentes en el mercado deciden **a ciegas del coste**: no saben lo que cuesta cada plato, así que no pueden saber lo que cada descuento destruye. Folvy sí lo sabe — **al céntimo** — porque el motor de ofertas está construido sobre el escandallo.

---

## 2. Qué es

Un **agente autónomo** que analiza el negocio continuamente (cada hora, 24/7), decide qué promociones convienen —en qué marca, canal, platos, profundidad, días y horas—, las somete a un guardarraíl de margen real plato a plato, y las **publica directamente en las plataformas**. El operador elige el nivel de autonomía: desde "el agente propone y yo apruebo con un clic" hasta piloto automático completo.

**El resultado:** promociones siempre activas donde convienen, nunca donde destruyen margen, ajustadas al ritmo real del negocio — sin que nadie tenga que acordarse.

---

## 3. Cómo decide el agente (el ciclo, paso a paso)

### 3.1 Las señales — qué mira cada hora
Para cada **marca × canal × local**, el agente calcula desde las ventas reales:

- **Pulso actual:** pedidos/día de los últimos 7 días.
- **Tendencia:** media de los últimos 28 días.
- **Pico histórico:** el mejor rendimiento que esa marca ha demostrado poder alcanzar (mejor mes de los últimos 12). Es la referencia de recuperación: no "cómo vas", sino "cuánto puedes".
- **Perfil semanal:** cómo se distribuyen los pedidos por día de la semana — el motor sabe que un viernes no es un lunes, y concentra la potencia promocional en los días donde cada euro de descuento genera más pedidos.
- **Contexto de demanda:** calendario de eventos con impacto (partidos, festivos, conciertos, alertas meteorológicas). La lluvia y el gran derbi mueven el delivery; el agente lo sabe antes de decidir.
- **Estado de campañas:** qué promociones hay vivas, cuáles expiran, qué resultados están dando.

### 3.2 Las reglas de decisión — cuándo y cuánto
El agente opera en **modo crecimiento**: cada marca tiene un objetivo de recuperación (por defecto, el 90% de su pico histórico; configurable, incluso objetivo manual por marca).

- **Reactivación urgente.** Marca con historial demostrado que hoy vende cerca de cero → intervención máxima inmediata. Los casos más graves reciben la respuesta más agresiva, no el abandono.
- **Recuperación proporcional.** Marca por debajo de su objetivo → promoción con **profundidad proporcional al hueco**: al 85% del pico, empujón suave; al 45%, artillería. Ni café para todos ni descuentos porque sí.
- **Presencia continua (always-on).** En marcas en recuperación, al expirar una campaña el agente prepara la siguiente: el ranking de las plataformas premia la constancia, y el agente no descansa.
- **Aceleración por contexto.** Evento de demanda alta en la ventana → la promoción se refuerza para capturar el pico de demanda.
- **Orquestación por franjas.** Varias ofertas pueden convivir en el mismo día con horarios distintos: una campaña agresiva en la franja valle (14:00–15:30) y una suave el resto del día. El agente compone el día completo, y puede sustituir ofertas sobre la marcha cuando el dato lo pide.

### 3.3 El arsenal — qué tipos de campaña maneja
El agente no solo decide *cuánto*, decide *qué arma*:

- **Descuento % en productos seleccionados** — la herramienta de recuperación y ranking.
- **Descuento en todo el menú** — el empujón de marca completa.
- **2x1 con artículo optimizado** — la promoción de mayor impacto visual y volumen. El motor calcula automáticamente el precio del artículo promocionado que **protege el margen del pack completo** (validado en cliente real: una marca con 2x1 permanente bien construido multiplicó ×6 las ventas de esos productos).
- **Ofertas de captación** — dirigidas a clientes nuevos o inactivos.
- **Promoción de gastos de envío** — cuando el ticket medio la absorbe con margen.

### 3.4 El guardarraíl — la parte que nadie más puede hacer
Antes de crear cualquier campaña, el agente la pasa por el **simulador de margen real**:

> Para cada plato del alcance: PVP → descuento → **comisión de la plataforma calculada sobre la base ya rebajada** (la regla real de facturación, verificada al céntimo contra facturas reales) → coste del escandallo → **margen resultante**.

- Los platos que con ese descuento caen por debajo del **suelo de margen** configurado (p. ej. 45%) se **excluyen automáticamente** del alcance. Una lata de refresco en un canal con 27% de comisión no aguanta un 10% de descuento — el agente lo ve y la aparta, plato a plato.
- Si ninguna referencia aguanta el suelo, la campaña entera se descarta y queda registrado el porqué.
- El descuento real cuesta **menos de lo que parece**: al rebajar el precio, la comisión de la plataforma también baja. El simulador lo computa exacto — la mayoría de operadores ni lo sabe.

### 3.5 La publicación — del clic a la plataforma
Aprobada una campaña (por el operador o por el propio agente en modo automático), Folvy la **publica directamente** en el canal correspondiente, en todos los locales del alcance, con verificación de cada parámetro (descuento, productos, calendario, ausencia de extras no deseados) antes y después de la publicación. Pausar, sustituir o finalizar una campaña es un clic desde Folvy.

### 3.6 La medición — el informe de rendimiento y objetivos
Cada campaña se mide contra su línea base:

- **Uplift real:** pedidos e ingresos durante la campaña vs. el periodo previo comparable (mismo patrón semanal).
- **Coste real de la promoción:** los descuentos financiados, leídos de las ventas reales — no estimados.
- **Margen real del periodo:** con escandallo y comisiones, el beneficio neto que la campaña dejó (o se llevó).
- **Consecución de objetivo:** ¿la marca pasó del 57% al 90% de su pico? El panel lo muestra marca a marca, campaña a campaña.

### 3.7 El aprendizaje — el ciclo se cierra
Cada decisión del agente queda registrada con sus señales y su razonamiento; cada campaña, con su resultado. Sobre ese histórico, el motor **ajusta sus propias reglas**: qué profundidades funcionan en qué marcas, qué días rinden las campañas top, qué tipos de promoción convierten mejor en cada canal. El agente de hoy decide con reglas expertas; el de cada mes siguiente decide, además, con la experiencia acumulada del propio negocio.

---

## 4. Control, transparencia y seguridad

- **Niveles de autonomía por canal:** automático / propone-y-apruebas / apagado. La tienda propia puede ir en automático total mientras las plataformas requieren un clic de aprobación — o todo en piloto.
- **Agresividad configurable:** Baja · Media · Alta · Máxima — regula la profundidad máxima de descuento, la frecuencia y cuántos frentes abre a la vez.
- **Reglas inquebrantables:** el suelo de margen es ley en todos los niveles; las marcas licenciadas/cedidas quedan fuera de las campañas de plataforma por diseño; ningún gasto publicitario adicional se contrata jamás sin orden expresa.
- **Auditoría total:** cada corrida del agente deja escrito qué vio, qué decidió, qué descartó y por qué. No hay caja negra: cualquier propuesta se puede abrir y leer su razonamiento.
- **Cumplimiento normativo:** el motor es consciente de la normativa de precios promocionales (Ley Ómnibus — precio mínimo de 30 días) y registra las referencias de cada campaña.

---

## 5. Por qué Folvy y no otro

| | Herramientas de promos del mercado | **Folvy Motor de Ofertas** |
|---|---|---|
| Base de decisión | Ventas y reglas genéricas | Ventas + **margen real por plato** (escandallo + comisión real) |
| Protección de margen | Estimaciones o nada | **Suelo de margen duro, plato a plato, automático** |
| Precio del 2x1 | A ojo | **Calculado para proteger el margen del pack** |
| Objetivo | "Más ventas" | **Recuperación medible contra el pico histórico de cada marca** |
| Medición | Impresiones y clics de la plataforma | **Uplift, coste real y margen real desde las ventas** |
| Integración | Herramienta aparte | **Nace dentro del sistema de gestión** — mismo dato, cero fricción |

El agente de Folvy es el único que puede responder a la pregunta que importa: *"esta promoción, ¿me hizo ganar dinero?"* — porque es el único que sabe lo que cuesta cada plato que descuenta.

---

*Folvy · Gestión inteligente para la hostelería · folvy.app*
