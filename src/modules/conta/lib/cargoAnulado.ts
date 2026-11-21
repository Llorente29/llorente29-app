// src/modules/conta/lib/cargoAnulado.ts
//
// B01·20 · El cargo que el banco anula (maqueta aprobada por Julio, 07/11).
// Lo que dice el aviso de Bancos y lo que confirma cada botón, a partir de lo
// que devuelve la base (bank_cargos_anulados, bank_anulado_quitar y
// bank_anulado_es_bueno). Cuándo hay aviso lo decide la base, no esto.

import { diaMesCorto, eurosExactos } from '@/modules/conta/lib/formato'

/** El motivo con que «Quitarlo» aparta el cargo (el mismo que escribe la base). */
export const MOTIVO_ANULADO = 'Anulado por el banco: no había saldo'

export interface CargoAnulado {
  id: string
  fecha: string
  importeCent: number
  concepto: string
  /** El concepto del asiento con que está casado, si lo está. */
  casadoCon: string | null
  estaCasado: boolean
}

export interface AvisoAnulado {
  /** El extracto en que el banco no bajó: es la clave del aviso. */
  extracto: string
  banco: string
  dia: string
  saldoBancoCent: number
  huecoCent: number
  cargos: CargoAnulado[]
}

const euros = (c: number) => eurosExactos(c / 100)

/** «el cargo de 3.308,46 €» · «los 2 cargos (798,36 €)». */
function cuales(n: number, sumaCent: number): string {
  return n === 1 ? `el cargo de ${euros(sumaCent)}` : `los ${n} cargos (${euros(sumaCent)})`
}

/** Lo que dice el aviso: el título, el porqué en una frase, las dos cifras y, si hace falta, lo del casado. */
export function textosAviso(a: AvisoAnulado): { titulo: string; porque: string; cifras: string; casado: string | null } {
  const uno = a.cargos.length === 1
  const dia = diaMesCorto(a.dia)
  const conEl = a.saldoBancoCent - a.huecoCent
  const casados = a.cargos.filter((c) => c.estaCasado)
  return {
    titulo: uno ? 'El banco anuló este cargo: no había saldo' : `El banco anuló estos ${a.cargos.length} cargos: no había saldo`,
    porque: uno
      ? `Lo apuntó el ${dia} y, como no había saldo, lo anuló. Su saldo no bajó ese día, y la anulación no nos ha llegado. Sin él, Sumied y el banco cuadran al céntimo.`
      : `Los apuntó el ${dia} y, como no había saldo, los anuló. Su saldo no bajó ese día, y la anulación no nos ha llegado. Sin ellos, Sumied y el banco cuadran al céntimo.`,
    cifras: uno
      ? `Con él: Sumied ${euros(conEl)} · banco ${euros(a.saldoBancoCent)}. Sin él: los dos, ${euros(a.saldoBancoCent)}.`
      : `Con ellos: Sumied ${euros(conEl)} · banco ${euros(a.saldoBancoCent)}. Sin ellos: los dos, ${euros(a.saldoBancoCent)}.`,
    casado: casados.length === 0 ? null
      : casados.length === 1 && uno
        ? `Está casado con «${casados[0].casadoCon ?? 'su asiento'}»: al quitarlo, ese casado se deshace.`
        : `${casados.length === 1 ? 'Uno está casado' : `${casados.length} están casados`}: al quitarlos, esos casados se deshacen.`,
  }
}

/** La confirmación de «Quitarlo» (regla 8: con contenido). */
export function textoQuitado(r: { n: number; sumaCent: number; dia: string; saldoBancoCent: number; deshechos: number }): string {
  const dia = diaMesCorto(r.dia)
  const que = r.n === 1 ? `Quitado: el cargo de ${euros(r.sumaCent)} del ${dia} ya no cuenta.` : `Quitados: ${cuales(r.n, r.sumaCent)} del ${dia} ya no cuentan.`
  const casado = r.deshechos === 0 ? '' : r.deshechos === 1 ? ' Su casado se ha deshecho.' : ` Se han deshecho ${r.deshechos} casados.`
  return `${que} El saldo de Sumied es el del banco: ${euros(r.saldoBancoCent)}.${casado}`
}

/** La confirmación de «No, es bueno». */
export function textoEsBueno(r: { n: number; sumaCent: number; dia: string }): string {
  return r.n === 1
    ? `Hecho: el cargo de ${euros(r.sumaCent)} del ${diaMesCorto(r.dia)} se queda, y no te vuelvo a avisar de él.`
    : `Hecho: ${cuales(r.n, r.sumaCent)} del ${diaMesCorto(r.dia)} se quedan, y no te vuelvo a avisar de ellos.`
}

/** La confirmación de deshacer un «Apartar». */
export function textoDesapartado(m: { fecha: string; importeCent: number }, motivo: string | null): string {
  return `Deshecho: el movimiento del ${diaMesCorto(m.fecha)} de ${euros(m.importeCent)} vuelve a contar${motivo ? ` (estaba apartado: «${motivo}»)` : ''}. Lo vuelvo a mirar para casarlo.`
}

/** De lo que devuelve la base a lo de la pantalla. */
export function avisoDeFila(f: Record<string, unknown>): AvisoAnulado {
  const cent = (x: unknown) => Math.round(Number(x) * 100)
  return {
    extracto: String(f.extracto), banco: String(f.banco), dia: String(f.dia),
    saldoBancoCent: cent(f.saldo_banco), huecoCent: cent(f.hueco),
    cargos: ((f.cargos as Record<string, unknown>[] | null) ?? []).map((c) => ({
      id: String(c.id), fecha: String(c.fecha), importeCent: cent(c.importe), concepto: String(c.concepto ?? ''),
      casadoCon: c.casado == null ? null : String(c.casado), estaCasado: !!c.esta_casado,
    })),
  }
}
