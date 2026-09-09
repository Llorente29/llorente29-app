// La plantilla única de los correos de alerta (paso 4 del estándar).
//
// LOS ASUNTOS DE ABAJO NO SON EJEMPLOS: son los que hay hoy en
// `system_alert_queue`, copiados tal cual (regla 31). Escribir esta prueba con
// ejemplos inventados sería mirarse al espejo — y de hecho fueron los asuntos
// reales los que enseñaron las dos duplicaciones que se arreglan con ella.

import { describe, it, expect } from 'vitest'
import {
  componerAsunto, componerCorreo, severidadDe,
} from '../../../supabase/functions/_shared/plantillaAlerta.ts'

describe('componerAsunto', () => {
  it('pone el negocio y el local delante, que es lo que faltaba en 74 de 76', () => {
    expect(componerAsunto('Sin pedidos desde hace 45 min — está abierto', 'Foodint', 'Alcalá'))
      .toBe('[Foodint · Alcalá] Sin pedidos desde hace 45 min — está abierto')
  })

  it('con negocio pero sin local, sólo el negocio: no se inventa un local', () => {
    expect(componerAsunto('1 Edge Function(s) no coinciden con main', 'Foodint', null))
      .toBe('[Foodint] 1 Edge Function(s) no coinciden con main')
  })

  it('sin negocio ni local dice Folvy: hay avisos que no son de nadie en concreto', () => {
    expect(componerAsunto('Canal de alertas degradado', null, null))
      .toBe('[Folvy] Canal de alertas degradado')
  })

  it('EL PREFIJO NO SE RECORTA NUNCA: si sobra, se corta la cola y se ve el corte', () => {
    // El más largo que hay hoy en la cola, 58 caracteres.
    const real = 'CRITICO: 49 productos vendidos sin catalogo (6.200,39 EUR)'
    const r = componerAsunto(real, 'Foodint', 'Carabanchel')
    expect(r.startsWith('[Foodint · Carabanchel] ')).toBe(true)
    expect(r.length).toBeLessThanOrEqual(78)
    expect(r.endsWith('…')).toBe(true)
  })

  it('lo que cabe entero no se toca', () => {
    const r = componerAsunto('Sin pedidos desde hace 45 min', 'Foodint', 'Alcalá')
    expect(r.endsWith('…')).toBe(false)
    expect(r).toContain('45 min')
  })

  it('un nombre vacío o en blanco no pinta un separador huérfano', () => {
    expect(componerAsunto('algo', 'Foodint', '   ')).toBe('[Foodint] algo')
    expect(componerAsunto('algo', '', '')).toBe('[Folvy] algo')
  })
})

describe('severidadDe', () => {
  it('los cuatro escalones se aceptan tal cual', () => {
    for (const s of ['critico', 'alto', 'aviso', 'info'] as const) {
      expect(severidadDe(s)).toEqual({ sev: s, declarada: true })
    }
  })

  it('NULL se trata como ALTO, no como bajo — «no lo sé» no es «no importa»', () => {
    // Los 16 vigías viejos aún no la declaran. Tratarlos como poco importantes
    // los silenciaría a los 24 puntos de llamada de golpe y sin avisar.
    expect(severidadDe(null)).toEqual({ sev: 'alto', declarada: false })
    expect(severidadDe(undefined)).toEqual({ sev: 'alto', declarada: false })
    expect(severidadDe('urgentisimo')).toEqual({ sev: 'alto', declarada: false })
  })
})

describe('componerCorreo', () => {
  const base = {
    subject: 'Sin pedidos desde hace 45 min — está abierto',
    message: 'Alcalá lleva 45 min sin ningún pedido.',
    kind: 'ingesta_silencio',
    creado_at: '2026-09-08T20:50:00Z',
  }

  it('el pie dice PRIMERO dónde, que es la razón de todo esto', () => {
    const c = componerCorreo({ ...base, severity: 'critico', negocio: 'Foodint', local: 'Alcalá' })
    const pie = c.text.split('— — —')[1]
    expect(pie).toContain('Foodint · Alcalá')
    expect(pie.indexOf('Foodint')).toBeLessThan(pie.indexOf('ingesta_silencio'))
  })

  it('cuando NO hay local lo dice, en vez de dejar el hueco', () => {
    const c = componerCorreo({ ...base, severity: 'info' })
    expect(c.text).toContain('Sin local: este aviso no es de un local concreto.')
  })

  it('una severidad sin declarar se CONFIESA, no se disimula de alto', () => {
    const c = componerCorreo({ ...base, negocio: 'Foodint' })
    expect(c.text).toContain('severidad sin declarar por el vigía')
    expect(c.html).toContain('severidad sin declarar por el vigía')
  })

  it('la fecha del pie va en hora de Madrid (regla 4)', () => {
    // 20:50 UTC del 8 son las 22:50 del 8 en Madrid.
    const c = componerCorreo({ ...base, severity: 'alto' })
    expect(c.text).toContain('22:50')
  })

  it('el HTML escapa lo que venga del mensaje: un aviso no inyecta marcado', () => {
    const c = componerCorreo({ ...base, message: 'fallo en <script>alert(1)</script> & cía' })
    expect(c.html).not.toContain('<script>')
    expect(c.html).toContain('&lt;script&gt;')
    expect(c.html).toContain('&amp;')
  })

  it('el color de la barra distingue crítico de aviso: nada de rojo por un aviso menor', () => {
    const critico = componerCorreo({ ...base, severity: 'critico' })
    const aviso = componerCorreo({ ...base, severity: 'aviso' })
    expect(critico.html).toContain('#b42318')
    expect(aviso.html).toContain('#475467')
    expect(aviso.html).not.toContain('#b42318')
  })

  it('sin campos nuevos sigue componiendo: es el camino de la reserva', () => {
    // `_shared/alerta.ts` cae al POST directo cuando la base no está, y ahí
    // sólo puede mandar subject/message/kind. Si esto exigiera los campos, el
    // único aviso que importa de verdad sería el único que no saldría.
    const c = componerCorreo({ subject: 'Webhook de ingesta CAÍDO', message: 'x' })
    expect(c.asunto).toBe('[Folvy] Webhook de ingesta CAÍDO')
    expect(c.text).toContain('x')
  })
})
