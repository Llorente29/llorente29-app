// src/modules/agentes/home/agentesService.ts
//
// El estado de los agentes y su pausa. Las dos RPC son SECURITY DEFINER con
// guarda de cuenta: `authenticated` no tiene acceso al esquema `cron` y no debe
// tenerlo — leer el planificador entero desde el navegador sería enseñar la
// infraestructura de las tres cuentas.

import { rpcSinTipar } from '@/lib/rpcSinTipar'

export interface EstadoAgente {
  agent_key: string
  nombre: string
  cadencia: string
  que_hace: string
  ultima_vez: string | null
  /** 'ok' | 'con_fallos' | 'sin_datos' | 'pausado' */
  estado: string
  corridas_24h: number
  fallos_24h: number
  pausado: boolean
  paused_at: string | null
  paused_by: string | null
  /** false = todavía no lee la pausa, así que NO se enseña interruptor. */
  se_puede_pausar: boolean
  jobs_totales: number
  jobs_apagados: number
}

export async function leeAgentes(accountId: string): Promise<EstadoAgente[]> {
  return rpcSinTipar<EstadoAgente[]>('home_agentes_estado', { p_account_id: accountId })
}

/** Devuelve el estado RESULTANTE, leído de la base, no lo que se pidió. */
export async function pausaAgente(
  accountId: string, agentKey: string, pausar: boolean,
): Promise<{ pausado: boolean; paused_at?: string; por?: string }> {
  return rpcSinTipar('agent_pause_set', {
    p_account_id: accountId, p_agent_key: agentKey, p_pausar: pausar,
  })
}

/**
 * La frase de confirmación, con LA CONSECUENCIA DENTRO.
 *
 * No es un «¿seguro?»: apagar Social no es lo mismo que apagar Guardias, y un
 * «¿seguro?» idéntico para los dos enseña a decir que sí sin leer. Lo que se
 * pierde va escrito, y sin adornos.
 */
export function consecuenciaDeApagar(a: EstadoAgente): string {
  const porAgente: Record<string, string> = {
    social: 'Mientras esté apagado no se preparará ni publicará contenido en tus redes.',
    ofertas: 'Mientras esté apagado no se encenderán ni apagarán promociones solas: los precios se quedan como estén.',
    campanas: 'Mientras esté apagado nadie vigilará los valles de venta y no se dispararán campañas.',
    clima: 'Mientras esté apagado el reparto no se ajustará cuando vaya a llover.',
    guardias: 'Mientras esté apagado nadie avisará de tablets mudas, pedidos atascados ni ventas sin mapear.',
  }
  return `Vas a apagar ${a.nombre} para esta cuenta. `
    + (porAgente[a.agent_key] ?? 'Mientras esté apagado no trabajará para esta cuenta.')
}
