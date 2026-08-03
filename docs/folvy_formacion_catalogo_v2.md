# Folvy — Formación · CATÁLOGO v2 Y EVOLUCIÓN DEL MÓDULO

> **De dónde venimos**: plataforma (C1 · C2 · C3-A) en producción + 9 cursos de cumplimiento + 6 esquemas. Todo verificado en vivo el 03/08/2026.
> **Qué es este documento**: la auditoría del formador sobre lo construido y el mapa de lo que convierte el módulo en un producto con entidad propia.
> **Molde de contenido**: `docs/folvy_formacion_guia_contenido.md` (sigue vigente; este doc lo amplía).

---

## 0. EL SALTO QUE PROPONE ESTE DOCUMENTO

Hoy Folvy tiene **un módulo de cumplimiento legal**: 9 cursos obligatorios, evidencia firmada e informe de inspección. Está bien resuelto y ya golea a Flow Learning en ciclo cerrado con el APPCC.

Pero un cliente hace esos 9 cursos **una vez al año** y se olvida del módulo.

El salto es pasar de *"lo que la ley me obliga"* a *"donde vive el conocimiento de mi operación"*. Un módulo con 30 cursos útiles y donde el cliente crea los suyos propios es algo que se usa **cada semana**, no cada año. Eso cambia la retención del módulo y lo que se puede cobrar por él.

**La palanca decisiva**: Folvy ya tiene los escandallos con **pasos vinculados a ingredientes** (diferenciador E8, que meez y Apicbase no tienen). Eso permite **generar cursos de producto directamente desde la receta**. Ningún LMS del mundo puede hacerlo, porque ninguno tiene el escandallo dentro.

---

## 1. AUDITORÍA DE LO CONSTRUIDO — qué falla

Evaluación honesta de los 9 cursos actuales, por gravedad:

### 🔴 1.1 Falta la parte práctica (fallo estructural)
Un curso de manipulador que se aprueba **sin que nadie compruebe que sabes usar un termómetro sonda** es exactamente lo que denuncia la evidencia: nota alta, conducta sin cambiar. La LPRL y el Reg. 852/2004 hablan de formación *"teórica y práctica"*.

→ **Solución: verificación práctica en el puesto.** Ver §2.

### 🟠 1.2 Todos hacen el mismo curso
Un friegaplatos y un jefe de cocina hacen el mismo manipulador. El primero se aburre con trazabilidad, el segundo se queda corto. Baja la tasa de finalización.

→ **Solución: rutas por puesto.** Ver §3.

### 🟠 1.3 Cero adaptación idiomática — la mayor pérdida de retención
La evidencia revisada da **+45% de retención** formando en la lengua materna. Con plantillas de hostelería reales, esto vale más que cualquier esquema. **Es el frente con mejor retorno de todo el documento.**

→ Ver §4.

### 🟡 1.4 Bloque legal-laboral sin ilustrar
4 cursos (igualdad, LGTBI, RGPD, canal) con **cero imágenes**. No necesitan esquemas conceptuales, pero sí **diagramas de proceso**: circuito del protocolo de acoso, derechos ARCO, flujo del canal. Los procesos se dibujan bien.

### 🟡 1.5 Faltan fotos reales donde tocan
Los esquemas cubren lo abstracto. Pero *reconocer moho*, *leer un alérgeno en negrita en una etiqueta*, *ver un apósito azul* pide **foto**. Encaja con "foto propia del cliente" (C3-A, ya construido).

### 🟡 1.6 Nada sobre reparto
Llorente29 es fundamentalmente delivery y **no hay un solo curso de su operación real**: temperatura en mochila, tiempos, precintos, incidencias.

---

## 2. VERIFICACIÓN PRÁCTICA EN EL PUESTO

**Decisión de Julio**: un **check por curso** que activa o no la parte práctica. No todos los cursos la necesitan (RGPD no) y no todos los clientes pueden hacerla.

