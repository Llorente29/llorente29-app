// tests/unit/modules/conta/q08/decisionesALaVista.test.tsx
//
// Q08 · «Cargar decisiones de QBO» en la pantalla de Clientes que monta la
// ruta (la G04). El #800 lo puso en ClientesCuotas.tsx, que no monta ninguna
// ruta, y en producción no se veía (Julio, 25/11). Aquí: que la ruta monta la
// G04, que el botón sale en su cabecera al lado de «Exportar», y que lo que ha
// pasado se dice (regla 8) con lo que no se ha atado (regla 7). Datos
// inventados (T11).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { Clientes } from '@/modules/conta/gestoria/g04/Clientes'
import { BotonDecisionesQbo, ResultadoDecisionesQbo } from '@/modules/conta/gestoria/g04/DecisionesQbo'
import { modeloClientes } from '@/modules/conta/gestoria/g04/modelo'
import type { DatosClientes } from '@/modules/conta/gestoria/g04/datos'

const Q = 'emp-prueba'
const EMPRESAS = [{ id: Q, nombre: 'Gestoría de Prueba, S.L.' }]
const DATOS: DatosClientes = {
  clientes: [], cuotasGc: [{ empresa_id: Q, al_mes: 121, altas_n: 0, altas_euros: 0, bajas_n: 0, bajas_euros: 0 }], proximos: [], cargos: [], queHacer: [],
  asignaciones: [], precios: [], servicios: [], niveles: [], paquetes: [], lineasDePaquete: [], ajustes: [], crm: [], gcDelMes: [],
}
const nada = () => undefined

function pintar(decisiones?: { boton: React.ReactNode; resultado: React.ReactNode }) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <Clientes modelo={modeloClientes(DATOS, EMPRESAS, [Q], '2026-11-25')} empresas={EMPRESAS} elegida={Q} alElegir={nada} mes="Noviembre de 2026" crm="Bitrix24"
        rutaFicha={() => '/x'} rutaTarifa="/t" rutaCrm={() => null} alExportar={nada} alAsignar={nada} alCobradoPorOtraVia={async () => ''}
        rutaPonerCuota={() => '/p'} hoy="2026-11-25" decisiones={decisiones} />
    </MemoryRouter>,
  )
}
const cabecera = (html: string) => /<header class="g4-cabecera">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ''

describe('Q08 · «Cargar decisiones de QBO», a la vista', () => {
  it('la ruta de Clientes y cuotas monta la G04 (no la pantalla de antes)', () => {
    const modulo = readFileSync('src/modules/conta/module.tsx', 'utf8')
    expect(modulo).toMatch(/path: CONTA\.rutas\.clientesCuotas, element: enMarco\(<SoloGestoria><ClientesG04Page \/>/)
    const pagina = readFileSync('src/modules/conta/gestoria/g04/paginas.tsx', 'utf8')
    expect(pagina).toContain('<BotonDecisionesQbo')
  })
  it('el botón sale en la cabecera, antes de «Exportar»', () => {
    const c = cabecera(pintar({ boton: <BotonDecisionesQbo cargando={false} alElegir={nada} />, resultado: null }))
    expect(c).toContain('Cargar decisiones de QBO')
    expect(c.indexOf('Cargar decisiones de QBO')).toBeLessThan(c.indexOf('Exportar'))
    expect(c).toContain('aria-label="El Excel de QBO con sus decisiones"')
  })
  it('sin GoCardless (sin el botón), no sale', () => {
    expect(pintar()).not.toContain('Cargar decisiones de QBO')
  })
  it('mientras carga, lo dice y no se puede pulsar otra vez', () => {
    const c = cabecera(pintar({ boton: <BotonDecisionesQbo cargando alElegir={nada} />, resultado: null }))
    expect(c).toMatch(/<button[^>]*disabled=""[^>]*>Cargando las decisiones de QBO…<\/button>/)
  })
  it('lo que ha pasado, con sus números, y lo que no se ha atado con su porqué', () => {
    const html = renderToStaticMarkup(<ResultadoDecisionesQbo cargando={false} aviso={{ ok: true, texto: 'Cargadas las decisiones de QBO (3 filas): 1 atados a su ficha.' }} lineas={[
      { fila: 2, emisor: 'Prueba', cliente: 'CLIENTE UNO SL', resultado: 'atado', frase: 'Atado.' },
      { fila: 3, emisor: 'Prueba', cliente: 'CLIENTE DOS SL', resultado: 'pendiente', frase: 'Pendiente de revisar.' },
      { fila: 4, emisor: 'Prueba', cliente: 'CLIENTE TRES SL', resultado: 'solo', frase: 'Se ata solo: no se toca.' },
    ]} />)
    expect(html).toContain('role="status"')
    expect(html).toContain('Lo que no se ha atado (1)')
    expect(html).toContain('CLIENTE DOS SL')
    expect(html).not.toContain('CLIENTE UNO SL')
  })
  it('si falla, lo dice como alerta', () => {
    const html = renderToStaticMarkup(<ResultadoDecisionesQbo cargando={false} aviso={{ ok: false, texto: 'No se han podido cargar las decisiones de QBO: falta la hoja.' }} lineas={null} />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('falta la hoja')
  })
})
