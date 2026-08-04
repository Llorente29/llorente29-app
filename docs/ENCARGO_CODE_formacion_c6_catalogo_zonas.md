# ENCARGO CODE — Formación · C6
## Catálogo en tres zonas · Adopción automática de las obligatorias

> **Depende de**: C5, ya en `main` y aplicada (13 portadas asignadas, taxonomía de adoptados corregida).
> **Origen**: con el catálogo real delante se ve que **plantillas de Folvy y cursos del cliente se pintan en la misma rejilla**. Resultado: alérgenos aparece dos veces (la plantilla global y la copia adoptada de la cuenta), y parece un duplicado del producto.
> **Decisiones de Julio**: (1) un curso **NO** se puede adoptar dos veces; (2) las obligatorias **se adoptan solas** al dar de alta un cliente.

---

## 0. EL PROBLEMA DE FONDO (no es visual, es de modelo)

Hoy la pantalla mezcla **dos objetos distintos**:

- **El catálogo de Folvy** — el escaparate. El cliente no lo edita: lo **adopta**.
- **Los cursos del cliente** — lo que esa empresa imparte de verdad: sus copias adoptadas (con sus fotos y ajustes) más los que cree desde cero.

Cuando un cliente adopta alérgenos, **no debería seguir viendo la plantilla**: debería ver *el suyo*, y la plantilla salir del escaparate porque ya la tiene.

Con dos zonas separadas, el duplicado **desaparece por diseño**, no por un parche.

---

## A. LAS TRES ZONAS

Reorganizar `CoursesPage` en tres bloques, en este orden:

### 1. "Mis cursos" (arriba, lo primero)
Lo que la empresa imparte hoy: copias adoptadas + cursos propios creados desde cero.
Es donde se asigna, se edita y se hace seguimiento. **Es la zona de trabajo diario**, por eso va primero.
Mantener el agrupado por categoría que ya funciona.

### 2. "Catálogo Folvy" (debajo)
Plantillas globales **aún no adoptadas** por esta cuenta.
- Cada tarjeta con botón **"Añadir a mis cursos"** → dispara la adopción existente (`courseAdoptionService`).
- 🔴 **Lo ya adoptado NO aparece aquí.** Esa es la regla que elimina el duplicado.
- Si por lo que sea se muestra algo ya adoptado, la tarjeta debe decir **"Ya lo tienes"** y **no permitir adoptar otra vez**.

### 3. "Certificados externos"
Cursos con `delivery_mode = 'solo_archivo'` — hoy solo PRL.
No son cursos que se hagan: son formaciones que **Folvy vigila pero no imparte**.
- Sin botón de asignar ni de hacer.
- Texto claro: *"Lo imparte tu servicio de prevención. Súbelo en la ficha del empleado."*
- **No mostrar `0 min`** en estas tarjetas: no tienen duración y hoy parece un curso roto.

---

## B. 🔴 ANTI-DUPLICADO (regla dura)

**Un curso global no se puede adoptar dos veces por la misma cuenta.**

- Ya existe el índice único `(account_id, adopted_from_course_id)` de C4 — **verifica que sigue vivo y que cubre este caso**.
- La UI no debe ofrecer adoptar algo ya adoptado.
- Y el servicio debe rechazarlo también si se llama igualmente (defensa en profundidad: la UI puede fallar, la BBDD no).

---

## C. ADOPCIÓN AUTOMÁTICA DE LAS OBLIGATORIAS

**Decisión de Julio**: al dar de alta una cuenta nueva, se adoptan solas **todas las plantillas globales con `is_mandatory = true`**. El cliente nace con el cumplimiento montado; el catálogo solo ofrece lo opcional.

Es coherente con la norma de onboarding del proyecto: *"crear un cliente completo, entero y bien, deuda 0, sin atajos"*.

**Implementación:**
- Función `adopt_mandatory_courses(p_account_id)` que adopta todas las globales obligatorias que la cuenta no tenga ya. **Idempotente**: llamarla dos veces no duplica nada.
- Engancharla donde se crea la cuenta. **RECON obligatorio**: hay un trigger `AFTER INSERT ON accounts` que ya siembra familias de ingredientes — mira cómo está montado y sigue ese patrón en vez de inventar otro.
- **Backfill**: adoptar las obligatorias en las cuentas que ya existen. Idempotente y sin pisar nada de lo que ya tengan adoptado.

⚠️ **Cuidado con el volumen**: adoptar clona curso + secciones + preguntas + opciones + gestos prácticos. Son 9 cursos × ~6 secciones × 10 preguntas × 4 opciones. Con varias cuentas puede ser pesado: hazlo en una transacción por cuenta, no todo en una sola.

⚠️ **`is_mandatory` y tipo de negocio**: los 9 de cumplimiento son `business_types = {todos}`, así que aplican a cualquier cliente. Si en el futuro hay una obligatoria filtrada por tipo de negocio, la adopción automática debe respetar ese filtro. Déjalo contemplado.

---

## D. DETALLE VISUAL

Las 13 portadas se han regenerado con **más contraste** (los fondos claros se veían pálidos junto a las fotos reales) y la de alérgenos ya **no lleva la X roja** — se leía como "curso cancelado". Mismos nombres de fichero: basta con reemplazarlos, sin cambios de código ni migración.

---

## ENTREGA

1. Rama `feature/formacion-c6-catalogo-zonas`.
2. Migraciones entregadas, **no aplicadas por ti**. Con guard `DO`.
3. `database.ts` regenerado en el mismo commit si cambia el esquema.
4. `npm run build` verde.
5. **Antes de cada commit: `git branch --show-current`.** Al terminar: `git rev-list --count origin/main..main` y dime si queda algo sin mergear.
6. **RECON directo, sin subagentes** (regla ya establecida).

## FUERA DE ALCANCE
Pieza C de C4 (curso desde escandallo) · contenido de cursos · multiidioma · rutas por puesto · marketplace entre clientes.

---

_Encargo generado el 04/08/2026 · frente de Formación C6._
