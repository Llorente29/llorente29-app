// tests/unit/modules/conta/marcaC06.test.ts
//
// C06 · Contabilidad sola, con su propia marca. Lo que se decide sin pantalla:
// con qué marca se enseña una pestaña, los enlaces de los correos con marca,
// quién hizo algo (persona o automático) y que ninguna frase de contabilidad
// escriba «Folvy» a mano.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  MARCAS, enlaceDeMarca, esHostDeProduccion, resolverMarca, urlBaseDeMarca,
} from '../../../../supabase/functions/_shared/marcas'
import { autorVisible, esFirmaAutomatica } from '@/modules/conta/lib/autor'
import { conLaMarca } from '@/modules/conta/lib/errorBase'
import { estadoDe, hechoAutomatico, type AsientoDiario } from '@/modules/conta/lib/diario'

describe('con qué marca se enseña la pestaña', () => {
  const r = (host: string, buscar = '', recordada: string | null = null) => resolverMarca({ host, buscar, recordada })

  it('en producción manda Folvy: ?marca= y lo recordado no hacen nada', () => {
    for (const host of ['app.folvy.app', 'foodint.folvy.app', 'folvy.app', 'folvy-app.vercel.app']) {
      expect(r(host, '?marca=contabilidad').id).toBe('folvy')
      expect(r(host, '', 'contabilidad').id).toBe('folvy')
      expect(r(host, '?marca=contabilidad').recordar).toBeUndefined()
      expect(esHostDeProduccion(host)).toBe(true)
    }
  })

  it('fuera de producción ?marca= la fuerza y se recuerda en la sesión', () => {
    expect(r('127.0.0.1', '?marca=contabilidad')).toEqual({ id: 'contabilidad', recordar: 'contabilidad', por: 'parametro' })
    expect(r('folvy-app-git-conta-c06-sola-llorente29s-projects.vercel.app', '?marca=contabilidad').id).toBe('contabilidad')
    expect(r('localhost', '', 'contabilidad')).toEqual({ id: 'contabilidad', recordar: undefined, por: 'recordada' })
  })

  it('?marca=folvy la olvida; una marca que no existe no hace nada', () => {
    expect(r('localhost', '?marca=folvy', 'contabilidad')).toEqual({ id: 'folvy', recordar: null, por: 'parametro' })
    expect(r('localhost', '?marca=otra', 'contabilidad').id).toBe('contabilidad')
    expect(r('localhost', '?marca=otra').id).toBe('folvy')
    expect(r('localhost').id).toBe('folvy')
  })

  it('el dominio de una marca manda siempre', () => {
    expect(r('app.folvy.app')).toEqual({ id: 'folvy', recordar: undefined, por: 'dominio' })
  })

  it('la marca de pruebas no tiene ni dominio ni remitente, ni textos legales (los pone Julio)', () => {
    const m = MARCAS.contabilidad
    expect(m.dominios).toEqual([])
    expect(m.remitente).toBeNull()
    expect(m.avisoLegal).toBeNull()
    expect(m.privacidad).toBeNull()
    expect(m.soloContabilidad).toBe(true)
    expect(JSON.stringify(m)).not.toMatch(/folvy/i)
  })

  it('Folvy sigue con su remitente de siempre', () => {
    expect(MARCAS.folvy.remitente).toBe('Folvy <no-reply@folvy.app>')
    expect(MARCAS.folvy.soloContabilidad).toBe(false)
  })
})

describe('los enlaces de los correos con marca', () => {
  it('sin dominio, la base de pruebas con ?marca=', () => {
    expect(urlBaseDeMarca(MARCAS.contabilidad)).toBeNull()
    expect(enlaceDeMarca(MARCAS.contabilidad, '/welcome', { token_hash: 'abc', type: 'recovery' }, 'https://vista.example/'))
      .toBe('https://vista.example/welcome?token_hash=abc&type=recovery&marca=contabilidad')
  })
  it('sin dominio y sin base, no hay enlace (y el correo no se manda)', () => {
    expect(enlaceDeMarca(MARCAS.contabilidad, '/welcome', {}, null)).toBeNull()
  })
  it('con dominio, el suyo y sin ?marca=', () => {
    expect(enlaceDeMarca(MARCAS.folvy, '/welcome', { a: '1' }, 'https://otra')).toBe('https://app.folvy.app/welcome?a=1')
  })
})

