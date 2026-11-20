
"use strict";

/* =====================================
   REFERENCIAS A LOS ELEMENTOS DEL DOM
===================================== */

const form = document.getElementById("consultation-form");
const textarea = document.getElementById("user-query");
const sendButton = document.getElementById("send-button");
const sendLabel = document.getElementById("send-label");
const characterCount = document.getElementById("character-count");
const formFeedback = document.getElementById("form-feedback");

const responseCard = document.getElementById("response-card");
const responseKicker = document.getElementById("response-kicker");
const responseTitle = document.getElementById("response-title");
const responseText = document.getElementById("response-text");

/* =====================================
   CONFIGURACIÓN
===================================== */

const MAX_LENGTH = 500;
const TIMEOUT_MS = 30000;
const COOLDOWN_MS = 1500;

let isSending = false;
let cooldownUntil = 0;
let cooldownInterval = null;
let sessionIdEnMemoria = null;

/* =====================================
   IDENTIFICADOR DE SESIÓN
===================================== */

function generarSessionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    return "sesion-" + Date.now() + "-" +
        Math.random().toString(36).substring(2);
}

function obtenerSessionId() {
    // Intenta recuperar la sesión guardada.
    try {
        const guardado = localStorage.getItem("sessionId");

        if (guardado) {
            sessionIdEnMemoria = guardado;
            return guardado;
        }

        // Si no existe, genera una nueva.
        sessionIdEnMemoria = generarSessionId();
        localStorage.setItem("sessionId", sessionIdEnMemoria);

        return sessionIdEnMemoria;

    } catch (error) {
        // Si localStorage no funciona, utiliza memoria.
        if (!sessionIdEnMemoria) {
            sessionIdEnMemoria = generarSessionId();
        }

        return sessionIdEnMemoria;
    }
}

const sessionId = obtenerSessionId();

/* =====================================
   VALIDACIÓN DE LA URL
===================================== */

function webhookConfigurado() {
    if (typeof WEBHOOK_URL !== "string") {
        return false;
    }

    const url = WEBHOOK_URL.trim().toLowerCase();

    return (
        url !== "" &&
        !url.includes("aca va") &&
        !url.includes("ejemplo-webhook-prueba")
    );
}

/* =====================================
   ACTUALIZACIÓN DEL CONTADOR
===================================== */

textarea.addEventListener("input", () => {
    characterCount.textContent =
        `${textarea.value.length} / ${MAX_LENGTH} caracteres`;

    updateSendButton();
});

/* =====================================
   ESTADOS DE LA RESPUESTA
===================================== */

function setResponse(state, title, message) {
    const icons = {
        idle: "✦",
        loading: "◌",
        success: "✓",
        error: "!"
    };

    responseCard.className = `response-card state-${state}`;

    responseKicker.textContent = {
        idle: "CONSULTOR MÉDICO",
        loading: "PROCESANDO CONSULTA",
        success: "RESPUESTA RECIBIDA",
        error: "NO SE PUDO COMPLETAR"
    }[state] || "CONSULTOR MÉDICO";

    responseTitle.textContent = title;
    responseText.textContent = message;

    const avatar = document.querySelector(".avatar");

    if (avatar) {
        avatar.textContent = icons[state] || "✦";
    }
}

/* =====================================
   MENSAJES DE ESTADO DEL FORMULARIO
===================================== */

function setFeedback(message, type = "") {
    formFeedback.textContent = message;
    formFeedback.className = type;
}

/* =====================================
   CONTROL DEL BOTÓN Y DEL TIEMPO
===================================== */

function updateSendButton() {
    const remaining = Math.max(0, cooldownUntil - Date.now());

    textarea.disabled = isSending;

    sendButton.disabled =
        isSending ||
        remaining > 0 ||
        textarea.value.trim().length === 0 ||
        textarea.value.length > MAX_LENGTH;

    if (isSending) {
        sendLabel.textContent = "Enviando...";
    } else if (remaining > 0) {
        sendLabel.textContent =
            `Esperá ${Math.ceil(remaining / 1000)} s`;
    } else {
        sendLabel.textContent = "Enviar consulta";
    }
}

