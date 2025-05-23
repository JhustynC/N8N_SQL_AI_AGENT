import { TsconfigRaw } from "./../node_modules/esbuild/lib/main.d";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, WASocket, proto, ConnectionState } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import { Request, Response } from "express";
import path from "path";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const webHookUrl = process.env.DEV === "true" ? process.env.N8N_WEBHOOK_DEV : process.env.N8N_WEBHOOK_PROD;

app.use(bodyParser.json());
app.use(express.static("public"));

let sock: WASocket;
let qrCodeData: string | null = null;
let connectionStatus: string = "Desconectado";
let isLoggedIn: boolean = false;
let reconnectAttempts: number = 0;
let maxReconnectAttempts: number = 5;
let isReconnecting: boolean = false;
let keepAliveInterval: NodeJS.Timeout | null = null;

//TODO: Trabajar el keep-alive de otra forma para no generear ruido
//? Función para enviar keep-alive periódicamente
// function startKeepAlive() {
//   if (keepAliveInterval) {
//     clearInterval(keepAliveInterval);
//   }

//   keepAliveInterval = setInterval(async () => {
//     if (sock && isLoggedIn) {
//       try {
//         //? Enviar un ping para mantener la conexión activa
//         await sock.query({
//           tag: "iq",
//           attrs: {
//             to: "g.us",
//             type: "get",
//             xmlns: "w:p",
//             id: sock.generateMessageTag(),
//           },
//         });
//         console.log("Keep-alive enviado");
//       } catch (error) {
//         console.log("Error en keep-alive, pero continuamos:", error);
//       }
//     }
//   }, 30000); //? Cada 30 segundos
// }

// function stopKeepAlive() {
// if (keepAliveInterval) {
//   clearInterval(keepAliveInterval);
//   keepAliveInterval = null;
// }
// }

async function start() {
  try {
    console.log(`Intento de conexión ${reconnectAttempts + 1}/${maxReconnectAttempts}`);

    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log("Usando WA v", version, isLatest ? "(última)" : "");

    //! Solo resetear QR si no estamos reconectando una sesión existente
    if (!isReconnecting || reconnectAttempts === 0) {
      connectionStatus = "Inicializando...";
      qrCodeData = null;
    }

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["Baileys-n8n", "Chrome", "120.0"],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => {
        return {
          conversation: "Hello",
        };
      },
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      console.log("Connection update:", {
        connection,
        qr: !!qr,
        reconnectAttempts,
        lastDisconnectReason: (lastDisconnect?.error as Boom)?.output?.statusCode,
      });

      if (qr) {
        try {
          qrCodeData = await QRCode.toDataURL(qr);
          connectionStatus = "Esperando escaneo del QR";
          isLoggedIn = false;
          isReconnecting = false;
          reconnectAttempts = 0; //! Reset attempts cuando se genera nuevo QR
          console.log("QR generado para la interfaz web");
        } catch (err) {
          console.error("Error generando QR:", err);
          qrCodeData = null;
        }
      }

      if (connection === "close") {
        const disconnectReason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        console.log(`Conexión cerrada. Razón: ${disconnectReason}`);

        isLoggedIn = false;
        // stopKeepAlive();

        switch (disconnectReason) {
          case DisconnectReason.loggedOut:
            console.log("Sesión cerrada por el usuario");
            connectionStatus = "Sesión cerrada - Necesita reautenticación";
            qrCodeData = null;
            isReconnecting = false;
            reconnectAttempts = 0;

            //! Limpiar archivos de auth
            await clearAuthFiles();
            setTimeout(() => {
              start();
            }, 2000);
            break;

          case DisconnectReason.restartRequired:
            console.log("Reinicio requerido");
            connectionStatus = "Reinicio requerido - Reconectando...";
            isReconnecting = true;
            setTimeout(() => {
              start();
            }, 2000);
            break;

          case DisconnectReason.connectionLost:
          case DisconnectReason.connectionClosed:
          case DisconnectReason.connectionReplaced:
            console.log("Conexión perdida, intentando reconectar...");
            if (reconnectAttempts < maxReconnectAttempts) {
              connectionStatus = `Reconectando... (${reconnectAttempts + 1}/${maxReconnectAttempts})`;
              isReconnecting = true;
              reconnectAttempts++;

              const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000); // Backoff exponencial
              setTimeout(() => {
                start();
              }, delay);
            } else {
              console.log("Máximo de intentos de reconexión alcanzado");
              connectionStatus = "Error de conexión - Reinicia manualmente";
              isReconnecting = false;
              reconnectAttempts = 0;
              qrCodeData = null;
            }
            break;

          case DisconnectReason.badSession:
            console.log("Sesión corrupta, limpiando y regenerando...");
            connectionStatus = "Sesión corrupta - Regenerando...";
            qrCodeData = null;
            isReconnecting = false;
            reconnectAttempts = 0;
            await clearAuthFiles();
            setTimeout(() => {
              start();
            }, 3000);
            break;

          default:
            console.log(`Desconexión con razón desconocida: ${disconnectReason}`);
            if (reconnectAttempts < maxReconnectAttempts) {
              connectionStatus = `Reconectando... (${reconnectAttempts + 1}/${maxReconnectAttempts})`;
              isReconnecting = true;
              reconnectAttempts++;
              setTimeout(() => {
                start();
              }, 5000);
            } else {
              connectionStatus = "Error - Reinicia manualmente";
              isReconnecting = false;
              reconnectAttempts = 0;
            }
            break;
        }
      } else if (connection === "open") {
        console.log("✅ Conexión establecida con WhatsApp");
        connectionStatus = "Conectado";
        isLoggedIn = true;
        qrCodeData = null;
        isReconnecting = false;
        reconnectAttempts = 0;

        //? Iniciar keep-alive
        // startKeepAlive();

        console.log("Bot listo para recibir mensajes");
      } else if (connection === "connecting") {
        connectionStatus = isReconnecting ? `Reconectando... (${reconnectAttempts}/${maxReconnectAttempts})` : "Conectando...";
        //? No cambiar isLoggedIn ni qrCodeData aquí
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      const m = messages[0];
      // if (!m.message || !m.key.fromMe) return; // Ignorar mensajes propios
      if (!m.message) return; // Ignorar mensajes propios

      const payload = {
        from: m.key.remoteJid,
        id: m.key.id,
        timestamp: m.messageTimestamp,
        body: extractMessageText(m.message),
        raw: m,
      };

      try {
        if (webHookUrl) {
          await axios.post(webHookUrl, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
          });
          console.log("Mensaje reenviado a n8n");
        }
      } catch (err) {
        console.error("Error enviando a n8n:", (err as Error).message);
      }
    });

    //? No es necesario manejar un evento global "error" en sock.ev, ya que no existe en BaileysEventMap.
  } catch (error) {
    console.error("Error en start():", error);
    connectionStatus = "Error - Reintentando...";

    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      setTimeout(start, 5000);
    } else {
      connectionStatus = "Error crítico - Reinicia manualmente";
      reconnectAttempts = 0;
    }
  }
}