### Cómo funciona
- `course.requires_practical` (bool). Si está activo, el curso **no se da por superado con el test**: queda en estado *"pendiente de verificación práctica"*.
- El curso define una **lista de gestos observables** (`course_practical_item`): 3-5 acciones concretas y verificables.
- Un **responsable** (jefe de cocina, encargado) observa al trabajador haciéndolas y las marca. **Firma él también**, con su identidad autenticada.
- El acta recoge las dos firmas: la del trabajador (comprendió) y la del verificador (lo vi hacer).

### Ejemplos de gestos
| Curso | Gestos a verificar |
|---|---|
| Manipulador | Lavado completo de manos · Tomar temperatura en el centro con sonda · Colocar la cámara correctamente · Etiquetar un producto trasvasado |
| Alérgenos | Preparar una comanda con alergia (superficie + utillaje limpio) · Consultar la ficha ante una duda · Transportar el plato aparte |
| APPCC | Rellenar un registro de temperatura correctamente · Actuar ante una desviación |
| Primeros auxilios | *(no aplica: la práctica la certifica la entidad externa)* |

### Por qué es la pieza más fuerte del módulo
- Es lo único que ataca de raíz el "aprueba pero no cambia la conducta".
- Convierte el acta en un documento **mucho más defendible**: no dice "hizo un test", dice "se verificó en el puesto que sabe hacerlo, y quién lo verificó".
- **Ningún competidor lo tiene.** Flow, TalentLMS, Typsy son LMS: no están en la cocina. Folvy sí.
- Reutiliza el patrón de firma de C1 (`course_signature` con `auth_uid`).

### Modelo de datos
- `course.requires_practical bool default false`
- `course_practical_item (course_id, ord, text, help_text)`
- `course_practical_check (attempt_id, item_id, checked bool, verified_by, verified_at, notes)`
- El estado *vigente* en `training_compliance_matrix` pasa a exigir: test aprobado **+ firma** **+ (si aplica) verificación práctica completa**.

---

## 3. RUTAS POR PUESTO Y DURACIÓN

**Problema**: cursos de 25-30 min iguales para todos. En hostelería nadie tiene 30 minutos seguidos.

**Solución en dos capas:**

**(a) Secciones marcadas por rol.** `course_section.roles text[]` (cocina, sala, reparto, mando, todos). El trabajador ve solo lo suyo. Un friegaplatos hace 4 secciones del manipulador; un jefe de cocina, las 6 más la de trazabilidad.

**(b) Píldoras.** Cursos de **5 minutos, una sola idea**, para refuerzo periódico. No sustituyen al curso completo: lo mantienen vivo durante el año. Ejemplos: *"Los 3 errores de la cámara"*, *"Cuándo se tira un plato"*, *"El apio se esconde en los caldos"*.

**Regla de duración**: curso obligatorio ≤ 25 min · curso de producto ≤ 10 min · píldora ≤ 5 min. Si se pasa, se parte.

---

## 4. ADAPTACIÓN: IDIOMA (máxima prioridad de retorno)

Es el punto con mejor relación esfuerzo/resultado de todo el documento (+45% de retención según la evidencia).

- `course_section_translation (section_id, lang, title, body)` y equivalente para preguntas/opciones.
- Idiomas prioritarios para hostelería en España: **castellano · inglés · árabe · rumano · urdu · chino · francés**. A validar con la plantilla real de cada cliente.
- El trabajador elige idioma en su portal; el acta se emite **en castellano** (documento legal) indicando en qué idioma se impartió.
- Traducción asistida por IA + revisión humana. Nunca publicar traducción sin revisar: es contenido legal.

**Frente propio, no se cuela en otro tramo.**

---

## 5. IMÁGENES: segunda tanda

**Criterio (de la guía §4, vigente):** esquema para lo invisible · foto para reconocer o ejecutar · foto propia del cliente para máxima transferencia.

**Pendientes de producir:**