describe('quién lo hizo: persona o automático', () => {
  // Las firmas guardadas en producción el 13/10 (solo lectura): lo guardado se lee igual.
  it('las firmas de los escritores automáticos', () => {
    for (const n of ['Folvy', 'Folvy (cierre del día)', 'Folvy (validación automática de ventas)', 'Folvy · corte con Diez (C04 R4)']) {
      expect(esFirmaAutomatica(n)).toBe(true)
    }
    for (const n of ['Diez (traído)', 'Ana', 'Folvyna López', '', null]) expect(esFirmaAutomatica(n)).toBe(false)
  })
  it('con Folvy se enseña lo guardado; con una marca propia, «automático»', () => {
    expect(autorVisible('Folvy (cierre del día)', false)).toBe('Folvy (cierre del día)')
    expect(autorVisible('Folvy (cierre del día)', true)).toBe('automático')
    expect(autorVisible('Ana', true)).toBe('Ana')
    expect(autorVisible(null, true)).toBeNull()
  })
  const asiento = (o: Partial<AsientoDiario>): AsientoDiario => ({
    id: 'x', serie: 1, numero: 1, fecha: '2026-10-01', concepto: 'c', origen: 'sales_day', origenId: null, estado: 'validado',
    confianza: null, porque: null, razones: [], documento: null, terceroId: null, creadoPor: null, creadoEn: '2026-10-01T00:00:00Z',
    validadoPor: null, validadoEn: null, anuladoPor: null, anuladoEn: null, motivoAnulacion: null, anuladoCon: null, anulaA: null,
    traido: null, huella: null, huellaAnterior: null, cadena: null, apuntes: [], ...o,
  } as AsientoDiario)
  it('la lógica mira el campo; una fila guardada sin el campo se lee por su firma, igual que antes', () => {
    expect(hechoAutomatico(asiento({ validadoAutomatico: true, validadoPor: 'automático' }))).toBe(true)
    expect(hechoAutomatico(asiento({ validadoAutomatico: false, validadoPor: 'Folvy (algo)' }))).toBe(false)
    expect(hechoAutomatico(asiento({ validadoPor: 'Folvy (validación automática de ventas)' }))).toBe(true)
    expect(estadoDe(asiento({ validadoPor: 'Folvy (validación automática de ventas)' })).texto).toBe('Hecho por mí')
  })
})

describe('los errores de la base dicen la marca', () => {
  it('cambia «Folvy» por la marca, y con Folvy no toca nada', () => {
    expect(conLaMarca('Un ejercicio traído no se reabre en Folvy.', 'Contabilidad')).toBe('Un ejercicio traído no se reabre en Contabilidad.')
    expect(conLaMarca('Un ejercicio traído no se reabre en Folvy.')).toBe('Un ejercicio traído no se reabre en Folvy.')
  })
})

// Guarda: ninguna frase de contabilidad escribe «Folvy» a mano. Las que quedan
// son las que SOLO se dicen con Folvy (detrás de CON_MARCA, de MARCA.id o de
// `!solo`), la firma que se guarda en la base y la regla que la lee. Una nueva
// tiene que ir por la marca (src/modules/conta/cuenta/marca.ts).
describe('contabilidad no escribe «Folvy» a mano', () => {
  const PERMITIDAS: [string, RegExp][] = [
    // M01: «Volver a Folvy» vive en el marco nuevo, en el menú del usuario y en la hoja del móvil (detrás de `!solo`).
    ['marco/nuevo/BarraSuperior.tsx', /Volver a Folvy/],
    ['marco/nuevo/BarraInferior.tsx', /Volver a Folvy/],
    ['ajustes/MarcoAjustes.tsx', /CON_MARCA \? MARCA\.nombre : 'Folvy Conta'/],
    ['module.tsx', /CON_MARCA \? MARCA\.nombre : 'Folvy Conta'/],
    // D01: «Apuntar solo lo seguro» firma como escritor automático, igual que la de ventas (lib/autor.ts la reconoce).
    ['services/propuestasLibroService.ts', /p_quien_nombre: 'Folvy \((validación automática de ventas|apunta solo lo seguro)\)'/],
    ['lib/autor.ts', /FIRMA_AUTOMATICA = /],
    ['lib/errorBase.ts', /nombre === 'Folvy' \? texto : texto\.replace/],
  ]
  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? ficheros(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
    })
  }
  it('cada «Folvy» que queda está en la lista y es solo para Folvy', () => {
    const raiz = 'src/modules/conta'
    const sueltas: string[] = []
    for (const f of ficheros(raiz)) {
      const rel = f.slice(raiz.length + 1)
      readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
        const t = linea.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return
        if (!/\bFolvy\b/.test(linea.replace(/\/\/.*$/, ''))) return
        if (PERMITIDAS.some(([fi, re]) => rel === fi && re.test(linea))) return
        sueltas.push(`${rel}:${i + 1}: ${t.slice(0, 120)}`)
      })
    }
    expect(sueltas).toEqual([])
  })
})
