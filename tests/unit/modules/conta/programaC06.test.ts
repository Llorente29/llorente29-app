// C06, respuesta 4 · «¿De qué programa vienes?» en el alta, y la tarjeta de
// Diez del Inicio solo para lo que falte.
import { describe, expect, it } from 'vitest'
import { PROGRAMAS, entenderPrograma, fraseDePrograma } from '@/modules/conta/alta/programa'
import { verTarjetaDiez, type ListoDiez } from '@/modules/conta/lib/pasosDiez'
import { todasLasPreguntas, type ContextoAlta } from '@/modules/conta/alta/guion'

const ctx: ContextoAlta = {
  cuenta: { nombre: null, razonSocial: null, nif: null, direccion: null } as unknown as ContextoAlta['cuenta'],
  tipo: 'company', cp: '28004', clases: ['business'], respuestas: {}, hoy: '2026-10-14',
}

describe('la pregunta, en el paso de las cuentas', () => {
  it('va después de pymes o general, con la lista de Julio en su orden y «Empiezo de cero»', () => {
    const qs = todasLasPreguntas('cuentas', ctx)
    expect(qs.map((q) => q.clave)).toEqual(['cuentas', 'programa'])
    const p = qs[1]
    expect(p.texto).toBe('¿De qué programa vienes?')
    expect(p.opciones.map((o) => o.texto)).toEqual(['Cegid Diez', 'Holded', 'Sage', 'a3', 'ContaSol', 'Quipu', 'Otro', 'Empiezo de cero'])
    expect(p.entrada).toBe('texto') // «Otro» con su nombre escrito
  })
})

describe('lo que se entiende', () => {
  it('cada botón es su programa', () => {
    for (const x of PROGRAMAS.filter((y) => y.valor !== 'otro')) expect(entenderPrograma(x.valor)).toEqual({ programa: x.valor, otro: null })
  })
  it('«Otro» sin nombre pide el nombre (null); con nombre, otro con su nombre', () => {
    expect(entenderPrograma('otro')).toBeNull()
    expect(entenderPrograma('otro:  ')).toBeNull()
    expect(entenderPrograma('otro: Contaplus')).toEqual({ programa: 'otro', otro: 'Contaplus' })
  })
  it('escrito con sus palabras: el de la lista que nombre, o «otro» con lo escrito', () => {
    expect(entenderPrograma('usábamos cegid')).toEqual({ programa: 'diez', otro: null })
    expect(entenderPrograma('Holded')).toEqual({ programa: 'holded', otro: null })
    expect(entenderPrograma('empiezo de cero')).toEqual({ programa: 'ninguno', otro: null })
    expect(entenderPrograma('a3con')).toEqual({ programa: 'a3', otro: null })
    expect(entenderPrograma('Contaplus')).toEqual({ programa: 'otro', otro: 'Contaplus' })
    // Nombra dos de la lista: no se adivina, queda como lo escribió.
    expect(entenderPrograma('Sage y Holded')).toEqual({ programa: 'otro', otro: 'Sage y Holded' })
  })
})

describe('lo que se le dice: la verdad, sin prometer importaciones que no existen', () => {
  it('Cegid Diez: el plan al terminar y el histórico después', () => {
    expect(fraseDePrograma({ programa: 'diez', otro: null }, 'pymes')).toBe(
      'Vienes de Cegid Diez: al terminar el alta activo el plan general contable de pymes, y tu histórico, con tus subcuentas, lo traigo después. En el Inicio verás cómo va.')
  })
  it('cualquier otro: la frase de Julio, con el nombre que dio', () => {
    expect(fraseDePrograma({ programa: 'holded', otro: null }, 'normal')).toBe(
      'De momento no traigo solo los datos de Holded; empezamos con el plan general contable y te ayudamos a pasar los saldos.')
    expect(fraseDePrograma({ programa: 'otro', otro: 'Contaplus' }, 'pymes')).toBe(
      'De momento no traigo solo los datos de Contaplus; empezamos con el plan general contable de pymes y te ayudamos a pasar los saldos.')
    for (const x of ['holded', 'sage', 'a3', 'contasol', 'quipu'] as const) {
      expect(fraseDePrograma({ programa: x, otro: null }, 'pymes')).not.toMatch(/import|trae(r|go) tus datos|botón/i)
    }
  })
  it('de cero: el plan', () => {
    expect(fraseDePrograma({ programa: 'ninguno', otro: null }, 'pymes')).toBe('Empezamos de cero, con el plan general contable de pymes: lo activo al terminar el alta.')
  })
})

const listo = (falta: ListoDiez['falta'], base: string | null): ListoDiez => ({
  pasos: [
    { paso: 'datos', hecho: true }, { paso: 'plan', hecho: true }, { paso: 'banco', hecho: true },
    { paso: 'diez', hecho: falta === null, base, fallo: null },
  ],
  falta, sinNombre: 0,
} as ListoDiez)

describe('la tarjeta de Diez del Inicio: solo para lo que falte', () => {
  it('Foodint, como está en producción (C0008, histórico traído): no se enseña, como hoy', () => {
    expect(verTarjetaDiez(listo(null, 'C0008'), null)).toBe(false)
  })
  it('Foodint con algo pendiente: se enseña por su base, sin haber contestado la pregunta (su alta es de antes)', () => {
    expect(verTarjetaDiez(listo('diez', 'C0008'), null)).toBe(true)
  })
  it('quien viene de Diez, mientras falte: sí; quien viene de otro o de cero: no', () => {
    expect(verTarjetaDiez(listo('diez', null), 'diez')).toBe(true)
    for (const p of ['holded', 'sage', 'a3', 'contasol', 'quipu', 'otro', 'ninguno', null]) expect(verTarjetaDiez(listo('diez', null), p)).toBe(false)
  })
})

describe('la respuesta marcada es la normal (la que deja «No lo sé»)', () => {
  it('en todas las preguntas de siempre, la normal es la primera: marcar la normal no cambia nada en ellas', () => {
    for (const paso of ['nif', 'nombre', 'actividad', 'impuestos', 'cuentas', 'banco'] as const) {
      for (const q of todasLasPreguntas(paso, ctx)) {
        if (q.clave === 'programa' || q.opciones.length === 0) continue
        expect(q.opciones[0].valor, q.clave).toBe(q.normal)
      }
    }
  })
  it('en «¿De qué programa vienes?» la marcada es «Empiezo de cero», no Cegid Diez: no se sugiere ningún programa', () => {
    const p = todasLasPreguntas('cuentas', ctx).find((q) => q.clave === 'programa')!
    expect(p.normal).toBe('ninguno')
    expect(p.opciones[0].valor).toBe('diez')
  })
})
