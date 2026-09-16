import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolveMx } from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set('trust proxy', 1);

app.use(session({
  secret: process.env.NEXTAUTH_SECRET || 'ustasantiye_gizli_anahtar',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
const databasePath = path.join(__dirname, 'data.json');
const port = Number(process.env.PORT || 3000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const isProductionHttps = process.env.NODE_ENV === 'production' || process.env.SESSION_SECURE === 'true' || /^https:/i.test(String(process.env.BASE_URL || ''));
app.set('trust proxy', 1);
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const hasGoogleConfiguration = Boolean(googleClientId && googleClientSecret && !googleClientId.startsWith('BURAYA_') && !googleClientSecret.startsWith('BURAYA_'));
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
function getRequestProtocol(request) {
  const forwardedProto = (request.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (forwardedProto) return forwardedProto;
  return request.protocol || 'http';
}
function getGoogleRedirectUri(request) {
  const requestHost = request.get('host');
  const requestProtocol = getRequestProtocol(request);
  const configuredUrl = new URL(googleRedirectUri);
  const requestUrl = new URL(`${requestProtocol}://${requestHost}`);
  if (requestHost === configuredUrl.host) return googleRedirectUri;
  if (requestUrl.host === configuredUrl.host) return googleRedirectUri;
  if (requestHost === `localhost:${port}` || requestHost === `127.0.0.1:${port}`) return `http://${requestHost}/api/auth/google/callback`;
  if (configuredUrl.host.endsWith('.' + requestHost) || requestHost.endsWith('.' + configuredUrl.host)) return googleRedirectUri;
  return googleRedirectUri;
}
const plans = {
  Ucretsiz: { name: 'Ucretsiz', amount: 0 },
  Elite: { name: 'Elite', amount: 25 },
  Premium: { name: 'Premium', amount: 50 }
};
const pendingRegistrations = new Map();
const pendingPasswordResets = new Map();
const database = fs.existsSync(databasePath) ? JSON.parse(fs.readFileSync(databasePath, 'utf8')) : { users: [], messages: [], listings: [], posts: [], notifications: [] };
database.users ||= [];
database.messages ||= [];
database.listings ||= [];
database.posts ||= [];
database.notifications ||= [];
database.reviews ||= [];
database.announcements ||= [];
database.feedbacks ||= [];
database.totpSetupPending = database.totpSetupPending ?? true;
const adminEmail = 'kotumar@gmail.com';
const adminPassword = 'Slymnktmr7';
const appSecret = process.env.APP_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const donationConfig = {
  accountName: 'SÜLEYMAN KOTUMAR',
  banks: [
    { bank: 'Ziraat Bankası', iban: 'TR33 0001 0002 8873 3724 6750 01' },
    { bank: 'İş Bankası', iban: 'TR31 0006 4000 0016 4640 2621 20' }
  ],
  title: 'USTAŞANTİYE\'YE DESTEK',
  intro: 'Bu platformu oluştururken tek bir amacım vardı: İçeriklerin ve hizmetin herkese tamamen ücretsiz, engelsiz bir şekilde ulaşması. Sitedeki her şey dün olduğu gibi bugün de tamamen ücretsiz ve hep öyle kalacak.'
};

function signDonationConfig(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', appSecret).update(body).digest('hex');
  return { ...payload, signature };
}

function verifyDonationConfig(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const { signature, ...rest } = payload;
  if (!signature || typeof signature !== 'string') return false;
  const expected = crypto.createHmac('sha256', appSecret).update(JSON.stringify(rest)).digest('hex');
  if (expected.length !== signature.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

function generateTotpSecret(length = 32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = crypto.randomBytes(length);
  let secret = '';
  for (let index = 0; index < bytes.length; index += 1) {
    secret += alphabet[bytes[index] % alphabet.length];
  }
  return secret;
}
function normalizeTotpSecret(value) {
  const secret = String(value || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z2-7]+$/.test(secret) || secret.length < 16) {
    return generateTotpSecret();
  }
  return secret;
}
let adminTotpSecret = normalizeTotpSecret(database.adminTotpSecret || generateTotpSecret());
database.adminTotpSecret = adminTotpSecret;
database.totpSetupPending = database.totpSetupPending ?? true;
const registeredUsers = new Map(database.users.map(user => [user.email, user]));
const mailPlaceholders = ['smtp.example.com', 'mail@example.com', 'mail-sifreniz', 'your-gmail-address@gmail.com', 'your-app-password'];
const hasMailConfiguration = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && !mailPlaceholders.some(value => [process.env.SMTP_HOST, process.env.SMTP_USER, process.env.SMTP_PASS].includes(value));
const mailTransport = hasMailConfiguration
  ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
  : null;

app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ustasantiye-local-session-secret',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: isProductionHttps ? 'none' : 'lax',
    secure: isProductionHttps,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use((request, response, next) => {
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://oauth2.googleapis.com https://accounts.google.com; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com");
  next();
});
app.use(express.static(__dirname));

function saveDatabase() {
  database.users = [...registeredUsers.values()];
  fs.writeFileSync(databasePath, JSON.stringify(database, null, 2), 'utf8');
}

function getCookieValue(request, name) {
  const cookieHeader = request.headers.cookie || '';
  const match = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  if (!match) return '';
  return decodeURIComponent(match.slice(name.length + 1));
}

function clearCookie(response, name) {
  response.clearCookie(name, { path: '/', httpOnly: true, sameSite: isProductionHttps ? 'none' : 'lax', secure: isProductionHttps });
}

function getSessionUser(request) {
  return request.session.userId ? registeredUsers.get(request.session.userId) : null;
}

function requireSessionUser(request, response, next) {
  if (!getSessionUser(request)) return response.status(401).json({ status: 'failed', message: 'Mesajlaşmak için giriş yapmalısın.' });
  return next();
}

const requiredEnvironment = ['PAYTR_MERCHANT_ID', 'PAYTR_MERCHANT_KEY', 'PAYTR_MERCHANT_SALT'];
const placeholderValues = ['PAYTR_MAGAZA_NUMARANIZ', 'PAYTR_MERCHANT_KEY', 'PAYTR_MERCHANT_SALT'];
const hasPaytrConfiguration = requiredEnvironment.every(name => process.env[name]) && !placeholderValues.includes(process.env.PAYTR_MERCHANT_ID) && !placeholderValues.includes(process.env.PAYTR_MERCHANT_KEY) && !placeholderValues.includes(process.env.PAYTR_MERCHANT_SALT);

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.socket.remoteAddress;
  return String(ip || '127.0.0.1').replace(/^::ffff:/, '').slice(0, 39);
}

function createMerchantOrderId() {
  return `USTA${Date.now()}${crypto.randomBytes(4).toString('hex')}`.slice(0, 64);
}

function createPaytrToken(values) {
  const hashString = values.merchantId + values.userIp + values.merchantOid + values.email + values.paymentAmount + values.userBasket + values.noInstallment + values.maxInstallment + values.currency + values.testMode;
  return crypto.createHmac('sha256', values.merchantKey).update(hashString + values.merchantSalt).digest('base64');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLocaleLowerCase('tr-TR');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve({ salt, hash: derivedKey.toString('hex') })));
}

function codesMatch(expected, received) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(received || ''));
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function decodeBase32(value) {
  const normalized = String(value || '').replace(/\s+/g, '').toUpperCase().replace(/=+$/, '');
  if (!normalized) return Buffer.alloc(0);

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let bitCount = 0;
  const output = [];

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) continue;
    bits = (bits << 5) | index;
    bitCount += 5;

    if (bitCount >= 8) {
      bitCount -= 8;
      output.push((bits >> bitCount) & 0xff);
    }
  }

  return Buffer.from(output);
}

