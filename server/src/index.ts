import { createApp } from './app';
import { startOutboxWorker } from './domain/outboxWorker';

const fs = require('fs');
const path = require('path');

const app = createApp();
const outboxTimer = startOutboxWorker(10000);

let currentPort = 3001;

function startServer(port: number) {
  const server = app.listen(port, () => {
    console.log(`🚀 Newtonite API server running on http://localhost:${port}`);
    console.log(`   Health check: http://localhost:${port}/health`);
    console.log(`   Environment: development`);
    
    // Client .env sync removed
  });

  server.on('error', (e: any) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', e);
    }
  });

  return server;
}

const server = startServer(currentPort);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down...');
  clearInterval(outboxTimer);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down...');
  clearInterval(outboxTimer);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
