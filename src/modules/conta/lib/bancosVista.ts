// src/modules/conta/lib/bancosVista.ts
//
// B01 · Lo que enseñan las pantallas de Bancos (N17), sin React ni base: de
// un movimiento con su casado o su propuesta sale UNA fila de la tabla (el
// punto, el título, el porqué y los botones), y de las filas de un mes las
// cinco cifras y la frase de la banda. Lo que la pantalla pinta se decide
// aquí, y aquí se prueba (tests/unit/modules/conta/bancosVistaB01.test.ts).
//
// Un umbral ordena, no esconde (regla 7): «Todo» enseña todas las filas del
// mes; «Para confirmar» y «Por aclarar» solo filtran a petición.

export type Tono = 'verde' | 'ambar' | 'gris'
export type Boton = 'ver' | 'deshacer' | 'si' | 'otra-cosa' | 'subir-foto' | 'si-sin-ticket' | 'buscar-factura' | 'decirlo-yo' | 'alta-tarjeta'

/** Lo que dice cada botón de la tabla. */
export const TEXTO_BOTON: Record<Boton, string> = {
  ver: 'Ver', deshacer: 'Deshacer', si: 'Sí', 'otra-cosa': 'Otra cosa', 'subir-foto': 'Subir foto', 'si-sin-ticket': 'Sí, sin ticket',
  'buscar-factura': 'Buscar factura', 'decirlo-yo': 'Decirlo yo', 'alta-tarjeta': 'Dar de alta la tarjeta',
}

export interface PropuestaGuardada {
  que?: string
  destino?: Record<string, unknown> | null
  falta?: string | null
  pideTicket?: boolean
  reglaId?: string | null
  contraparte?: string | null
  tarjetaId?: string | null
}

export interface MovimientoBanco {
  id: string
  cuentaId: string
  fecha: string
  importeCent: number
  conceptoBanco: string
  conceptoLimpio: string
  estado: 'pendiente' | 'propuesto' | 'por_aclarar' | 'casado' | 'posible_repetido' | 'antes_corte_sin_pareja' | 'ignorado'
  confianza: 'seguro' | 'probable' | 'duda' | null
  porque: string | null
  propuesta: PropuestaGuardada | null
  casado: { id: string; tipo: string; porque: string; porQuien: 'folvy' | 'persona'; asientoId: string | null; asientoConcepto: string | null } | null
  tarjeta: { ultimos4: string; titular: string } | null
  ticket: string | null
  motivoIgnorado: string | null
}

export interface Fila {
  id: string
  tono: Tono
  /** «Para confirmar», «Por aclarar», «Casado solo»…: lo que dice el punto, para quien no ve el color. */
  estado: string
  titulo: string
  porque: string
  botones: Boton[]
  grupo: 'casado' | 'confirmar' | 'aclarar' | 'otro'
}

const sinPunto = (s: string) => s.trim().replace(/\.$/, '')
const minuscula = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const quitarCasadoSolo = (s: string) => s.replace(/^casado solo\s*[:·]\s*/i, '')

/** Una fila de la tabla de Movimientos (N17). */
export function filaDe(m: MovimientoBanco): Fila {
  if (m.estado === 'casado' && m.casado) {
    const porque = quitarCasadoSolo(m.casado.porque)
    const titulo = m.casado.asientoConcepto ?? m.propuesta?.que ?? 'Casado'
    return {
      id: m.id, tono: 'verde', grupo: 'casado',
      estado: m.casado.porQuien === 'folvy' ? 'Casado solo' : 'Casado por ti',
      titulo,
      porque: m.casado.porQuien === 'folvy' ? `Casado solo: ${minuscula(sinPunto(porque))}` : `Lo confirmaste tú: ${minuscula(sinPunto(porque))}`,
      botones: m.casado.asientoId ? ['ver', 'deshacer'] : ['deshacer'],
    }
  }
  if (m.estado === 'propuesto') {
    const ticket = !!m.propuesta?.pideTicket && !m.ticket
    return {
      id: m.id, tono: 'ambar', grupo: 'confirmar', estado: 'Para confirmar',
      titulo: ticket ? `${m.propuesta?.que ?? 'Pago con tarjeta'} · ¿ticket?` : m.propuesta?.que ?? 'Para confirmar',
      porque: sinPunto(m.porque ?? ''),
      botones: ticket ? ['subir-foto', 'si-sin-ticket'] : ['si', 'otra-cosa'],
    }
  }
  if (m.estado === 'por_aclarar' || m.estado === 'pendiente') {
    const tarjetaDesconocida = /tarjeta acabada en \d{4}, ¿de quién es\?/i.test(m.porque ?? '')
    return {
      id: m.id, tono: 'gris', grupo: 'aclarar', estado: 'Por aclarar',
      titulo: m.estado === 'pendiente' ? 'Aún no lo he mirado' : m.propuesta?.que ?? 'No sé qué es',
      porque: m.estado === 'pendiente' ? 'Llegó con el último extracto; lo miro al conciliar.' : sinPunto(m.porque ?? ''),
      botones: tarjetaDesconocida ? ['alta-tarjeta', 'decirlo-yo']
        : m.propuesta?.pideTicket && !m.ticket ? ['subir-foto', 'decirlo-yo']
        : m.importeCent < 0 ? ['buscar-factura', 'decirlo-yo'] : ['decirlo-yo'],
    }
  }
  if (m.estado === 'antes_corte_sin_pareja') {
    return { id: m.id, tono: 'gris', grupo: 'otro', estado: 'Antes del corte', titulo: 'Antes del corte · sin pareja en el libro', porque: sinPunto(m.porque ?? ''), botones: [] }
  }
  if (m.estado === 'posible_repetido') {
    return { id: m.id, tono: 'gris', grupo: 'aclarar', estado: 'Por aclarar', titulo: '¿Es el mismo movimiento otra vez?', porque: 'Mismo día e importe que otro que ya estaba, por otro camino.', botones: [] }
  }
  return { id: m.id, tono: 'gris', grupo: 'otro', estado: 'Apartado', titulo: 'Apartado', porque: sinPunto(m.motivoIgnorado ?? ''), botones: [] }
}

