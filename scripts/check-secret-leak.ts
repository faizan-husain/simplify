import fs from 'fs';
import path from 'path';

const distDir = path.resolve(__dirname, '../frontend/dist');
const srcDir = path.resolve(__dirname, '../frontend/src');

const suspiciousPatterns = [
  /service_role_key/i,
  /supabase_service_role/i,
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, // JWT matching service role if present
];

let leakDetected = false;

function scanDir(dir: string, isDist = false) {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, isDist);
    } else if (
      entry.name.endsWith('.ts') ||
      entry.name.endsWith('.tsx') ||
      entry.name.endsWith('.js') ||
      entry.name.endsWith('.html') ||
      entry.name.endsWith('.json')
    ) {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check env vars in client code
      if (!isDist && /import\.meta\.env\.VITE_.*SERVICE_ROLE/i.test(content)) {
        console.error(`🚨 SECRET LEAK: Service role env var found in client code: ${fullPath}`);
        leakDetected = true;
      }

      // Check if service_role token or key is hardcoded
      if (content.includes('service_role_key') || content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        console.error(`🚨 SECRET LEAK: Possible service-role key reference in ${fullPath}`);
        leakDetected = true;
      }
    }
  }
}

console.log('Scanning frontend source (frontend/src) for secret leaks...');
scanDir(srcDir, false);

if (fs.existsSync(distDir)) {
  console.log('Scanning frontend production bundle (frontend/dist) for secret leaks...');
  scanDir(distDir, true);
} else {
  console.log('frontend/dist does not exist yet. Run build to verify bundle.');
}

if (leakDetected) {
  console.error('❌ Secret leak check failed.');
  process.exit(1);
} else {
  console.log('✅ Secret leak check passed: Frontend code and bundle are clean.');
}
