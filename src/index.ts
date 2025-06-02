import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import axios from "axios";
import dotenv from "dotenv";
import express from "express";
import { Request, Response } from "express";
import path from "path";
import fs from "fs";
import {
  makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  WASocket,
  proto,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";

dotenv.config();

//* N8N
const webHookUrl = process.env.DEV === "true" ? process.env.N8N_WEBHOOK_DEV : process.env.N8N_WEBHOOK_PROD;

//* Express
const app = express();
const PORT = process.env.PORT || 3000;
// Aumentar el límite para JSON (para base64)
app.use(
  express.json({
    limit: "50mb", // Ajusta según necesites
  })
);

app.use(
  express.urlencoded({
    limit: "50mb",
    extended: true,
  })
);
app.use(express.static("public"));

//* Baileys
let sock: WASocket;
let qrCodeData: string | null = null;
let connectionStatus: string = "Desconectado";
let isLoggedIn: boolean = false;
let reconnectAttempts: number = 0;
let maxReconnectAttempts: number = 5;
let isReconnecting: boolean = false;
let keepAliveInterval: NodeJS.Timeout | null = null;

// Helper
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

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
          //? Aqui se crea el QR
          qrCodeData = await QRCode.toDataURL(qr); //? Convierte a imagen base64
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

        //? Se manejan distinto tipos de errores de desconexión
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

              /* 
              ?¿Cómo funciona?
                Intento 1: 2000 * 2^1 = 4000ms (4 segundos)
                Intento 2: 2000 * 2^2 = 8000ms (8 segundos)
                Intento 3: 2000 * 2^3 = 16000ms (16 segundos)
                Intento 4: 2000 * 2^4 = 32000ms → Math.min(32000, 30000) = 30000ms (30 segundos)
                Intento 5: 30 segundos (máximo)

                ¿Por qué backoff exponencial?

                Evita sobrecargar el servidor con intentos constantes
                Da tiempo a que se resuelvan problemas temporales
                Reduce el ruido en logs del servidor
                Es una buena práctica en sistemas distribuidos 
              */

              const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000); //? Backoff exponencial
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
      //? if (type !== "notify") return;? Porque solo queremos procesar mensajes nuevos, no historial.
      if (type !== "notify") return;
      const m = messages[0];
      // if (!m.message || !m.key.fromMe) return; // Ignorar mensajes propios
      if (!m.message) return;

      // Preparar el payload base
      const payload: any = {
        from: m.key.remoteJid,
        id: m.key.id,
        timestamp: m.messageTimestamp,
        body: extractMessageText(m.message),
        messageType: "text",
        raw: m,
      };

      try {
        if (webHookUrl) {
          //? Handle different message types
          if (m.message.imageMessage) {
            payload.messageType = "image";
            const mediaData = await downloadMedia(m, "image");
            if (mediaData) {
              payload.media = mediaData;
            }
          } else if (m.message.audioMessage) {
            payload.messageType = "audio";
            const mediaData = await downloadMedia(m, "audio");
            if (mediaData) {
              payload.media = mediaData;
            }

          } else if (m.message.videoMessage) {
            payload.messageType = "video";
            const mediaData = await downloadMedia(m, "video");
            if (mediaData) {
              payload.media = mediaData;
            }
          } else if (m.message.documentMessage) {
            payload.messageType = "document";
            const mediaData = await downloadMedia(m, "document");
            if (mediaData) {
              payload.media = mediaData;
            }
          }

          //* Mark as read
          await sleep(1000);
          await sock.readMessages([m.key]);
          await sleep(1000);
          
          //* Send to n8n webhook
          await axios.post(webHookUrl, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 30000, //? Increased timeout for media uploads
          });
          console.log(`Mensaje ${payload.messageType} reenviado a n8n`);
          
          //* Set typing indicator
          if (m.message.conversation || m.message.extendedTextMessage?.text ) {
            await sock.sendPresenceUpdate("composing", m.key.remoteJid!);
          } else if (m.message.audioMessage) {
            await sock.sendPresenceUpdate("recording", m.key.remoteJid!);
          } 
        }
      } catch (err) {
        console.error("Error procesando mensaje:", (err as Error).message);
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

// Crea un logger simple
// const logger = {
//   level: "silent",
//   // Métodos requeridos por la interfaz ILogger
//   trace: () => {},
//   debug: () => {},
//   info: () => {},
//   warn: console.warn,
//   error: console.error,
//   fatal: console.error,
//   child: () => logger,
// };

// Luego, en la función downloadMedia, modifica la llamada a downloadMediaMessage
async function downloadMedia(webMessageInfo: proto.IWebMessageInfo, type: "image" | "audio" | "video" | "document") {
  try {
    if (!sock || !webMessageInfo.key) return null;

    // Obtener el mensaje específico según el tipo
    const message = webMessageInfo.message;
    if (!message) return null;

    let buffer: Buffer | undefined;

    try {
      //? Usar downloadMediaMessage con el mensaje completo
      buffer = (await downloadMediaMessage(
        webMessageInfo, //* Pasar el mensaje completo que incluye la key
        "buffer",
        {},
        {
          logger: sock.logger,
          reuploadRequest: sock.updateMediaMessage,
        }
      )) as Buffer;
    } catch (error) {
      console.error("Error downloading media:", error);
      return null;
    }

    if (!buffer) return null;

    //* Obtener el tipo MIME del mensaje original
    let mimeType = "application/octet-stream";
    let fileExtension = "bin";

    // Determinar el tipo MIME basado en el tipo de mensaje
    if (type === "audio" && message.audioMessage) {
      mimeType = message.audioMessage.mimetype || "audio/ogg; codecs=opus";
      fileExtension = "ogg";
    } else if (type === "image" && message.imageMessage) {
      mimeType = message.imageMessage.mimetype || "image/jpeg";
      fileExtension = "jpg";
    } else if (type === "video" && message.videoMessage) {
      mimeType = message.videoMessage.mimetype || "video/mp4";
      fileExtension = "mp4";
    } else if (type === "document" && message.documentMessage) {
      mimeType = message.documentMessage.mimetype || "application/octet-stream";
      fileExtension = message.documentMessage.fileName?.split(".").pop() || "bin";
    }

    // Convertir a base64
    const base64 = buffer.toString("base64");

    return {
      base64,
      mimeType,
      fileExtension,
      size: buffer.length,
    };
  } catch (error) {
    console.error("Error in downloadMedia:", error);
    return null;
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

async function sendAudioMessage(to: string, audioData: string | any) {
  try {
    let audioBuffer: Buffer;

    // Verificar el tipo de dato que llega
    console.log("Tipo de audioData:", typeof audioData);
    console.log("audioData:", audioData);

    if (typeof audioData === "string") {
      // Si es string (base64)
      const base64Data = audioData.replace(/^data:audio\/[^;]+;base64,/, "");
      audioBuffer = Buffer.from(base64Data, "base64");
    } else if (audioData && audioData.data) {
      // Si es objeto con propiedad data (formato de n8n)
      audioBuffer = Buffer.from(audioData.data, "base64");
    } else if (Buffer.isBuffer(audioData)) {
      // Si ya es un Buffer
      audioBuffer = audioData;
    } else {
      throw new Error("Formato de audio inválido. Recibido: " + typeof audioData);
    }

    console.log("Buffer creado, tamaño:", audioBuffer.length);

    const message = await sock.sendMessage(to, {
      audio: audioBuffer,
      mimetype: "audio/mpeg",
      ptt: true,
    });

    console.log("Audio enviado:", message!.key);
    return message;
  } catch (error) {
    console.error("Error al enviar audio:", error);
    throw error;
  }
}

//? Endpoint para enviar mensajes
app.post("/send-message", async (req: Request, res: Response): Promise<void> => {
  const { remoteJid, to, message, messageType } = req.body;

  //? To change the readding animation state
  await sock.sendPresenceUpdate("paused", remoteJid!);
  await sock.sendPresenceUpdate("available", remoteJid!);

  console.log("FROM ME:", req.body);
  // if (!fromMe) return;

  //TODO: CAMBAIR PARA ENVIAR MENSAJES A CUALQUIER NUMERO
  // if ((to as String).includes("593999898554")) {
  if (!to || !message) {
    res.status(400).json({ error: 'Faltan parámetros: "to" y "message" son requeridos.' });
    return;
  }

  if (!isLoggedIn || !sock) {
    res.status(503).json({ error: "WhatsApp no está conectado. Por favor, escanea el código QR primero." });
    return;
  }

  try {
    if (messageType === "text") {
      await sock.sendMessage(to, { text: message });
    }
    if (messageType === "audio") {
      await sendAudioMessage(to, message);
      res.status(200).json({ success: true, message: "Audio enviado" });
    }
    // await sock.sendPresenceUpdate("paused", remoteJid!);
    // console.log(to === from);
    res.status(200).json({ status: "Mensaje enviado con éxito." });
    console.log(`Mensaje enviado a ${to}: ${message}`);
  } catch (error) {
    console.error("Error al enviar el mensaje:", error);
    res.status(500).json({ error: "Error al enviar el mensaje." });
  }
  // } else {
  //   console.log("Se enviara el mensaje a otro chat");
  // }
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
