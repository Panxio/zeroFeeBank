# M6-capturas — `demo:m6` deja de ensuciar el árbol

Enmienda de infraestructura a `specs/M6-demo-completa.md` § 4 (línea «Capturas»). SDD ligero; toca un árbitro, por eso el esperado se fija ANTES de correr.

## Problema (medido, no supuesto)
`scripts/demo-m6.mjs` reescribe las capturas de la referencia aprobada (`corrida-{1,2,3}/`) en cada batería (`rmSync` + `screenshot`). Las PNG llevan ruido (UUID visibles), así que `git status` queda sucio tras cada corrida, no se restauran solas y hay que restaurarlas a mano antes de cada merge.

## Qué hace
- El directorio de salida sale de `ZFB_CAPTURAS` (relativo a la raíz del repo, o absoluto). **Por defecto: un directorio `m6-ultima/` de última corrida**, ignorado por git.
- La carpeta de capturas de referencia queda como **referencia aprobada**: sólo se regenera a propósito, apuntando `ZFB_CAPTURAS` a ella al correr `npm run demo:m6`.
- `ZFB_CAPTURAS` vacío cuenta como no definida (usa el defecto).

> **Nota de la vitrina:** en el repositorio privado de origen el directorio por defecto, la carpeta de referencia y el directorio de E2 son rutas concretas bajo su carpeta de evidencias, que no se publica. Aquí se describen sin ruta; el comportamiento (`ZFB_CAPTURAS` o el defecto) es el mismo.

## No-goals
- No cambia ningún paso (P1–P14), ninguna aserción, ninguna constante ni el número de capturas por corrida.
- No se reordena ni se renombra el contenido de la carpeta de capturas de referencia.

## Esperado (fijado antes de medir)
| # | Condición | Resultado esperado |
|---|---|---|
| E1 | `npm run demo:m6` sin variable | `3/3 corridas · 42/42 pasos`; **0** líneas en `git status --porcelain` después; `corrida-{1,2,3}/` en el directorio por defecto, con **6 PNG cada una (18)** |
| E2 | `ZFB_CAPTURAS` apuntando a un directorio nuevo | **18** PNG en ese directorio; **0** líneas en `git status --porcelain` sobre la carpeta de capturas de referencia |
| E3 | `ZFB_CAPTURAS=` (vacía) | igual que E1 |

## Calibración (la ley del arnés: el check debe poder ponerse rojo)
El check es «`git status --porcelain` vacío tras la batería». Rojo esperado: la **línea base en `main`** (script sin cambiar) debe dejar **> 0** líneas sucias. Se mide antes de tocar el script.

## Hecho cuando
E1, E2 y E3 cumplen con los números de arriba, la línea base dio rojo (> 0), `typecheck` en 0 y `guante` 6/6 no se movieron.
