# DEUDA · Las capturas de Movimientos miran su CONTENIDO — spec

> Aprobada por el humano el 2026-09-24: unidad, spec y reparto.
> Casos y rojos esperados fijados ANTES de medir.

## 1. Qué hace / qué no / hecho

- **Qué hace.** El script de capturas de movimientos deja de contar archivos. Antes de cada
  `page.screenshot`, `foto()` corre dos chequeos sobre el artefacto renderizado; si alguno falla,
  la foto NO se cuenta, el estado va a `faltan` y el script sale ≠ 0 (como hoy con cualquier
  excepción dentro de `estado()`).
- **No-goals.** Los otros scripts de captura (t3, t4, abrir-cuenta, transferir). Cambios de UI o
  de `web/`. Cambiar los 6 estados, sus esperas o sus datos.
- **Hecho.** Línea base 12/12 exit 0 en **2 corridas** + `calibrar:capturas-s17-movimientos`
  **3/3 exactos** (§ 4), corridos sobre el artefacto.

## 2. Los dos chequeos

**CH-A · sujeto: la tabla no recorta su contenido.** Sólo en los estados con tabla (02, 03, 06):
para `.tabla-scroll` que contiene a `movimientos-tabla`, `scrollHeight <= clientHeight`.
Sin tolerancia: medido con el arreglo puesto, 663/663 · 2903/2903 · 1233/1233 ·
5753/5753. El motivo del rojo lleva el literal
`CH-A` y los dos números.

**CH-B · cámara: la foto muestra el estado que dice.** En todos los estados, justo antes del
`screenshot`:
1. `movimientos-region` existe y su `data-estado` es el esperado del estado
   (01 `inicial` · 02 `listo` · 03 `listo` · 04 `vacio` · 05 `error` · 06 `listo`).
2. La caja del ancla (el `ancla` que ya recibe `foto()`) **intersecta el viewport** con área > 0.
   Intersecta y no «cabe entera»: en el teléfono la tabla de 10 filas mide 1233 px en 844.

El motivo del rojo lleva el literal `CH-B` y qué falló (estado leído, o la caja del ancla).
El `scrollIntoViewIfNeeded(...).catch(() => {})` actual se traga el fallo del scroll: el
`.catch` se va y el fallo del scroll pasa a ser un `FALTA` más.

## 3. Constantes

| Constante | Valor | Por qué |
|---|---|---|
| Tolerancia de CH-A | 0 px | se midió igualdad exacta en los 4 casos |
| Área mínima de CH-B | > 0 px² | «se ve algo del ancla»; entera es imposible en el teléfono |
| Estado esperado por foto | tabla de § 2 | es el `data-estado` que cada estado ya espera antes de fotografiar |

## 4. Calibración (defectos y rojos pre-registrados)

Calibrador nuevo (`npm run
calibrar:capturas-s17-movimientos`). Paso 0: línea base limpia, exige 12/12. Por defecto: parcha
con reemplazo literal único, corre el script de capturas, lee las líneas `FALTA`
y exige **las dos mitades**: faltan EXACTAMENTE los declarados, con el literal de su chequeo en
el motivo, y todos los demás se capturan. Restaura siempre. Denominador fijo: 3.

| ID | Defecto | FALTA exactamente | Motivo |
|---|---|---|---|
| K1 | quitar `flex-shrink: 0` de `.movimientos-region .tabla-scroll` (`web/src/styles.css`) | esc-02, esc-06, tel-02, tel-03, tel-06 | CH-A |
| K2 | en el estado 02, `await page.goto(APP)` justo antes de su `foto(...)` | esc-02, tel-02 | CH-B |
| K3 | el `foto(...)` del estado 06 sin ancla (no hace scroll al aviso) | esc-06, tel-06 | CH-B |

**Derivación de K1** (pre-registrada, no medida): con los números medidos, cabecera ≈ 103 px y
fila ≈ 56 px (escritorio) / 113 px (teléfono); el hueco que le queda a la tabla encogida es
≈ 187 px / 73 px. Tabla de 1 fila: 159 px en escritorio (cabe, margen ~28 px → esc-03 verde) y
216 px en el teléfono (no cabe → tel-03 rojo). Si el resultado se desvía, se publica la
desviación; no se re-declara.

**Derivación de K3:** `movimientos-aviso-tope` va después de la tabla (`app.html:1192`); con 50
filas su caja queda a >2900 px del borde del viewport en los dos tamaños.
