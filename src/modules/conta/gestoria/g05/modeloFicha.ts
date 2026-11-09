// src/modules/conta/gestoria/g05/modeloFicha.ts
//
// G05 · Tarea 4 · La ficha de una factura que sale de un recibo, sin pintar
// (la maqueta aprobada, Factura.dc.html): la cabecera, «Lo que ha pasado» y
// «En la contabilidad». Recibe la lectura única (conta_pantalla_factura_recibo,
// 1403) y lo que ya se sabe de la factura; devuelve los textos.
// Lo prueba tests/unit/modules/conta/gestoria/g05/modeloFicha.test.ts.

import { mesEnPalabras, nombreDelMes } from '../../../../../supabase/functions/_shared/cobro/recibo'
import { euros } from '../../../../../supabase/functions/_shared/tarifa/precio'

/** Lo que devuelve conta_pantalla_factura_recibo (null si la factura no sale de un recibo). */
export interface DatosFichaRecibo {
  recibo: {
    id: string; company_id: string; mes: string; estado: string; gc_estado: string | null; cobrar_cent: number
    cargo_el: string | null; confirmado_el: string | null; enviado_at: string | null; enviado_por_name: string | null; aviso_el: string | null
  }
  eventos: { tipo: string; texto: string; cuando: string; quien: string | null }[]
  verifactu: { estado: string; entorno: 'pruebas' | 'real'; huella: string | null; anterior: string | null } | null
  asientos: { tipo: 'factura' | 'cobro' | 'devolucion'; id: string; fecha: string; numero: number | null; estado: string;
    apuntes: { codigo: string; nombre: string; debe: number; haber: number }[] }[]
}

/** Lo que ya se sabe de la factura (de leerFactura). */
export interface FacturaDeLaFicha {
  numero: string | null; serie: string; fecha: string; total: number; cliente: string | null
  enviadaEl: string | null; correo: string | null; anulada: boolean
}

export type Bola = 'hecho' | 'pendiente' | 'espera' | 'mal'
export interface Hito { bola: Bola; icono: string; titulo: string; detalle: string }
export interface AsientoDeLaFicha { id: string; titulo: string; lineas: { cuenta: string; debe: string; haber: string }[] }