function startCooldown() {
    cooldownUntil = Date.now() + COOLDOWN_MS;

    if (cooldownInterval) {
        clearInterval(cooldownInterval);
    }

    updateSendButton();

    cooldownInterval = setInterval(() => {
        updateSendButton();

        if (Date.now() >= cooldownUntil) {
            clearInterval(cooldownInterval);
            cooldownInterval = null;
            updateSendButton();
        }
    }, 200);
}

/* =====================================
   LIMPIEZA DE BLOQUES MARKDOWN
===================================== */

function limpiarMarkdown(texto) {
    return texto
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

/* =====================================
   REPARACIÓN DE JSON CON SALTOS DE LÍNEA
===================================== */

function repararSaltosDeLinea(texto) {
    let resultado = "";
    let dentroDeCadena = false;
    let escape = false;

    for (const caracter of texto) {
        if (escape) {
            resultado += caracter;
            escape = false;
            continue;
        }

        if (caracter === "\\" && dentroDeCadena) {
            resultado += caracter;
            escape = true;
            continue;
        }

        if (caracter === '"') {
            dentroDeCadena = !dentroDeCadena;
            resultado += caracter;
            continue;
        }

        if (dentroDeCadena) {
            if (caracter === "\n") {
                resultado += "\\n";
                continue;
            }

            if (caracter === "\r") {
                resultado += "\\r";
                continue;
            }

            if (caracter === "\t") {
                resultado += "\\t";
                continue;
            }
        }

        resultado += caracter;
    }

    return resultado;
}

/* =====================================
   EXTRACCIÓN DE TEXTO DE JSON MAL FORMADO
===================================== */

function extraerTextoConRegex(texto) {
    const claves = [
        "response",
        "respuesta",
        "message",
        "mensaje"
    ];

    for (const clave of claves) {
        const patron = new RegExp(
            '"' + clave + '"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"',
            "i"
        );

        const coincidencia = texto.match(patron);

        if (coincidencia) {
            let contenido = coincidencia[1];

            try {
                contenido = JSON.parse(
                    '"' + repararSaltosDeLinea(contenido) + '"'
                );
            } catch {
                contenido = contenido
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\"/g, '"');
            }

            if (typeof contenido === "string" && contenido.trim()) {
                return contenido.trim();
            }
        }
    }

    return "";
}

/* =====================================
   INTERPRETACIÓN DE LA RESPUESTA
===================================== */

function extraerResponse(data) {
    const posiblesClaves = [
        "response",
        "respuesta",
        "message",
        "mensaje"
    ];

    for (const clave of posiblesClaves) {
        if (
            typeof data[clave] === "string" &&
            data[clave].trim()
        ) {
            return data[clave].trim();
        }
    }

    return "Make respondió, pero sin el campo response";
}

function interpretarRespuesta(texto) {
    const limpio = limpiarMarkdown(texto);

    if (!limpio) {
        return "(respuesta vacía)";
    }

    let resultado;

    try {
        resultado = JSON.parse(limpio);

    } catch {
        // Si parece un objeto, intenta repararlo.
        if (limpio.startsWith("{") && limpio.endsWith("}")) {
            try {
                resultado = JSON.parse(
                    repararSaltosDeLinea(limpio)
                );
            } catch {
                // Si sigue fallando, intenta extraer el texto.
                const extraido = extraerTextoConRegex(limpio);

                return extraido ||
                    "Make respondió, pero sin el campo response";
            }
        } else {
            // El texto plano se muestra tal como llegó.
            return texto.trim();
        }
    }

    // Solo se interpretan objetos JSON.
    if (
        resultado !== null &&
        typeof resultado === "object" &&
        !Array.isArray(resultado)
    ) {
        return extraerResponse(resultado);
    }

    // Números, listas, booleanos, null y otros
    // valores JSON se muestran como texto recibido.
    return texto.trim();
}

/* =====================================
   ENVÍO ASÍNCRONO AL WEBHOOK
===================================== */

async function sendConsultation(message) {
    if (isSending || Date.now() < cooldownUntil) {
        return;
    }

    if (!webhookConfigurado()) {
        setResponse(
            "error",
            "Webhook sin configurar",
            "Falta pegar la URL de tu webhook en config.js"
        );

        setFeedback(
            "Falta pegar la URL de tu webhook en config.js",
            "error"
        );

        return;
    }

    if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > MAX_LENGTH
    ) {
        setFeedback(
            "Escribí una consulta de hasta 500 caracteres.",
            "error"
        );
        return;
    }

    isSending = true;
    updateSendButton();
    setFeedback("");

    setResponse(
        "loading",
        "Estamos procesando tu consulta",
        "El asistente está esperando la respuesta. Esto puede tardar unos segundos."
    );

    const controller = new AbortController();

    // Límite máximo de 30 segundos.
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, TIMEOUT_MS);

    try {
        const respuesta = await fetch(WEBHOOK_URL.trim(), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                sessionId: sessionId,
                mensaje: message,
                fecha: new Date().toISOString()
            }),
            signal: controller.signal
        });

        // Lee siempre la respuesta como texto.
        const rawBody = (await respuesta.text()).trim();

        if (!respuesta.ok) {
            throw new Error(
                `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`
            );
        }

        const answer = interpretarRespuesta(rawBody);

        setResponse(
            "success",
            "Respuesta del consultor médico",
            answer
        );

        setFeedback(
            "Consulta procesada correctamente.",
            "success"
        );

    } catch (error) {
        console.error("Error al procesar la consulta:", error);

        let titulo = "No pudimos obtener una respuesta";
        let mensaje = "Ocurrió un error inesperado. Intentá nuevamente.";
        let feedback = "No se pudo completar el envío.";

        if (error.name === "AbortError") {
            titulo = "Se agotó el tiempo de espera";
            mensaje = "Make tardó más de 30 segundos en responder. Revisá el escenario e intentá nuevamente.";
            feedback = "Tiempo de espera agotado.";

        } else if (
            error.message.startsWith("Make respondió con error")
        ) {
            titulo = "Error de Make";
            mensaje = error.message;
            feedback = "Revisá que el escenario esté activo.";

        } else if (
            error instanceof TypeError
        ) {
            titulo = "Error de conexión";
            mensaje = "No se pudo conectar con Make. Revisá tu conexión a Internet y que el webhook permita recibir solicitudes desde esta página.";
            feedback = "Falla de red. Intentá nuevamente.";

        } else {
            titulo = "Error del servidor";
            mensaje = error.message;
            feedback = "Ocurrió un error al procesar la consulta.";
        }

        setResponse("error", titulo, mensaje);
        setFeedback(feedback, "error");

    } finally {
        clearTimeout(timeoutId);

        isSending = false;
        startCooldown();
    }
}

/* =====================================
   EVENTO DEL FORMULARIO
===================================== */

form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = textarea.value.trim();

    if (!message) {
        setFeedback(
            "Escribí una consulta antes de enviarla.",
            "error"
        );
        textarea.focus();
        return;
    }

    if (message.length > MAX_LENGTH) {
        setFeedback(
            "La consulta no puede superar los 500 caracteres.",
            "error"
        );
        return;
    }

    await sendConsultation(message);

    // Limpia el campo solo si recibió una respuesta exitosa.
    if (responseCard.classList.contains("state-success")) {
        textarea.value = "";
        characterCount.textContent = `0 / ${MAX_LENGTH} caracteres`;
    }

    updateSendButton();
});

/* =====================================
   INICIALIZACIÓN
===================================== */

characterCount.textContent = `0 / ${MAX_LENGTH} caracteres`;

updateSendButton();