async function clearAuthFiles() {
  try {
    const authDir = path.join(process.cwd(), "auth_info");
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      console.log("Archivos de autenticación eliminados");
    }
  } catch (err) {
    console.error("Error limpiando archivos de auth:", err);
  }
}

function extractMessageText(message: proto.IMessage): string {
  if ("conversation" in message) return message.conversation!;
  if ("extendedTextMessage" in message) return message.extendedTextMessage?.text ?? "";
  if ("imageMessage" in message) return message.imageMessage?.caption ?? "[Imagen]";
  if ("videoMessage" in message) return message.videoMessage?.caption ?? "[Video]";
  if ("audioMessage" in message) return "[Audio]";
  if ("documentMessage" in message) return message.documentMessage?.title ?? "[Documento]";
  if ("stickerMessage" in message) return "[Sticker]";
  return "[Mensaje no soportado]";
}

//! Se cambio a la carpeta ./public
//? Servir la página principal
// app.get("/", (req: Request, res: Response) => {
//   const html = `
// <!DOCTYPE html>
// <html lang="es">
// <head>
//     <meta charset="UTF-8">
//     <meta name="viewport" content="width=device-width, initial-scale=1.0">
//     <title>WhatsApp Bot - Estado de Conexión</title>
//     <style>
//         body {
//             font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
//             max-width: 800px;
//             margin: 0 auto;
//             padding: 20px;
//             background-color: #f5f5f5;
//             display: flex;
//             flex-direction: column;
//             align-items: center;
//             justify-content: center;
//             text-align: center;
//         }
//         .container {
//             background: white;
//             border-radius: 10px;
//             padding: 30px;
//             box-shadow: 0 2px 10px rgba(0,0,0,0.1);
//             text-align: center;
//         }
//         .status {
//             padding: 15px;
//             border-radius: 8px;
//             margin: 20px 0;
//             font-weight: bold;
//             font-size: 18px;
//         }
//         .connected {
//             background-color: #d4edda;
//             color: #155724;
//             border: 1px solid #c3e6cb;
//         }
//         .disconnected {
//             background-color: #f8d7da;
//             color: #721c24;
//             border: 1px solid #f5c6cb;
//         }
//         .connecting {
//             background-color: #fff3cd;
//             color: #856404;
//             border: 1px solid #ffeaa7;
//         }
//         .qr-container {
//             margin: 30px 0;
//             padding: 20px;
//             background-color: #f8f9fa;
//             border-radius: 8px;
//         }
//         .qr-code {
//             max-width: 300px;
//             height: auto;
//             margin: 20px auto;
//             display: block;
//             border: 2px solid #ddd;
//             border-radius: 8px;
//         }
//         .refresh-btn {
//             background-color: #007bff;
//             color: white;
//             border: none;
//             padding: 12px 24px;
//             border-radius: 6px;
//             cursor: pointer;
//             font-size: 16px;
//             margin: 10px;
//             transition: background-color 0.3s;
//         }
//         .refresh-btn:hover {
//             background-color: #0056b3;
//         }
//         .refresh-btn:disabled {
//             background-color: #6c757d;
//             cursor: not-allowed;
//         }
//         .info {
//             background-color: #e7f3ff;
//             padding: 15px;
//             border-radius: 6px;
//             margin: 20px 0;
//             color: #004085;
//         }
//         .error {
//             background-color: #f8d7da;
//             padding: 15px;
//             border-radius: 6px;
//             margin: 20px 0;
//             color: #721c24;
//         }
//         h1 {
//             color: #333;
//             margin-bottom: 10px;
//         }
//         .timestamp {
//             color: #666;
//             font-size: 14px;
//             margin-top: 20px;
//         }
//         .stats {
//             display: flex;
//             justify-content: space-around;
//             margin: 20px 0;
//             flex-wrap: wrap;
//         }
//         .stat-item {
//             background: #f8f9fa;
//             padding: 10px 15px;
//             border-radius: 6px;
//             margin: 5px;
//             min-width: 120px;
//         }
//         .loading {
//             display: inline-block;
//             width: 20px;
//             height: 20px;
//             border: 3px solid #f3f3f3;
//             border-top: 3px solid #3498db;
//             border-radius: 50%;
//             animation: spin 1s linear infinite;
//         }
//         @keyframes spin {
//             0% { transform: rotate(0deg); }
//             100% { transform: rotate(360deg); }
//         }
//     </style>
// </head>
// <body>
//     <div class="container">
//         <h1>🚀 WhatsApp Bot</h1>
//         <p>Estado de conexión mejorado con persistencia</p>

