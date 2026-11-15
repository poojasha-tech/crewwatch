import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';

let wss: WebSocketServer | null = null;

// Attach the WebSocket server to the existing HTTP server
// We share the same port (3000) — HTTP and WS on the same port
export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server });

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    console.log(`[WS] Client connected — ${clientIp} | total: ${wss!.clients.size}`);

    // Send current state to newly connected client so dashboard loads immediately
    socket.send(JSON.stringify({ type: 'connected', message: 'CrewWatch live feed active' }));

    socket.on('close', () => {
      console.log(`[WS] Client disconnected | remaining: ${wss!.clients.size}`);
    });

    socket.on('error', (err) => {
      console.error('[WS] Socket error:', err.message);
    });
  });

  wss.on('error', (err) => {
    console.error('[WS] Server error:', err);
  });

  console.log('[WS] WebSocket server ready — sharing port with HTTP');
}

// Broadcast a message to ALL connected dashboard clients
// Called from pipeline.ts after every reading and from alert modules when an alert fires
export function broadcast(payload: Record<string, unknown>): void {
  if (!wss) return;

  const message = JSON.stringify(payload);
  let sent = 0;

  wss.clients.forEach((client) => {
    // Only send to clients that are fully connected (OPEN state)
    // A client could be in CONNECTING or CLOSING state — skip those
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent++;
    }
  });

  if (sent > 0) {
    console.log(`[WS] Broadcast → ${sent} client(s) | type: ${payload['type']}`);
  }
}

// Broadcast a new alert to all clients — called from anomaly.ts and trend.ts
export function broadcastAlert(alert: {
  crewId:    number;
  vitalName: string;
  alertType: string;
  severity:  string;
  message:   string;
  guidance:  string;
  value:     number | null;
}): void {
  broadcast({
    type: 'alert',
    ...alert,
  });
}
