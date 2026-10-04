# Pruebas de cumplimiento normativo del módulo de contabilidad

Esta carpeta va a reunir la batería de pruebas que garantiza que Folvy cumple
el **Plan General de Contabilidad** (RD 1514/2007 y, para pymes, RD 1515/2007)
y la normativa fiscal y tributaria española (IVA, IRPF, facturación,
modelos). Empieza en serio en el **C02 (plan contable)**. En el C01 sólo se
deja preparado el sitio.

## Qué es una prueba de cumplimiento (y qué no)

Una prueba unitaria comprueba que el código hace lo que su autor quería.
Una prueba de cumplimiento comprueba que **lo que el código hace es lo que
dice la norma**. Por eso cada caso tiene que poder rastrearse hasta su fuente:
quien la lea, sin conocer el código, tiene que poder ir a la norma y
comprobar que el caso está bien.

## Cómo se añade un caso

1. **Un fichero por norma o por regla**, con su nombre:
   `pgc_cuadro_de_cuentas.test.ts`, `iva_tipos_vigentes.test.ts`,
   `irpf_retenciones_profesionales.test.ts`…
2. **Cada caso lleva su origen escrito al lado.** La disposición exacta
   (norma, artículo, apartado, BOE y fecha), o el documento oficial (manual
   de la AEAT, FAQ de VIES, norma ISO) con su versión. Si el caso se ha
   calculado a mano, se escribe la cuenta para que cualquiera la repita.
3. **Los casos no salen de la cabeza de quien escribió el código.** Salen de
   la norma, de ejemplos oficiales o de la población real (regla 31 de
   CLAUDE.md). Un caso inventado que confirma el código es un espejo.
4. **Cuando cambia una norma**, el caso viejo no se borra: se marca con su
   vigencia (desde/hasta) y se añade el nuevo. Un ejercicio pasado se sigue
   contabilizando con la norma que estaba en vigor.
5. Las funciones que se prueban aquí son **funciones puras** del núcleo
   (`src/modules/conta/lib/`). Nada de base de datos ni de pantallas.

## Lo que ya existe (C01), fuera de esta carpeta

Las validaciones del núcleo del C01 llevan ya sus casos documentados con
origen en `tests/unit/modules/conta/`:

| Regla | Fichero | Origen |
|---|---|---|
| NIF, NIE y CIF | `nif.test.ts` | Orden INT/2058/2008 (letra del NIF y NIE); Orden EHA/451/2008, art. 3 (NIF de persona jurídica) |
| IBAN | `iban.test.ts` | ISO 13616-1 (módulo 97) y registro SWIFT de IBAN |
| NIF-IVA europeo (forma) | `vatEu.test.ts` | Comisión Europea, FAQ de VIES (estructura por Estado miembro) |

Cuando arranque el C02 se decidirá si se mueven aquí o se quedan donde están
y esta carpeta las referencia.
