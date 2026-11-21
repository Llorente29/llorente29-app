// supabase/functions/_shared/bancos/agente.ts
//
// B01·21 · La pasada del motor de Bancos SIN que nadie abra Bancos. Hasta ahora
// el motor solo corría en el navegador (al subir un extracto o la primera vez
// del día que alguien abría Bancos): del 07/11 al 12/11, Foodint tuvo 40
// movimientos en «pendiente» sin propuesta porque nadie entró. La lectura de
// cada noche (conta-banco-agregador) llama aquí al acabar, con la clave de
// servicio, por cada empresa que tenga algo pendiente: de BBVA, de Revolut o de
// un fichero.
//
// Lo mismo que la pasada del navegador (crearBancos(bd).conciliarPendientes, con
// sus guardas: lo seguro se casa solo, lo demás se propone o queda por aclarar)
// y su registro como «la pasada del día» (bank_agente_registrar). Y que no falle
// en silencio (regla 8): si después de la pasada queda algún movimiento en
// «pendiente» con más de un día, aviso a la cuenta (encolar_alerta).

import { crearBancos, type Bd, type Consulta, type ResultadoConciliar } from './nucleo.ts'

/** Lo mínimo del cliente de supabase-js que hace falta (el de la clave de servicio). */
export interface ClienteBase {
  from(tabla: string): unknown
  rpc(nombre: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** La base del núcleo sobre un cliente de supabase-js. */
export function bdDe(c: ClienteBase): Bd {
  return {
    tabla: (t) => c.from(t) as Consulta,
    rpc: async <T,>(nombre: string, args: Record<string, unknown>) => {
      const { data, error } = await c.rpc(nombre, args)
      if (error) throw new Error(`${nombre}: ${error.message}`)
      return data as T
    },
  }
}

export interface PasadaServidor {
  empresa: string
  resultado: Pick<ResultadoConciliar, 'casadosSolos' | 'propuestos' | 'porAclarar' | 'antesDelCorte'> & { fallos: number } | null
  /** Movimientos que siguen en «pendiente» con más de un día, después de la pasada. */
  sinProponer: number
  error: string | null
}

/** El texto del aviso: banco, fecha e importe del más antiguo, y cuántos son. */
export function textoAviso(n: number, masAntiguo: { banco: string; fecha: string; importe: number } | null): { asunto: string; mensaje: string } {
  const euros = (x: number) => `${x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  const dia = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`
  return {
    asunto: n === 1 ? 'Bancos: 1 movimiento lleva más de un día sin proponer' : `Bancos: ${n} movimientos llevan más de un día sin proponer`,
    mensaje: `${n === 1 ? 'Hay 1 movimiento' : `Hay ${n} movimientos`} en «pendiente» desde hace más de un día: la pasada de esta noche no ha podido proponerlos.`
      + (masAntiguo ? ` El más antiguo: ${masAntiguo.banco}, ${dia(masAntiguo.fecha)}, ${euros(masAntiguo.importe)}.` : '')
      + ' Abre Bancos › Movimientos para verlos; si sigue mañana, hay que mirar el motor.',
  }
}

/** Pasa el motor por una empresa, registra la pasada y avisa si queda algo viejo sin proponer. */
export async function pasarElMotor(c: ClienteBase, accountId: string, companyId: string, hoy: string, ahora = new Date()): Promise<PasadaServidor> {
  const bd = bdDe(c)
  const out: PasadaServidor = { empresa: companyId, resultado: null, sinProponer: 0, error: null }
  try {
    const r = await crearBancos(bd).conciliarPendientes(accountId, companyId, hoy)
    out.resultado = { casadosSolos: r.casadosSolos, propuestos: r.propuestos, porAclarar: r.porAclarar, antesDelCorte: r.antesDelCorte, fallos: r.fallos.length }
    await bd.rpc('bank_agente_registrar', { p_company: companyId, p_disparo: 'diario', p_resultado: {
      casados: r.casadosSolos, propuestos: r.propuestos, por_aclarar: r.porAclarar, antes_corte: r.antesDelCorte,
      fallos: r.fallos.length, fallos_detalle: r.fallos.slice(0, 20), por: 'la lectura de cada noche' } })
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e)
  }
  // Lo que sigue en «pendiente» con más de un día, pase lo que pase arriba (si la pasada ha fallado, con más razón).
  const hace = new Date(ahora.getTime() - 24 * 3600 * 1000).toISOString()
  type Q = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
    select(c: string): Q; eq(c: string, v: unknown): Q; lt(c: string, v: unknown): Q; order(c: string, o: { ascending: boolean }): Q; limit(n: number): Q
  }
  const { data, error } = await (c.from('bank_movement') as Q).select('op_date, amount, treasury_account:treasury_account_id(name)')
    .eq('account_id', accountId).eq('company_id', companyId).eq('status', 'pendiente').lt('created_at', hace)
    .order('op_date', { ascending: true }).limit(200)
  if (error) { out.error = `${out.error ? `${out.error} · ` : ''}No se ha podido mirar lo pendiente: ${error.message}`; return out }
  const viejos = (data ?? []) as { op_date: string; amount: number | string; treasury_account: { name: string } | null }[]
  out.sinProponer = viejos.length
  if (viejos.length > 0) {
    const m = viejos[0]
    const t = textoAviso(viejos.length, { banco: m.treasury_account?.name ?? 'un banco', fecha: String(m.op_date), importe: Number(m.amount) })
    try {
      await bd.rpc('encolar_alerta', { p_kind: 'bancos_sin_proponer', p_subject: t.asunto, p_message: t.mensaje,
        p_debounce_kind: `bancos_sin_proponer:${companyId}`, p_debounce_window: '20 hours', p_account_id: accountId, p_severity: 'aviso' })
    } catch (e) {
      out.error = `${out.error ? `${out.error} · ` : ''}No se ha podido avisar: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return out
}
