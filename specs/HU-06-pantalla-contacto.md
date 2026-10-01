# HU-06 · Pantalla de datos de contacto

> Historia de pantalla (humano: una HU por pantalla). El backend existe desde S-14
> (`GET /contacto`, `PUT /contacto`). Escrita el **2026-09-15**.
> Auditoría de huecos: 4 brutos, 0 reales (§ 6).
> De ella sale S-17-contacto (§ 8). **No pide backend.**

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** ver y actualizar mi nombre, dirección y teléfono,
> **para** que el banco tenga mis datos al día,
> **y** ver mi email, sin poder cambiarlo desde aquí.

## 2 · Variantes del flujo

| # | Variante | API hoy | Qué falta |
|---|---|---|---|
| V1 | Ver mis datos (usuario nuevo: todos vacíos salvo el email) | ✅ `GET /contacto` (`null` en los 7) | pantalla |
| V2 | Guardar los 7 datos | ✅ `PUT /contacto`, reemplazo total | pantalla |

## 3 · Reglas de negocio (de las specs del backend o del humano — no inventadas)

| # | Regla | Fuente |
|---|---|---|
| R1 | Siete datos **obligatorios** en cada guardado, no vacíos tras recortar espacios: nombre 50 · apellido 50 · dirección 100 · ciudad 50 · estado 50 · código postal 20 · teléfono 20. | S-14 N1 |
| R2 | Teléfono y código postal son **texto libre**, sin formato (paridad ParaBank literal). | S-14 N1 (humano) |
| R3 | El **email no se cambia**: es la credencial de acceso. Se muestra de sólo lectura; si llega distinto, `400 EMAIL_NO_MODIFICABLE`. | S-14 § 1 (humano, 2026-09-09) |
| R4 | Sólo se aplica `trim()`: sin normalizar mayúsculas ni acentos. | S-14 § 1 |
| R5 | Guardar no mueve plata ni pide `Idempotency-Key`. | S-14 § 1 |

## 4 · Decisiones de diseño

- **J1 · Un usuario nuevo ve el formulario vacío**, no la palabra «null», y el primer guardado
  exige los 7 datos (R1). Es el caso borde de V1.
- **J2 · El email va en un campo de sólo lectura, fuera del cuerpo del `PUT`.** Así R3 no se puede
  gatillar desde la pantalla; el caso `EMAIL_NO_MODIFICABLE` se prueba por API.
- **J3 · Confirmación efímera** al guardar, con `role=status`: es el desafío 17 del catálogo
  (S-10 § 3). Sale sola y no bloquea; la suite la espera por su estado (C4), no por tiempo.
- **J4 · Validación en el cliente sólo por comodidad.** La autoridad es la API: cada rechazo se
  muestra con su código (C5), en el orden de precedencia de S-14 (`contacto.service.ts:95`).
- **J5 · Al guardar, la pantalla muestra lo que devolvió el `PUT`** (ya recortado, R4), no lo que
  se tecleó.

## 5 · Criterios de aceptación (verificables sobre el artefacto renderizado, C3)

- CA1 · Usuario nuevo → formulario vacío y email visible de sólo lectura (J1, J2).
- CA2 · Guardar los 7 datos válidos → confirmación efímera `role=status` (J3). Al recargar, los
  datos siguen ahí.
- CA3 · Cada dato vacío, sólo espacios o sobre su máximo → su código (`CONTACTO_NOMBRE_INVALIDO` …
  `CONTACTO_TELEFONO_INVALIDO`), y los datos guardados no cambian. Borde exacto: máximo → pasa,
  máximo + 1 → rechazo.
- CA4 · «  Ana  » se guarda y se muestra como «Ana» (R4, J5).
- CA5 · Teléfono con letras → se guarda tal cual (R2): el caso que prueba que no hay formato.
- CA6 · Con la validación del cliente desactivada, la API igual rechaza (J4).
- CA7 · Estado de carga explícito (C4) al leer y al guardar.

## 6 · Huecos del mapa, clasificados

| Hueco | Clasificación |
|---|---|
| Sin `PATCH` | no hace falta: el formulario envía los 7 datos, prellenados desde el `GET` |
| No se cambia el email ni la contraseña | no-goal de S-14 (R3) |
| Sin formato de teléfono ni de código postal | no-goal de S-14 (R2) |
| Usuario nuevo con los 7 en `null` | no es un hueco de la API: caso borde de la pantalla (J1, CA1) |

## 7 · Invariantes

No mueve plata: I1–I5 e I7 no pueden cambiar por usar esta pantalla.

## 8 · Specs que salen de esta HU

| Spec | Qué | Árbitro | Reparto |
|---|---|---|---|
| **S-17-contacto** | Pantalla y entrada `nav-contacto` (reservada en S-10 § 6; su lugar en la barra lo fija la spec) | CA1–CA7 y la lista de `data-testid` | delegable con el arnés hecho; es la pantalla más chica |

## 9 · No-goals

- Cambiar el email o la contraseña (R3).
- Validar formatos (R2) o normalizar texto (R4).
- Guardado parcial (`PATCH`).
