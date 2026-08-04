# Folvy — Formación · ONBOARDING FORMATIVO Y CALENDARIO

> **Origen**: pregunta de Julio — *"al contratar a un trabajador nuevo, ¿qué cursos mínimos tiene que hacer para poder empezar? Y un calendario de formación."*
> **Estado**: diseño para aprobación. Ritual: BENCHMARK ✅ · DISEÑO (este doc) · aprobación · construir · MEDIR.
> **Complementa**: `folvy_formacion_catalogo_v2.md` · `folvy_formacion_guia_contenido.md`

---

## 0. EL HUECO QUE CIERRA

Hoy Folvy sabe **quién ha hecho qué**. No sabe **qué debería hacer cada uno, ni cuándo**.

Eso deja el módulo dependiendo de que un encargado se acuerde de asignar cursos a cada persona que entra. En hostelería, con la rotación que hay, eso falla siempre — y falla justo en el peor momento posible.

**Por qué el trabajador nuevo es el punto de mayor riesgo legal de una empresa:** si alguien que lleva tres días provoca una intoxicación o sufre un accidente sin formación acreditada, la responsabilidad empresarial se agrava mucho (recargo de prestaciones, sanción, eventual vía penal). Y en higiene alimentaria la formación debe estar **antes de manipular**, no "en el primer mes".

---

## 1. BENCHMARK — el estándar del sector

Lo que hacen los líderes (Trainual, TalentLMS, 360Learning, D2L, SAP Litmos, CYPHER):

- **Asignación automática al alta.** <cite>Cuando se crea la ficha de un nuevo empleado, la formación debe asignarse automáticamente. Nadie debería estar eligiendo cursos a mano de un desplegable.</cite>
- **Itinerarios por rol.** La automatización por rol asigna el contenido según puesto, departamento o ubicación, para que un comercial nuevo no acabe haciendo la formación de seguridad de almacén.
- **Plazos atados a la fecha de alta**, no fechas fijas globales.
- **Recordatorios y escalado automáticos**, sin intervención del administrador.
- **Registro audit-ready** de cada completado, sin entrada manual.
- **Historial que se archiva, no se borra**, al cambiar de puesto: un operario que se traslada recibe la inducción del nuevo centro, un mando promocionado recibe las obligaciones que su nuevo rol añade, y **el registro del rol anterior se conserva** por obligación documental.

### 🎯 El hallazgo que cambia el diseño: el modelo 30-60-90

> <cite>Un programa de cumplimiento que lo carga todo el primer día no es más conforme: es menos eficaz. Los empleados que reciben toda su formación de cumplimiento el primer día retienen muy poco.</cite>

El estándar es **escalonar en tres tramos**, respetando a la vez el requisito legal y cómo aprende la gente:
- **Día 1** — lo que no puede esperar (plan de emergencia, y en nuestro caso higiene y alérgenos).
- **Primeros 30 días** — el resto del cumplimiento del puesto.
- **60-90 días** — refuerzo y especialización.

Y el criterio legal que ordena el tramo 1: **formación antes de la exposición al riesgo**. En hostelería eso significa: antes de manipular alimentos.

**Consecuencia para Folvy**: no basta con "asignar los obligatorios". Hay que distinguir **bloqueantes** de **diferibles**, y eso es exactamente lo que Julio preguntaba.

---

## 2. DÓNDE ESTAMOS FRENTE A ESO

| Capacidad del estándar | Folvy hoy |
|---|---|
| Asignación automática al alta | ❌ — solo `adopt_mandatory_courses` (adopta el curso a la CUENTA, no lo asigna a la PERSONA) |
| Itinerario por rol/puesto | ❌ — existe `staff_role` y `course.level`, sin usar para esto |
| Plazos atados a la fecha de alta | ❌ — `course_assignment.due_at` es manual |
| Recordatorios y escalado | ❌ |
| Registro audit-ready | ✅ **por encima del estándar** (firma identificada + verificación práctica) |
| Historial conservado al cambiar de puesto | ⚠️ — las firmas son inmutables, pero no hay concepto de cambio de puesto |
| Distinción bloqueante / diferible | ❌ — **y es lo que más falta** |

**Traducción honesta**: Folvy gana en **evidencia** (nadie tiene firma identificada + verificación práctica + ciclo APPCC) y pierde en **automatización de la asignación**, que es precisamente lo que los rivales tienen resuelto desde hace años.

---

## 3. DISEÑO

### 3.1 Itinerario de incorporación (la pieza central)

**Nueva tabla `training_path`** — el itinerario, configurable por cuenta:

```
training_path        (id, account_id, name, role_id NULL, business_type NULL, active)
training_path_item   (id, path_id, course_id, phase, days_from_hire, is_blocking)
```

- **`phase`**: `dia_1` · `dias_30` · `dias_90` — el modelo 30-60-90 del benchmark.
- **`is_blocking`**: 🔴 **el campo clave**. Si es `true`, el empleado **no puede empezar a manipular alimentos** sin haberlo superado.
- **`days_from_hire`**: el plazo se calcula desde la fecha de alta, nunca una fecha fija.
- **`role_id`**: itinerarios distintos para cocina, sala, reparto y mandos.

**Itinerario por defecto de Folvy** (que cada cuenta puede ajustar):

| Fase | Curso | Bloqueante |
|---|---|---|
| Día 1 | Higiene alimentaria (manipulador) | 🔴 **Sí** |
| Día 1 | Alérgenos e intolerancias | 🔴 **Sí** |
| 30 días | APPCC y prerrequisitos | No |
| 30 días | PRL *(archivo del certificado del SPA)* | No |
| 30 días | Embolsado *(solo delivery)* | No |
| 30 días | La estación / KDS | No |
| 90 días | Igualdad y acoso · LGTBI · RGPD · Canal de denuncias | No |
| 90 días | El escandallo *(solo cocina)* | No |

