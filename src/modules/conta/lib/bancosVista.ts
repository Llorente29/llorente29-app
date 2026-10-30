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
export type Boton = 'ver' | 'deshacer' | 'si' | 'otra-cosa' | 'subir-foto' | 'si-sin-ticket' | 'buscar-factura' | 'decirlo-yo' | 'alta-tarjeta' | 'es-el-mismo' | 'son-dos'

/** Lo que dice cada botón de la tabla. */
export const TEXTO_BOTON: Record<Boton, string> = {
  ver: 'Ver', deshacer: 'Deshacer', si: 'Sí', 'otra-cosa': 'Otra cosa', 'subir-foto': 'Subir foto', 'si-sin-ticket': 'Sí, sin ticket',
  'buscar-factura': 'Buscar factura', 'decirlo-yo': 'Decirlo yo', 'alta-tarjeta': 'Dar de alta la tarjeta',
  'es-el-mismo': 'Es el mismo', 'son-dos': 'Son dos',
}

export interface PropuestaGuardada {
  que?: string
  destino?: Record<string, unknown> | null
  falta?: string | null
  pideTicket?: boolean
  reglaId?: string | null
  contraparte?: string | null
  tarjetaId?: string | null
  /** B02 · La píldora, el punto verde y lo demás que dice el motor (ver Decision en conciliacion.ts). */
  origen?: string | null
  preseleccionar?: boolean
  tarjetaDesconocida?: string | null
  alternativas?: { etiqueta: string; destino: Record<string, unknown> }[]
  quedaPorCasarCent?: number | null
  facturaSinAprobar?: boolean
  /** S01d · Las cuentas de una regla con reparto cuyo importe no cuadró: la ventana abre con ellas. */
  reparto?: { cuenta: string; importeCent: number | null; concepto: string | null; modelo?: string | null; periodo?: string | null }[] | null
}

export interface MovimientoBanco {
  id: string
  cuentaId: string
  fecha: string
  importeCent: number
  conceptoBanco: string
  conceptoLimpio: string
  /** B02 · A quién pagas o quién te paga, limpio (`counterparty`), y el tipo de movimiento del banco (`movement_type`). */
  contraparte?: string | null
  tipo?: string | null
  estado: 'pendiente' | 'propuesto' | 'por_aclarar' | 'casado' | 'posible_repetido' | 'antes_corte_sin_pareja' | 'ignorado'
  confianza: 'seguro' | 'probable' | 'duda' | null
  porque: string | null
  propuesta: PropuestaGuardada | null
  casado: { id: string; tipo: string; porque: string; porQuien: 'folvy' | 'persona'; asientoId: string | null; asientoConcepto: string | null
    /** S02 · PR 2: el estado de su asiento (propuesto: espera en «Por validar»; validado; anulado). */
    asientoEstado?: 'propuesto' | 'borrador' | 'validado' | 'anulado' | null } | null
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
  /**
   * El único botón principal (azul) de la fila (respuesta 4, 2.3): en ámbar
   * «Sí» (o «Subir foto» si falta el ticket); en gris «Decirlo yo»; en verde,
   * ninguno: «Ver» y «Deshacer» van en secundario.
   */
  principal: Boton | null
  grupo: 'casado' | 'confirmar' | 'aclarar' | 'otro'
}

const sinPunto = (s: string) => s.trim().replace(/\.$/, '')
const minuscula = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)
const quitarCasadoSolo = (s: string) => s.replace(/^casado solo\s*[:·]\s*/i, '')

/** Una fila de la tabla de Movimientos (N17). */
export function filaDe(m: MovimientoBanco): Fila {
  const f = filaSinPrincipal(m)
  const principal: Boton | null = f.tono === 'ambar' ? (['si', 'subir-foto'] as Boton[]).find((b) => f.botones.includes(b)) ?? null
    : f.tono === 'gris' && f.botones.includes('decirlo-yo') ? 'decirlo-yo' : null
  return { ...f, principal }
}