/** Las cinco cifras de arriba y la frase de la banda, contadas con la misma vara que la tabla (regla 31). */
export function resumenFilas(filas: readonly Fila[], mes: string, deFolvy: number): { total: number; casadoSolo: number; paraConfirmar: number; porAclarar: number; frase: string } {
  const total = filas.length
  const paraConfirmar = filas.filter((f) => f.grupo === 'confirmar').length
  const porAclarar = filas.filter((f) => f.grupo === 'aclarar').length
  const nombre = nombreMes(mes).toLowerCase()
  const frase = total === 0
    ? `No hay movimientos de ${nombre}: sube el extracto y los miro.`
    : `He casado yo ${deFolvy} de ${total} movimientos de ${nombre}. ${paraConfirmar || porAclarar
      ? `Te quedan ${paraConfirmar} por confirmar y ${porAclarar} por aclarar.`
      : 'No te queda nada.'}`
  return { total, casadoSolo: deFolvy, paraConfirmar, porAclarar, frase }
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

/** '2026-10' → «Octubre». */
export function nombreMes(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1] ?? mes
}

/** '2026-10' → { desde: '2026-10-01', hasta: '2026-10-31' }. */
export function limitesMes(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/** Los meses que se pueden elegir: del primero con movimientos al de hoy, el más reciente primero. */
export function mesesElegibles(primero: string | null, hoy: string): string[] {
  const fin = hoy.slice(0, 7)
  let m = (primero ?? hoy).slice(0, 7)
  if (m > fin) m = fin
  const out: string[] = []
  while (m <= fin && out.length < 36) {
    out.push(m)
    const [a, n] = m.split('-').map(Number)
    m = n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}`
  }
  return out.reverse()
}

/** «ES02 0182 … 0011» → «0011»: lo que la barra enseña de cada banco. */
/** Los 4 dígitos de «tarjeta acabada en 1234, ¿de quién es?», para dar de alta esa tarjeta. */
export function tarjetaPorAclarar(porque: string | null): string | null {
  return /tarjeta acabada en (\d{4})/i.exec(porque ?? '')?.[1] ?? null
}

export function ultimosIban(iban: string | null): string | null {
  const limpio = (iban ?? '').replace(/\s+/g, '')
  return limpio.length >= 4 ? limpio.slice(-4) : null
}

/** «ES0201829101320000000011» → «ES02 0182 9101 3200 0000 0011». */
export function ibanLegible(iban: string | null): string {
  return (iban ?? '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

/** «Banco B01 · Norte» con su 572 → «Banco B01 · Norte · 57200911». Siempre nombre · código. */
export function nombreConCodigo(nombre: string, codigo: string | null): string {
  return codigo ? `${nombre.trim().replace(/[.\s]+$/, '')} · ${codigo}` : nombre
}

/** El estado de un banco en la barra «Tus bancos»: «al día» o «3 dudas». */
export function estadoBanco(dudas: number, conMovimientos: boolean): { texto: string; tono: Tono } {
  if (!conMovimientos) return { texto: 'sin extracto', tono: 'gris' }
  return dudas === 0 ? { texto: 'al día', tono: 'verde' } : { texto: `${dudas} ${dudas === 1 ? 'duda' : 'dudas'}`, tono: 'ambar' }
}

/** El cierre del mes de un banco: el saldo del banco frente al de su cuenta, y por qué difieren. */
export function cierreBanco(saldoBancoCent: number | null, saldoLibroCent: number, sueltosCent: number): { cuadra: boolean | null; diferenciaCent: number | null; frase: string } {
  if (saldoBancoCent === null) return { cuadra: null, diferenciaCent: null, frase: 'Falta el extracto con el saldo de fin de mes: súbelo y lo compruebo.' }
  const dif = saldoBancoCent - saldoLibroCent
  if (dif === 0) return { cuadra: true, diferenciaCent: 0, frase: 'El saldo del banco y el de contabilidad son iguales al céntimo.' }
  return {
    cuadra: false, diferenciaCent: dif,
    frase: dif === sueltosCent
      ? 'La diferencia son exactamente los movimientos que aún no están casados: cásalos y cuadra.'
      : 'La diferencia no se explica solo con los movimientos sin casar: hay algo en contabilidad que no está en el banco.',
  }
}