⚠️ **Solo los dos primeros son bloqueantes**, y no por criterio nuestro: son los que la normativa exige **antes de manipular alimentos**. Marcar más cosas como bloqueantes haría el sistema inoperante y la gente lo saltaría.

### 3.2 El semáforo de la ficha del empleado

Lo que un encargado necesita ver el lunes por la mañana, de un vistazo:

- 🟢 **Puede trabajar** — formación bloqueante superada.
- 🟡 **Puede trabajar, con pendientes** — bloqueante ok, quedan cursos de 30/90 días.
- 🔴 **NO puede manipular alimentos** — falta formación bloqueante.

**Debe verse también en el cuadrante**: si el encargado va a poner a alguien en rojo en un turno de cocina, tiene que saberlo **al montar el cuadrante**, no después. Es el mayor valor práctico de toda la pieza.

### 3.3 Disparo automático

Al crear un empleado: trigger `AFTER INSERT ON employees` → resuelve su itinerario (por `staff_role` y `business_type` de la cuenta) → crea los `course_assignment` con `origin='onboarding'` (valor **ya previsto** en el modelo de C1) y `due_at = fecha_alta + days_from_hire`.

**Cambio de puesto**: al cambiar `employees.department` / rol, se añaden los cursos del nuevo itinerario que falten. **Nunca se borra el historial anterior** — es obligación documental, y las firmas ya son inmutables.

### 3.4 Calendario de formación

Vista temporal en Team → Formación, con tres capas:

1. **Qué vence** — asignaciones con `due_at` próximo, ordenadas por urgencia.
2. **Qué caduca** — cursos vigentes que expiran (por `reeval_months`) y certificados externos.
3. **Reevaluaciones** — periódicas y las disparadas por evento APPCC.

Con filtros por local y por puesto, y vista de mes. **Engancha con el cuadrante**: formar cuesta horas de trabajo, y el convenio de hostelería de Madrid establece que **el tiempo de formación es tiempo efectivo de trabajo**.

### 3.5 Recordatorios y escalado

- **Al empleado**: aviso en su portal al asignarle algo y cuando se acerca el plazo.
- **Al responsable**: resumen de quién va tarde. Y **escalado**: si un bloqueante sigue sin hacerse pasada la fecha, se avisa con más énfasis.
- Un cron diario, mismo patrón que los watchdogs ya vivos.

---

## 4. DÓNDE GOLEAMOS (y dónde solo igualamos)

**Igualamos** al estándar en: asignación automática al alta, itinerarios por rol, plazos desde la fecha de alta, recordatorios y escalado, modelo 30-60-90.

**Goleamos en tres cosas que ningún LMS puede hacer:**

1. **El semáforo llega al cuadrante.** Los LMS no saben quién trabaja mañana; Folvy sí. Avisar de que vas a poner a alguien sin formación en un turno de cocina **antes** de montarlo es una capacidad que no tienen y que no pueden tener sin ser también el sistema de turnos.
2. **"Bloqueante" significa algo real.** En un LMS, un curso vencido es una fila roja en un informe. En Folvy puede impedir que se asigne a alguien a una tarea. La consecuencia está donde ocurre el trabajo.
3. **La evidencia sigue siendo superior**: firma identificada + verificación práctica en el puesto + ciclo cerrado con el APPCC. Un competidor puede copiar el itinerario; no puede copiar esto sin estar dentro de la cocina.

---

## 5. CÓMO SE MIDE

- **% de plantilla con la formación bloqueante superada** — debe ser 100% y es el número que mira un inspector.
- Días medios desde el alta hasta completar el bloqueante (**objetivo: 0** — antes del primer turno en cocina).
- % de itinerario completado a 30 y a 90 días.
- Nº de veces que el sistema avisó de un empleado en rojo asignado a un turno *(el indicador de que la pieza sirve de verdad)*.

---

## 6. DECISIONES ABIERTAS

- **¿El semáforo rojo debe BLOQUEAR el cuadrante o solo avisar?** Recomendación: **avisar con fuerza, no bloquear**. Un bloqueo duro en hora punta hace que la gente busque la forma de saltárselo, y entonces se pierde el control de verdad. Decisión de Julio.
- **¿Qué pasa con la plantilla actual?** Backfill: aplicar el itinerario a los empleados existentes, con plazos desde hoy y no desde su fecha de alta real (si no, nacerían todos vencidos).
- **Extras de temporada / horas sueltas**: si alguien entra para un fin de semana, el itinerario completo no tiene sentido — pero **el bloqueante sí**. Contemplar un itinerario reducido.

---

## 7. ORDEN DE CONSTRUCCIÓN

1. **`training_path` + itinerario por defecto + disparo al alta** — el núcleo.
2. **Semáforo en la ficha del empleado.**
3. **Semáforo en el cuadrante** — la goleada.
4. **Calendario de formación.**
5. **Recordatorios y escalado** (cron).

---

## Fuentes del benchmark

- Trainual — *The Definitive Guide to LMS Onboarding Automation for HR Leaders*
- Coggno — *2026 Guide on Employee Onboarding Compliance Training* (modelo 30-60-90)
- D2L — *LMS Platforms for Effective Employee Onboarding in 2026* · *LMS Workflow Automation*
- Trainery — *LMS for Compliance Training: 2026 Guide + Evaluation Checklist*
- iCAN — *LMS with HRIS Integration* (alta rotación, formación documentada antes del primer turno)
- CYPHER Learning — *Top 5 LMSs for onboarding and compliance training*

_Diseño realizado el 04/08/2026 en el frente de Formación._
