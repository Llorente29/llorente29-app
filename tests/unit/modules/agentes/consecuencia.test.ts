import { describe, it, expect } from 'vitest'
import { consecuenciaDeApagar, type EstadoAgente } from '@/modules/agentes/home/agentesService'

const a = (agent_key: string, nombre: string): EstadoAgente => ({
  agent_key, nombre, cadencia: 'x', que_hace: 'y', ultima_vez: null, estado: 'ok',
  corridas_24h: 0, fallos_24h: 0, pausado: false, paused_at: null, paused_by: null,
  se_puede_pausar: true, jobs_totales: 1, jobs_apagados: 0,
})

describe('la confirmación lleva la consecuencia dentro', () => {
  // Apagar Social no es lo mismo que apagar Guardias. Un «¿seguro?» idéntico
  // para los dos enseña a decir que sí sin leer.
  it('cada agente dice lo que se pierde, y no es el mismo texto', () => {
    const social = consecuenciaDeApagar(a('social', 'Social'))
    const guardias = consecuenciaDeApagar(a('guardias', 'Guardias'))
    expect(social).toContain('no se preparará ni publicará contenido')
    expect(guardias).toContain('nadie avisará de tablets mudas')
    expect(social).not.toBe(guardias)
  })

  // El alcance ya es el correcto —la pausa es por cuenta— así que la frase dice
  // «para esta cuenta» y no tiene que explicar que afecta a los demás.
  it('dice que es de esta cuenta', () => {
    expect(consecuenciaDeApagar(a('social', 'Social'))).toContain('para esta cuenta')
  })

  it('un agente sin texto propio no se queda sin consecuencia', () => {
    expect(consecuenciaDeApagar(a('nuevo', 'Nuevo'))).toContain('no trabajará para esta cuenta')
  })
})