| Curso | Recurso | Tipo |
|---|---|---|
| Igualdad y acoso | Circuito del protocolo: comunicación → confidencialidad → cautelares → investigación → resolución → seguimiento | Esquema |
| RGPD | Los derechos ARCO-POL en una vista | Esquema |
| RGPD | Dónde SÍ y dónde NO puede haber cámara | Esquema |
| Canal de denuncias | Flujo: qué sí / qué no entra + plazos (7 días / 3 meses) | Esquema |
| LGTBI | Orientación · identidad · expresión · características: las 4 dimensiones | Esquema |
| APPCC | Los 5 PCC de una cocina con su límite | Esquema |
| Manipulador | Fotos de reconocimiento: apósito azul, etiqueta con alérgeno destacado, envase hinchado | **Foto** |
| Reparto | Montaje correcto de la mochila (frío arriba/abajo, bebidas) | Esquema + foto |

---

## 6. CATÁLOGO v2 — todos los cursos

### Bloque A · Cumplimiento legal (HECHO, 9 cursos)
Alérgenos ✅ · Manipulador ✅ · APPCC ✅ · Igualdad y acoso ✅ · LGTBI ✅ · RGPD ✅ · Canal de denuncias ✅ · Primeros auxilios ✅ · PRL (archivo) ✅

### Bloque B · Operación de cocina (alta prioridad — aquí se pierde dinero a diario)
| Curso | Por qué importa |
|---|---|
| **Mermas y aprovechamiento** | La merma es margen. Engancha directo con el escandallo. |
| **Usar el escandallo y las fichas técnicas** | Que el cocinero entienda por qué la báscula importa. **Nadie forma en esto** y es la raíz de que los costes no cuadren. |
| **Inventario y conteo** | Si se cuenta de memoria, el AvT miente. |
| **Recepción de pedidos** | Qué se rechaza y por qué. El módulo ya existe; falta que sepan usarlo. |
| **Conservación, etiquetado y vida útil** | Regeneración, vacío, fechas. |
| **Limpieza a fondo y cierre de cocina** | El checklist de cierre, explicado. |

### Bloque C · Delivery (la operación real de Llorente29, hoy sin cubrir)
| Curso | Por qué importa |
|---|---|
| **Embolsado y montaje del pedido** | Origen del ~80% de las reclamaciones. |
| **Temperatura en ruta y mochila** | La cadena de frío/calor que nadie vigila. |
| **Incidencias: pedido tarde, producto agotado, cliente enfadado** | Guion de actuación. |
| **Usar el KDS y la estación** | Formación de las propias herramientas de Folvy. |

### Bloque D · Sala y cliente
Atención al cliente y quejas · Venta sugerida (upselling) · Cobro, TPV y arqueo · Servicio de bebidas y ley del alcohol · Reservas y gestión de mesas.

### Bloque E · Equipo y mandos
| Curso | Por qué importa |
|---|---|
| **Onboarding: tu primer día** | **El más rentable de todos.** Reduce el coste de rotación desde la primera semana. |
| Cómo dar un pase | El cuello de botella de todo servicio. |
| Liderazgo de turno | Para mandos intermedios. |
| Cuadrante, fichaje y tus derechos | Reduce conflictos y consultas repetidas. |

### Bloque F · Sostenibilidad y normativa emergente
Residuos y reciclaje · Ahorro energético en cocina · **Ley 1/2025 de desperdicio alimentario**.

**Prioridad de producción sugerida:** Bloque C (delivery) → Bloque B (cocina) → Onboarding del bloque E → resto.

---

## 7. CURSOS DEL CLIENTE — lo que da entidad propia al módulo

**Principio**: Folvy no escribe los cursos de producto de cada cliente. Folvy hace que el cliente pueda crearlos **en minutos, no en días**.

### Nivel 1 — Generar curso desde el escandallo 🎯
Un botón en la ficha del plato: **"Crear curso de este plato"**.

