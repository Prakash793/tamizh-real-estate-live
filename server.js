const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const auth = require('./auth');
const storage = require('./storage');

const DEFAULT_PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const IS_PROD = process.env.NODE_ENV === 'production';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const VALID_CATEGORIES = [
  'Layout Promotion', 'Buying & Selling Resale Plots', 'Building Construction', 'Farmland Development', 'Farmhouse Development', 'Building & Construction', 'Rental Homes & Flats',
  'Layout', 'Building', 'Farm land', 'Promoting', 'Resell Promoting'
];
const VALID_STATUSES = ['Available', 'Active', 'Booked', 'Sold', 'Under Construction', 'Completed', 'Handover', 'Available for Rent', 'Ready for Rental'];

// In-memory rate limiting map for login attempts: ip -> { count, resetTime, lockedUntil }
const loginRateLimitMap = new Map();

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginRateLimitMap.get(ip);
  if (!entry) return { allowed: true };

  if (entry.lockedUntil && now < entry.lockedUntil) {
    const remainingSecs = Math.ceil((entry.lockedUntil - now) / 1000);
    return { allowed: false, error: `Too many failed login attempts. Please try again in ${remainingSecs} seconds.` };
  }

  if (now > entry.resetTime) {
    loginRateLimitMap.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const entry = loginRateLimitMap.get(ip) || { count: 0, resetTime: now + 15 * 60 * 1000 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = now + 15 * 60 * 1000; // 15-minute lock after 5 consecutive failures
  }
  loginRateLimitMap.set(ip, entry);
}

function recordLoginSuccess(ip) {
  loginRateLimitMap.delete(ip);
}

// Parse request cookies
function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    let [name, ...rest] = cookie.split('=');
    name = name.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

