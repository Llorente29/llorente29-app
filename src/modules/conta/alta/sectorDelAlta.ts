// src/modules/conta/alta/sectorDelAlta.ts
//
// G03 · El sector que se propone en el alta, cuando se vuelve a entrar a
// medias: el que quedó guardado en la empresa (lo puso el alta al confirmar la
// actividad) y, si es gestoría, si iba con duda (por los códigos de sus
// actividades). Puro.

import { esSector, gestoriaPorCodigos, sectorPropuesto, type Propuesta } from '@/modules/conta/sectores/sectores'
import { esHosteleriaPorCodigos, esHosteleriaPorGrupos, gruposDe } from '@/modules/conta/alta/actividades'

/**
 * G03 (Julio, 08/11) · El sector que se propone al acabar «A qué te dedicas»:
 * por las actividades elegidas Y por las palabras de la persona. Quien escribe
 * «gestoría», «gestor», «asesoría» o «asesor» recibe Gestoría aunque el
 * catálogo no encuentre nada: nunca se le dice que no es una gestoría. Sin
 * ninguna pista (ni actividad ni palabras), la pregunta va sin propuesta dicha.
 */
export function propuestaDelAlta(a: { texto: string | null; elegidas: readonly { clave: string; iae: string | null; cnae: string | null }[] }): Propuesta {
  const deLasPalabras = a.texto ? gruposDe(a.texto).map((g) => g.clave).filter((c) => !c.startsWith('palabra:')) : []
  const grupos = [...new Set([...deLasPalabras, ...a.elegidas.map((x) => x.clave)])]
  const codigos = a.elegidas.map((x) => ({ iae: x.iae, cnae: x.cnae }))
  const hosteleria = esHosteleriaPorGrupos(grupos) || codigos.some((c) => esHosteleriaPorCodigos(c.iae, c.cnae))
  const p = sectorPropuesto({ hosteleria, grupos, codigos })
  const sinPista = grupos.length === 0 && codigos.every((c) => !c.iae && !c.cnae)
  return sinPista ? { ...p, sinPista: true } : p
}

export function propuestaGuardada(sector: unknown, hosteleria: boolean | null, actividades: readonly { iaeCode: string | null; cnaeCode: string | null; endedOn: string | null }[]): Propuesta {
  const s = esSector(sector) ? sector : hosteleria ? 'hosteleria' : 'general'
  const vivas = actividades.filter((a) => a.endedOn === null).map((a) => gestoriaPorCodigos(a.iaeCode, a.cnaeCode))
  const duda = s === 'gestoria' && vivas.length > 0 && !vivas.includes('si') && vivas.includes('duda')
  // Sin sector ni actividades, nada en qué apoyarse: la pregunta va sin propuesta dicha.
  return !esSector(sector) && !hosteleria && vivas.length === 0 ? { sector: s, duda, sinPista: true } : { sector: s, duda }
}
