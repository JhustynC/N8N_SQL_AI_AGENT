import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    WASocket,
    proto
  } from '@whiskeysockets/baileys';
  import { Boom } from '@hapi/boom';
  import qrcode from 'qrcode-terminal';
  import axios from 'axios';
  import dotenv from 'dotenv';
  import express from 'express';
  import bodyParser from 'body-parser';
  import { Request, Response } from 'express';
  
  dotenv.config();
  
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  app.use(bodyParser.json());
  
  let sock: WASocket;
  
  async function start() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log('Usando WA v', version, isLatest ? '(última)' : '');
  
    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      browser: ['Baileys-n8n', 'Chrome', '120.0'],
    });
  
    sock.ev.on('creds.update', saveCreds);
  
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Conexión cerrada, reconectar:', shouldReconnect);
        if (shouldReconnect) start();
      } else if (connection === 'open') {
        console.log('Conexión establecida con WhatsApp');
      }
    });
  
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      const m = messages[0];
      if (!m.message) return;
  
      const payload = {
        from: m.key.remoteJid,
        id: m.key.id,
        timestamp: m.messageTimestamp,
        body: extractMessageText(m.message),
        raw: m,
      };
  
      try {
        await axios.post(process.env.N8N_WEBHOOK!, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        });
        console.log('Mensaje reenviado a n8n');
      } catch (err) {
        console.error('Error enviando a n8n:', (err as Error).message);
      }
    });
  }
  
  function extractMessageText(message: proto.IMessage): string {
    if ('conversation' in message) return message.conversation!;
    if ('extendedTextMessage' in message) return message.extendedTextMessage?.text ?? '';
    if ('imageMessage' in message) return '[Imagen]';
    if ('videoMessage' in message) return '[Video]';
    if ('audioMessage' in message) return '[Audio]';
    if ('documentMessage' in message) return '[Documento]';
    return '[Mensaje no soportado]';
  }
  
  app.get('/', async(req: Request, res: Response) => {
    res.status(200).json('<h1>Hola</h1>');
  } )   

  // Endpoint para recibir mensajes desde n8n y enviarlos por WhatsApp
  app.post('/send-message', async (req: Request, res: Response): Promise<void> => {
    const { to, message } = req.body;
  
    if (!to || !message) {
      res.status(400).json({ error: 'Faltan parámetros: "to" y "message" son requeridos.' });
      return;
    }
  
    try {
      await sock.sendMessage(to, { text: message });
      res.status(200).json({ status: 'Mensaje enviado con éxito.' });
    } catch (error) {
      console.error('Error al enviar el mensaje:', error);
      res.status(500).json({ error: 'Error al enviar el mensaje.' });
    }
  });


  app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    start();
  });
  