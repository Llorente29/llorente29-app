# C00 · La ficha de la empresa frente al modelo 200 y el depósito de cuentas

> Respuesta 3 de Julio, punto 5 (03/10/2026). Lo que piden el **modelo 200** y el **depósito de cuentas anuales** en el Registro Mercantil tiene que estar ya en la ficha de la empresa, no pedirse el día de presentar.

## Contra qué se ha cruzado, y lo que NO se ha podido cotejar

- **Modelo 200 · página 1.** Los datos identificativos: identificación, ejercicio, forma jurídica, CNAE, personal medio, representantes, socios con un 5 % o más, grupo y entidad dominante, auditoría y caracteres de la declaración.
  - La orden que lo aprueba cada año trae el modelo como **anexo en PDF**. La base consolidada del BOE (lo que descarga `fuentes.mjs`) trae el texto articulado, no el anexo. Además, la única orden del 200 que está en esa base es la **HAC/565/2020**, la del ejercicio 2019.
  - **El cruce está hecho sobre la estructura publicada de la página 1, no cotejado casilla a casilla con el anexo oficial.** Pendiente: descargar el PDF del anexo de la orden del ejercicio vigente desde Actions y cotejar. Por eso aquí se dicen **apartados**, no números de casilla.
- **Depósito de cuentas · hoja de datos generales de identificación.** La de los modelos de cuentas anuales del Ministerio de Justicia: identificación, datos registrales, domicilio, contacto, actividad, plantilla media, ejercicio y firmantes.
  - Tampoco está entre las fuentes descargadas: no hay fuente `orden-jus-*` en `fuentes.json`. **Pendiente:** añadir la orden JUS vigente de los modelos de depósito y cotejar.

Lo que falta para presentar lo enseña «Tu empresa › Para presentar el 200 y depositar las cuentas» (`src/modules/conta/lib/presentar.ts`). El agente nocturno lo avisa en ámbar a toda sociedad a la que ya le toca, es decir, con un ejercicio cerrado o con el 200 entre sus modelos (`scripts/conta/lib/coherencia.mjs`). Las dos listas son la misma: `tests/conta/cumplimiento/presentar.test.ts` lo comprueba en las 16.384 combinaciones.

## Campo a campo

| Lo que se pide | 200 | Depósito | Dónde vive en Folvy | Estado |
|---|:-:|:-:|---|---|
| NIF | ✓ | ✓ | `company.tax_id` | Ya estaba |
| Razón social | ✓ | ✓ | `company.legal_name` | Ya estaba |
| Forma jurídica | ✓ | ✓ | `company.legal_form_code` → `legal_form` | Ya estaba |
| Domicilio fiscal / social | ✓ | ✓ | `company.fiscal_*` | Ya estaba |
| Fecha de constitución | ✓ | ✓ | `company.incorporated_on` | **Añadido (0200)** |
| Registro Mercantil: registro, tomo, folio, hoja, inscripción | | ✓ | `company.registry_name`, `registry_volume`, `registry_folio`, `registry_sheet`, `registry_entry` | Las columnas estaban; **la pantalla solo enseñaba registro y hoja: añadidos tomo, folio e inscripción** |
| Teléfono y correo de la empresa | | ✓ | `company.phone`, `company.email` | Las columnas estaban sin pantalla: **añadidas a «Quién eres»** |
| Correo y teléfono de avisos de notificaciones (DEHú) | | | `company.dehu_email`, `company.dehu_phone` | **Añadido (0200)**. No es casilla de ninguno de los dos: lo pidió Julio para las notificaciones |
| Actividad principal (CNAE) | ✓ | ✓ | `company_activity.cnae_code` de la principal (`is_main`) | Ya estaba |
| Ejercicio: inicio y fin | ✓ | ✓ | `fiscal_year.starts_on`, `ends_on` | Ya estaba |
| Personal asalariado medio, fijo y no fijo | ✓ | ✓ | `fiscal_year.average_staff_fixed`, `average_staff_temporary` | **Añadido (0200)**, por ejercicio |
| Auditoría: si está auditada, auditor y opinión | ✓ | ✓ | `fiscal_year.is_audited`, `auditor_name`, `auditor_tax_id`, `audit_opinion` | **Añadido (0200)**, por ejercicio |
| Representantes legales, con NIF y cargo | ✓ | | `company_person` (`roles`: administrador, representante, presidente) + `tax_id` | Ya estaba |
| Socios con un 5 % o más, con NIF y porcentaje | ✓ | | `company_person.ownership_pct` + `tax_id` | Ya estaba |
| Grupo y entidad dominante | ✓ | ✓ | `company_relation` de tipo `group` con `related_is_parent` | La tabla estaba sin pantalla; **añadido `related_is_parent` (0200) y la dominante en «Quién eres»** |
| Firmantes de las cuentas | | ✓ | `company_person.signs_accounts` | **Añadido (0200)**; «Firma las cuentas anuales» en cada persona |
| Certificado digital | | | **No va en la ficha.** «Certificados y accesos», cifrado, con quién puede usarlo y aviso de caducidad | Hueco visible en «Quién eres»: «Aún no · irá en «Certificados y accesos»». **Pendiente del encargo de impuestos** |

## Lo que salió de la lectura y no estaba en la lista de la respuesta: pendiente, sin decidir

Va al PR #138 como pendiente; no se ha añadido nada de esto.

1. **Código LEI.** La hoja de identificación del depósito lo pide a las sociedades que lo tienen.
2. **Caracteres de la declaración del 200**: entidad de reducida dimensión, régimen especial, cooperativa, ZEC, grupo fiscal… Son del **ejercicio y del impuesto**, no de la ficha: encajan en el encargo de impuestos.
3. **Participaciones de la empresa en otras entidades.** El 200 las pide aparte de los socios que tiene la empresa.
4. **Unidades y moneda de las cuentas** (euros o miles de euros), en la hoja del depósito.
5. **El desglose de la plantilla por sexo** que piden algunos modelos de depósito. Aquí se ha guardado fija y no fija; el desglose por sexo está por confirmar con la orden JUS vigente.
6. **El cotejo casilla a casilla** con los anexos oficiales del 200 y del depósito (ver arriba).
