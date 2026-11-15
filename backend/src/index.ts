import dotenv from 'dotenv';
dotenv.config(); // must be first — loads .env before anything reads process.env

import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import path from 'path';

import crewRouter   from './routes/crew';
import vitalsRouter from './routes/vitals';
import alertsRouter from './routes/alerts';
import { initWebSocket } from './ws/broadcast';
import { startSimulator } from './simulator/simulator';

const app  = express();
const PORT = Number(process.env['PORT']) || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

// Parse incoming JSON request bodies (needed for POST /crew/:id/readings)
app.use(express.json());

// Serve the frontend from /frontend/src as static files
// When browser requests http://localhost:3000/ it gets index.html
app.use(express.static(path.join(__dirname, '../../frontend/src')));

// CORS — allow any origin during development so the frontend can call the API
// even if served from a different port
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

app.use('/crew',   crewRouter);    // GET /crew, GET /crew/:id
app.use('/crew',   vitalsRouter);  // GET /crew/:id/vitals, POST /crew/:id/readings
app.use('/alerts', alertsRouter);  // GET /alerts?crew_id=1

// Health check — useful for Docker healthchecks and deployment platforms
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler — catches any request that didn't match a route above
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler — catches any unhandled errors thrown in route handlers
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

// Create HTTP server manually so we can attach WebSocket to the same port
const server = createServer(app);

// Attach WebSocket server — shares port 3000 with HTTP
initWebSocket(server);

// Start listening for connections
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket ready on ws://localhost:${PORT}`);
});

// Start simulator after server is up
// Wrapped in async IIFE so we can use await at the top level
(async () => {
  try {
    await startSimulator();
  } catch (err) {
    console.error('[Simulator] Failed to start:', err);
    process.exit(1);
  }
})();