function getTotpCode(secret = adminTotpSecret, timestamp = Date.now()) {
  const timeStep = 30;
  const timeCounter = Math.floor(timestamp / 1000 / timeStep);
  const base32 = String(secret || '').replace(/\s+/g, '').toUpperCase();
  const key = decodeBase32(base32);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(0, 0);
  counter.writeUInt32BE(timeCounter, 4);
  const hash = crypto.createHmac('sha1', key).update(counter).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  let binary = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
  const code = (binary % 1000000).toString();
  return code.padStart(6, '0');
}

function isTotpCodeValid(secret = adminTotpSecret, submittedCode, allowedDrift = 1) {
  const entered = String(submittedCode || '').trim();
  if (!/^\d{6}$/.test(entered)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  for (let step = -allowedDrift; step <= allowedDrift; step += 1) {
    if (getTotpCode(secret, (currentCounter + step) * 30 * 1000) === entered) {
      return true;
    }
  }
  return false;
}

function buildTotpUri(secret = adminTotpSecret, email = adminEmail, issuer = 'USTAŞANTİYE') {
  const safeEmail = String(email || adminEmail).trim();
  const label = `${issuer}:${safeEmail}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(String(secret || adminTotpSecret))}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&period=30&digits=6`;
}

async function ensureAdminUser() {
  const normalizedEmail = normalizeEmail(adminEmail);
  if (registeredUsers.has(normalizedEmail)) {
    const existingAdmin = registeredUsers.get(normalizedEmail);
    existingAdmin.admin = true;
    existingAdmin.userType = 'admin';
    existingAdmin.profileComplete = true;
    return;
  }
  const passwordData = await hashPassword(adminPassword);
  registeredUsers.set(normalizedEmail, {
    email: normalizedEmail,
    firstName: 'Süleyman',
    lastName: 'Kotumar',
    password: passwordData,
    profileComplete: true,
    userType: 'admin',
    admin: true,
    workExperiences: []
  });
  saveDatabase();
}

ensureAdminUser().catch(error => console.error('Admin kullanıcı kurulumu hatası:', error));

async function sendVerificationEmail(email, firstName, code) {
  if (!mailTransport) {
    throw new Error('SMTP ayarlari eksik. E-posta gonderimi icin .env dosyasini doldurun.');
  }
  await mailTransport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'USTAŞANTİYE e-posta doğrulama kodun',
    text: `Merhaba ${firstName}, USTAŞANTİYE kayıt işlemini tamamlamak için doğrulama kodun: ${code}`
  });
}

async function sendPasswordResetEmail(email, firstName, code) {
  if (!mailTransport) throw new Error('SMTP ayarlari eksik. Sifre yenileme icin e-posta ayarlarini .env dosyasina ekleyin.');
  await mailTransport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'USTAŞANTİYE şifre yenileme kodun',
    text: `Merhaba ${firstName || ''}, USTAŞANTİYE şifreni yenilemek için doğrulama kodun: ${code}. Kod 10 dakika geçerlidir.`
  });
}

app.post('/api/auth/register', async (request, response) => {
  const { firstName, lastName, email, password, userType } = request.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!firstName || !lastName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail) || typeof password !== 'string' || password.length < 8 || !/\d/.test(password) || !['santiye', 'usta'].includes(userType)) {
    return response.status(400).json({ status: 'failed', message: 'Ad, soyad, geçerli e-posta, en az 8 karakterli ve en az bir rakam içeren şifre ile hesap türü gerekli.' });
  }

  if (registeredUsers.has(normalizedEmail)) {
    return response.status(409).json({ status: 'failed', message: 'Bu e-posta adresiyle kayıtlı bir hesap zaten var.' });
  }

  try {
    const domain = normalizedEmail.split('@')[1];
    if (!domain) {
      throw new Error('Geçerli bir e-posta adresi girin.');
    }

    const mxRecords = await resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) {
      throw new Error('Girdiğiniz e-posta adresi geçerli görünmüyor. Lütfen gerçek bir e-posta adresi yazın.');
    }
  } catch (error) {
    return response.status(400).json({
      status: 'failed',
      message: error.message || 'Girdiğiniz e-posta adresi geçerli görünmüyor. Lütfen gerçek bir e-posta adresi yazın.'
    });
  }

  const passwordData = await hashPassword(password);
  registeredUsers.set(normalizedEmail, {
    email: normalizedEmail,
    firstName: String(firstName).trim(),
    lastName: String(lastName).trim(),
    password: passwordData,
    profileComplete: false,
    userType,
    workExperiences: []
  });

  request.session.userId = normalizedEmail;
  saveDatabase();

  return response.json({
    status: 'success',
    email: normalizedEmail,
    userType,
    message: 'Hesabınız oluşturuldu. Profil bilgilerinizi tamamlayın.'
  });
});

app.post('/api/auth/verify', async (request, response) => {
  const normalizedEmail = normalizeEmail(request.body?.email);
  const pending = pendingRegistrations.get(normalizedEmail);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingRegistrations.delete(normalizedEmail);
    return response.status(400).json({ status: 'failed', message: 'Doğrulama kodu geçersiz veya süresi dolmuş.' });
  }
  if (!/^\d{6}$/.test(String(request.body?.code || '')) || !codesMatch(pending.code, request.body.code)) {
    return response.status(400).json({ status: 'failed', message: 'Doğrulama kodu yanlış.' });
  }
  registeredUsers.set(normalizedEmail, {
    email: normalizedEmail,
    firstName: pending.firstName,
    lastName: pending.lastName,
    password: pending.password,
    profileComplete: false,
    userType: ['santiye', 'usta'].includes(pending.userType) ? pending.userType : 'usta',
    workExperiences: []
  });
  request.session.userId = normalizedEmail;
  request.session.save(() => {});
  saveDatabase();
  pendingRegistrations.delete(normalizedEmail);
  return response.json({ status: 'success', email: normalizedEmail, userType: pending.userType || 'usta', message: 'Giriş yapıldı. Profilini tamamlayabilirsin.' });
});