function filaSinPrincipal(m: MovimientoBanco): Omit<Fila, 'principal'> {
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
    const ultimos = tarjetaPorAclarar(m.porque, m.propuesta)
    const tarjetaDesconocida = !!ultimos
    const porque = sinPunto(m.porque ?? '')
    return {
      id: m.id, tono: 'gris', grupo: 'aclarar', estado: 'Por aclarar',
      titulo: m.estado === 'pendiente' ? 'Aún no lo he mirado' : m.propuesta?.que ?? 'No sé qué es',
      porque: m.estado === 'pendiente' ? 'Llegó con el último extracto; lo miro al conciliar.'
        : m.propuesta?.tarjetaDesconocida ? `${porque}${porque ? ' · ' : ''}tarjeta ···${ultimos} sin dar de alta` : porque,
      botones: tarjetaDesconocida ? ['alta-tarjeta', 'decirlo-yo']
        : m.propuesta?.pideTicket && !m.ticket ? ['subir-foto', 'decirlo-yo']
        : m.importeCent < 0 ? ['buscar-factura', 'decirlo-yo'] : ['decirlo-yo'],
    }
  }
  if (m.estado === 'antes_corte_sin_pareja') {
    return { id: m.id, tono: 'gris', grupo: 'otro', estado: 'Antes del corte', titulo: 'Antes del corte · sin pareja en el libro', porque: sinPunto(m.porque ?? ''), botones: [] }
  }
  if (m.estado === 'posible_repetido') {
    return { id: m.id, tono: 'gris', grupo: 'aclarar', estado: 'Por aclarar', titulo: '¿Es el mismo movimiento otra vez?', porque: 'Mismo día e importe que otro que ya estaba, por otro camino.', botones: ['es-el-mismo', 'son-dos'] }
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

/** El mes corto de la cabecera (N30: «2026 · Oct»): '2026-09' → 'Sep 2026'. */
export function mesCorto(mes: string): string {
  const n = nombreMes(mes)
  return `${n.charAt(0).toUpperCase()}${n.slice(1, 3)} ${mes.slice(0, 4)}`
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
/**
 * Los 4 dígitos de la tarjeta que no está dada de alta, para darla de alta: los
 * que anota el motor (B02, `tarjetaDesconocida`) o, en las propuestas guardadas
 * antes, los de «tarjeta acabada en 1234, ¿de quién es?».
 */
export function tarjetaPorAclarar(porque: string | null, propuesta?: PropuestaGuardada | null): string | null {
  return propuesta?.tarjetaDesconocida ?? /tarjeta acabada en (\d{4})/i.exec(porque ?? '')?.[1] ?? null
}

export function ultimosIban(iban: string | null): string | null {
  const limpio = (iban ?? '').replace(/\s+/g, '')
  return limpio.length >= 4 ? limpio.slice(-4) : null
}

/** «ES0201829101320000000011» → «ES02 0182 9101 3200 0000 0011». */
export function ibanLegible(iban: string | null): string {
  return (iban ?? '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

/** El nombre de un banco en la barra: su alias (respuesta 4) o, si no tiene, el nombre entero. */
export function nombreCorto(b: { nombre: string; alias?: string | null }): string {
  return b.alias?.trim() || b.nombre
}

/** Las migas de Movimientos: «Bancos › Banco B01 · Norte · ···0011». */
export function migasBanco(b: { nombre: string; iban: string | null }): string {
  const u = ultimosIban(b.iban)
  return `Bancos › ${b.nombre}${u ? ` · ···${u}` : ''}`
}

/**
 * Qué bancos caben en la barra (respuesta 4, 1): todos en una fila hasta
 * cuatro; desde cinco, tres a la vista y el resto en «y N más». A la vista van
 * siempre el que tiene más dudas y el elegido; los demás, en su orden.
 */
export function bancosEnBarra<T extends { id: string }>(bancos: readonly T[], dudas: Readonly<Record<string, number>>, elegido: string | null): { visibles: T[]; resto: T[] } {
  if (bancos.length < 5) return { visibles: [...bancos], resto: [] }
  const masDudas = [...bancos].sort((a, b) => (dudas[b.id] ?? 0) - (dudas[a.id] ?? 0))[0]
  const fijos = new Set([masDudas.id, ...(elegido && bancos.some((b) => b.id === elegido) ? [elegido] : [])])
  for (const b of bancos) { if (fijos.size >= 3) break; fijos.add(b.id) }
  return { visibles: bancos.filter((b) => fijos.has(b.id)), resto: bancos.filter((b) => !fijos.has(b.id)) }
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

// ── Deshacer un extracto (15/10) ────────────────────────────────────────────

export interface ExtractoDeshecho { fichero: string | null; movimientos: number; posiblesRepetidos: number }

/** Lo que dice la pantalla al deshacer un extracto (regla 8: con contenido). */
export function textoExtractoDeshecho(r: ExtractoDeshecho): string {
  const cuantos = `${r.movimientos} ${r.movimientos === 1 ? 'movimiento' : 'movimientos'}`
  const repetidos = r.posiblesRepetidos > 0 ? `, ${r.posiblesRepetidos} de ellos como «¿es el mismo?»` : ''
  return `Extracto ${r.fichero ? `«${r.fichero}» ` : ''}deshecho: quitados ${cuantos}${repetidos}. Ya puedes subir el bueno.`
}
