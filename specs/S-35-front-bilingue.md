# S-35 — Front bilingüe ES/EN

> Origen: alcance de quien busque un fork de ParaBank para automatizar.
> Metas y umbrales: fijados en § Hecho cuando. Aquí no se redefinen; se aplican.

## Qué hace
`web/` ofrece **español (por defecto) e inglés**, con un selector de idioma visible y persistente
en la sesión del navegador. Todo texto visible al usuario sale de un catálogo ES/EN, incluidos los
errores de negocio, que se muestran por **código tipado (C5)** y no por el `mensaje` en prosa del backend.
`<html lang>` sigue al idioma activo.

## No-goals
- No se toca `src/` (backend, dominio, ledger): «UI sin dinero; el núcleo financiero no se toca».
  Consecuencia: el `mensaje` en español que envía el backend **no se traduce en el servidor**; el front
  lo reemplaza por el texto del catálogo según `codigo`.
- No se cambian `data-testid` (contrato C3) ni los códigos de error (C5). Un `testid` nuevo (p. ej. el
  selector de idioma) se anota en el registro de cambios y rompe árbitros por lista cerrada.
- No se traducen datos del usuario (nombres, glosas) ni montos: el formato de moneda/fecha queda como está.
- No se agregan más idiomas ni se implementa i18n por URL/SEO.

## Hecho cuando (metas fijas, no se modifican)
S35-1 … S35-5 y B. Resumen: 0 textos en idioma
equivocado sobre el artefacto renderizado, ES y EN, árbitro calibrado en rojo · 0 árbitros rojos sin explicar ·
≤ 6 h activas / ≤ 24 h calendario · `docs` ≤ 25 % de los commits de S-35 · cuota reportada · tabla B.

## Predictor (anotado ANTES de tocar código — 2026-10-02)
Supuestos iniciales, falsables; se comparan con lo medido al cerrar:
1. **Si el contrato de la SUT aguanta** (C3/C5), se rompen pocos árbitros: **≤ 5 de los 50 scripts de
   `package.json`** (los que afirman sobre texto visible) y ningún invariante I1–I7.
2. **Riesgo principal (hipótesis): los errores.** `app.html`/`app.ts` muestran el `mensaje` del backend
   en 43 puntos (`.mensaje`: 11 en html, 32 en ts). Esos textos llegarán en español en modo EN: es lo que
   S35-1 debe cazar primero. Si el predictor 1 falla, la causa probable es ésta.
3. **Riesgo de tamaño:** el front es monolítico (`app.html` 1.639 líneas, `app.ts` 2.663), así que la
   extracción no es paralelizable por pantalla; va en una sola entrega, no en dos.
4. **Riesgo de proceso:** el `docs` ≤ 25 % es la meta que más probablemente falle (base 54,2 %).

## Decisión de mecanismo
`@angular/localize` **no está instalado** y obliga a un build por idioma (dos URL, dos artefactos para
los árbitros). **Elegido: catálogo propio en tiempo de ejecución** (diccionario ES/EN tipado + `signal`
de idioma + función `t(clave)` / pipe), un solo build, una sola URL, `testid` intactos. Costo: no hay
extracción automática de cadenas, y la completitud la garantiza el árbitro S35-1 (por eso es el
corazón de la unidad). Alternativa descartada: `@angular/localize` (dependencia nueva, doble artefacto).

## Decisión de alcance (2026-10-02): S35-1 sobre textos del backend
Opción **B**. El marco de login (`src/modules/auth/marco.pagina.ts`, iframe servido por el backend) y los PDFs
(comprobantes y boletas, PDFKit en `src/modules/comprobantes/plantillas/pdf.ts`) quedan **fuera de S35-1, por
lista nombrada**: se quedan en español. El árbitro S35-1 lleva esa lista como excepción exacta (no un patrón
amplio) y falla si aparece **otro** texto en español en modo EN. Se reporta como hallazgo de producto y deuda
(llevarlos a EN sería otra unidad con spec).

## Costura nueva: idioma por URL (C2/C3, representa un estado real del sistema)
`?lang=en|es` en la URL fija el idioma al arrancar (prioridad: query > `sessionStorage` > `es`). Existe para que
el barrido S35-1 y las suites entren a cada ruta en un idioma determinado sin pulsar el selector. `data-testid`
nuevos: `idioma-selector` (el `<select>`). Anotados aquí como cambio de contrato C3.

## Fases
Secuencia de trabajo: mapa → catálogo → árbitro S35-1 y su calibración → verificación independiente → re-medición S35-2 → aprobación visual → cierre.
Rama dedicada; merge sujeto a aprobación.

## Constantes
- Idioma por defecto `es` (el producto nace en español).
- Persistencia: `sessionStorage` clave `zfb.idioma` (misma familia que `zfb.auth.cerrar`).
- Lista de términos del barrido S35-1: se versiona junto al resultado (ley del arnés: un check por ausencia versiona su lista).
