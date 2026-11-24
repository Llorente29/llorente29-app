// supabase/functions/conta-gocardless-leer/casado.ts
//
// G01 · Tarea 2 (06/11/2026). El casado cliente a cliente entre Bitrix24 (la
// ficha) y cada cuenta de GoCardless (una por emisor):
//
//   · primero por NIF y, si no casa, por correo;
//   · el EMISOR del cliente lo dice la cuenta de GoCardless en la que está;
//     «Forma de pago» de Bitrix24 es solo referencia: si dice otro emisor,
//     sale como diferencia;
//   · un mismo cliente puede estar en las dos cuentas (paga a los dos).
//
// Lo que no casa NO se esconde: sale como diferencia, con su porqué
// (regla 7). Puro: lo prueban las unitarias
// (tests/unit/modules/conta/gestoria/casado.test.ts).
//
// G06 · Tarea 3 (12/11). Lo que no casa solo, con cobro vivo, sale además como
// PROPUESTA, nunca atado solo (encargo G06): por el correo, si está en varias
// fichas; por el NOMBRE normalizado (sin tildes ni signos, palabras en orden),
// si coincide con una o varias fichas. Cada propuesta dice por qué y con qué
// fichas; la confirma una persona con un clic (conta_gc_enlace_confirmar).

/** Lo que el casado necesita de una ficha de Bitrix24 (la de conta-bitrix-leer/mapa.ts lo cumple). */
export interface FichaParaCasar {
  claveFicha: string
  nombre: string
  nif: string | null
  correos: string[]
  situacion: 'activo' | 'baja' | 'moroso' | 'solo_renta' | 'sin_clasificar' | null
  formaPago: string | null
  emisorSegunCrm: string | null
}

/** Un cliente de una cuenta de GoCardless, con lo que tiene vivo. */
export interface ClienteParaCasar {
  emisor: string
  id: string
  nombre: string
  nif: string | null
  correo: string | null
  mandatosVivos: number
  suscripcionesActivas: number
}

export interface Pareja {
  claveFicha: string
  emisor: string
  clienteGcId: string
  por: 'nif' | 'correo'
}

/** Una pareja que no se ata sola: la confirma una persona. */
export interface Propuesta {
  emisor: string
  clienteGcId: string
  por: 'correo' | 'nombre'
  claveFichas: string[]
  porque: string
}

