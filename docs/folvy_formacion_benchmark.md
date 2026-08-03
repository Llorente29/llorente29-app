# Folvy — Módulo de Formación · BENCHMARK y mapa competitivo

> **Frente**: Módulo de Formación (compartido Team ↔ Safety/APPCC, pago extra).
> **Disparador**: en inspección sanitaria pidieron formación específica del personal en alérgenos — 3ª pata del cumplimiento junto a la matriz de alérgenos y las fichas técnicas.
> **Alcance decidido (Julio)**: Folvy **imparte** los cursos internos **y** archiva los certificados externos.
> **RECON previo**: existe `employee_formations` (baseline, versionada) + `FormacionesTab.tsx` = registro manual de certificados externos con caducidad. El sistema de **cursos internos con evidencia firmada** está entero por construir.

---

## 1. La vara del mercado (estándar de cumplimiento)

Los líderes de compliance-LMS (360Learning, TalentLMS, iSpring, Trainual, Absorb, Docebo) convergen en un set de features que hay que igualar para no vender empate:

- **Recertificación automática**: ciclos por curso configurables + alertas de re-inscripción antes de que caduque un certificado.
- **Tracking de certificaciones auditable**: registro central de activas/caducadas con seguimiento automático de fechas.
- **Reporting audit-ready**: informes de estado de completado, puntuación de test y tiempo por empleado/curso; exportaciones con sello de tiempo para inspección.
- **Versionado de contenido**: historial de revisiones del material (cuando cambia una política, se edita y se re-firma, no se reconstruye).
- **Asignación por rol/ubicación/departamento** + acuse de recibo de políticas (patrón Trainual).
- **Autoría propia** (crear tus cursos) + librería de contenido lista.
- **Móvil, incluso offline**; dashboards de "quién va tarde" + recordatorios automáticos.

**Precio de referencia**: por asiento y transparente en el mid-market (TalentLMS desde ~69 $/mes, gratis hasta 5 usuarios; iSpring ~2,29 $/usuario/mes a 100 usuarios). Enterprise (Absorb, Docebo, LearnUpon, SAP Litmos) por presupuesto.

## 2. El líder en hostelería — Flow Learning (Mapal OS)

Es el espejo directo de Folvy:

- 50+ módulos de hostelería, gestión de cumplimiento, calendario de aprendizaje, creador de contenido (authoring), workbook, gestión de competencias, itinerarios de carrera, appraisals.
- App móvil para el empleado (aprender sobre la marcha), gamificación, vídeo/audio, y secciones para **almacenar certificados**.
- Módulos de compliance: seguridad alimentaria, PRL/fire, protección de datos, diversidad/igualdad, acoso, licencias de alcohol.

**Debilidad estructural**: Mapal OS lo vende como **módulos separados** — su food-safety checklist (su "APPCC"), su workforce, su analytics y su LMS son productos distintos que se integran, pero **no cierran el círculo** entre auditoría de higiene, formación y evidencia. Ese hueco es de Folvy.

## 3. El desbloqueo legal español (RD 109/2010) — clave del alcance

Régimen del manipulador de alimentos en España, verificado (fuentes: Comunidad de Madrid, AESAN, análisis jurídicos):

- El **RD 109/2010 eliminó el carnet oficial** y la autorización administrativa previa de centros. Desde 2011 **AESAN no homologa** entidades ni certificados.
- **La responsabilidad de la formación recae en la empresa alimentaria**, que puede **impartirla ella misma**. Reg. (CE) 852/2004, Cap. XII: formación adecuada al puesto.
- Los **certificados emitidos por la propia empresa son documentos privados** válidos; su validez/caducidad la determina la empresa. **No hay modelo oficial**, pero el certificado debe **especificar los contenidos impartidos y estar firmado por el responsable de la formación**.
- **No hay caducidad legal fija**, pero el estándar de facto de inspectores y manuales APPCC es **~4 años**.
- La empresa debe **poder demostrar en inspección** que todo el personal en contacto con alimentos está formado, y **conservar la documentación**.

**Implicación de producto**: Folvy no solo archiva el carnet — **puede impartir la formación de manipulador (y las demás obligatorias) como curso interno y emitir el certificado legalmente válido** (contenidos + firma identificada). Sustituye al curso externo de ~12 € y cubre "los muchos carnets de manipulador" que faltan.

## 4. Dónde golea Folvy (tesis de diseño)

1. **Círculo cerrado que nadie tiene**: la formación vive en el MISMO sistema que el APPCC (prerrequisito), la identidad/cuadrante del empleado (Team) y la matriz de alérgenos. Una **auditoría APPCC fallida dispara la reevaluación** del personal implicado (reutiliza el mecanismo de acciones correctivas ya existente). Flow/Mapal lo vende en módulos sueltos; los LMS generalistas no tienen APPCC.
2. **Evidencia firmada e identificada**: magic-link personal + firma con el dedo + DNI + sello de tiempo = exactamente el artefacto "firmado por el responsable/asistente" que exige el RD. Más fuerte que el "login + completion" de los genéricos y superior al registro en papel.
3. **Sin peaje por asiento de contenido**: los cursos obligatorios españoles (empezando por el de alérgenos ya redactado + manipulador) se entregan dentro del módulo; los rivales cobran por librería.
4. **Nativo de la ley española**: contenidos y acta pensados para el marco ES (RD 109/2010, Reg. 852/2004, Reg. UE 1169/2011 de alérgenos), no traducidos de otro mercado.
5. **Compartido Team ↔ Safety**: oficina en Team (crear cursos, ver quién ha hecho qué, quién va tarde, disparar reevaluaciones); prerrequisito y evidencia en Safety/APPCC.

## 5. Veredicto — la vara a batir, explícita

**Igualar** a Flow/Mapal + 360Learning en: recertificación automática, reportes audit-ready con sello de tiempo, autoría de cursos, móvil, y tracking de certificados internos + externos.

**Golear** en: círculo cerrado APPCC (fallo → formación → evidencia), evidencia firmada e identificada, datos de empleado integrados (sin doble alta), cursos nativos de la ley española, y precio sin peaje de librería.

**No vender empate**: si alguna de las de "igualar" queda a medias, se declara deuda explícita con disparador.

---

## Fuentes

- Mapal OS / Flow Learning (features, módulos, pricing): mapal-os.com/en/solutions/flow-learning y subpáginas; exploretech.io/en/product/mapal-os-flow-learning
- Compliance-LMS (recertificación, tracking, audit reporting, pricing): 360learning.com/use-cases/compliance-training; talentlms.com/blog/employee-training-tracking-software; valamis.com/blog/best-compliance-training-software; trainual.com/manual/top-compliance-training-platforms-2026; recruiterslineup.com/best-lms-for-compliance-training
- RD 109/2010 y régimen del manipulador (ES): comunidad.madrid/servicios/salud/manipuladores-alimentos; manipulador-alimentos.net/aesan-organismos-reguladores-manipulador-alimentos; qualitatis.es/caducidad-carnet-manipulador-de-alimentos; legalitas.com/actualidad/ley-manipulacion-alimentos; alimentiaformacion.com/blog/es-obligatorio-carnet-manipulador-alimentos

_Generado en el frente de Formación. Al cerrar, enlazar desde `folvy_competitive_map.md` (sección Team/Formación) y `folvy_indice.md`._