app.post('/api/auth/login', async (request, response) => {
  const normalizedEmail = normalizeEmail(request.body?.email);
  const user = registeredUsers.get(normalizedEmail);
  if (!user || !user.password?.hash || typeof request.body?.password !== 'string') {
    return response.status(401).json({ status: 'failed', message: 'E-posta veya şifre hatalı.' });
  }
  const password = await hashPassword(request.body.password, user.password.salt);
  if (!codesMatch(password.hash, user.password.hash)) return response.status(401).json({ status: 'failed', message: 'E-posta veya şifre hatalı.' });

  if (user.admin || normalizedEmail === adminEmail) {
    const otp = String(request.body?.authCode || '').trim();
    const shouldRequireTotp = database.totpSetupPending || Boolean(user.admin && database.totpSetupPending !== false);
    if (!otp) {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(buildTotpUri(adminTotpSecret, adminEmail, 'USTAŞANTİYE'))}`;
      return response.status(401).json({
        status: 'failed',
        message: 'Admin için Google Authenticator kodu gerekli.',
        requireTotp: true,
        adminEmail: normalizedEmail,
        setupRequired: shouldRequireTotp,
        secret: shouldRequireTotp ? adminTotpSecret : null,
        qrUrl: shouldRequireTotp ? qrUrl : '',
        otpauthUri: shouldRequireTotp ? buildTotpUri(adminTotpSecret, adminEmail, 'USTAŞANTİYE') : null
      });
    }
    if (!isTotpCodeValid(adminTotpSecret, otp, 1)) {
      return response.status(401).json({ status: 'failed', message: 'Google Authenticator kodu yanlış. Lütfen 30 saniye bekleyip tekrar deneyin.', requireTotp: true, adminEmail: normalizedEmail, setupRequired: shouldRequireTotp });
    }
    database.totpSetupPending = false;
    saveDatabase();
  }

  request.session.userId = user.email;
  return response.json({ status: 'success', email: normalizedEmail, name: `${user.firstName} ${user.lastName}`, admin: Boolean(user.admin || normalizedEmail === adminEmail) });
});

app.post('/api/auth/password-reset/request', async (request, response) => {
  const normalizedEmail = normalizeEmail(request.body?.email);
  const user = registeredUsers.get(normalizedEmail);
  if (!user || user.admin || normalizedEmail === adminEmail) return response.status(400).json({ status: 'failed', message: 'Bu hesap icin e-posta ile sifre yenileme kullanilamiyor.' });
  const code = String(crypto.randomInt(100000, 1000000));
  try {
    await sendPasswordResetEmail(user.email, user.firstName, code);
    pendingPasswordResets.set(normalizedEmail, { code, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0 });
    return response.json({ status: 'success', email: normalizedEmail, maskedEmail: `${normalizedEmail.slice(0, 2)}***${normalizedEmail.slice(normalizedEmail.indexOf('@'))}`, message: 'Dogrulama kodu kayitli e-posta adresinize gonderildi.' });
  } catch (error) {
    return response.status(503).json({ status: 'failed', message: error.message || 'E-posta gonderilemedi.' });
  }
});

app.post('/api/auth/password-reset/verify', (request, response) => {
  const normalizedEmail = normalizeEmail(request.body?.email);
  const pending = pendingPasswordResets.get(normalizedEmail);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingPasswordResets.delete(normalizedEmail);
    return response.status(400).json({ status: 'failed', message: 'Dogrulama kodu gecersiz veya suresi dolmus.' });
  }
  pending.attempts += 1;
  if (pending.attempts > 5 || !/^\d{6}$/.test(String(request.body?.code || '')) || !codesMatch(pending.code, request.body.code)) {
    if (pending.attempts > 5) pendingPasswordResets.delete(normalizedEmail);
    return response.status(400).json({ status: 'failed', message: 'Dogrulama kodu yanlis.' });
  }
  pending.verified = true;
  pending.resetToken = crypto.randomBytes(32).toString('hex');
  return response.json({ status: 'success', resetToken: pending.resetToken, message: 'Kod dogrulandi. Yeni sifrenizi olusturun.' });
});

app.post('/api/auth/password-reset/complete', async (request, response) => {
  const normalizedEmail = normalizeEmail(request.body?.email);
  const pending = pendingPasswordResets.get(normalizedEmail);
  const password = String(request.body?.password || '');
  if (!pending || !pending.verified || pending.resetToken !== request.body?.resetToken || pending.expiresAt < Date.now()) return response.status(400).json({ status: 'failed', message: 'Sifre yenileme oturumu gecersiz veya suresi dolmus.' });
  if (password.length < 8 || !/\d/.test(password)) return response.status(400).json({ status: 'failed', message: 'Yeni sifre en az 8 karakter ve en az bir rakam icermeli.' });
  const user = registeredUsers.get(normalizedEmail);
  if (!user) return response.status(404).json({ status: 'failed', message: 'Kullanici bulunamadi.' });
  user.password = await hashPassword(password);
  pendingPasswordResets.delete(normalizedEmail);
  saveDatabase();
  return response.json({ status: 'success', message: 'Sifreniz yenilendi. Yeni sifrenizle giris yapabilirsiniz.' });
});

app.get('/api/admin/totp', (request, response) => {
  const user = getSessionUser(request);
  if (!database.totpSetupPending && (!user || !user.admin)) {
    return response.status(403).json({ status: 'failed', message: 'Bu işlemi yalnızca admin kullanıcısı yapabilir.' });
  }
  const secret = adminTotpSecret;
  const otpauthUri = buildTotpUri(secret, adminEmail, 'USTAŞANTİYE');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`;
  if (!database.totpSetupPending) {
    return response.json({ status: 'success', setupRequired: false, code: getTotpCode(secret), validFor: 30, secret: null, otpauthUri: null, qrUrl: '' });
  }
  return response.json({ status: 'success', setupRequired: true, code: getTotpCode(secret), validFor: 30, secret, otpauthUri, qrUrl });
});

app.post('/api/admin/totp/reset', requireSessionUser, async (request, response) => {
  const user = getSessionUser(request);
  if (!user || (!user.admin && user.email !== adminEmail)) return response.status(403).json({ status: 'failed', message: 'Bu işlemi yalnızca admin kullanıcısı yapabilir.' });
  const { email, password } = request.body || {};
  const normalizedEmail = normalizeEmail(email);
  const account = registeredUsers.get(normalizedEmail);
  if (!account || !account.password?.hash || typeof password !== 'string') {
    return response.status(401).json({ status: 'failed', message: 'E-posta veya şifre hatalı.' });
  }
  const passwordData = await hashPassword(password, account.password.salt);
  if (!codesMatch(passwordData.hash, account.password.hash)) {
    return response.status(401).json({ status: 'failed', message: 'E-posta veya şifre hatalı.' });
  }
  adminTotpSecret = generateTotpSecret();
  database.adminTotpSecret = adminTotpSecret;
  database.totpSetupPending = true;
  saveDatabase();
  const otpauthUri = buildTotpUri(adminTotpSecret, adminEmail, 'USTAŞANTİYE');
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUri)}`;
  return response.json({ status: 'success', secret: adminTotpSecret, otpauthUri, qrUrl, code: getTotpCode(adminTotpSecret) });
});

app.get('/api/admin/summary', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  if (!user || !user.admin) return response.status(403).json({ status: 'failed', message: 'Bu işlemi yalnızca admin kullanıcısı yapabilir.' });

  const feedbacks = [...database.feedbacks, ...database.reviews].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const summaries = {
    totalUsers: registeredUsers.size,
    activeListings: database.listings.length,
    totalAnnouncements: database.announcements.length,
    totalFeedback: feedbacks.length,
    recentUsers: [...registeredUsers.values()].slice(0, 6).map(profile => ({
      email: profile.email,
      name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || profile.email,
      userType: profile.userType || 'user',
      createdAt: profile.createdAt || 'Bilinmiyor'
    })),
    recentFeedback: feedbacks.slice(0, 8).map(item => ({
      id: item.id || item.email || crypto.randomUUID(),
      author: item.authorName || item.authorEmail || item.email || 'Kullanıcı',
      text: item.text || item.jobDescription || 'Geri bildirim metni mevcut değil.',
      rating: item.rating || 0,
      createdAt: item.createdAt || new Date().toISOString()
    }))
  };

  return response.json({ status: 'success', summary: summaries });
});

app.get('/api/admin/feedback', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  if (!user || !user.admin) return response.status(403).json({ status: 'failed', message: 'Bu işlemi yalnızca admin kullanıcısı yapabilir.' });

  const feedbacks = [...database.feedbacks, ...database.reviews].map(item => ({
    id: item.id || crypto.randomUUID(),
    author: item.authorName || item.authorEmail || item.email || 'Kullanıcı',
    email: item.authorEmail || item.email || item.recipientEmail || 'yok',
    text: item.text || item.jobDescription || 'Geri bildirim metni mevcut değil.',
    rating: Number(item.rating) || 0,
    createdAt: item.createdAt || new Date().toISOString(),
    source: item.authorName ? 'yorum' : 'geri-bildirim'
  })).sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  return response.json({ status: 'success', feedbacks });
});

app.get('/api/announcements', (_request, response) => {
  return response.json({ status: 'success', announcements: (database.announcements || []).slice(0, 10) });
});

app.get('/api/donation/config', (_request, response) => {
  const safePayload = {
    accountName: String(donationConfig.accountName || '').trim(),
    title: String(donationConfig.title || 'USTAŞANTİYE\'YE DESTEK').trim(),
    intro: String(donationConfig.intro || '').trim(),
    banks: Array.isArray(donationConfig.banks) ? donationConfig.banks.map(item => ({
      bank: String(item?.bank || '').trim(),
      iban: String(item?.iban || '').trim()
    })).filter(item => item.bank && item.iban) : []
  };

  if (!safePayload.banks.length) {
    return response.status(500).json({ status: 'failed', message: 'Bağış bilgileri hazır değil.' });
  }

  return response.json({ status: 'success', data: signDonationConfig(safePayload) });
});

app.post('/api/admin/donation/config', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  if (!user || !user.admin) return response.status(403).json({ status: 'failed', message: 'Yalnızca admin bağış bilgisi güncelleyebilir.' });

  const incoming = request.body || {};
  const banks = Array.isArray(incoming.banks) ? incoming.banks.map(item => ({
    bank: String(item?.bank || '').trim(),
    iban: String(item?.iban || '').trim().replace(/\s+/g, ' ')
  })).filter(item => item.bank && /^TR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}$/.test(item.iban)) : [];

  if (!banks.length || !String(incoming.accountName || '').trim()) {
    return response.status(400).json({ status: 'failed', message: 'Bağış bilgileri eksik veya IBAN formatı hatalı.' });
  }

  donationConfig.accountName = String(incoming.accountName).trim();
  donationConfig.title = String(incoming.title || donationConfig.title).trim();
  donationConfig.intro = String(incoming.intro || donationConfig.intro).trim();
  donationConfig.banks = banks;

  return response.json({ status: 'success', data: signDonationConfig({
    accountName: donationConfig.accountName,
    title: donationConfig.title,
    intro: donationConfig.intro,
    banks: donationConfig.banks
  }) });
});

app.post('/api/feedback', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const text = String(request.body?.text || '').trim();
  if (!text || text.length < 10 || text.length > 2000) {
    return response.status(400).json({ status: 'failed', message: 'Geri bildirim en az 10 karakter olmalıdır.' });
  }

  const feedback = {
    id: crypto.randomUUID(),
    authorEmail: user.email,
    authorName: `${user.firstName} ${user.lastName}`.trim(),
    text,
    rating: Number(request.body?.rating) || 5,
    createdAt: new Date().toISOString()
  };

  database.feedbacks.unshift(feedback);
  saveDatabase();
  return response.status(201).json({ status: 'success', feedback });
});

app.post('/api/admin/announcements', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  if (!user || !user.admin) return response.status(403).json({ status: 'failed', message: 'Yalnızca admin duyuru paylaşabilir.' });

  const title = String(request.body?.title || '').trim();
  const text = String(request.body?.text || '').trim();
  if (!title || !text || title.length > 120 || text.length > 1500) {
    return response.status(400).json({ status: 'failed', message: 'Başlık ve duyuru metni gerekli ve uygun uzunlukta olmalı.' });
  }

  const announcement = {
    id: crypto.randomUUID(),
    title,
    text,
    author: `${user.firstName} ${user.lastName}`.trim(),
    createdAt: new Date().toISOString(),
    priority: request.body?.priority || 'normal'
  };

  database.announcements.unshift(announcement);
  saveDatabase();
  return response.status(201).json({ status: 'success', announcement });
});

app.delete('/api/admin/announcements/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  if (!user || (!user.admin && user.email !== adminEmail)) return response.status(403).json({ status: 'failed', message: 'Yalnızca admin duyuru silebilir.' });

  const index = database.announcements.findIndex(item => item.id === request.params.id);
  if (index === -1) return response.status(404).json({ status: 'failed', message: 'Silinecek duyuru bulunamadı.' });

  database.announcements.splice(index, 1);
  saveDatabase();
  return response.json({ status: 'success', message: 'Duyuru silindi.' });
});

app.get('/api/auth/google/start', (request, response) => {
  if (!hasGoogleConfiguration) return response.status(503).json({ status: 'failed', message: 'Google girişi için .env dosyasındaki GOOGLE_CLIENT_ID ve GOOGLE_CLIENT_SECRET satırlarını doldurun.' });
  const state = crypto.randomBytes(24).toString('hex');
  const redirectUri = getGoogleRedirectUri(request);
  request.session.googleState = state;
  request.session.googleRedirectUri = redirectUri;

  response.cookie('google_oauth_state', state, {
    httpOnly: true,
    sameSite: isProductionHttps ? 'none' : 'lax',
    secure: isProductionHttps,
    path: '/',
    maxAge: 5 * 60 * 1000
  });
  response.cookie('google_oauth_redirect_uri', redirectUri, {
    httpOnly: true,
    sameSite: isProductionHttps ? 'none' : 'lax',
    secure: isProductionHttps,
    path: '/',
    maxAge: 5 * 60 * 1000
  });

  request.session.save(error => {
    if (error) {
      return response.status(500).json({ status: 'failed', message: 'Google güvenlik oturumu kaydedilemedi.' });
    }
    const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account' });
    return response.json({ status: 'success', url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  });
});

app.get('/api/auth/google/callback', async (request, response) => {
  const { code, state, error } = request.query;
  if (error) return response.redirect(`/?google_error=${encodeURIComponent('Google girişi iptal edildi.')}`);
  const storedState = getCookieValue(request, 'google_oauth_state') || request.session.googleState;
  const storedRedirectUri = getCookieValue(request, 'google_oauth_redirect_uri') || request.session.googleRedirectUri;
  if (!code || !state || state !== storedState) return response.redirect(`/?google_error=${encodeURIComponent('Google güvenlik doğrulaması başarısız oldu.')}`);
  const redirectUri = storedRedirectUri || getGoogleRedirectUri(request);
  delete request.session.googleState;
  delete request.session.googleRedirectUri;
  clearCookie(response, 'google_oauth_state');
  clearCookie(response, 'google_oauth_redirect_uri');
  request.session.save(() => {});
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Google erişim belirteci alınamadı.');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.email || !profile.email_verified) throw new Error('Google hesabının e-posta adresi doğrulanamadı.');
    const email = normalizeEmail(profile.email);
    let user = registeredUsers.get(email);
    if (!user) {
      user = { email, firstName: profile.given_name || profile.name || 'Google', lastName: profile.family_name || '', password: null, profileComplete: false, authProvider: 'google' };
      registeredUsers.set(email, user);
      saveDatabase();
    }
    request.session.userId = email;
    return request.session.save(() => response.redirect('/?google_success=1'));
  } catch (oauthError) {
    return response.redirect(`/?google_error=${encodeURIComponent(oauthError.message || 'Google girişi başarısız oldu.')}`);
  }
});

app.post('/api/auth/logout', (request, response) => request.session.destroy(() => response.json({ status: 'success' })));
app.get('/api/auth/me', (request, response) => {
  const user = getSessionUser(request);
  if (!user) return response.status(401).json({ status: 'failed', message: 'Oturum bulunamadı.' });
  user.workExperiences ||= [];
  const ratingAverage = user.ratings?.length ? user.ratings.reduce((sum, rating) => sum + Number(rating), 0) / user.ratings.length : 0;
  return response.json({ status: 'success', user: { email: user.email, firstName: user.firstName, lastName: user.lastName, profileComplete: user.profileComplete, phone: user.phone, userType: user.userType, admin: Boolean(user.admin), province: user.province, district: user.district, experienceYears: user.experienceYears, workExperiences: user.workExperiences, ratingAverage } });
});

app.get('/api/users/:email/profile', (request, response) => {
  const user = registeredUsers.get(normalizeEmail(request.params.email));
  if (!user) return response.status(404).json({ status: 'failed', message: 'Kullanıcı profili bulunamadı.' });
  user.workExperiences ||= [];
  const posts = database.posts.filter(post => post.ownerEmail === user.email).map(post => ({ ...post, likes: post.likes.length, likeUsers: post.likes.map(email => registeredUsers.get(email)).filter(Boolean).map(person => ({ email: person.email, name: `${person.firstName} ${person.lastName}`.trim() })), likedByCurrentUser: Boolean(getSessionUser(request) && post.likes.includes(getSessionUser(request).email)), comments: post.comments.map(comment => ({ ...comment })) }));
  const reviews = database.reviews.filter(review => review.recipientEmail === user.email).map(review => ({ ...review, author: registeredUsers.get(review.authorEmail) ? `${registeredUsers.get(review.authorEmail).firstName} ${registeredUsers.get(review.authorEmail).lastName}`.trim() : review.authorEmail }));
  const ratingAverage = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  return response.json({ status: 'success', profile: { email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone || 'Telefon paylaşılmadı', userType: user.userType === 'usta' ? 'Usta / ekip' : user.userType === 'santiye' ? 'Şantiye' : 'Hesap türü belirtilmedi', province: user.province || 'Konum belirtilmedi', district: user.district || '', experienceYears: user.experienceYears ?? 'Belirtilmedi', workExperiences: user.workExperiences, ratingAverage, reviews, posts } });
});

app.get('/api/users/:email/posts', (request, response) => {
  const email = normalizeEmail(request.params.email);
  if (!registeredUsers.has(email)) return response.status(404).json({ status: 'failed', message: 'Kullanıcı bulunamadı.' });
  const currentUser = getSessionUser(request);
  const posts = database.posts.filter(post => post.ownerEmail === email).map(post => ({ ...post, likes: post.likes.length, likeUsers: post.likes.map(likeEmail => registeredUsers.get(likeEmail)).filter(Boolean).map(person => ({ email: person.email, name: `${person.firstName} ${person.lastName}`.trim() })), likedByCurrentUser: Boolean(currentUser && post.likes.includes(currentUser.email)), comments: post.comments.map(comment => ({ ...comment })) }));
  return response.json({ status: 'success', posts });
});

app.post('/api/posts', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const { description, image } = request.body || {};
  if (!String(description || '').trim() || String(description).length > 3000) return response.status(400).json({ status: 'failed', message: 'Gönderi açıklaması gerekli ve 3000 karakteri geçemez.' });
  if (image && (!String(image).startsWith('data:image/') || String(image).length > 4_000_000)) return response.status(400).json({ status: 'failed', message: 'Geçerli ve 4 MB altında bir görsel seçin.' });
  const post = { id: crypto.randomUUID(), ownerEmail: user.email, ownerName: `${user.firstName} ${user.lastName}`.trim(), description: String(description).trim(), image: image || '', createdAt: new Date().toISOString(), likes: [], comments: [] };
  database.posts.unshift(post);
  saveDatabase();
  return response.status(201).json({ status: 'success', post: { ...post, likes: 0, likeUsers: [], likedByCurrentUser: false } });
});

app.post('/api/posts/:id/like', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const post = database.posts.find(item => item.id === request.params.id);
  if (!post) return response.status(404).json({ status: 'failed', message: 'Gönderi bulunamadı.' });
  const existingIndex = post.likes.indexOf(user.email);
  const liked = existingIndex === -1;
  if (liked) {
    post.likes.push(user.email);
    if (post.ownerEmail !== user.email) database.notifications.unshift({ id: crypto.randomUUID(), type: 'like', recipientEmail: post.ownerEmail, actorEmail: user.email, actorName: `${user.firstName} ${user.lastName}`.trim(), postId: post.id, text: `${user.firstName} ${user.lastName} gönderini beğendi.`, createdAt: new Date().toISOString(), readAt: null });
  } else post.likes.splice(existingIndex, 1);
  saveDatabase();
  return response.json({ status: 'success', liked, likes: post.likes.length });
});

app.post('/api/posts/:id/comments', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const post = database.posts.find(item => item.id === request.params.id);
  const text = String(request.body?.text || '').trim();
  if (!post) return response.status(404).json({ status: 'failed', message: 'Gönderi bulunamadı.' });
  if (!text || text.length > 1000) return response.status(400).json({ status: 'failed', message: 'Yorum 1 ile 1000 karakter arasında olmalı.' });
  const comment = { id: crypto.randomUUID(), postId: post.id, authorEmail: user.email, authorName: `${user.firstName} ${user.lastName}`.trim(), text, createdAt: new Date().toISOString() };
  post.comments.push(comment);
  if (post.ownerEmail !== user.email) database.notifications.unshift({ id: crypto.randomUUID(), type: 'comment', recipientEmail: post.ownerEmail, actorEmail: user.email, actorName: comment.authorName, postId: post.id, text: `${comment.authorName} gönderine yorum yaptı.`, createdAt: comment.createdAt, readAt: null });
  saveDatabase();
  return response.status(201).json({ status: 'success', comment });
});

app.put('/api/posts/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const post = database.posts.find(item => item.id === request.params.id);
  const description = String(request.body?.description || '').trim();
  if (!post || post.ownerEmail !== user.email) return response.status(404).json({ status: 'failed', message: 'Bu gönderiyi düzenleme yetkiniz yok.' });
  if (!description || description.length > 3000) return response.status(400).json({ status: 'failed', message: 'Gönderi açıklaması gerekli ve 3000 karakteri geçemez.' });
  post.description = description;
  if (request.body?.image !== undefined) post.image = String(request.body.image || '');
  saveDatabase();
  return response.json({ status: 'success', post });
});

app.delete('/api/posts/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const index = database.posts.findIndex(item => item.id === request.params.id && item.ownerEmail === user.email);
  if (index === -1) return response.status(404).json({ status: 'failed', message: 'Bu gönderiyi silme yetkiniz yok.' });
  database.posts.splice(index, 1);
  database.reviews = database.reviews.filter(review => review.postId !== request.params.id);
  saveDatabase();
  return response.json({ status: 'success' });
});

app.put('/api/posts/:postId/comments/:commentId', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const post = database.posts.find(item => item.id === request.params.postId);
  const comment = post?.comments.find(item => item.id === request.params.commentId);
  const text = String(request.body?.text || '').trim();
  if (!comment || comment.authorEmail !== user.email) return response.status(404).json({ status: 'failed', message: 'Bu yorumu düzenleme yetkiniz yok.' });
  if (!text || text.length > 1000) return response.status(400).json({ status: 'failed', message: 'Yorum 1 ile 1000 karakter arasında olmalı.' });
  comment.text = text;
  saveDatabase();
  return response.json({ status: 'success', comment });
});

app.delete('/api/posts/:postId/comments/:commentId', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const post = database.posts.find(item => item.id === request.params.postId);
  const index = post?.comments.findIndex(item => item.id === request.params.commentId && item.authorEmail === user.email) ?? -1;
  if (!post || index === -1) return response.status(404).json({ status: 'failed', message: 'Bu yorumu silme yetkiniz yok.' });
  post.comments.splice(index, 1);
  saveDatabase();
  return response.json({ status: 'success' });
});

app.post('/api/users/:email/reviews', requireSessionUser, (request, response) => {
  const author = getSessionUser(request);
  const recipientEmail = normalizeEmail(request.params.email);
  const recipient = registeredUsers.get(recipientEmail);
  const rating = Number(request.body?.rating);
  const text = String(request.body?.text || '').trim();
  if (!recipient || recipientEmail === author.email) return response.status(400).json({ status: 'failed', message: 'Geçerli bir müşteri değerlendirmesi seçin.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !text || text.length > 1000) return response.status(400).json({ status: 'failed', message: '1-5 arası puan ve 1000 karaktere kadar yorum gerekli.' });
  const review = { id: crypto.randomUUID(), recipientEmail, authorEmail: author.email, authorName: `${author.firstName} ${author.lastName}`.trim(), rating, text, createdAt: new Date().toISOString() };
  database.reviews.unshift(review);
  if (recipientEmail !== author.email) database.notifications.unshift({ id: crypto.randomUUID(), type: 'review', recipientEmail, actorEmail: author.email, actorName: review.authorName, text: `${review.authorName} profilinize ${rating} yıldız verdi.`, createdAt: review.createdAt, readAt: null });
  saveDatabase();
  return response.status(201).json({ status: 'success', review });
});

app.put('/api/reviews/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const review = database.reviews.find(item => item.id === request.params.id && item.authorEmail === user.email);
  const rating = Number(request.body?.rating);
  const text = String(request.body?.text || '').trim();
  if (!review) return response.status(404).json({ status: 'failed', message: 'Bu değerlendirmeyi düzenleme yetkiniz yok.' });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !text || text.length > 1000) return response.status(400).json({ status: 'failed', message: '1-5 arası puan ve yorum gerekli.' });
  review.rating = rating;
  review.text = text;
  saveDatabase();
  return response.json({ status: 'success', review });
});

app.delete('/api/reviews/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const index = database.reviews.findIndex(item => item.id === request.params.id && item.authorEmail === user.email);
  if (index === -1) return response.status(404).json({ status: 'failed', message: 'Bu değerlendirmeyi silme yetkiniz yok.' });
  database.reviews.splice(index, 1);
  saveDatabase();
  return response.json({ status: 'success' });
});

app.post('/api/auth/profile', requireSessionUser, (request, response) => {
  const { phone, userType, province, district, experienceYears } = request.body || {};
  const user = getSessionUser(request);
  const years = Number(experienceYears);
  if (!user || !phone || !['santiye', 'usta'].includes(userType) || !province || !district || !Number.isInteger(years) || years < 0 || years > 80) {
    return response.status(400).json({ status: 'failed', message: 'Telefon, kullanıcı tipi, il, ilçe ve geçerli deneyim yılı gerekli.' });
  }
  user.phone = String(phone).trim();
  user.userType = userType;
  user.province = String(province).trim();
  user.district = String(district).trim();
  user.experienceYears = years;
  user.workExperiences ||= [];
  user.profileComplete = true;
  request.session.userId = user.email;
  saveDatabase();
  return response.json({ status: 'success', message: 'Profilin tamamlandı.' });
});

app.delete('/api/auth/profile/work-experience/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const workId = request.params.id;
  if (!user || !workId) {
    return response.status(400).json({ status: 'failed', message: 'Silinecek iş bilgisi eksik.' });
  }
  user.workExperiences ||= [];
  const originalLength = user.workExperiences.length;
  user.workExperiences = user.workExperiences.filter(item => item.id !== workId);
  if (user.workExperiences.length === originalLength) {
    return response.status(404).json({ status: 'failed', message: 'Silinecek iş bulunamadı.' });
  }
  saveDatabase();
  return response.json({ status: 'success', message: 'İş silindi.' });
});

app.post('/api/auth/profile/work-experience', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const { companyName, contactPhone, address, jobDescription, workPhoto } = request.body || {};
  if (!user || !String(companyName || '').trim() || !String(contactPhone || '').trim() || !String(address || '').trim() || !String(jobDescription || '').trim()) {
    return response.status(400).json({ status: 'failed', message: 'Firma adı, yetkili telefonu, adres ve yaptığınız iş bilgisi gerekli.' });
  }
  if (workPhoto && (!String(workPhoto).startsWith('data:image/') || String(workPhoto).length > 4_000_000)) {
    return response.status(400).json({ status: 'failed', message: 'Fotoğraf geçersiz veya çok büyük.' });
  }
  user.workExperiences ||= [];
  user.workExperiences.unshift({
    id: crypto.randomUUID(),
    companyName: String(companyName).trim(),
    contactPhone: String(contactPhone).trim(),
    address: String(address).trim(),
    jobDescription: String(jobDescription).trim(),
    workPhoto: workPhoto || '',
    createdAt: new Date().toISOString()
  });
  saveDatabase();
  return response.status(201).json({ status: 'success', workExperience: user.workExperiences[0] });
});

app.get('/api/messages', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  const otherEmail = normalizeEmail(request.query.with);
  if (!registeredUsers.has(otherEmail) || otherEmail === currentUser.email) return response.status(400).json({ status: 'failed', message: 'Geçerli bir kullanıcı seçilmedi.' });
  const messages = database.messages.filter(message => (message.senderEmail === currentUser.email && message.recipientEmail === otherEmail) || (message.senderEmail === otherEmail && message.recipientEmail === currentUser.email));
  return response.json({ status: 'success', messages });
});

app.get('/api/messages/summary', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  const conversations = new Map();
  database.messages.filter(message => message.senderEmail === currentUser.email || message.recipientEmail === currentUser.email).forEach(message => {
    const otherEmail = message.senderEmail === currentUser.email ? message.recipientEmail : message.senderEmail;
    const existing = conversations.get(otherEmail);
    if (!existing || existing.createdAt < message.createdAt) conversations.set(otherEmail, { email: otherEmail, name: registeredUsers.get(otherEmail) ? `${registeredUsers.get(otherEmail).firstName} ${registeredUsers.get(otherEmail).lastName}` : 'Kullanıcı', text: message.text, createdAt: message.createdAt, unread: message.recipientEmail === currentUser.email && !message.readAt });
  });
  return response.json({ status: 'success', conversations: [...conversations.values()].sort((first, second) => second.createdAt.localeCompare(first.createdAt)) });
});

app.get('/api/notifications', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  const messageNotifications = database.messages.filter(message => message.recipientEmail === currentUser.email && !message.readAt).map(message => ({ id: message.id, type: 'message', senderEmail: message.senderEmail, senderName: registeredUsers.get(message.senderEmail) ? `${registeredUsers.get(message.senderEmail).firstName} ${registeredUsers.get(message.senderEmail).lastName}` : 'Kullanıcı', text: message.text, createdAt: message.createdAt }));
  const postNotifications = database.notifications.filter(notification => notification.recipientEmail === currentUser.email && !notification.readAt).map(notification => ({ ...notification, senderEmail: notification.actorEmail, senderName: notification.actorName }));
  const notifications = [...messageNotifications, ...postNotifications].sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  return response.json({ status: 'success', notifications });
});

app.post('/api/notifications/read', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  database.messages.forEach(message => { if (message.recipientEmail === currentUser.email && !message.readAt) message.readAt = new Date().toISOString(); });
  database.notifications.forEach(notification => { if (notification.recipientEmail === currentUser.email && !notification.readAt) notification.readAt = new Date().toISOString(); });
  saveDatabase();
  return response.json({ status: 'success' });
});

app.post('/api/messages', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  const recipientEmail = normalizeEmail(request.body?.recipientEmail);
  const text = String(request.body?.text || '').trim();
  if (!registeredUsers.has(recipientEmail) || recipientEmail === currentUser.email || !text || text.length > 2000) return response.status(400).json({ status: 'failed', message: 'Geçerli alıcı ve mesaj gerekli.' });
  const message = { id: crypto.randomUUID(), senderEmail: currentUser.email, recipientEmail, text, createdAt: new Date().toISOString(), readAt: null };
  database.messages.push(message);
  saveDatabase();
  return response.status(201).json({ status: 'success', message });
});

app.delete('/api/messages/conversation/:email', requireSessionUser, (request, response) => {
  const currentUser = getSessionUser(request);
  const otherEmail = normalizeEmail(request.params.email);
  if (!registeredUsers.has(otherEmail) || otherEmail === currentUser.email) return response.status(400).json({ status: 'failed', message: 'Geçerli bir sohbet seçilmedi.' });
  const messages = database.messages.filter(message => (message.senderEmail === currentUser.email && message.recipientEmail === otherEmail) || (message.senderEmail === otherEmail && message.recipientEmail === currentUser.email));
  if (!messages.length) return response.status(404).json({ status: 'failed', message: 'Silinecek sohbet bulunamadı.' });
  database.messages = database.messages.filter(message => !messages.includes(message));
  saveDatabase();
  return response.json({ status: 'success', message: 'Sohbet silindi.' });
});

app.get('/api/listings', (_request, response) => response.json({ status: 'success', listings: database.listings }));

app.post('/api/listings', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const { title, role, category, province, district, description } = request.body || {};
  if (!title || !['santiye', 'usta', 'firma'].includes(role) || !category || !province || !district || !description) return response.status(400).json({ status: 'failed', message: 'İlan bilgileri eksik.' });
  const listing = { id: crypto.randomUUID(), ownerEmail: user.email, ownerName: `${user.firstName} ${user.lastName}`, title: String(title).trim(), role, category, location: `${String(district).trim()}, ${String(province).trim()}`, distance: 0, user: `${user.firstName} ${user.lastName}`, initials: `${user.firstName[0]}${user.lastName[0]}`.toUpperCase(), createdAt: new Date().toISOString(), age: 'az önce', text: String(description).trim() };
  database.listings.unshift(listing);
  saveDatabase();
  return response.status(201).json({ status: 'success', listing });
});

app.delete('/api/listings/:id', requireSessionUser, (request, response) => {
  const user = getSessionUser(request);
  const index = database.listings.findIndex(item => item.id === request.params.id && item.ownerEmail === user.email);
  if (index === -1) return response.status(404).json({ status: 'failed', message: 'Bu ilanı silme yetkiniz yok.' });
  database.listings.splice(index, 1);
  saveDatabase();
  return response.json({ status: 'success', message: 'İlan silindi.' });
});

app.post('/api/paytr/token', async (request, response) => {
  if (!hasPaytrConfiguration) {
    return response.status(503).json({ status: 'failed', message: 'PayTR ayarlari eksik veya ornek deger olarak kalmis. .env dosyasina gercek merchant_id, merchant_key ve merchant_salt bilgilerini girin.' });
  }

  const { plan, userName, email, phone } = request.body || {};
  const selectedPlan = plans[plan];
  if (!selectedPlan || !userName || !email || !phone || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return response.status(400).json({ status: 'failed', message: 'Gecerli musteri ve paket bilgileri gerekli.' });
  }

  const merchantId = process.env.PAYTR_MERCHANT_ID;
  const merchantKey = process.env.PAYTR_MERCHANT_KEY;
  const merchantSalt = process.env.PAYTR_MERCHANT_SALT;
  const merchantOid = createMerchantOrderId();
  const paymentAmount = String(Math.round(selectedPlan.amount * 100));
  const userBasket = Buffer.from(JSON.stringify([[selectedPlan.name, selectedPlan.amount.toFixed(2), 1]])).toString('base64');
  const testMode = process.env.PAYTR_TEST_MODE === '0' ? '0' : '1';
  const noInstallment = '0';
  const maxInstallment = '0';
  const currency = 'TL';
  const values = { merchantId, merchantKey, merchantSalt, userIp: getClientIp(request), merchantOid, email, paymentAmount, userBasket, noInstallment, maxInstallment, currency, testMode };
  const form = new URLSearchParams({
    merchant_id: merchantId,
    user_ip: values.userIp,
    merchant_oid: merchantOid,
    email,
    payment_amount: paymentAmount,
    paytr_token: createPaytrToken(values),
    user_basket: userBasket,
    debug_on: process.env.PAYTR_DEBUG === '0' ? '0' : '1',
    no_installment: noInstallment,
    max_installment: maxInstallment,
    user_name: String(userName).slice(0, 60),
    user_address: 'Online siparis',
    user_phone: String(phone).slice(0, 20),
    merchant_ok_url: process.env.PAYTR_OK_URL || `${baseUrl}/odeme-basarili`,
    merchant_fail_url: process.env.PAYTR_FAIL_URL || `${baseUrl}/odeme-basarisiz`,
    timeout_limit: '30',
    currency,
    test_mode: testMode
  });

  try {
    const paytrResponse = await fetch('https://www.paytr.com/odeme/api/get-token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const responseText = await paytrResponse.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      return response.status(502).json({ status: 'failed', message: `PayTR beklenmeyen yanit verdi: ${responseText.slice(0, 180)}` });
    }
    if (result.status !== 'success') {
      return response.status(502).json({ status: 'failed', message: result.reason || 'PayTR token olusturulamadi.' });
    }
    return response.json({ status: 'success', token: result.token, merchantOid });
  } catch (error) {
    return response.status(502).json({ status: 'failed', message: 'PayTR sunucusuna ulasilamadi.' });
  }
});

app.post('/api/paytr/callback', (request, response) => {
  const { merchant_oid: merchantOid, status, total_amount: totalAmount, hash } = request.body;
  const expectedHash = crypto.createHmac('sha256', process.env.PAYTR_MERCHANT_KEY || '').update(`${merchantOid}${process.env.PAYTR_MERCHANT_SALT || ''}${status}${totalAmount || ''}`).digest('base64');
  const hashMatches = typeof hash === 'string' && hash.length === expectedHash.length && crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
  if (!merchantOid || !hashMatches) {
    return response.status(400).send('HASH_ERR');
  }
  console.log(`PayTR callback: ${merchantOid} -> ${status}`);
  return response.send('OK');
});

app.get('/odeme-basarili', (_request, response) => response.send('<h1>Odeme basarili</h1><p>Siparisiniz PayTR bildirimi ile kesinlestirilecektir.</p>'));
app.get('/odeme-basarisiz', (_request, response) => response.send('<h1>Odeme basarisiz</h1><p>Odeme tamamlanamadi.</p>'));
app.get('*', (_request, response) => response.sendFile(path.join(__dirname, 'ilk sayfam.html')));

app.listen(port, '0.0.0.0', () => console.log(`USTASANTIYE server http://localhost:${port}`));
