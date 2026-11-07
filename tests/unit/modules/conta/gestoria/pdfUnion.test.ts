// G01b · El PDF del ensayo de la unión: dice que es un ensayo, lleva la
// empresa, la fecha, el resumen y una tabla por bloque, y ningún código
// UF_CRM. Datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { ficheroDelEnsayo, limpio, pdfDelEnsayo, type DatosEnsayo } from '@/modules/conta/gestoria/pdfUnion'
import { opcionesDeCampos } from '@/modules/conta/gestoria/queEsCadaCampo'

const DATOS: DatosEnsayo = {
  empresa: 'Gestoría Alfa Ejemplo', leido: '2026-11-07T10:40:00Z', aplicada: false,
  resumen: { fichas: 6, clientes: 5, clientesUnidos: 1, fichasUnidas: 2, sinNifPorFormato: 1, sinNifPorMuchas: 0,
    clientesPorSituacion: { activo: 3, moroso: 0, solo_renta: 0, sin_clasificar: 1, baja: 1, sin_situacion: 0 },
    fichasPorSituacion: { activo: 3, moroso: 0, solo_renta: 0, sin_clasificar: 1, baja: 2, sin_situacion: 0 } },
  unidos: [{ nif: '00000000T', situacion: 'activo', fichas: [
    { bitrixId: '11', nombre: 'CLIENTE PRUEBA UNO', situacion: 'baja', situacionTexto: 'BAJA DE GESTORIA ❌' },
    { bitrixId: '12', nombre: 'CLIENTE PRUEBA UNO, S.L.', situacion: 'activo', situacionTexto: 'ACTIVO' }] }],
  sinNif: [{ bitrixId: '13', nombre: 'CLIENTE PRUEBA DOS', nifEnBitrix: '123', motivo: 'nif_no_valido', fichasConSuNif: 1 }],
}

// El texto de un PDF de jsPDF sin comprimir: lo que va entre paréntesis en cada «Tj».
const texto = (pdf: string) => [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(' ')

describe('G01b · el PDF del ensayo de la unión', () => {
  it('dice que es un ensayo, la empresa, la fecha, el resumen y los dos bloques', () => {
    const t = texto(pdfDelEnsayo(DATOS).output())
    expect(t).toContain('Gestoría Alfa Ejemplo')
    expect(t).toContain('7 de noviembre de 2026, 11:40')
    expect(t).toContain('ENSAYO. No se ha cambiado nada en Sumied ni en Bitrix24. Es lo que pasará cuando se aplique la unión en Ajustes > Cobros > Bitrix24.')
    expect(t).toContain('Clientes que resultan en Sumied')
    expect(t).toContain('Clientes que se unen \\(1\\)')
    expect(t).toContain('Fichas que entran sin NIF \\(1\\)')
    expect(t).toContain('CLIENTE PRUEBA UNO, S.L.')
    expect(t).toContain('00000000T')
    expect(t).not.toContain('❌')
    expect(t).toContain('No tiene formato de DNI, NIE ni CIF')
    expect(t).toContain('Página 1 de 1')
    expect(t).not.toMatch(/UF_CRM/)
  })

  it('aplicada, lo dice; y el nombre del fichero lleva la fecha', () => {
    expect(texto(pdfDelEnsayo({ ...DATOS, aplicada: true }).output())).toContain('ENSAYO. La unión ya está aplicada')
    expect(ficheroDelEnsayo(DATOS.leido)).toBe('Ensayo de la union de fichas de Bitrix24 - 2026-11-07.pdf')
  })

  it('lo que no cabe en la fuente (los «❌» de Bitrix24) se quita', () => {
    expect(limpio('BAJA DE GESTORIA ❌')).toBe('BAJA DE GESTORIA')
    expect(limpio('  Situación «Vzla»  ')).toBe('Situación «Vzla»')
  })

  it('«Qué es cada campo» no ofrece nunca un campo con una contraseña o un certificado', () => {
    const o = opcionesDeCampos({ UF_A: { formLabel: 'CIF/NIF' }, UF_B: { formLabel: 'Clave Certificado Digital' }, UF_C: { formLabel: 'Certificado', type: 'file' }, UF_D: { formLabel: 'Usuario vinculado' } })
    expect(o.map((x) => x.valor)).toEqual(['UF_A'])
  })
})
