# Candado común a todas las specs de este directorio

> Este bloque aplica a **toda** spec de `specs/`. Está aquí una vez para no repetirlo;
> **se copia textual dentro de cada tarea**.

## La Regla de Oro, en su forma operativa

**Si un runner falla, el problema está en TU código, no en el runner.**
Los archivos `*.spec.ts` son la especificación ejecutable y **NO SE TOCAN**: ni una aserción,
ni un caso, ni un nombre, ni un `it.skip`. Si crees que un caso está mal escrito o es
imposible de cumplir, **DETENTE y escribe un bloqueo** describiendo el obstáculo en 2-3
líneas y 2-3 alternativas con sus consecuencias. No sigas.

**Prohibido reclasificar el rojo.** Nada de "fallo controlado", "conocido" o "tolerado".
Nada de `try/catch` que se trague un error para que el test pase. Nada de `expect(A.or(B))`
donde A es éxito y B es fracaso.

**No inventes datos.** Si falta una constante, un formato o una regla de negocio, se escala.
Un valor de ejemplo "para que lo reemplaces" es exactamente lo que esta regla prohíbe.

## Alcance de archivos

Cada spec enumera **los archivos que puedes crear o modificar**. Cualquier otro archivo del
repositorio está fuera de tu alcance, incluidos los `*.spec.ts`.

**No afirmes nada sobre el estado global del repositorio.** Tu criterio de éxito nunca es
"`git status` limpio": es "los comandos del árbitro pasan y toqué solo mis archivos".

## Cómo se verifica

```bash
npm run test:domain    # los runners del dominio
npm run typecheck      # chequeo de tipos en limpio
```

Ambos deben terminar en **exit 0**. Reporta **el número real** de pruebas pasadas y falladas
(Pilar 7). "Funciona" no es una métrica.

## Reglas de código que aplican a todo el dominio

- `src/domain/` **no importa nada** de NestJS, Prisma, Express ni de la base de datos.
- El dominio **nunca** llama a `Date.now()` ni a `new Date()`. El instante actual se recibe
  como parámetro.
- El dinero es `bigint` en centavos. **Prohibido** `number`, `float`, `parseFloat`, `Number()`
  y la aritmética de coma flotante para montos.
- Módulos ESM: los imports relativos llevan extensión `.js` (así lo exige el `tsconfig`).
- TypeScript estricto: sin `any`, sin `as` para silenciar al compilador, sin `@ts-ignore`.
