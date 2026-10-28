import { spawn, ChildProcess } from 'child_process';
import { Client } from 'pg';
import http from 'http';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

async function checkPostgres(): Promise<boolean> {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    return true;
  } catch (err: any) {
    console.error('❌ PostgreSQL connection failed:', err.message);
    console.error(`Please verify PostgreSQL is running on ${DB_HOST}:${DB_PORT} with database "${DB_NAME}".`);
    return false;
  }
}

function waitForServer(port: number, maxAttempts = 15): Promise<boolean> {
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = http.request({ host: '127.0.0.1', port, path: '/health', timeout: 400 }, (res) => {
        clearInterval(interval);
        resolve(true);
      });
      req.on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          resolve(false);
        }
      });
      req.end();
    }, 200);
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Starting SIMPLIFY SaaS Full Local Environment');
  console.log('================================================================');

  const pgOk = await checkPostgres();
  if (!pgOk) {
    process.exit(1);
  }

  console.log('✅ PostgreSQL connected successfully to ' + DB_NAME);

  const isWindows = process.platform === 'win32';
  const npxCmd = isWindows ? 'npx.cmd' : 'npx';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';

  // 1. Start Backend Bridge (Port 54321)
  console.log('⚡ Starting Supabase Dev Bridge on http://127.0.0.1:54321 ...');
  const bridgeProc: ChildProcess = spawn(npxCmd, ['tsx', 'scripts/local-dev-bridge.ts'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  bridgeProc.stdout?.on('data', (d) => {
    process.stdout.write(`\x1b[36m[Backend]\x1b[0m ${d.toString()}`);
  });

  bridgeProc.stderr?.on('data', (d) => {
    process.stderr.write(`\x1b[31m[Backend Error]\x1b[0m ${d.toString()}`);
  });

  const bridgeReady = await waitForServer(54321);
  if (bridgeReady) {
    console.log('✅ Backend Bridge is ready & responding on http://127.0.0.1:54321');
  }

  // 2. Start Frontend Vite Server (Port 5173)
  console.log('💻 Starting Frontend Dev Server on http://localhost:5173 ...');
  const frontendProc: ChildProcess = spawn(npmCmd, ['--prefix', 'frontend', 'run', 'dev'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  frontendProc.stdout?.on('data', (d) => {
    process.stdout.write(`\x1b[32m[Frontend]\x1b[0m ${d.toString()}`);
  });

  frontendProc.stderr?.on('data', (d) => {
    process.stderr.write(`\x1b[33m[Frontend Warn]\x1b[0m ${d.toString()}`);
  });

  const cleanup = () => {
    console.log('\n🛑 Shutting down SIMPLIFY local servers...');
    try {
      if (bridgeProc.pid) {
        if (isWindows) spawn('taskkill', ['/pid', bridgeProc.pid.toString(), '/f', '/t']);
        else bridgeProc.kill();
      }
      if (frontendProc.pid) {
        if (isWindows) spawn('taskkill', ['/pid', frontendProc.pid.toString(), '/f', '/t']);
        else frontendProc.kill();
      }
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
