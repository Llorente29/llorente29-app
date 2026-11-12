// src/modules/conta/compras/reglasSocio.ts
//
// S01p·18 · Lo que se recuerda de las líneas de la transacción del socio de
// marca (socio_linea_regla), por socio y concepto: sus textos, y el gancho
// que trae lo que ya se sabe y lo pendiente de facturar en un local.

import { useEffect, useState } from 'react'
import { rpc } from '@/modules/conta/services/bd'
import type { QueEsLinea } from '@/modules/conta/lib/lectorLiquidacionMensual'

export interface ReglaSocio { concepto: string; clave: string; queEs: QueEsLinea; fecha: string; quien: string | null }
export interface ContextoDelSocio { reglas: Record<string, ReglaSocio>; pendiente: number; listo: boolean; fallo: string | null }

/** Las opciones, en palabras de usuario (maqueta S01p·18). */
export const TEXTO_QUE_ES: Record<QueEsLinea, string> = {
  pendiente_facturar: 'Género que te cobrará el mes que viene',
  cancela_pendiente: 'Género del mes pasado que ya te cobra',
  a_mano: 'Otra cosa: la apunto yo a mano',
}

/** Lo que se recuerda, en una frase para la ficha del socio. */
export const FRASE_QUE_ES: Record<QueEsLinea, string> = {
  pendiente_facturar: 'es género que te cobrará el mes que viene',
  cancela_pendiente: 'es el género del mes pasado que ya te cobra',
  a_mano: 'la apuntas tú a mano',
}

export const leerReglasSocio = (empresa: string, proveedor: string) =>
  rpc<ReglaSocio[]>('compras_socio_reglas', { p_empresa: empresa, p_proveedor: proveedor })
export const guardarReglaSocio = (empresa: string, proveedor: string, concepto: string, queEs: QueEsLinea | null) =>
  rpc<ReglaSocio | null>('compras_socio_regla_guardar', { p_empresa: empresa, p_proveedor: proveedor, p_concepto: concepto, p_que_es: queEs })

/** Lo que el socio ya sabe de sus líneas y lo pendiente en ese local, para el lector. */
export function useContextoSocio(empresa: string | null, proveedor: string, local: string | null) {
  const [estado, setEstado] = useState<ContextoDelSocio>({ reglas: {}, pendiente: 0, listo: false, fallo: null })
  useEffect(() => {
    let vivo = true
    if (!empresa || !proveedor) return
    void Promise.all([
      leerReglasSocio(empresa, proveedor),
      local ? rpc<number>('compras_socio_pendiente', { p_empresa: empresa, p_proveedor: proveedor, p_local: local }) : Promise.resolve(0),
    ]).then(([rs, p]) => {
      if (!vivo) return
      setEstado({ reglas: Object.fromEntries((rs ?? []).map((r) => [r.clave, r])), pendiente: Number(p ?? 0), listo: true, fallo: null })
    }).catch((e: unknown) => {
      if (vivo) setEstado({ reglas: {}, pendiente: 0, listo: true, fallo: `No he podido saber lo que ya sé de este socio: ${e instanceof Error ? e.message : String(e)}` })
    })
    return () => { vivo = false }
  }, [empresa, proveedor, local])
  return !empresa || !proveedor ? SIN_SOCIO : estado
}
const SIN_SOCIO: ContextoDelSocio = { reglas: {}, pendiente: 0, listo: true, fallo: null }
