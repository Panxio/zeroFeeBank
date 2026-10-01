/**
 * Genera el documento HTML completo para el marco de login servido en GET /auth/marco.
 *
 * El marco corre en otro origen (:3000) respecto a la app anfitriona (:4200),
 * comunicándose exclusivamente vía postMessage con targetOrigin exacto.
 */
export function generarHtmlMarco(targetOrigin: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Jost';
    font-style: normal;
    font-weight: 400;
    src: url('/auth/marco/fuentes/jost-400.woff2') format('woff2');
  }
  @font-face {
    font-family: 'Jost';
    font-style: normal;
    font-weight: 500;
    src: url('/auth/marco/fuentes/jost-500.woff2') format('woff2');
  }
  :root { color-scheme: dark; }
  body { margin: 0; background: transparent; color: #ede9e2;
         font: 400 0.9375rem/1.4 "Jost", "Futura", "Avenir Next", system-ui, sans-serif; }
  form { display: grid; gap: 14px; padding: 12px 2px 4px; }
  form[hidden] { display: none !important; }
  label { display: grid; gap: 6px; font-size: 0.8125rem; color: #a8a299; letter-spacing: 0.02em; }
  input { font: inherit; color: #ede9e2; background: rgba(237,233,226,0.06);
          border: 1px solid rgba(237,233,226,0.18); border-radius: 8px; padding: 0.7em 0.8em; }
  input:focus { outline: none; border-color: #ede9e2; background: rgba(237,233,226,0.1); }
  .enviar { font-family: inherit; font-weight: 500; font-size: 0.9375rem; line-height: 1; color: #0e0e0d; background: #ede9e2;
            border: 0; border-radius: 999px; padding: 0.85em 1em; cursor: pointer; margin-top: 4px; }
  .enviar:hover { background: #fff; }
  .cambio { margin: 0; font-size: 0.8125rem; color: #a8a299; text-align: center; }
  .cambio button { font: inherit; color: #ede9e2; background: none; border: 0; padding: 0;
                   text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
  .nota { margin: 0; min-height: 1.2em; font-size: 0.75rem; color: #e06c75; text-align: center; }
  .exito { margin: 0; min-height: 1.2em; font-size: 0.75rem; color: #98c379; text-align: center; }
  [hidden] { display: none !important; }
  :focus-visible { outline: 2px solid #ede9e2; outline-offset: 2px; }
</style>
</head>
<body>
<form id="login-form" data-testid="login-form" novalidate>
  <label for="login-email">Correo
    <input id="login-email" data-testid="login-email" type="email" autocomplete="username" autofocus></label>
  <label for="login-password">Contraseña
    <input id="login-password" data-testid="login-password" type="password" autocomplete="current-password"></label>
  <button class="enviar" id="login-enviar" data-testid="login-enviar" type="submit">Entrar</button>
  <p class="cambio">¿No tienes cuenta? <button type="button" id="ir-registro" data-testid="ir-registro">Crea una</button></p>
  <p class="exito" id="registro-exito" data-testid="registro-exito" role="status" hidden></p>
  <p class="nota" id="login-error" data-testid="login-error" role="alert" hidden></p>
</form>
<form id="registro-form" data-testid="registro-form" novalidate hidden>
  <label for="registro-email">Correo
    <input id="registro-email" data-testid="registro-email" type="email" autocomplete="email"></label>
  <label for="registro-password">Contraseña
    <input id="registro-password" data-testid="registro-password" type="password" autocomplete="new-password"></label>
  <button class="enviar" id="registro-enviar" data-testid="registro-enviar" type="submit">Crear cuenta</button>
  <p class="cambio">¿Ya tienes cuenta? <button type="button" id="ir-login" data-testid="ir-login">Ingresa</button></p>
  <p class="nota" id="registro-error" data-testid="registro-error" role="alert" hidden></p>
</form>
<script>
(() => {
  const TARGET_ORIGIN = ${JSON.stringify(targetOrigin)};
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginError = document.getElementById("login-error");
  const registroExito = document.getElementById("registro-exito");
  const registroForm = document.getElementById("registro-form");
  const registroEmail = document.getElementById("registro-email");
  const registroPassword = document.getElementById("registro-password");
  const registroError = document.getElementById("registro-error");
  const irRegistro = document.getElementById("ir-registro");
  const irLogin = document.getElementById("ir-login");

  function limpiarMensajes() {
    registroExito.hidden = true;
    registroExito.textContent = "";
    loginError.hidden = true;
    loginError.removeAttribute("data-codigo");
    loginError.removeAttribute("data-motivo");
    loginError.textContent = "";
    registroError.hidden = true;
    registroError.removeAttribute("data-codigo");
    registroError.removeAttribute("data-motivo");
    registroError.textContent = "";
  }

  irRegistro.addEventListener("click", () => {
    limpiarMensajes();
    loginForm.hidden = true;
    registroForm.hidden = false;
    registroEmail.focus();
  });

  irLogin.addEventListener("click", () => {
    limpiarMensajes();
    registroForm.hidden = true;
    loginForm.hidden = false;
    loginEmail.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      parent.postMessage({ v: 1, tipo: "zfb.auth.cerrar" }, TARGET_ORIGIN);
    }
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    loginError.removeAttribute("data-codigo");
    loginError.removeAttribute("data-motivo");
    loginError.textContent = "";
    registroExito.hidden = true;

    const email = loginEmail.value;
    const password = loginPassword.value;

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        parent.postMessage({
          v: 1,
          tipo: "zfb.auth.sesion",
          token: data.token,
          expiraEn: data.expiraEn
        }, TARGET_ORIGIN);
      } else {
        const codigo = (data && data.codigo) || "ERROR";
        loginError.setAttribute("data-codigo", codigo);
        loginError.textContent = (data && data.mensaje) || codigo;
        loginError.hidden = false;
      }
    } catch {
      loginError.setAttribute("data-motivo", "SIN_RESPUESTA");
      loginError.textContent = "Sin conexión con el servidor.";
      loginError.hidden = false;
    }
  });

  registroForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    registroError.hidden = true;
    registroError.removeAttribute("data-codigo");
    registroError.removeAttribute("data-motivo");
    registroError.textContent = "";

    const email = registroEmail.value;
    const password = registroPassword.value;

    try {
      const res = await fetch("/auth/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        registroForm.hidden = true;
        loginForm.hidden = false;
        loginEmail.value = email;
        loginPassword.value = "";
        registroExito.textContent = "Cuenta creada. Ingresa con tu contraseña.";
        registroExito.hidden = false;
        loginPassword.focus();
      } else {
        const codigo = (data && data.codigo) || "ERROR";
        registroError.setAttribute("data-codigo", codigo);
        registroError.textContent = (data && data.mensaje) || codigo;
        registroError.hidden = false;
      }
    } catch {
      registroError.setAttribute("data-motivo", "SIN_RESPUESTA");
      registroError.textContent = "Sin conexión con el servidor.";
      registroError.hidden = false;
    }
  });

  parent.postMessage({ v: 1, tipo: "zfb.auth.listo" }, TARGET_ORIGIN);
})();
</script>
</body>
</html>`;
}