//         <div id="status" class="status">
//             <div class="loading"></div> Cargando estado...
//         </div>

//         <div class="stats" id="stats" style="display: none;">
//             <div class="stat-item">
//                 <strong>Reconexiones:</strong><br>
//                 <span id="reconnect-count">0</span>
//             </div>
//             <div class="stat-item">
//                 <strong>Última actualización:</strong><br>
//                 <span id="last-update">-</span>
//             </div>
//         </div>

//         <div id="content">
//             <!-- El contenido se cargará aquí -->
//         </div>

//         <div style="margin: 20px 0;">
//             <button class="refresh-btn" onclick="updateStatus()" id="refresh-btn">
//                 🔄 Actualizar Estado
//             </button>

//             <button class="refresh-btn" onclick="forceReconnect()" style="background-color: #dc3545;" id="reconnect-btn">
//                 🔌 Forzar Reconexión
//             </button>

//             <button class="refresh-btn" onclick="clearSession()" style="background-color: #fd7e14;" id="clear-btn">
//                 🗑️ Nueva Sesión
//             </button>
//         </div>

//         <div class="timestamp" id="timestamp">
//             Cargando...
//         </div>
//     </div>

//     <script>
//         let reconnectCount = 0;
//         let isUpdating = false;

//         async function updateStatus() {
//             if (isUpdating) return;
//             isUpdating = true;

//             const refreshBtn = document.getElementById('refresh-btn');
//             refreshBtn.disabled = true;
//             refreshBtn.innerHTML = '<div class="loading" style="width: 16px; height: 16px; border-width: 2px;"></div> Actualizando...';

//             try {
//                 const response = await fetch('/status');
//                 const data = await response.json();

//                 const statusEl = document.getElementById('status');
//                 const contentEl = document.getElementById('content');
//                 const timestampEl = document.getElementById('timestamp');
//                 const statsEl = document.getElementById('stats');

//                 console.log('Status data:', data);

