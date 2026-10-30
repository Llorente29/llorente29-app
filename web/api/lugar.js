// Devuelve la ciudad aproximada del visitante a partir de las cabeceras que pone Vercel.
// No guarda nada y no devuelve la IP.
var REDES = { "3352": "Movistar", "12479": "Orange", "12430": "Vodafone", "6739": "Vodafone", "15704": "MasMovil", "57269": "Digi" };
function dec(s) { try { return decodeURIComponent(String(s || "")).slice(0, 80); } catch (e) { return ""; } }
module.exports = function (req, res) {
  var h = req.headers || {};
  var asn = String(h["x-vercel-ip-as-number"] || "").replace(/[^0-9]/g, "").slice(0, 10);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 200;
  res.end(JSON.stringify({
    ciu: dec(h["x-vercel-ip-city"]),
    pais: dec(h["x-vercel-ip-country"]).slice(0, 2),
    red: asn ? (REDES[asn] || ("red " + asn)) : ""
  }));
};