/** El nombre para comparar: minúsculas, sin tildes ni signos, las palabras en orden alfabético. */
export function normalizarNombre(nombre: string | null | undefined): string {
  return (nombre ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(Boolean).sort().join(' ')
}

export type TipoDiferencia =
  | 'crm_sin_cobro'
  | 'gocardless_sin_ficha'
  | 'emisor_distinto'
  | 'nif_repetido_en_crm'
  | 'correo_repetido_en_crm'
  | 'nif_distinto'

export interface Diferencia {
  tipo: TipoDiferencia
  claveFicha: string | null
  emisor: string | null
  clienteGcId: string | null
  porque: string
}

/**
 * Una ficha que se cobra: solo la activa (Julio, G01b, 07/11: lo que no sea
 * activo, también la morosa y la «sin clasificar», no cuenta para «Activos en
 * Bitrix24 sin cobro»).
 */
export const SE_COBRA: readonly string[] = ['activo']

export function casar(
  fichas: FichaParaCasar[],
  clientes: ClienteParaCasar[],
  nombreEmisor: (emisor: string) => string,
): { parejas: Pareja[]; diferencias: Diferencia[]; propuestas: Propuesta[] } {
  const parejas: Pareja[] = []
  const diferencias: Diferencia[] = []
  const propuestas: Propuesta[] = []

  const porNif = new Map<string, FichaParaCasar[]>()
  const porCorreo = new Map<string, FichaParaCasar[]>()
  const porNombre = new Map<string, FichaParaCasar[]>()
  const vivo = (c: ClienteParaCasar) => c.mandatosVivos > 0 || c.suscripcionesActivas > 0
  const nombres = (v: FichaParaCasar[]) => v.map((x) => `«${x.nombre}»`).join(', ')
  for (const f of fichas) {
    if (f.nif) porNif.set(f.nif, [...(porNif.get(f.nif) ?? []), f])
    for (const c of f.correos) porCorreo.set(c, [...(porCorreo.get(c) ?? []), f])
    const n = normalizarNombre(f.nombre)
    if (n) porNombre.set(n, [...(porNombre.get(n) ?? []), f])
  }
  const avisadoNif = new Set<string>()
  const avisadoCorreo = new Set<string>()
  const casadas = new Set<string>()

  for (const c of clientes) {
    let ficha: FichaParaCasar | null = null
    let por: Pareja['por'] | null = null
    if (c.nif) {
      const v = porNif.get(c.nif) ?? []
      if (v.length === 1) { ficha = v[0]; por = 'nif' }
      else if (v.length > 1) {
        if (!avisadoNif.has(c.nif)) {
          avisadoNif.add(c.nif)
          diferencias.push({ tipo: 'nif_repetido_en_crm', claveFicha: null, emisor: c.emisor, clienteGcId: c.id,
            porque: `El NIF ${c.nif} está en ${v.length} fichas de Bitrix24 (${v.map((x) => x.nombre).join(', ')}): no se sabe cuál es.` })
        }
        continue
      }
    }
    if (!ficha && c.correo) {
      const v = porCorreo.get(c.correo) ?? []
      if (v.length === 1) { ficha = v[0]; por = 'correo' }
      else if (v.length > 1) {
        if (!avisadoCorreo.has(c.correo)) {
          avisadoCorreo.add(c.correo)
          diferencias.push({ tipo: 'correo_repetido_en_crm', claveFicha: null, emisor: c.emisor, clienteGcId: c.id,
            porque: `El correo ${c.correo} está en ${v.length} fichas de Bitrix24: no se sabe cuál es.` })
        }
        if (vivo(c)) {
          propuestas.push({ emisor: c.emisor, clienteGcId: c.id, por: 'correo', claveFichas: v.map((x) => x.claveFicha),
            porque: `Su correo ${c.correo} está en ${v.length} fichas de Bitrix24 (${nombres(v)}): ¿cuál es?` })
        }
        continue
      }
    }
    if (!ficha || !por) {
      const mismos = porNombre.get(normalizarNombre(c.nombre)) ?? []
      if (vivo(c) && mismos.length) {
        propuestas.push({ emisor: c.emisor, clienteGcId: c.id, por: 'nombre', claveFichas: mismos.map((x) => x.claveFicha),
          porque: mismos.length === 1
            ? `Se llama igual que la ficha ${nombres(mismos)} de Bitrix24, sin NIF ni correo que lo confirme: ¿es esta?`
            : `Se llama igual que ${mismos.length} fichas de Bitrix24 (${nombres(mismos)}): ¿cuál es?` })
      }
      if (vivo(c)) {
        diferencias.push({ tipo: 'gocardless_sin_ficha', claveFicha: null, emisor: c.emisor, clienteGcId: c.id,
          porque: `«${c.nombre}» está en GoCardless de ${nombreEmisor(c.emisor)} y no tiene ficha en Bitrix24 con su NIF${c.correo ? ' ni con su correo' : ''}.` })
      }
      continue
    }
    parejas.push({ claveFicha: ficha.claveFicha, emisor: c.emisor, clienteGcId: c.id, por })
    casadas.add(ficha.claveFicha)
    if (por === 'correo' && c.nif && ficha.nif && c.nif !== ficha.nif) {
      diferencias.push({ tipo: 'nif_distinto', claveFicha: ficha.claveFicha, emisor: c.emisor, clienteGcId: c.id,
        porque: `Casado por el correo: Bitrix24 dice NIF ${ficha.nif} y GoCardless ${c.nif}.` })
    }
    if (ficha.emisorSegunCrm && ficha.emisorSegunCrm !== c.emisor && c.suscripcionesActivas > 0) {
      diferencias.push({ tipo: 'emisor_distinto', claveFicha: ficha.claveFicha, emisor: c.emisor, clienteGcId: c.id,
        porque: `Bitrix24 dice que paga a ${nombreEmisor(ficha.emisorSegunCrm)} («${ficha.formaPago}») y GoCardless le cobra desde ${nombreEmisor(c.emisor)}.` })
    }
  }

  // Las fichas que se cobran y no tienen nada vivo en ninguna cuenta.
  const conCobro = new Set(parejas.filter((p) => {
    const c = clientes.find((x) => x.id === p.clienteGcId && x.emisor === p.emisor)
    return c ? c.suscripcionesActivas > 0 : false
  }).map((p) => p.claveFicha))
  for (const f of fichas) {
    if (!f.situacion || !SE_COBRA.includes(f.situacion) || conCobro.has(f.claveFicha)) continue
    diferencias.push({ tipo: 'crm_sin_cobro', claveFicha: f.claveFicha, emisor: f.emisorSegunCrm, clienteGcId: null,
      porque: casadas.has(f.claveFicha)
        ? `«${f.nombre}» está activo en Bitrix24 y está en GoCardless, pero sin ningún cobro mensual.`
        : `«${f.nombre}» está activo en Bitrix24 y no está en GoCardless (ni por NIF ni por correo).` })
  }
  return { parejas, diferencias, propuestas }
}