//                 // Actualizar estadísticas
//                 if (data.reconnectAttempts !== undefined) {
//                     reconnectCount = data.reconnectAttempts;
//                     document.getElementById('reconnect-count').textContent = reconnectCount;
//                     document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
//                     statsEl.style.display = 'flex';
//                 }

//                 // Actualizar estado
//                 statusEl.innerHTML = data.status;
//                 statusEl.className = 'status ' + (
//                     data.isLoggedIn ? 'connected' :
//                     data.status.includes('Conectando') || data.status.includes('Reconectando') || data.status.includes('Esperando') ? 'connecting' : 'disconnected'
//                 );

//                 // Actualizar contenido
//                 if (data.isLoggedIn) {
//                     contentEl.innerHTML = \`
//                         <div class="info">
//                             <h3>✅ ¡Conectado exitosamente!</h3>
//                             <p>El bot está funcionando correctamente y listo para recibir mensajes.</p>
//                             <p><small>Sesión persistente activa con keep-alive</small></p>
//                         </div>
//                     \`;
//                 } else if (data.qrCode && data.hasQR) {
//                     contentEl.innerHTML = \`
//                         <div class="qr-container">
//                             <h3>📱 Escanea este código QR con WhatsApp</h3>
//                             <p>1. Abre WhatsApp en tu teléfono</p>
//                             <p>2. Ve a <strong>Configuración → Dispositivos vinculados</strong></p>
//                             <p>3. Toca <strong>"Vincular dispositivo"</strong></p>
//                             <p>4. Escanea este código QR</p>
//                             <img src="\${data.qrCode}" alt="Código QR" class="qr-code">
//                             <p><small>⚠️ El código QR expira cada 20 segundos y se regenera automáticamente</small></p>
//                         </div>
//                     \`;
//                 } else if (data.status.includes('Error')) {
//                     contentEl.innerHTML = \`
//                         <div class="error">
//                             <h3>❌ Error de conexión</h3>
//                             <p>Ha ocurrido un error. Intenta las siguientes opciones:</p>
//                             <ul style="text-align: left; display: inline-block;">
//                                 <li>Forzar reconexión</li>
//                                 <li>Crear nueva sesión</li>
//                                 <li>Verificar tu conexión a internet</li>
//                                 <li>Reiniciar la aplicación</li>
//                             </ul>
//                         </div>
//                     \`;
//                 } else {
//                     contentEl.innerHTML = \`
//                         <div class="info">
//                             <h3>⏳ Iniciando conexión...</h3>
//                             <div class="loading" style="margin: 20px auto;"></div>
//                             <p>Estableciendo conexión con WhatsApp...</p>
//                             <p><small>Este proceso puede tomar hasta 60 segundos</small></p>
//                         </div>
//                     \`;
//                 }

//                 timestampEl.textContent = \`Última actualización: \${new Date().toLocaleString()}\`;

//             } catch (error) {
//                 console.error('Error al actualizar estado:', error);
//                 document.getElementById('status').innerHTML = '❌ Error al conectar con el servidor';
//                 document.getElementById('status').className = 'status disconnected';
//                 document.getElementById('content').innerHTML = \`
//                     <div class="error">
//                         <h3>Error de comunicación</h3>
//                         <p>No se puede conectar con el servidor. Verifica que la aplicación esté ejecutándose.</p>
//                     </div>
//                 \`;
//             } finally {
//                 refreshBtn.disabled = false;
//                 refreshBtn.innerHTML = '🔄 Actualizar Estado';
//                 isUpdating = false;
//             }
//         }

//         async function forceReconnect() {
//             if (confirm('¿Forzar reconexión? Esto cerrará la conexión actual e intentará reconectar.')) {
//                 const btn = document.getElementById('reconnect-btn');
//                 btn.disabled = true;
//                 btn.innerHTML = '<div class="loading" style="width: 16px; height: 16px; border-width: 2px;"></div> Reconectando...';

//                 try {
//                     const response = await fetch('/reconnect', { method: 'POST' });
//                     const data = await response.json();
//                     console.log('Reconexión forzada:', data);

//                     setTimeout(() => {
//                         updateStatus();
//                         btn.disabled = false;
//                         btn.innerHTML = '🔌 Forzar Reconexión';
//                     }, 3000);
//                 } catch (error) {
//                     console.error('Error al forzar reconexión:', error);
//                     btn.disabled = false;
//                     btn.innerHTML = '🔌 Forzar Reconexión';
//                 }
//             }
//         }

//         async function clearSession() {
//             if (confirm('¿Crear nueva sesión? Esto eliminará todos los datos de autenticación y requerirá escanear un nuevo QR.')) {
//                 const btn = document.getElementById('clear-btn');
//                 btn.disabled = true;
//                 btn.innerHTML = '<div class="loading" style="width: 16px; height: 16px; border-width: 2px;"></div> Limpiando...';