Los pasos ya están (`recipe_item_step_line`), las cantidades ya están, la foto ya está. Sale un borrador de curso con:
- Sección por paso de la receta, con sus ingredientes y cantidades.
- Alérgenos del plato (ya calculados por el motor de herencia).
- Test generado: orden de los pasos, cantidades clave, alérgenos.
- **Prueba práctica: hacer el plato y subir la foto** → el jefe valida.

**Esta es la jugada.** Ningún LMS puede hacerlo porque ninguno tiene el escandallo dentro. Es la misma victoria estructural que la matriz de alérgenos: ganas porque los módulos están conectados.

### Nivel 2 — Curso desde cero con IA
El jefe de cocina escribe cuatro frases ("cómo montamos el pedido de Glovo") y la IA devuelve secciones y test **para revisar**. Contrato B3 de Folvy: *la IA propone, el humano decide*. Nunca se publica sin aprobación.

### Nivel 3 — Grabar y convertir
El encargado graba 2 minutos explicando algo en cocina → transcripción → borrador de curso. La forma más natural de capturar el conocimiento que hoy solo está en la cabeza del que lleva 10 años.

### Modelo de negocio que abre
- **Cursos legales de Folvy** — globales, mantenidos y actualizados por Folvy cuando cambia la ley. *Valor recurrente claro.*
- **Cursos de producto del cliente** — suyos, privados, de su cuenta.
- **Marketplace entre clientes** (futuro) — un grupo puede publicar su curso para otros. Zona a estudiar.

Con esto Folvy deja de competir con un LMS: **es la capa de conocimiento de la operación**.

---

## 8. CURSOS DE PRODUCTO — por qué son otra cosa

| | Cumplimiento (Bloque A) | Producto (smash, milanesa…) |
|---|---|---|
| Objetivo | Que nadie enferme | Que el plato salga **igual siempre** |
| Contenido | Genérico, legal, global | **Del cliente**, específico de su receta |
| Prueba | Test + firma | **Foto del plato hecho** + validación del jefe |
| Caduca | Sí, por ley | No, pero se actualiza con la carta |
| Quién lo escribe | Folvy | El cliente (asistido) |
| Duración | 20-25 min | **≤ 10 min** |

**Los que priorizaría** (por volumen y por dónde falla la consistencia): smash burger (punto, prensado, tiempos) · milanesa (empanado y fritura) · montaje y embolsado para delivery · el pase completo de un combo.

---

## 9. ORDEN DE EJECUCIÓN PROPUESTO

1. **Verificación práctica** (§2) — el fallo estructural, y el mayor diferenciador. Requiere modelo de datos nuevo.
2. **Generar curso desde el escandallo** (§7 nivel 1) — la jugada que nadie puede copiar.
3. **Bloque C · Delivery** (4 cursos) — la operación real de Llorente29, hoy a cero.
4. **Segunda tanda de imágenes** (§5) — cierra la deuda visual del bloque legal.
5. **Rutas por puesto y píldoras** (§3).
6. **Bloque B · Cocina** (6 cursos).
7. **Multiidioma** (§4) — frente propio, máximo retorno en retención.
8. **Onboarding + resto de bloques.**

---

## 10. DEUDAS ABIERTAS DEL MÓDULO

- **UI de `solo_archivo`**: PRL no debe ofrecer botón de "hacer curso"; debe decir *"lo imparte tu servicio de prevención — súbelo aquí"*. Por eso sigue en `draft`.
- **7 cursos en `draft`** pendientes de revisión de Julio. El bloque legal-laboral, además, de asesor laboral.
- **Manipulador quedó `published`** al probarlo en el móvil, sin revisión completa.
- **Reevaluación (C4) y círculo APPCC (C5)** siguen sin construir.
- **Cabecera de columna truncada** en la matriz de cumplimiento (cosmético, se notará con 9 cursos).

---

_Auditoría y diseño realizados el 03/08/2026 en el frente de Formación. Complementa `folvy_formacion_diseno.md` y `folvy_formacion_guia_contenido.md`._