export interface ModeloFicha {
  titulo: string
  chip: { texto: string; tono: 'bien' | 'mal' | 'neutro' }
  subtitulo: string
  volver: { texto: string; mes: string; empresa: string }
  hitos: Hito[]
  asientos: AsientoDeLaFicha[]
  notas: string[]
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «4 de diciembre» de una fecha AAAA-MM-DD. */
export const diaLargo = (f: string) => `${Number(f.slice(8, 10))} de ${MESES[Number(f.slice(5, 7)) - 1]}`
/** Fecha y hora de Madrid de un instante: ['2026-12-04', '10:15']. */
function enMadrid(iso: string): [string, string] {
  const t = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  return [t.slice(0, 10), t.slice(11, 16)]
}
const importe = (n: number) => (n ? n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '')
/** «7C3E 91A0 5B2D … F04E»: el principio y el final de la huella, en grupos de 4. */
export const huellaCorta = (h: string) => `${h.slice(0, 4)} ${h.slice(4, 8)} ${h.slice(8, 12)} … ${h.slice(-4)}`

const VERIFACTU_HECHO = new Set(['correcto', 'aceptado_con_errores'])

export function modeloFicha(d: DatosFichaRecibo, f: FacturaDeLaFicha): ModeloFicha {
  const r = d.recibo
  const mesNombre = mesEnPalabras(r.mes)
  const cobrado = euros(r.cobrar_cent)
  const devuelto = r.estado === 'devuelto' || r.estado === 'retrocedido'
  const hitos: Hito[] = []

  // 1 · El cobro enviado a GoCardless, con el aviso al cliente.
  if (r.enviado_at) {
    const [dia] = enMadrid(r.enviado_at)
    hitos.push({ bola: 'hecho', icono: '✓', titulo: 'Cobro enviado', detalle: `${diaLargo(dia)}${r.aviso_el ? ` · aviso al cliente el día ${Number(r.aviso_el.slice(8, 10))} con el detalle` : ''}` })
  }
  // 2 · Cobrado (o devuelto después).
  if (r.confirmado_el) hitos.push({ bola: 'hecho', icono: '✓', titulo: 'Cobrado', detalle: `${diaLargo(r.confirmado_el)} · ${cobrado} por domiciliación` })
  // 3 · La factura.
  if (f.numero) hitos.push({ bola: 'hecho', icono: '✓', titulo: 'Factura emitida', detalle: `${diaLargo(f.fecha)} · ${f.numero}, serie ${f.serie} · facturas expedidas` })
  // 4 · Verifactu.
  const v = d.verifactu
  if (v && VERIFACTU_HECHO.has(v.estado)) {
    hitos.push({ bola: 'hecho', icono: '✓', titulo: v.entorno === 'pruebas' ? 'Verifactu: registrada en pruebas de la AEAT' : 'Verifactu: registrada en la AEAT',
      detalle: [v.huella ? `Huella ${huellaCorta(v.huella)}` : null, v.anterior ? `encadenada con la ${v.anterior}` : 'la primera de su cadena'].filter(Boolean).join(' · ') })
  } else if (v && v.estado === 'incorrecto') {
    hitos.push({ bola: 'mal', icono: '!', titulo: 'Verifactu: la AEAT no la ha aceptado', detalle: 'Mira qué dice y corrígela en «Con Hacienda», más abajo en esta ficha.' })
  } else {
    hitos.push({ bola: 'espera', icono: '…', titulo: 'Verifactu de pruebas: pendiente', detalle: 'Se registrará sola en cuanto la conexión con la AEAT esté probada. El PDF saldrá entonces con su QR.' })
  }
  // 5 · Enviada al cliente.
  if (f.enviadaEl) {
    const [dia, hora] = enMadrid(f.enviadaEl)
    hitos.push({ bola: 'hecho', icono: '✓', titulo: 'Enviada al cliente', detalle: `${diaLargo(dia)}, ${hora}${f.correo ? ` · ${f.correo}` : ''}` })
  } else if (f.numero) {
    hitos.push({ bola: 'pendiente', icono: '…', titulo: 'Sin enviar al cliente', detalle: f.correo ? `Aún no se le ha mandado a ${f.correo}.` : 'Aún no se le ha mandado: su ficha no tiene correo.' })
  }
  // 6 · Devuelto: se deshace el cobro (la factura se queda).
  if (devuelto) {
    const ev = [...d.eventos].reverse().find((e) => e.tipo === 'devuelto')
    hitos.push({ bola: 'mal', icono: '!', titulo: r.estado === 'retrocedido' ? 'Retrocedido' : 'Devuelto',
      detalle: ev ? `${diaLargo(enMadrid(ev.cuando)[0])} · ${ev.texto}` : 'No se ha podido cobrar: vuelve a «Te deben».' })
  } else if (r.confirmado_el) {
    // 7 · El ingreso de GoCardless en el banco: lo casa Bancos; aquí no hay fecha.
    hitos.push({ bola: 'pendiente', icono: '…', titulo: 'Ingreso de GoCardless en el banco',
      detalle: r.gc_estado === 'paid_out'
        ? 'GoCardless ya lo ha pagado, junto con los demás cobros del día. Se casa solo en Bancos.'
        : 'Llega unos días después del cobro, junto con los demás cobros del día. Se casa solo en Bancos.' })
  }

  const NOMBRE = { factura: 'Factura', cobro: 'Cobro', devolucion: 'Devolución' } as const
  const asientos: AsientoDeLaFicha[] = d.asientos.map((a) => ({
    id: a.id,
    titulo: `${NOMBRE[a.tipo]} · ${diaLargo(a.fecha)}${a.numero ? ` · asiento ${a.numero.toLocaleString('es-ES')}` : ''}`,
    lineas: a.apuntes.map((x) => ({ cuenta: `${x.codigo} ${x.nombre}`, debe: importe(Number(x.debe)), haber: importe(Number(x.haber)) })),
  }))

  const chip: ModeloFicha['chip'] = f.anulada ? { texto: 'Anulada', tono: 'mal' }
    : devuelto ? { texto: r.estado === 'retrocedido' ? 'Retrocedida' : 'Devuelta', tono: 'mal' }
    : r.confirmado_el ? { texto: 'Pagada', tono: 'bien' } : { texto: 'Emitida', tono: 'neutro' }

  return {
    titulo: `Factura ${f.numero ?? ''}`.trim(),
    chip,
    subtitulo: [f.cliente, mesNombre, euros(Math.round(f.total * 100))].filter(Boolean).join(' · '),
    volver: { texto: `← Cobro de ${nombreDelMes(r.mes)}`, mes: r.mes, empresa: r.company_id },
    hitos,
    asientos,
    notas: [
      'El ingreso de GoCardless en el banco (572 / 57200002) lo casa Bancos, con todos los cobros del día juntos.',
      'La comisión de GoCardless no va aquí: llega en su factura mensual, que se registra como factura recibida (629, con inversión del sujeto pasivo) y se paga desde la 57200002.',
    ],
  }
}
