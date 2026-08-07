# Prompt de arranque de sesión — Folvy

> Copiar y pegar el bloque de abajo al empezar una sesión nueva.
> **Última actualización: 07 ago 2026 (noche).**

---

```
Arranca Folvy.

RITUAL DE APERTURA — hazlo antes de proponer nada:
1. Lee `folvy_estado.md` (frente activo, pendientes, deuda).
2. Lee `folvy_reglas.md` (reglas no negociables).
3. Abre `folvy_indice.md` y lee TODOS los docs de la sección del área que vamos a tocar.
4. Lee el `*_estado.md` del área (`folvy_team_estado.md`) — verdad viva + DECISIONES QUE NO SE RE-LITIGAN.
5. RECON en la BBDD por MCP (proyecto `xzmpnchlguibclvxyynt`) antes de diseñar.

REGLAS QUE ME IMPORTAN MÁS:
- La verdad es la BBDD y el repo, nunca un doc. Producción va por delante del repo.
- NO fiarse del "Success": verificar cada objeto con query independiente.
- NO DESTRUCCIÓN: nada se elimina/oculta/renombra sin inventario y aprobación mía.
- Todo encargo lleva arriba "decisiones vigentes que este encargo NO revisa", con fecha y doc.
- Al cruzar `clock_entries`, filtrar SIEMPRE por `location_id_at_clock`.
- Nada es HECHO hasta: commit → push → merge → deploy → verificación en vivo.
- NO tocar `App.tsx` ni `notificationsService.ts` sin permiso.
- NO `supabase db push`. Migraciones por MCP, con guard DO.
- **VERIFICA ANTES DE ASUMIR.** El 07/08 se pagaron varios errores por asumir: nombres de columna
  inventados, "Alcalá"=municipio (es una CALLE de Madrid capital), y desmentir un hallazgo con
  una fórmula sin validar. Toda función de cálculo nueva se valida contra casos calculados a mano
  ANTES de usar su salida para decidir.
- **NO PERDER PENDIENTES DE VISTA.** El 07/08 F10 se empezó, se verificó viable y se dejó caer sin
  volver a listarlo. Cada cierre debe llevar la lista completa de pendientes del módulo.

CONTEXTO DE PROYECTO:
- Folvy: SaaS multi-tenant de hostelería. Cliente activo Llorente29 (Foodint).
  Locales: Alcalá, Carabanchel, Plaza Castilla — LOS TRES en Madrid capital (city='Madrid').
  Cuenta `51ad1792-6629-4ef7-833a-b57b09a86710`. Sandbox: `00000000-0000-0000-0000-000000000001`.
- Stack: React 19 + TS + Vite en Vercel; Supabase. Repo: C:\dev\llorente29-app.
- Marca: marino #1E3A5F, terracota #D67442, crema #F5F4F0.
- Objetivo: salir al mercado / admitir cliente 2. Producción objetivo: 7 sept 2026.

FRENTE ACTIVO: FOLVY TEAM — REMATE FINAL (mañana se termina).
Ayer (07/08) se cerraron F0,F1,F2,F3,F4,F5,F7(comparador),F8(visibilidad),F10 + deuda de rendimiento.
TODO mergeado a main (b7957e4) y en producción. Ver `folvy_team_estado.md` para el detalle.

LO PRIMERO DE TODO, HOY (por orden):
1. 🔴 PRUEBA DE HUMO EN PRODUCCIÓN (no se hizo ayer, el merge fue al final):
   a) Cocina/kiosko: fichar entrada y salida reales. Es lo único que toca la operación diaria
      (trigger nuevo `trg_clock_entry_pause_order` + `team_worked_shifts` reescrita).
   b) Plantilla: Natacha +23,68 h y Johanny -1,67 h en julio.
   c) Cierre de mes: deben salir las incidencias (6 sin descansos, Marlón fichaje olvidado,
      Mirlenys -83,3 h), no una tabla en blanco.
2. 🔴 F9 — BOTÓN DE PAUSA EN KIOSKO. El backend está desde ayer pero NADIE puede fichar pausa.
   Por eso el PDF legal sale con la columna "descanso" VACÍA en los 6 empleados y el export a
   gestoría marca "sin descansos registrados" a todos. Es el pendiente de más valor/esfuerzo.
3. 🔴 F6 — PANTALLA DE CUMPLIMIENTO. Motor listo (`team_compliance_scan`). El benchmark la llama
   "la que justifica el precio". Sin pantalla, el motor no se ve.

PENDIENTES DEL MÓDULO TEAM — LISTA COMPLETA (nada se cae de aquí hasta que se cierre):

FASES INCOMPLETAS
- F6 pantalla de Cumplimiento (motor ✅, pantalla ⬜). Además: el encargo pide tabla
  `compliance_rule` CONFIGURABLE POR CUENTA — hoy las 4 reglas están DENTRO de la función.
  Y pide 7 reglas; hay 4 (faltan: descanso semanal 1,5 días art.37.1; tope 80h extra/año art.35.2;
  extras prohibidas a nocturnos art.36.1).
- F7.2 limpiar `shift_templates` duplicadas (18 activas; Alcalá 10 para ~4 turnos reales:
  "Mañana" duplicada, Corrido1/Completo1 misma hora, Tarde/Noche con dos horas distintas).
  DECIDE JULIO cuáles conservar. Hay `schedules.cells` apuntando a esos IDs: reasignar al desactivar.
- F7.3 cobertura por ROL, no por número (`coverage_mon..sun` sin `staff_role_id` en shift_templates).
  Bloquea el desglose por rol en el comparador de cobertura y en el generador.
- F7.5 publicar cuadrantes: 24 de 33 semanas siguen en BORRADOR. Publicar es lo que da valor legal.
- F7.6 `open_shifts` vacía y solo 2 `shift_swap_requests`. PREGUNTAR AL ENCARGADO por qué antes de
  rediseñar (puede que con 8 personas no haga falta).
- F8 PORTAL DEL EMPLEADO: la PWA en sí (Hoy / Mis turnos / Mis horas / Vacaciones / Bolsa /
  Formación / Yo). Solo está hecha la capa de visibilidad. Tono SIEMPRE suave, nunca semáforos de culpa.
- F9 KIOSKO: botón de Pausa (ver arriba) + QR dinámico firmado anti-fraude (el GPS miente
  sistemáticamente: Natacha marca 670 m estando dentro. Biometría descartada por el borrador del RD).
- F11 ARMONIZACIÓN: aplicar sistema visual y paleta de marca a Formación, Nóminas, Solicitudes,
  Recordatorios, Calendario, Informes Gestoría. Los prototipos HTML viejos usan paleta genérica.

DEUDA TÉCNICA DECLARADA
- F3.1 extras vs complementarias: BLOQUEADO por dato sucio. `contract_type` está a null en 5 de 9 y
  no existe distinción completa/parcial. NO construir sobre eso hasta que Julio lo rellene.
  Falta también `journey_type`, `employee_contract_period` y cómputo ANUAL (~1.800 h de convenio).
- F2.2 casar fichaje con turno: `clock_entries.scheduled` poblado en 12 de 574. De ahí cuelgan
  retrasos, "no fichó teniendo turno" y la cobertura real vs planificada.
- F2.6 modelo de `sala` en `team_labor_model` (solo hay cocina y reparto). Sin él no hay cobertura
  por área para restaurante de mesa.
- F8 flags de visibilidad son GLOBALES (`app_settings` es una fila única con scope='global'), no por
  cuenta. Con cliente 2 cada cliente querrá los suyos → mover a tabla por cuenta.
- `assigned_locations` VACÍO en los 6 empleados. El roster se resuelve por evidencia de fichajes
  (>=5 en 90 días). Si se empieza a usar el campo, revisar `propose_schedule`.
- Condición de carrera en `refresh()` de Calendario (sin guard de respuesta obsoleta): al navegar
  semanas rápido muestra brevemente datos de otra semana. Pre-existente, detectada por Code.
- Calendario dispara ~25 llamadas concurrentes al montar. Ya no rompe (fix de BBDD 520ms→122ms)
  pero sigue siendo incorrecto; con más locales volvería.
- Optimización fina pendiente: CTE `ppt` y `loc_days` de `team_labor_requirement` aún escanean ventas
  crudas (~47 ms de los 122). Pasarlos a `sales_hourly_agg` bajaría a ~60 ms.
- `propose_schedule` NO usa el descanso de 12 h como restricción dura del solver (sí lo vigila
  `team_compliance_scan` a posteriori). Declarado, no fingido.
- Métrica de éxito de F10 sin medir: ≥85 % de turnos aceptados sin tocar a las 6 semanas.

TAREAS DE JULIO (no son desarrollo — bloquean funcionalidad)
- 🔴 Rellenar `account_gestoria_config`: las 3 filas están VACÍAS y desactivadas (sin nombre ni email).
  Sin eso el envío a gestoría no puede funcionar.
- 🔴 Caso Mirlenys: -83,3 h sobre contrato en julio con 1 solo día de baja. O faltan fichajes, o hubo
  ausencia no registrada, o su contrato no es de 40 h. La gestoría lo preguntará.
- 🟠 Rellenar `contract_type` / tipo de jornada (desbloquea F3.1).
- 🟠 Alcalá tiene solo 3 empleados propios; con uno de vacaciones se queda en 2 para 7 turnos/día.
  El generador lo dejó a la vista. Decisión de plantilla, no de software.
- 🟠 Verificar con la asesoría el convenio de nocturnidad y la pausa retribuida de Madrid
  (se sembró `break_policy` con: continuada >6 h → 15 min RETRIBUIDOS, máx 5 h seguidas,
  12 h entre jornadas, máx 9 h/día, franja 22:00-06:00).
- 🟠 Decidir qué `shift_templates` duplicadas se conservan (F7.2).
- 🟠 Preguntar al encargado por qué no se usan turnos abiertos ni cambios de turno (F7.6).

COORDINACIÓN (importante)
- Hay MÁS DE UN AGENTE con acceso de escritura al working tree `C:\dev\llorente29-app`.
  El 07/08 apareció un commit directo de otra sesión mientras Code trabajaba (sin conflicto, ficheros
  distintos). Antes de trabajar en paralelo, confirmar quién puede commitear autónomamente.

FICHEROS QUE NECESITARÉ: ninguno al arrancar (RECON por MCP + repo).

SEGURIDAD PENDIENTE: rotar `OFFERS_AGENT_SECRET`, `PUSH_AGENT_SECRET`, credenciales sandbox de
Catcher y secretos internos de triggers. Bucket `delivery-proof` PÚBLICO. `HUBRISE_ACCESS_TOKEN`
global. `external_integration.access_token` en texto plano.
```