// Read body (supports JSON or base64 data payloads)
function getRequestBody(req, maxBytes = 15 * 1024 * 1024) { // 15MB upload capacity
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    req.on('data', chunk => {
      totalBytes += chunk.length;
      body += chunk.toString();
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(new Error('File or payload exceeds maximum allowed size (15MB)'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function getSessionCookieHeader(token, maxAgeSeconds) {
  const secureFlag = IS_PROD ? '; Secure' : '';
  return `trs_admin_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureFlag}`;
}

// Magic bytes validator for real raster image inspection
function validateRasterImageBytes(buffer) {
  if (buffer.length < 12) return null;

  // JPEG magic bytes: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
    buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A
  ) {
    return 'png';
  }

  // WebP magic bytes: RIFF .... WEBP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

// Validate and persist an uploaded image from Base64
function saveBase64Image(base64Data, customPrefix = 'img') {
  const matches = base64Data.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid image format. Must be a valid Base64 data URI.');
  }

  let declaredExtension = matches[1].toLowerCase();
  if (declaredExtension === 'jpeg') declaredExtension = 'jpg';

  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > 10 * 1024 * 1024) { // 10MB per image limit
    throw new Error('Image size exceeds 10MB limit.');
  }

  // Check actual file signature (Magic Bytes) - only safe raster formats permitted
  const detectedFormat = validateRasterImageBytes(buffer);
  if (!detectedFormat) {
    throw new Error('Unsupported or corrupted image content. Only valid JPG, PNG, and WebP raster images are accepted.');
  }

  // Safe unique filename with verified detected format
  const sanitizedPrefix = customPrefix.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
  const filename = `${sanitizedPrefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${detectedFormat}`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  // Return public relative path
  return `/uploads/${filename}`;
}

// Initialize server
async function startServer(customPort = null) {
  const listenPort = customPort || process.env.PORT || DEFAULT_PORT;
  await storage.initDB();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    const cookies = parseCookies(req);
    const sessionToken = cookies.trs_admin_session;
    const currentSession = await auth.validateSession(sessionToken);
    const isAuthenticated = !!currentSession;

    // CSRF verification for state-changing Admin requests
    if (pathname.startsWith('/api/admin/') && method !== 'GET') {
      if (!isAuthenticated) {
        return sendJSON(res, 401, { error: 'Access denied: Valid administrator session required.' });
      }
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== sessionToken) {
        return sendJSON(res, 403, { error: 'CSRF token missing or mismatched. Request rejected.' });
      }
    }

    // ==========================================
    // 1. PUBLIC READ-ONLY APIS
    // ==========================================
    if (method === 'GET' && pathname === '/api/public/data') {
      const properties = await storage.getProperties();
      const rawPlots = await storage.getPlots();
      const plots = rawPlots.map(pl => ({
        id: pl.id,
        layoutId: pl.layoutId,
        number: pl.number,
        layout: pl.layout,
        dimension: pl.dimension,
        facing: pl.facing,
        status: pl.status,
        areaSqft: pl.areaSqft || 0,
        plotType: pl.plotType || 'Residential',
        image: pl.image || '',
        gallery: Array.isArray(pl.gallery) ? pl.gallery : [],
        price: 'To be Negotiable'
      }));
      const layoutDoc = await storage.getLayoutDocument();
      const reviews = await storage.getPublishedReviews();
      const happyCustomers = await storage.getPublishedHappyCustomers();
      const servicePanels = await storage.getPublishedServicePanels();
      const socialSettings = await storage.getSocialSettings();
      return sendJSON(res, 200, { properties, plots, layoutDoc, reviews, happyCustomers, servicePanels, socialSettings });
    }

    // ==========================================
    // 2. AUTHENTICATION ENDPOINTS
    // ==========================================
    if (method === 'GET' && pathname === '/api/auth/status') {
      const users = await storage.getUsers();
      return sendJSON(res, 200, {
        hasAdmin: users.length > 0,
        authenticated: isAuthenticated,
        username: isAuthenticated ? currentSession.username : null,
        csrfToken: isAuthenticated ? sessionToken : null,
        environment: IS_PROD ? 'production' : 'development'
      });
    }

    if (method === 'POST' && pathname === '/api/auth/setup') {
      const users = await storage.getUsers();
      if (users.length > 0) {
        return sendJSON(res, 400, { error: 'Administrator account already exists. Please log in at /admin/login.' });
      }

      const { username, password } = await getRequestBody(req);
      if (!username || !username.trim() || !password || password.length < 8) {
        return sendJSON(res, 400, { error: 'Valid username required and password must be at least 8 characters long.' });
      }

      const passwordHash = auth.hashPassword(password);
      await storage.createUser(username.trim(), passwordHash);

      const { token } = await auth.createSession(username.trim());
      recordLoginSuccess(clientIp);
      return sendJSON(res, 200, { success: true, message: 'Admin account created successfully', csrfToken: token }, {
        'Set-Cookie': getSessionCookieHeader(token, 86400)
      });
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      const rateLimitCheck = checkLoginRateLimit(clientIp);
      if (!rateLimitCheck.allowed) {
        return sendJSON(res, 429, { error: rateLimitCheck.error });
      }

      const { username, password } = await getRequestBody(req);
      if (!username || !password) {
        recordLoginFailure(clientIp);
        return sendJSON(res, 400, { error: 'Username and password are required.' });
      }

      const user = await storage.getUserByUsername(username);

      if (!user || !auth.verifyPassword(password || '', user.passwordHash)) {
        recordLoginFailure(clientIp);
        return sendJSON(res, 401, { error: 'Invalid username or password.' });
      }

      recordLoginSuccess(clientIp);
      const { token } = await auth.createSession(user.username);
      return sendJSON(res, 200, { success: true, username: user.username, csrfToken: token }, {
        'Set-Cookie': getSessionCookieHeader(token, 86400)
      });
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      if (sessionToken) {
        await auth.destroySession(sessionToken);
      }
      return sendJSON(res, 200, { success: true }, {
        'Set-Cookie': getSessionCookieHeader('', 0)
      });
    }

    if (method === 'POST' && pathname === '/api/auth/change-credentials') {
      if (!isAuthenticated) {
        return sendJSON(res, 401, { error: 'Unauthorized: Active administrator session required.' });
      }

      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || csrfHeader !== sessionToken) {
        return sendJSON(res, 403, { error: 'CSRF token missing or invalid.' });
      }

      const { currentPassword, newUsername, newPassword } = await getRequestBody(req);
      const user = await storage.getUserByUsername(currentSession.username);

      if (!user || !auth.verifyPassword(currentPassword || '', user.passwordHash)) {
        return sendJSON(res, 400, { error: 'Current password verification failed. Please enter your correct current password.' });
      }

      if (newPassword && newPassword.length < 8) {
        return sendJSON(res, 400, { error: 'New password must be at least 8 characters long.' });
      }

      const updatedUsername = (newUsername && newUsername.trim()) ? newUsername.trim() : user.username;
      const updatedHash = newPassword ? auth.hashPassword(newPassword) : user.passwordHash;

      await storage.updateUser(user.username, updatedUsername, updatedHash);

      await auth.destroySession(sessionToken);
      const { token } = await auth.createSession(updatedUsername);

      return sendJSON(res, 200, { success: true, username: updatedUsername, csrfToken: token }, {
        'Set-Cookie': getSessionCookieHeader(token, 86400)
      });
    }

    // ==========================================
    // 3. SECURE ADMIN-ONLY REST APIS (Requires Active Session & CSRF)
    // ==========================================
    if (pathname.startsWith('/api/admin/')) {
      if (!isAuthenticated) {
        return sendJSON(res, 401, { error: 'Access denied: Valid administrator session required.' });
      }

      // --- SECURE IMAGE UPLOAD HANDLER ---
      if (method === 'POST' && pathname === '/api/admin/upload-image') {
        try {
          const { fileData, prefix } = await getRequestBody(req);
          if (!fileData) {
            return sendJSON(res, 400, { error: 'Missing image payload (fileData base64 required).' });
          }
          const savedUrl = saveBase64Image(fileData, prefix || 'property');
          return sendJSON(res, 200, { success: true, url: savedUrl });
        } catch (uploadErr) {
          return sendJSON(res, 400, { error: uploadErr.message });
        }
      }

      // --- LAYOUT MASTERPLAN & BLUEPRINT DOCUMENT MANAGEMENT ---
      if (method === 'GET' && pathname === '/api/admin/layout-document') {
        const doc = await storage.getLayoutDocument();
        return sendJSON(res, 200, { success: true, layoutDoc: doc });
      }

      if (method === 'PUT' && pathname === '/api/admin/layout-document') {
        const data = await getRequestBody(req);
        const updatedDoc = await storage.updateLayoutDocument({
          title: data.title ? String(data.title).trim() : undefined,
          sanctionNumber: data.sanctionNumber ? String(data.sanctionNumber).trim() : undefined,
          primaryImage: data.primaryImage ? String(data.primaryImage).trim() : undefined,
          gallery: Array.isArray(data.gallery) ? data.gallery.filter(g => typeof g === 'string') : undefined
        });
        return sendJSON(res, 200, { success: true, layoutDoc: updatedDoc });
      }

      // --- PLOTS (Per Layout or Global) ---
      if (method === 'GET' && pathname === '/api/admin/plots') {
        const layoutId = parsedUrl.query.layoutId ? parseInt(parsedUrl.query.layoutId, 10) : null;
        const plots = layoutId ? await storage.getPlotsByLayoutId(layoutId) : await storage.getPlots();
        return sendJSON(res, 200, { success: true, plots });
      }

      if (method === 'POST' && pathname === '/api/admin/plots') {
        const data = await getRequestBody(req);
        if (!data.number) {
          return sendJSON(res, 400, { error: 'Plot number is required.' });
        }
        const layoutIdVal = data.layoutId ? parseInt(data.layoutId, 10) : 1;
        const cleanNumber = String(data.number).trim();

        // Enforce uniqueness within the same layout
        const existingPlots = await storage.getPlotsByLayoutId(layoutIdVal);
        const isDuplicate = existingPlots.some(p => p.number.toLowerCase() === cleanNumber.toLowerCase());
        if (isDuplicate) {
          return sendJSON(res, 400, { error: `Plot number "${cleanNumber}" already exists in this layout. Duplicate plot numbers in the same layout are not allowed.` });
        }

        const statusVal = VALID_STATUSES.includes(data.status) ? (data.status === 'Active' ? 'Available' : data.status) : 'Available';
        const priceVal = (data.price && String(data.price).trim()) ? String(data.price).trim() : 'To be Negotiable';
        const areaSqftVal = parseInt(data.areaSqft, 10) || 0;
        const dimensionVal = data.dimension ? String(data.dimension).trim() : (areaSqftVal ? `${areaSqftVal} Sq.Ft` : '');
        const plotTypeVal = data.plotType ? String(data.plotType).trim() : 'Residential';
        const notesVal = data.notes ? String(data.notes).trim() : '';

        const newPlot = await storage.addPlot({
          layoutId: layoutIdVal,
          number: cleanNumber,
          layout: data.layout ? String(data.layout).trim() : "Sowbhagya Nagar Layout",
          dimension: dimensionVal,
          areaSqft: areaSqftVal,
          plotType: plotTypeVal,
          facing: data.facing ? String(data.facing).trim() : "East Facing",
          price: priceVal,
          status: statusVal,
          notes: notesVal,
          image: data.image ? String(data.image).trim() : '',
          gallery: Array.isArray(data.gallery) ? data.gallery : []
        });
        return sendJSON(res, 201, { success: true, plot: newPlot });
      }

      if (method === 'PUT' && pathname.startsWith('/api/admin/plots/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid plot ID' });
        const data = await getRequestBody(req);
        if (data.status && !VALID_STATUSES.includes(data.status)) {
          return sendJSON(res, 400, { error: 'Invalid status value. Must be Available, Booked, or Sold.' });
        }

        // Check duplicate if plot number is being changed
        if (data.number) {
          const cleanNumber = String(data.number).trim();
          const targetLayoutId = data.layoutId ? parseInt(data.layoutId, 10) : null;
          const allPlots = await storage.getPlots();
          const currentPlot = allPlots.find(p => p.id === id);
          const layoutToCheck = targetLayoutId || (currentPlot ? currentPlot.layoutId : 1);
          const existingPlots = allPlots.filter(p => p.layoutId === layoutToCheck && p.id !== id);
          if (existingPlots.some(p => p.number.toLowerCase() === cleanNumber.toLowerCase())) {
            return sendJSON(res, 400, { error: `Plot number "${cleanNumber}" already exists in this layout. Duplicate plot numbers in the same layout are not allowed.` });
          }
        }

        const updatePayload = {};
        if (data.number !== undefined) updatePayload.number = String(data.number).trim();
        if (data.dimension !== undefined) updatePayload.dimension = String(data.dimension).trim();
        if (data.areaSqft !== undefined) updatePayload.areaSqft = parseInt(data.areaSqft, 10) || 0;
        if (data.plotType !== undefined) updatePayload.plotType = String(data.plotType).trim();
        if (data.facing !== undefined) updatePayload.facing = String(data.facing).trim();
        if (data.status !== undefined) updatePayload.status = data.status;
        if (data.price !== undefined) updatePayload.price = String(data.price).trim();
        if (data.notes !== undefined) updatePayload.notes = String(data.notes).trim();
        if (data.layoutId !== undefined) updatePayload.layoutId = parseInt(data.layoutId, 10);
        if (data.image !== undefined) updatePayload.image = String(data.image).trim();
        if (data.gallery !== undefined) updatePayload.gallery = Array.isArray(data.gallery) ? data.gallery : [];

        const updated = await storage.updatePlot(id, updatePayload);
        if (!updated) return sendJSON(res, 404, { error: 'Plot not found' });
        return sendJSON(res, 200, { success: true, plot: updated });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/plots/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid plot ID' });
        await storage.deletePlot(id);
        return sendJSON(res, 200, { success: true });
      }

      // --- LAYOUT & PROPERTY MANAGER (Admin full view with owner details) ---
      if (method === 'GET' && pathname === '/api/admin/properties') {
        const properties = await storage.getAllAdminProperties();
        return sendJSON(res, 200, { success: true, properties });
      }

      if (method === 'POST' && pathname === '/api/admin/properties') {
        const data = await getRequestBody(req);
        if (!data.title || !data.category) {
          return sendJSON(res, 400, { error: 'Title and category are required.' });
        }
        if (!VALID_CATEGORIES.includes(data.category)) {
          return sendJSON(res, 400, { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
        }
        const statusVal = VALID_STATUSES.includes(data.status) ? (data.status === 'Active' ? 'Available' : data.status) : 'Available';
        const priceVal = 'To be Negotiable';
        const newProp = await storage.addProperty({
          title: String(data.title).trim(),
          category: data.category,
          price: priceVal,
          location: data.location ? String(data.location).trim() : "Kayarambedu, Nellikuppam Main Road",
          image: data.image ? String(data.image).trim() : null,
          masterplanImage: data.masterplanImage ? String(data.masterplanImage).trim() : '',
          sanctionNumber: data.sanctionNumber ? String(data.sanctionNumber).trim() : '',
          ownerName: data.ownerName ? String(data.ownerName).trim() : '',
          ownerPhone: data.ownerPhone ? String(data.ownerPhone).trim() : '',
          internalPrice: data.internalPrice ? String(data.internalPrice).trim() : '',
          plotCount: parseInt(data.plotCount, 10) || 0,
          isPublished: data.isPublished !== false,
          isArchived: Boolean(data.isArchived),
          gallery: Array.isArray(data.gallery) ? data.gallery.filter(g => typeof g === 'string') : [],
          status: statusVal,
          specs: data.specs ? String(data.specs).trim() : "Ready for Registration • Clear Title",
          desc: data.desc ? String(data.desc).trim() : "Verified property managed directly by Mr. K. Kulasekaran.",
          totalLandArea: data.totalLandArea !== undefined ? String(data.totalLandArea).trim() : '',
          totalLandAreaUnit: data.totalLandAreaUnit ? String(data.totalLandAreaUnit).trim() : 'acres',
          builtUpArea: data.builtUpArea !== undefined ? String(data.builtUpArea).trim() : '',
          builtUpAreaUnit: data.builtUpAreaUnit ? String(data.builtUpAreaUnit).trim() : 'sq.ft',
          grossArea: data.grossArea !== undefined ? String(data.grossArea).trim() : '',
          grossAreaUnit: data.grossAreaUnit ? String(data.grossAreaUnit).trim() : 'sq.ft',
          clientName: data.clientName ? String(data.clientName).trim() : '',
          buildingType: data.buildingType ? String(data.buildingType).trim() : '',
          configuration: data.configuration ? String(data.configuration).trim() : '',
          carParking: data.carParking ? String(data.carParking).trim() : '',
          floorPlanImage: data.floorPlanImage ? String(data.floorPlanImage).trim() : '',
          buildingPhotos: Array.isArray(data.buildingPhotos) ? data.buildingPhotos.filter(g => typeof g === 'string') : [],
          amenitiesPhotos: Array.isArray(data.amenitiesPhotos) ? data.amenitiesPhotos.filter(g => typeof g === 'string') : [],
          managePlots: data.managePlots !== false
        });
        return sendJSON(res, 201, { success: true, property: newProp });
      }

      if (method === 'POST' && pathname.match(/^\/api\/admin\/properties\/(\d+)\/duplicate$/)) {
        const id = parseInt(pathname.split('/')[4], 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid property ID' });
        const duplicated = await storage.duplicateProperty(id);
        if (!duplicated) return sendJSON(res, 404, { error: 'Property not found to duplicate' });
        return sendJSON(res, 201, { success: true, property: duplicated });
      }

      if (method === 'PUT' && pathname.startsWith('/api/admin/properties/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid property ID' });
        const data = await getRequestBody(req);
        if (data.category && !VALID_CATEGORIES.includes(data.category)) {
          return sendJSON(res, 400, { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` });
        }
        if (data.status && !VALID_STATUSES.includes(data.status)) {
          return sendJSON(res, 400, { error: `Invalid status value. Must be one of: ${VALID_STATUSES.join(', ')}` });
        }
        const updated = await storage.updateProperty(id, data);
        if (!updated) return sendJSON(res, 404, { error: 'Property not found' });
        return sendJSON(res, 200, { success: true, property: updated });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/properties/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid property ID' });
        await storage.deleteProperty(id);
        return sendJSON(res, 200, { success: true });
      }

      // --- CUSTOMER REVIEWS MANAGEMENT ---
      if (method === 'GET' && pathname === '/api/admin/reviews') {
        const reviews = await storage.getAllReviews();
        return sendJSON(res, 200, { success: true, reviews });
      }

      if (method === 'POST' && pathname === '/api/admin/reviews') {
        const data = await getRequestBody(req);
        if (!data.name || !data.review) {
          return sendJSON(res, 400, { error: 'Customer name and review text are required.' });
        }
        const ratingVal = parseInt(data.rating, 10);
        if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
          return sendJSON(res, 400, { error: 'Rating must be an integer between 1 and 5 stars.' });
        }
        const newReview = await storage.addReview({
          name: String(data.name).trim(),
          location: data.location ? String(data.location).trim() : 'Guduvanchery',
          rating: ratingVal,
          review: String(data.review).trim(),
          service: data.service ? String(data.service).trim() : 'Property Purchase',
          avatar: data.avatar ? String(data.avatar).trim() : null,
          date: data.date ? String(data.date).trim() : new Date().toISOString().split('T')[0],
          published: data.published !== false
        });
        return sendJSON(res, 201, { success: true, review: newReview });
      }

      if (method === 'PUT' && pathname.startsWith('/api/admin/reviews/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid review ID' });
        const data = await getRequestBody(req);
        if (data.rating !== undefined) {
          const r = parseInt(data.rating, 10);
          if (isNaN(r) || r < 1 || r > 5) {
            return sendJSON(res, 400, { error: 'Rating must be an integer between 1 and 5 stars.' });
          }
        }
        const updated = await storage.updateReview(id, data);
        if (!updated) return sendJSON(res, 404, { error: 'Review not found' });
        return sendJSON(res, 200, { success: true, review: updated });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/reviews/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid review ID' });
        await storage.deleteReview(id);
        return sendJSON(res, 200, { success: true });
      }

      // --- HAPPY CUSTOMERS PHOTO GALLERY MANAGEMENT (With Consent Tracking) ---
      if (method === 'GET' && pathname === '/api/admin/happy-customers') {
        const photos = await storage.getAllHappyCustomers();
        return sendJSON(res, 200, { success: true, happyCustomers: photos });
      }

      if (method === 'POST' && pathname === '/api/admin/happy-customers') {
        const data = await getRequestBody(req);
        if (!data.image) {
          return sendJSON(res, 400, { error: 'Photo image is required.' });
        }
        const newPhoto = await storage.addHappyCustomerPhoto({
          image: String(data.image).trim(),
          caption: data.caption ? String(data.caption).trim() : '',
          location: data.location ? String(data.location).trim() : 'Chengalpattu Dist.',
          order: parseInt(data.order, 10) || 0,
          isCover: !!data.isCover,
          published: data.published !== false,
          hasConsent: data.hasConsent !== false
        });
        return sendJSON(res, 201, { success: true, photo: newPhoto });
      }

      if (method === 'PUT' && pathname.startsWith('/api/admin/happy-customers/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid customer photo ID' });
        const data = await getRequestBody(req);
        const updated = await storage.updateHappyCustomerPhoto(id, data);
        if (!updated) return sendJSON(res, 404, { error: 'Customer photo not found' });
        return sendJSON(res, 200, { success: true, photo: updated });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/happy-customers/')) {
        const id = parseInt(pathname.split('/').pop(), 10);
        if (isNaN(id) || id <= 0) return sendJSON(res, 400, { error: 'Invalid customer photo ID' });
        await storage.deleteHappyCustomerPhoto(id);
        return sendJSON(res, 200, { success: true });
      }

      // --- SERVICE PANELS MANAGEMENT ---
      if (method === 'GET' && pathname === '/api/admin/service-panels') {
        const panels = await storage.getAllServicePanels();
        return sendJSON(res, 200, { success: true, servicePanels: panels });
      }

      if (method === 'POST' && pathname === '/api/admin/service-panels') {
        const data = await getRequestBody(req);
        if (!data.title || !String(data.title).trim()) {
          return sendJSON(res, 400, { error: 'Service panel title is required.' });
        }
        if (!data.shortDescription || !String(data.shortDescription).trim()) {
          return sendJSON(res, 400, { error: 'Service panel short description is required.' });
        }
        // Link validation: only relative #links or http/https links
        if (data.buttonLink && typeof data.buttonLink === 'string') {
          const trimmedLink = data.buttonLink.trim();
          if (trimmedLink && !trimmedLink.startsWith('#') && !trimmedLink.startsWith('/') && !/^https?:\/\//i.test(trimmedLink)) {
            return sendJSON(res, 400, { error: 'Button link must be a relative anchor (#section) or a valid HTTP/HTTPS URL.' });
          }
        }
        const newPanel = await storage.addServicePanel({
          title: String(data.title).trim(),
          shortDescription: String(data.shortDescription).trim(),
          description: data.description ? String(data.description).trim() : '',
          image: data.image ? String(data.image).trim() : undefined,
          isIllustrative: data.isIllustrative === true,
          buttonText: data.buttonText ? String(data.buttonText).trim() : 'View Details',
          buttonLink: data.buttonLink ? String(data.buttonLink).trim() : '#listings',
          categoryFilter: data.categoryFilter ? String(data.categoryFilter).trim() : '',
          displayOrder: parseInt(data.displayOrder, 10) || 0,
          isEnabled: data.isEnabled !== false
        });
        return sendJSON(res, 201, { success: true, servicePanel: newPanel });
      }

      if (method === 'PUT' && pathname.startsWith('/api/admin/service-panels/')) {
        const id = pathname.split('/').pop();
        if (!id) return sendJSON(res, 400, { error: 'Invalid service panel ID' });
        const data = await getRequestBody(req);
        if (data.title !== undefined && !String(data.title).trim()) {
          return sendJSON(res, 400, { error: 'Title cannot be empty.' });
        }
        if (data.shortDescription !== undefined && !String(data.shortDescription).trim()) {
          return sendJSON(res, 400, { error: 'Short description cannot be empty.' });
        }
        if (data.buttonLink && typeof data.buttonLink === 'string') {
          const trimmedLink = data.buttonLink.trim();
          if (trimmedLink && !trimmedLink.startsWith('#') && !trimmedLink.startsWith('/') && !/^https?:\/\//i.test(trimmedLink)) {
            return sendJSON(res, 400, { error: 'Button link must be a relative anchor (#section) or a valid HTTP/HTTPS URL.' });
          }
        }
        const updated = await storage.updateServicePanel(id, data);
        if (!updated) return sendJSON(res, 404, { error: 'Service panel not found' });
        return sendJSON(res, 200, { success: true, servicePanel: updated });
      }

      if (method === 'DELETE' && pathname.startsWith('/api/admin/service-panels/')) {
        const id = pathname.split('/').pop();
        if (!id) return sendJSON(res, 400, { error: 'Invalid service panel ID' });
        await storage.deleteServicePanel(id);
        return sendJSON(res, 200, { success: true });
      }

      if (method === 'POST' && pathname === '/api/admin/service-panels/reset-defaults') {
        const defaults = await storage.resetServicePanelsToDefault();
        return sendJSON(res, 200, { success: true, servicePanels: defaults });
      }

      // --- SOCIAL MEDIA SETTINGS MANAGEMENT ---
      if (method === 'GET' && pathname === '/api/admin/social-settings') {
        const settings = await storage.getSocialSettings();
        return sendJSON(res, 200, { success: true, socialSettings: settings });
      }

      if (method === 'PUT' && pathname === '/api/admin/social-settings') {
        const data = await getRequestBody(req);
        
        // Strict domain and HTTPS validation
        const fbUrl = data.facebook && data.facebook.url ? String(data.facebook.url).trim() : '';
        const igUrl = data.instagram && data.instagram.url ? String(data.instagram.url).trim() : '';

        if (fbUrl) {
          if (!/^https:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9._\-/?=]+$/i.test(fbUrl)) {
            return sendJSON(res, 400, { error: 'Facebook URL must start with https:// and be a valid facebook.com profile or page link.' });
          }
        }

        if (igUrl) {
          if (!/^https:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9._\-/?=]+$/i.test(igUrl)) {
            return sendJSON(res, 400, { error: 'Instagram URL must start with https:// and be a valid instagram.com profile link.' });
          }
        }

        const updated = await storage.updateSocialSettings(data);
        return sendJSON(res, 200, { success: true, socialSettings: updated });
      }

      return sendJSON(res, 404, { error: 'Unknown admin endpoint' });
    }

    // ==========================================
    // 4. HTML PAGE ROUTING & STATIC ASSETS
    // ==========================================
    if (pathname === '/admin/login' || pathname === '/admin/login/') {
      const loginHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'admin-login.html'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(loginHtml);
    }

    if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin/dashboard') {
      if (!isAuthenticated) {
        res.writeHead(302, { 'Location': '/admin/login' });
        return res.end();
      }
      const adminHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(adminHtml);
    }

    if (pathname === '/' || pathname === '/index.html') {
      const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=UTF-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN'
      });
      return res.end(indexHtml);
    }

    // Static file handler (including /uploads/*, /robots.txt, /sitemap.xml)
    const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
    if (safePath.startsWith(PUBLIC_DIR) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.xml': 'application/xml',
        '.txt': 'text/plain'
      };
      res.writeHead(200, {
        'Content-Type': contentTypes[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.xml' || ext === '.txt' ? 'public, max-age=86400' : 'public, max-age=31536000',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(fs.readFileSync(safePath));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Page Not Found');
  });

  server.listen(listenPort, () => {
    console.log(`Tamizh Real Estate Server listening on port ${listenPort} [Mode: ${IS_PROD ? 'PRODUCTION' : 'DEVELOPMENT'}]`);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, saveBase64Image, validateRasterImageBytes };
