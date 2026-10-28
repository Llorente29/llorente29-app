// src/modules/personal/laboral/InformeJornadaVista.tsx
//
// L1a · PR 2 (28/10/2026). El informe del registro de jornada, como el tablero
// 5 de la maqueta: el título con la persona y el periodo, quién es (empresa,
// CIF, persona, centro, jornada), la tabla día a día con cómo se registró cada
// cosa y cada corrección a la vista, las cifras del periodo, la firma y la
// nota de la ley. Lo comparten la pantalla de la empresa y el enlace de la
// Inspección; los botones los pone quien la usa.

import type { ReactNode } from 'react'
import { Chip, Tarjeta, TarjetaCifra } from '@/modules/conta/diseno'
import type { InformeJornada } from './informeJornada'
import './estilo'

export default function InformeJornadaVista({ informe, acciones, encima }: {
  informe: InformeJornada
  acciones?: ReactNode
  /** Algo entre la cabecera y la tabla (el aviso del enlace, una confirmación). */
  encima?: ReactNode
}) {
  return (
    <div className="l-raiz" data-prueba="informe-jornada">
      <div className="l-cabeza">
        <div>
          <h1>{informe.titulo}</h1>
          <p className="l-apoyo">{informe.subtitulo}</p>
        </div>
        {acciones && <div className="l-acciones">{acciones}</div>}
      </div>

      {encima}

      {informe.avisos.length > 0 && (
        <Tarjeta tono="duda" titulo="Para tener en cuenta" nivel={3}>
          {informe.avisos.map(a => <p key={a} className="l-apoyo">{a}</p>)}
        </Tarjeta>
      )}

      <Tarjeta compacta>
        <div className="l-tabla-envoltorio">
          <table className="s-tabla l-tabla">
            <thead>
              <tr>
                <th>Día</th><th>Entrada</th><th>Pausas</th><th>Salida</th><th className="l-cifra">Horas</th><th>Cómo se registró</th>
              </tr>
            </thead>
            <tbody>
              {informe.filas.map(f => (
                <tr key={f.dia} data-prueba="informe-dia" data-dia={f.dia}>
                  <td><b>{f.diaTexto}</b></td>
                  {f.tramos.length === 0 ? (
                    <td colSpan={5} className="l-sin-jornada">{f.sinJornada}</td>
                  ) : (
                    <>
                      <td>{f.tramos.map((t, i) => <div key={i} className="l-tramo">{t.entrada}</div>)}</td>
                      <td>{f.tramos.map((t, i) => <div key={i} className="l-tramo">{t.pausas}</div>)}</td>
                      <td>{f.tramos.map((t, i) => (
                        <div key={i} className="l-tramo">
                          {t.sinSalida ? <Chip tono="falta">Sin salida</Chip> : t.salida}
                          {t.larga && <> <Chip tono="duda">Más de 12 h</Chip></>}
                        </div>
                      ))}</td>
                      <td className="l-cifra">{f.tramos.map((t, i) => <div key={i} className="l-tramo">{t.total}</div>)}</td>
                      <td>
                        <div className="l-registro">
                          {f.enDesacuerdo && <span><Chip tono="falta">El trabajador no está de acuerdo</Chip></span>}
                          {!f.enDesacuerdo && f.corregido && <span><Chip tono="duda">Corregido después</Chip></span>}
                          {f.registro.map(r => <p key={r}>{r}</p>)}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <div className="l-banda">
        <TarjetaCifra etiqueta="Total del periodo">{informe.totales.total}</TarjetaCifra>
        <TarjetaCifra etiqueta="Ordinarias">{informe.totales.ordinarias}</TarjetaCifra>
        <TarjetaCifra etiqueta="Extra">{informe.totales.extra}</TarjetaCifra>
        <TarjetaCifra etiqueta="Marcas corregidas">{informe.totales.corregidas}</TarjetaCifra>
      </div>

      {informe.semanas.length > 0 && (
        <Tarjeta titulo="Por semana, frente a la jornada del contrato" nivel={3} compacta>
          <div className="l-tabla-envoltorio">
            <table className="s-tabla">
              <thead><tr><th>Semana</th><th className="l-cifra">Trabajadas</th><th className="l-cifra">Contrato</th><th className="l-cifra">Ordinarias</th><th className="l-cifra">Extra</th></tr></thead>
              <tbody>
                {informe.semanas.map(s => (
                  <tr key={s.texto}>
                    <td>{s.texto}</td><td className="l-cifra">{s.trabajadas}</td><td className="l-cifra">{s.contrato}</td>
                    <td className="l-cifra">{s.ordinarias}</td><td className="l-cifra">{s.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      <p className="l-apoyo" data-prueba="informe-firma">{informe.firma}</p>
      <p className="l-nota">{informe.ley}</p>
    </div>
  )
}
