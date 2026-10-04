// src/modules/conta/proveedor/useGuardarAlSalir.ts
//
// «Se guarda al salir del campo» (encargo C01b §5): cada campo, al perder el
// foco (o al tocar una píldora o un desplegable), manda SOLO lo suyo. Si no ha
// cambiado nada respecto a la ficha guardada, no escribe. Si el núcleo
// encuentra un error (validarFicha), no guarda y lo dice en el campo.
//
// Confirma con contenido (regla 8): «Guardado: razón social.», no un visto.

import { useCallback, useState } from 'react'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import type { FichaProveedor } from '@/modules/conta/types'
import type { ProblemaFicha } from '@/modules/conta/lib/validacionesFicha'

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export interface GuardarAlSalir {
  /** Lo que se ha guardado, o null. */
  texto: string | null
  ocupado: boolean
  /** Fallo de la base (no de validación). */
  fallo: string | null
  errores: ProblemaFicha[]
  avisos: ProblemaFicha[]
  /** Error de un campo concreto, del núcleo o puesto a mano con `marcar`. */
  error: (campo: keyof FichaProveedor) => string | null
  aviso: (campo: keyof FichaProveedor) => string | null
  /** Pone (o quita, con null) el error de un campo sin ir a la base: validación al momento. */
  marcar: (campo: keyof FichaProveedor, mensaje: string | null) => void
  /** Guarda lo que haya cambiado de `cambios`. `que` dice qué se guardó. Devuelve si guardó. */
  guardar: (cambios: Partial<FichaProveedor>, que: string) => Promise<boolean>
}

export function useGuardarAlSalir(): GuardarAlSalir {
  const { datos, guardar: guardarFicha } = useFicha()
  const [texto, avisar] = useAvisoGuardado()
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [errores, setErrores] = useState<ProblemaFicha[]>([])
  const [avisos, setAvisos] = useState<ProblemaFicha[]>([])

  const marcar = useCallback((campo: keyof FichaProveedor, mensaje: string | null) => {
    setErrores((es) => [...es.filter((e) => e.campo !== campo), ...(mensaje ? [{ campo, mensaje }] : [])])
  }, [])

  const guardar = useCallback(async (cambios: Partial<FichaProveedor>, que: string): Promise<boolean> => {
    const f = datos.ficha
    const cambiados = Object.fromEntries(
      Object.entries(cambios).filter(([k, v]) => !igual(f[k as keyof FichaProveedor], v)),
    ) as Partial<FichaProveedor>
    const campos = Object.keys(cambios) as (keyof FichaProveedor)[]
    // Lo que se vuelve a dejar como estaba limpia su error.
    if (Object.keys(cambiados).length === 0) {
      setErrores((es) => es.filter((e) => !campos.includes(e.campo)))
      return false
    }
    setOcupado(true); setFallo(null)
    try {
      const r = await guardarFicha(cambiados)
      setErrores((es) => [...es.filter((e) => !campos.includes(e.campo)), ...r.errores])
      setAvisos((as) => [...as.filter((a) => !campos.includes(a.campo)), ...r.avisos])
      if (r.errores.length > 0) return false
      avisar(`Guardado: ${que}.`)
      return true
    } catch (e) {
      setFallo(e instanceof Error ? e.message : 'No se pudo guardar.')
      return false
    } finally {
      setOcupado(false)
    }
  }, [datos.ficha, guardarFicha, avisar])

  return {
    texto, ocupado, fallo, errores, avisos, marcar, guardar,
    error: (c) => errores.find((e) => e.campo === c)?.mensaje ?? null,
    aviso: (c) => avisos.find((e) => e.campo === c)?.mensaje ?? null,
  }
}
