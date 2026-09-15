import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePath = path.join(__dirname, 'data.json');
const database = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
const adminEmail = 'kotumar@gmail.com';
const adminUser = (database.users || []).find(user => user.email === adminEmail || user.admin || user.userType === 'admin');

if (!adminUser) throw new Error('Admin kullanıcısı bulunamadı; veri sıfırlanmadı.');

const resetDatabase = {
  users: [{ ...adminUser, admin: true, userType: 'admin', profileComplete: true }],
  messages: [],
  listings: [],
  posts: [],
  notifications: [],
  reviews: [],
  announcements: [],
  feedbacks: [],
  adminTotpSecret: database.adminTotpSecret,
  totpSetupPending: database.totpSetupPending ?? true
};

fs.writeFileSync(databasePath, JSON.stringify(resetDatabase, null, 2), 'utf8');
console.log('Yayin verileri sifirlandi; admin kullanicisi korundu.');