//                 try {
//                     const response = await fetch('/clear-session', { method: 'POST' });
//                     const data = await response.json();
//                     console.log('Sesión limpiada:', data);

//                     setTimeout(() => {
//                         updateStatus();
//                         btn.disabled = false;
//                         btn.innerHTML = '🗑️ Nueva Sesión';
//                     }, 5000);
//                 } catch (error) {
//                     console.error('Error al limpiar sesión:', error);
//                     btn.disabled = false;
//                     btn.innerHTML = '🗑️ Nueva Sesión';
//                 }
//             }
//         }

//         // Actualizar estado cada 10 segundos (menos frecuente para no sobrecargar)
//         setInterval(updateStatus, 10000);

//         // Cargar estado inicial
//         updateStatus();
//     </script>
// </body>
// </html>
//   `;

//   res.send(html);
// });


//TODO: Crear un weebhook para gentionar cuando se cierra o falla la sesion
//TODO: Para no tener que hacer poling desde el frontend (mandar request a esta ruta cada cierto tiempo, no X)
//? Endpoint para obtener el estado actual
app.get("/status", (req: Request, res: Response) => {
  const response = {
    status: connectionStatus,
    isLoggedIn: isLoggedIn,
    qrCode: qrCodeData,
    timestamp: new Date().toISOString(),
    hasQR: !!qrCodeData,
    qrLength: qrCodeData?.length || 0,
    reconnectAttempts: reconnectAttempts,
    maxReconnectAttempts: maxReconnectAttempts,
    isReconnecting: isReconnecting,
  };

  console.log("Status requested:", {
    status: connectionStatus,
    isLoggedIn,
    hasQR: !!qrCodeData,
    reconnectAttempts,
  });

  res.json(response);
});

//? Endpoint para forzar reconexión
app.post("/reconnect", (req: Request, res: Response) => {
  console.log("Forzando reconexión...");

  // stopKeepAlive();
  isReconnecting = true;
  reconnectAttempts = 0;
  connectionStatus = "Reiniciando...";

  if (sock) {
    sock.end(undefined);
  }

  setTimeout(() => {
    start();
  }, 1000);

  res.json({ message: "Reconexión iniciada", status: "restarting" });
});

//? Endpoint para enviar mensajes
app.post("/send-message", async (req: Request, res: Response): Promise<void> => {
  const { from, to, message, fromMe } = req.body;

  console.log("FROM ME:", req.body);
  // if (!fromMe) return;

  //TODO: CAMBAIR PARA ENVIAR MENSAJES A CUALQUIER NUMERO
  if ((to as String).includes("593999898554")) {
    if (!to || !message) {
      res.status(400).json({ error: 'Faltan parámetros: "to" y "message" son requeridos.' });
      return;
    }

    if (!isLoggedIn || !sock) {
      res.status(503).json({ error: "WhatsApp no está conectado. Por favor, escanea el código QR primero." });
      return;
    }

    try {
      await sock.sendMessage(to, { text: message });
      console.log(to === from);
      res.status(200).json({ status: "Mensaje enviado con éxito." });
      console.log(`Mensaje enviado a ${to}: ${message}`);
    } catch (error) {
      console.error("Error al enviar el mensaje:", error);
      res.status(500).json({ error: "Error al enviar el mensaje." });
    }
  } else {
    console.log("Se enviara el mensaje a otro chat");
  }
});

//? Endpoint para limpiar sesión
app.post("/clear-session", async (req: Request, res: Response) => {
  console.log("Limpiando sesión manualmente...");

  // stopKeepAlive();
  qrCodeData = null;
  isLoggedIn = false;
  isReconnecting = false;
  reconnectAttempts = 0;
  connectionStatus = "Limpiando sesión...";

  if (sock) {
    sock.end(undefined);
  }

  await clearAuthFiles();

  setTimeout(() => {
    start();
  }, 2000);

  res.json({ message: "Sesión limpiada, reiniciando..." });
});

//? Manejar cierre graceful
process.on("SIGINT", () => {
  console.log("Cerrando aplicación...");
  // stopKeepAlive();
  if (sock) {
    sock.end(undefined);
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Terminando aplicación...");
  // stopKeepAlive();
  if (sock) {
    sock.end(undefined);
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
  console.log(`📱 Interfaz web: http://localhost:${PORT}`);
  console.log(`🔧 Webhook URL: ${webHookUrl || "No configurado"}`);
  start();
});
