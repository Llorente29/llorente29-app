// tests/unit/modules/conta/i01b/certificados.test.ts
//
// I01b · P4 · El núcleo de Certificados y accesos. El certificado es de
// mentira (titular y fechas inventados); los textos de custodia, los de la
// base (conta_cert_custodia de la 0130).

import { describe, expect, it } from 'vitest'
import { avisoCaducidad, chipsCertificado, lineaAsesoria, lineaCertificado, resultadoUso, textoUso, type Certificado, type Uso } from '@/modules/conta/impuestos/certificados'

const cert = (o: Partial<Certificado> = {}): Certificado => ({
  id: 'c', titular: 'EMPRESA DE PRUEBA SL', nif_cola: '00T', tipo: 'legal_representative', emisor: 'AC DE PRUEBA',
  desde: '2025-03-14T00:00:00Z', caduca: '2027-03-14T00:00:00Z', estado: 'active', almacen: 'vault', custodia: '—',
  subido: '2026-04-03T08:05:00Z', subido_por: 'Julio', quitado: null, quitado_por: null,
  probado: '2026-10-09T07:12:00Z', prueba: 'ok', prueba_mensaje: null, presenta: true,
  permisos: [{ persona: 'u1', nombre: 'Julio', permiso: 'file' }, { persona: 'u2', nombre: 'Ana', permiso: 'view' }], ...o,
})

describe('la ficha del certificado', () => {
  it('la línea y los chips de la maqueta', () => {
    expect(lineaCertificado(cert())).toBe('Certificado de representante de EMPRESA DE PRUEBA SL · válido hasta el 14/03/2027')
    expect(chipsCertificado(cert()).map((c) => c.texto)).toEqual(['Funciona · probado con Hacienda el 09/10', 'Pueden presentar: Julio', 'Solo ver: Ana'])
  })
  it('sin probar, o que falló al probarlo, lo dice; sin permisos dados, presentan los administradores', () => {
    expect(chipsCertificado(cert({ probado: null, prueba: null, permisos: [] })).map((c) => c.texto)).toEqual(['Aún sin probar con Hacienda', 'Pueden presentar: los administradores'])
    expect(chipsCertificado(cert({ prueba: 'error' }))[0]).toEqual({ tono: 'falta', texto: 'No funcionó al probarlo el 09/10' })
  })
  it('quitado: con quién y cuándo', () => {
    expect(lineaCertificado(cert({ estado: 'removed', quitado: '2026-10-18T10:00:00Z', quitado_por: 'Julio' }))).toBe('Certificado de representante de EMPRESA DE PRUEBA SL · quitado el 18/10/2026 por Julio')
  })
})

describe('el registro de usos', () => {
  const uso = (o: Partial<Uso>): Uso => ({ cuando: '2026-07-20T10:51:00Z', quien: 'Julio', accion: 'file', resultado: 'ok', mensaje: null, declaracion: null, ...o })
  it('las filas de la maqueta', () => {
    expect(textoUso(uso({ accion: 'test' }))).toBe('Prueba de conexión con Hacienda')
    expect(resultadoUso(uso({ accion: 'test' })).texto).toBe('✓ correcta')
    const d = { id: 'r', modelo: '303', ejercicio: 2026, periodo: '2T', justificante_pdf: 'cuenta/impuestos/r/h.pdf' }
    expect(textoUso(uso({ declaracion: d }))).toBe('Presentó el IVA del 2.º trimestre (303)')
    expect(resultadoUso(uso({ declaracion: d }))).toEqual({ tono: 'ok', texto: 'Justificante', justificante: 'cuenta/impuestos/r/h.pdf' })
    expect(textoUso(uso({ accion: 'upload' }))).toBe('Subió el certificado')
    expect(resultadoUso(uso({ accion: 'upload' })).texto).toBe('—')
  })
  it('lo que no se dejó y lo que falló, con su porqué', () => {
    expect(resultadoUso(uso({ resultado: 'denied', mensaje: 'Esa confirmación ya se usó.' })).texto).toBe('No se dejó: Esa confirmación ya se usó.')
    expect(resultadoUso(uso({ resultado: 'error', mensaje: 'Hacienda no contesta.' })).texto).toBe('✗ Hacienda no contesta.')
  })
})

describe('el aviso de caducidad: solo a 30 días o a 7', () => {
  it('a 31 días, nada; a 30, ámbar; a 8, ámbar; a 7, rojo; caducado, rojo', () => {
    expect(avisoCaducidad('2026-11-18', '2026-10-18')).toBeNull()
    expect(avisoCaducidad('2026-11-17', '2026-10-18')).toEqual({ tono: 'duda', texto: 'El certificado para presentar impuestos caduca el 17/11, dentro de 30 días.' })
    expect(avisoCaducidad('2026-10-26', '2026-10-18')?.tono).toBe('duda')
    expect(avisoCaducidad('2026-10-25', '2026-10-18')).toEqual({ tono: 'falta', texto: 'El certificado para presentar impuestos caduca el 25/10, dentro de 7 días.' })
    expect(avisoCaducidad('2026-10-17', '2026-10-18')?.texto).toBe('El certificado para presentar impuestos caducó el 17/10: sube uno nuevo.')
  })
})

describe('la asesoría', () => {
  it('sin asesoría, la explicación de la maqueta; con ella, quién, cómo y quién lo permitió', () => {
    const p = { modo: 'company' as const, certificado: null, asesoria: null, base: null, consentida_por: null, consentida_el: null, retirada_el: null, desde: null }
    expect(lineaAsesoria(p)).toContain('colaborador social o con un poder tuyo')
    expect(lineaAsesoria({ ...p, modo: 'advisor', asesoria: 'Asesoría de Prueba', base: 'social_collaborator', consentida_por: 'Julio', consentida_el: '2026-10-18T09:00:00Z' }))
      .toBe('Presenta Asesoría de Prueba, como colaboradora social; lo permitió Julio el 18/10. Ella sube su certificado en su Sumied; tú no ves nada de él.')
  })
})
