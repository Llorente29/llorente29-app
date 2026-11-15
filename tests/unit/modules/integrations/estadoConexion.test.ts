// tests/unit/modules/integrations/estadoConexion.test.ts
//
// B01r26 (15/11) · Folvy › Integraciones se rompía con la conexión de Diez en
// `down` (la renovación fallida del token, connector_mark_down). Los estados son
// los del CHECK de account_connector en producción (account_connector_status_check,
// leído el 15/11), y los campos, los del config_schema de los conectores «diez» y
// «catcher» de la tabla connector. Los valores son inventados.

import { describe, expect, it } from 'vitest'
import { configParaGuardar, presentacionDeEstado, secretosParaGuardar } from '@/modules/integrations/lib/estadoConexion'
import type { ConnectorConfigField } from '@/types/integrations'

// account_connector_status_check, tal cual está en producción.
const DEL_CHECK = ['available', 'requested', 'connecting', 'connected', 'paused', 'error', 'down']

const DIEZ: ConnectorConfigField[] = [
  { key: 'nombre_bd', type: 'text', label: 'Base de datos de la empresa en Diez', required: true },
  { key: 'client_id', type: 'secret', label: 'client_id', required: true },
  { key: 'client_secret', type: 'secret', label: 'client_secret', required: true },
  { key: 'username', type: 'secret', label: 'Usuario', required: true },
  { key: 'password', type: 'secret', label: 'Contraseña', required: true },
] as ConnectorConfigField[]

const TODAS = { nombre_bd: 'C0000', client_id: 'cliente-0000', client_secret: 'secreto-0000', username: 'usuario0', password: 'clave0' }

describe('presentacionDeEstado', () => {
  it('cada estado que admite la base tiene su presentación, sin «desconocido»', () => {
    for (const e of DEL_CHECK) {
      const p = presentacionDeEstado(e)
      expect(p.desconocido, e).toBe(false)
      expect(p.etiqueta, e).not.toMatch(/desconocido/i)
    }
  })

  it('down es «Caída», en rojo, y hay que volver a guardar las credenciales', () => {
    expect(presentacionDeEstado('down')).toEqual({ etiqueta: 'Caída', tono: 'mal', icono: 'caida', rota: true, desconocido: false })
    expect(presentacionDeEstado('error').rota).toBe(true)
    expect(presentacionDeEstado('connected').rota).toBe(false)
  })

  it('un estado que no conoce no rompe: lo dice por su nombre', () => {
    expect(presentacionDeEstado('suspendida')).toMatchObject({ etiqueta: 'Estado desconocido (suspendida)', desconocido: true, icono: 'duda' })
    expect(presentacionDeEstado(undefined)).toMatchObject({ etiqueta: 'Estado desconocido', desconocido: true })
    // Ni lo que hereda un objeto: «toString» no es un estado.
    expect(presentacionDeEstado('toString').desconocido).toBe(true)
  })
})

describe('secretosParaGuardar', () => {
  it('con las cuatro escritas, van las cuatro (recortadas)', () => {
    const r = secretosParaGuardar(DIEZ, { ...TODAS, client_id: '  cliente-0000 ' }, true)
    expect(r).toEqual({ ok: true, secretos: { client_id: 'cliente-0000', client_secret: 'secreto-0000', username: 'usuario0', password: 'clave0' } })
  })

  it('con credenciales guardadas y todo en blanco, NO guarda: en blanco las borraría', () => {
    const r = secretosParaGuardar(DIEZ, { nombre_bd: 'C0000' }, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/escribe otra vez «client_id», «client_secret», «Usuario» y «Contraseña»/)
  })

  it('con solo una escrita, NO guarda: las otras tres se borrarían', () => {
    const r = secretosParaGuardar(DIEZ, { nombre_bd: 'C0000', password: 'clave0' }, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/^Faltan «client_id», «client_secret» y «Usuario»/)
  })

  it('sin credenciales todavía, también hacen falta todas', () => {
    const r = secretosParaGuardar(DIEZ, { nombre_bd: 'C0000', client_id: 'cliente-0000', client_secret: 'secreto-0000', username: 'usuario0' }, false)
    expect(r).toEqual({ ok: false, motivo: 'Falta «Contraseña»: se guardan todas a la vez, y lo que no se escribe se borra.' })
  })

  it('un conector sin secretos guarda sin pedir nada', () => {
    const r = secretosParaGuardar([{ key: 'auto', type: 'boolean', label: 'Automático', required: false }] as ConnectorConfigField[], {}, true)
    expect(r).toEqual({ ok: true, secretos: {} })
  })
})

describe('configParaGuardar', () => {
  it('no pierde la config que no sale en el formulario (base_url, adjuntar_documentos de Diez)', () => {
    const actual = { base_url: 'https://diez.invalid', nombre_bd: 'C0000', adjuntar_documentos: false }
    expect(configParaGuardar(actual, { nombre_bd: 'C0001' })).toEqual({ base_url: 'https://diez.invalid', nombre_bd: 'C0001', adjuntar_documentos: false })
    expect(configParaGuardar(null, { nombre_bd: 'C0001' })).toEqual({ nombre_bd: 'C0001' })
  })
})
