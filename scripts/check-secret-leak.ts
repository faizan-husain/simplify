import fs from 'fs';
import path from 'path';

const distDir = path.resolve(__dirname, '../frontend/dist');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_placeholder';

if (!fs.existsSync(distDir)) {
  console.log('Frontend dist folder does not exist yet. Run build first.');
  process.exit(0);
}

function checkDirectory(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      checkDirectory(fullPath);
    } else if (file.endsWith('.js') || file.endsWith('.html') || file.endsWith('.json')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (serviceRoleKey && serviceRoleKey.length > 10 && content.includes(serviceRoleKey)) {
        console.error(`🚨 SECURITY VIOLATION: Service role key found in built bundle file: ${file}`);
        process.exit(1);
      }
    }
  }
}

checkDirectory(distDir);
console.log('✅ Bundle check passed: No service-role key found in frontend bundle.');
