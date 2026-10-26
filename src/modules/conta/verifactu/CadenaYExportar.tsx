// src/modules/conta/verifactu/CadenaYExportar.tsx
//
// V03 · E3 · En Ajustes › Verifactu, los registros de la empresa:
//   · «Comprobar la cadena»: recorre las huellas (verifactu_comprobar_cadena) y
//     dice si falta algún registro o se ha tocado alguno, y cuál.
//   · «Exportar los registros»: todos, en Excel o CSV, con lo que entra en cada
//     huella para que una inspección pueda recalcularla.
// Los dos dicen en pantalla qué ha pasado (regla 8).

import { useState } from 'react'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { COLUMNAS_EXPORTAR, type Cadena, filasExportar } from '@/modules/conta/lib/verifactu/correccion'
import { comprobarCadena, registrosParaExportar } from '@/modules/conta/services/verifactuService'
import { exportarTabla, type FormatoExportar } from '@/modules/conta/ui/tabla/exportar'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }) : '—')

export function CadenaYExportar({ accountId, companyId, nombre, nif }: { accountId: string; companyId: string; nombre: string; nif: string | null }) {
  const [cadena, setCadena] = useState<Cadena | null>(null)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState<null | 'cadena' | FormatoExportar>(null)

  const comprobar = () => {
    setOcupado('cadena'); setAviso(null)
    void comprobarCadena(companyId).then(setCadena).catch((e) => setAviso({ ok: false, texto: msg(e) })).finally(() => setOcupado(null))
  }
  const exportar = (formato: FormatoExportar) => {
    setOcupado(formato); setAviso(null)
    void registrosParaExportar(accountId, companyId).then((rs) => {
      const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
      const fichero = exportarTabla(formato, {
        nombre: `Verifactu ${nif ?? nombre} ${hoy}`, titulo: 'Registros de facturación (Verifactu)', subtitulo: `${nombre}${nif ? ` · ${nif}` : ''} · exportado el ${dia(new Date().toISOString())}`,
        columnas: COLUMNAS_EXPORTAR, filas: filasExportar(rs),
      })
      setAviso(fichero
        ? { ok: true, texto: `Exportado ${fichero}: ${rs.length.toLocaleString('es-ES')} ${rs.length === 1 ? 'registro' : 'registros'}, en el orden de la cadena y con lo que entra en cada huella (SHA-256).` }
        : { ok: false, texto: 'No hay ningún registro de Verifactu de esta empresa: no hay nada que exportar.' })
    }).catch((e) => setAviso({ ok: false, texto: msg(e) })).finally(() => setOcupado(null))
  }

  return (
    <Tarjeta titulo="Tus registros en Hacienda" apoyo="Cada registro lleva la huella del anterior: si falta uno o se toca, la cadena se rompe." nivel={2}>
      <div className="cxvf-botones">
        <Boton variante="secundario" data-prueba="comprobar-cadena" disabled={ocupado !== null} onClick={comprobar}>{ocupado === 'cadena' ? 'Comprobando…' : 'Comprobar la cadena'}</Boton>
        <Boton variante="secundario" data-prueba="exportar-registros" disabled={ocupado !== null} onClick={() => exportar('xlsx')}>{ocupado === 'xlsx' ? 'Exportando…' : 'Exportar los registros (Excel)'}</Boton>
        <Boton variante="enlace" disabled={ocupado !== null} onClick={() => exportar('csv')}>{ocupado === 'csv' ? 'Exportando…' : 'En CSV'}</Boton>
      </div>
      {cadena && (
        <div className="cxvf-cuadre" data-prueba="cadena" data-tono={cadena.ok ? 'ok' : 'falta'} role="status">
          <p className="cxvf-cuadre-titulo">{cadena.ok ? 'La cadena está entera' : 'La cadena no está entera'}</p>
          <p>{cadena.frase}</p>
          {cadena.cadenas.map((c) => (
            <div key={c.entorno}>
              <p className="s-tarjeta-apoyo">
                <Chip tono={c.ok ? 'seguro' : 'falta'}>{c.entorno === 'real' ? 'Real' : 'Pruebas'}</Chip>{' '}
                {c.registros.toLocaleString('es-ES')} {c.registros === 1 ? 'registro' : 'registros'}, del {dia(c.desde)} al {dia(c.hasta)}
                {c.de_otras_empresas > 0 && ` (${c.de_otras_empresas} de otra empresa con el mismo NIF: la cadena es del NIF)`}
              </p>
              {c.problemas.length > 0 && (
                <ul className="cxvf-descuadre">
                  {c.problemas.map((p, i) => <li key={`${p.registro ?? 'cadena'}:${p.que}:${i}`}>{p.frase}</li>)}
                  {c.problemas_total > c.problemas.length && <li>Y {c.problemas_total - c.problemas.length} más del mismo tipo: exporta los registros para verlos todos.</li>}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {aviso && <p className="s-aviso-lista" data-tono={aviso.ok ? 'ok' : 'falta'} role="status" data-prueba="aviso-registros">{aviso.texto}</p>}
    </Tarjeta>
  )
}
