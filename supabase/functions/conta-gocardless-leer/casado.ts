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

/** Lo que el casado necesita de una ficha de Bitrix24 (la de conta-bitrix-leer/mapa.ts lo cumple). */
export interface FichaParaCasar {
  bitrixId: string
  nombre: string
  nif: string | null
  correos: string[]
  situacion: 'activo' | 'baja' | 'moroso' | 'solo_renta' | null
  formaPago: string | null
  emisorSegunBitrix: string | null
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
  bitrixId: string
  emisor: string
  clienteGcId: string
  por: 'nif' | 'correo'
}

export type TipoDiferencia =
  | 'bitrix_sin_cobro'
  | 'gocardless_sin_ficha'
  | 'emisor_distinto'
  | 'nif_repetido_en_bitrix'
  | 'correo_repetido_en_bitrix'
  | 'nif_distinto'

export interface Diferencia {
  tipo: TipoDiferencia
  bitrixId: string | null
  emisor: string | null
  clienteGcId: string | null
  porque: string
}

/** Una ficha que se cobra: activa o morosa. Las de baja y «solo renta» no esperan cobro mensual. */
export const SE_COBRA: readonly string[] = ['activo', 'moroso']

export function casar(
  fichas: FichaParaCasar[],
  clientes: ClienteParaCasar[],
  nombreEmisor: (emisor: string) => string,
): { parejas: Pareja[]; diferencias: Diferencia[] } {
  const parejas: Pareja[] = []
  const diferencias: Diferencia[] = []

  const porNif = new Map<string, FichaParaCasar[]>()
  const porCorreo = new Map<string, FichaParaCasar[]>()
  for (const f of fichas) {
    if (f.nif) porNif.set(f.nif, [...(porNif.get(f.nif) ?? []), f])
    for (const c of f.correos) porCorreo.set(c, [...(porCorreo.get(c) ?? []), f])
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
          diferencias.push({ tipo: 'nif_repetido_en_bitrix', bitrixId: null, emisor: c.emisor, clienteGcId: c.id,
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
          diferencias.push({ tipo: 'correo_repetido_en_bitrix', bitrixId: null, emisor: c.emisor, clienteGcId: c.id,
            porque: `El correo ${c.correo} está en ${v.length} fichas de Bitrix24: no se sabe cuál es.` })
        }
        continue
      }
    }
    if (!ficha || !por) {
      if (c.mandatosVivos > 0 || c.suscripcionesActivas > 0) {
        diferencias.push({ tipo: 'gocardless_sin_ficha', bitrixId: null, emisor: c.emisor, clienteGcId: c.id,
          porque: `«${c.nombre}» está en GoCardless de ${nombreEmisor(c.emisor)} y no tiene ficha en Bitrix24 con su NIF${c.correo ? ' ni con su correo' : ''}.` })
      }
      continue
    }
    parejas.push({ bitrixId: ficha.bitrixId, emisor: c.emisor, clienteGcId: c.id, por })
    casadas.add(ficha.bitrixId)
    if (por === 'correo' && c.nif && ficha.nif && c.nif !== ficha.nif) {
      diferencias.push({ tipo: 'nif_distinto', bitrixId: ficha.bitrixId, emisor: c.emisor, clienteGcId: c.id,
        porque: `Casado por el correo: Bitrix24 dice NIF ${ficha.nif} y GoCardless ${c.nif}.` })
    }
    if (ficha.emisorSegunBitrix && ficha.emisorSegunBitrix !== c.emisor && c.suscripcionesActivas > 0) {
      diferencias.push({ tipo: 'emisor_distinto', bitrixId: ficha.bitrixId, emisor: c.emisor, clienteGcId: c.id,
        porque: `Bitrix24 dice que paga a ${nombreEmisor(ficha.emisorSegunBitrix)} («${ficha.formaPago}») y GoCardless le cobra desde ${nombreEmisor(c.emisor)}.` })
    }
  }

  // Las fichas que se cobran y no tienen nada vivo en ninguna cuenta.
  const conCobro = new Set(parejas.filter((p) => {
    const c = clientes.find((x) => x.id === p.clienteGcId && x.emisor === p.emisor)
    return c ? c.suscripcionesActivas > 0 : false
  }).map((p) => p.bitrixId))
  for (const f of fichas) {
    if (!f.situacion || !SE_COBRA.includes(f.situacion) || conCobro.has(f.bitrixId)) continue
    diferencias.push({ tipo: 'bitrix_sin_cobro', bitrixId: f.bitrixId, emisor: f.emisorSegunBitrix, clienteGcId: null,
      porque: casadas.has(f.bitrixId)
        ? `«${f.nombre}» está ${f.situacion === 'moroso' ? 'moroso' : 'activo'} en Bitrix24 y está en GoCardless, pero sin ningún cobro mensual.`
        : `«${f.nombre}» está ${f.situacion === 'moroso' ? 'moroso' : 'activo'} en Bitrix24 y no está en GoCardless (ni por NIF ni por correo).` })
  }
  return { parejas, diferencias }
}
