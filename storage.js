const fs = require('fs');
const path = require('path');
const { DEFAULT_LAYOUT_DOCUMENT, DEFAULT_SERVICE_PANELS, DEFAULT_SOCIAL_SETTINGS, getDefaultImageForCategory } = require('./defaults');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROPS_FILE = path.join(DATA_DIR, 'properties.json');
const PLOTS_FILE = path.join(DATA_DIR, 'plots.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const LAYOUT_DOCS_FILE = path.join(DATA_DIR, 'layout_docs.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const HAPPY_CUSTOMERS_FILE = path.join(DATA_DIR, 'happy_customers.json');
const SERVICE_PANELS_FILE = path.join(DATA_DIR, 'service_panels.json');
const SOCIAL_SETTINGS_FILE = path.join(DATA_DIR, 'social_settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Database Connection (PostgreSQL for Render production when DATABASE_URL is configured, JSON files for local)
let pgPool = null;
const isPostgres = !!process.env.DATABASE_URL;

if (isPostgres) {
  try {
    const { Pool } = require('pg');
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  } catch (err) {
    console.warn("pg module not installed. Falling back to persistent file storage.");
  }
}

// Initialize tables if using PostgreSQL
async function initDB() {
  // Ensure existing JSON file schema upgrades (multi-layout and landowner support)
  if (!isPostgres) {
    if (!fs.existsSync(PROPS_FILE)) {
      const defaultProps = require('./data/properties.json');
      fs.writeFileSync(PROPS_FILE, JSON.stringify(defaultProps, null, 2));
    }
    if (!fs.existsSync(PLOTS_FILE)) {
      const defaultPlots = require('./data/plots.json');
      fs.writeFileSync(PLOTS_FILE, JSON.stringify(defaultPlots, null, 2));
    }
    if (!fs.existsSync(LAYOUT_DOCS_FILE)) {
      fs.writeFileSync(LAYOUT_DOCS_FILE, JSON.stringify(DEFAULT_LAYOUT_DOCUMENT, null, 2));
    }
    if (!fs.existsSync(REVIEWS_FILE)) {
      fs.writeFileSync(REVIEWS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(HAPPY_CUSTOMERS_FILE)) {
      fs.writeFileSync(HAPPY_CUSTOMERS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(SERVICE_PANELS_FILE)) {
      fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(DEFAULT_SERVICE_PANELS, null, 2));
    }
    if (!fs.existsSync(SOCIAL_SETTINGS_FILE)) {
      fs.writeFileSync(SOCIAL_SETTINGS_FILE, JSON.stringify(DEFAULT_SOCIAL_SETTINGS, null, 2));
    }

    // Auto-migrate properties.json to support multi-layout and landowner fields if needed
    try {
      let layoutDocData = null;
      if (fs.existsSync(LAYOUT_DOCS_FILE)) {
        try { layoutDocData = JSON.parse(fs.readFileSync(LAYOUT_DOCS_FILE, 'utf8')); } catch (e) {}
      }
      const props = JSON.parse(fs.readFileSync(PROPS_FILE, 'utf8'));
      let propsModified = false;
      props.forEach(p => {
        if (p.isPublished === undefined) { p.isPublished = true; propsModified = true; }
        if (p.isArchived === undefined) { p.isArchived = false; propsModified = true; }
        if (p.ownerName === undefined) { p.ownerName = ""; propsModified = true; }
        if (p.ownerPhone === undefined) { p.ownerPhone = ""; propsModified = true; }
        if (p.internalPrice === undefined) { p.internalPrice = ""; propsModified = true; }
        if (p.masterplanImage === undefined) {
          p.masterplanImage = (p.id === 1 && layoutDocData && layoutDocData.primaryImage) ? layoutDocData.primaryImage : "";
          propsModified = true;
        }
        if (p.sanctionNumber === undefined) {
          p.sanctionNumber = (p.id === 1 && layoutDocData && layoutDocData.sanctionNumber) ? layoutDocData.sanctionNumber : "";
          propsModified = true;
        }
        if (p.plotCount === undefined) {
          p.plotCount = (p.id === 1) ? 6 : 0;
          propsModified = true;
        }
      });
      if (propsModified) {
        fs.writeFileSync(PROPS_FILE, JSON.stringify(props, null, 2), 'utf8');
      }

      // Ensure plots link to layoutId 1 (Sowbhagya Nagar)
      const plots = JSON.parse(fs.readFileSync(PLOTS_FILE, 'utf8'));
      let plotsModified = false;
      plots.forEach(pl => {
        if (!pl.layoutId) {
          pl.layoutId = 1;
          plotsModified = true;
        }
      });
      if (plotsModified) {
        fs.writeFileSync(PLOTS_FILE, JSON.stringify(plots, null, 2), 'utf8');
      }
    } catch (migErr) {
      console.warn("JSON migration note:", migErr.message);
    }
    return;
  }

  // Create tables in PostgreSQL
  const client = await pgPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS trs_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_properties (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        price VARCHAR(100) NOT NULL,
        location VARCHAR(255),
        image TEXT,
        masterplan_image TEXT DEFAULT '',
        sanction_number VARCHAR(255) DEFAULT '',
        owner_name VARCHAR(255) DEFAULT '',
        owner_phone VARCHAR(100) DEFAULT '',
        internal_price VARCHAR(100) DEFAULT '',
        plot_count INT DEFAULT 0,
        is_published BOOLEAN DEFAULT true,
        is_archived BOOLEAN DEFAULT false,
        gallery JSONB DEFAULT '[]'::jsonb,
        status VARCHAR(50) DEFAULT 'Active',
        specs TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_plots (
        id SERIAL PRIMARY KEY,
        layout_id INT DEFAULT 1,
        number VARCHAR(100) NOT NULL,
        layout VARCHAR(255) DEFAULT 'Sowbhagya Nagar Layout',
        dimension VARCHAR(100) NOT NULL,
        facing VARCHAR(100),
        price VARCHAR(100) NOT NULL,
        status VARCHAR(50) DEFAULT 'Active',
        area_sqft INT DEFAULT 0,
        plot_type VARCHAR(100) DEFAULT 'Residential',
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_sessions (
        token VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trs_layout_docs (
        id VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_reviews (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        review_text TEXT NOT NULL,
        rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        location VARCHAR(255),
        profile_image TEXT,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_happy_customers (
        id SERIAL PRIMARY KEY,
        image_url TEXT NOT NULL,
        caption TEXT,
        display_order INT DEFAULT 0,
        is_cover BOOLEAN DEFAULT false,
        is_published BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_service_panels (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        short_description TEXT NOT NULL,
        description TEXT,
        image TEXT,
        is_illustrative BOOLEAN DEFAULT true,
        button_text VARCHAR(100),
        button_link VARCHAR(255),
        category_filter VARCHAR(100),
        display_order INT DEFAULT 0,
        is_enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS trs_social_settings (
        id VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration for PostgreSQL existing installations: add columns if missing
    const alterQueries = [
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS masterplan_image TEXT DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS sanction_number VARCHAR(255) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS owner_phone VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS internal_price VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS plot_count INT DEFAULT 0',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS client_name VARCHAR(255) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS built_up_area VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS built_up_area_unit VARCHAR(50) DEFAULT \'sq.ft\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS gross_area VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS gross_area_unit VARCHAR(50) DEFAULT \'sq.ft\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS building_type VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS configuration VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS car_parking VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS floor_plan_image TEXT DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS building_photos JSONB DEFAULT \'[]\'::jsonb',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS amenities_photos JSONB DEFAULT \'[]\'::jsonb',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS total_land_area VARCHAR(100) DEFAULT \'\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS total_land_area_unit VARCHAR(50) DEFAULT \'acres\'',
      'ALTER TABLE trs_properties ADD COLUMN IF NOT EXISTS manage_plots BOOLEAN DEFAULT true',
      'ALTER TABLE trs_plots ADD COLUMN IF NOT EXISTS layout_id INT DEFAULT 1',
      'ALTER TABLE trs_plots ADD COLUMN IF NOT EXISTS area_sqft INT DEFAULT 0',
      'ALTER TABLE trs_plots ADD COLUMN IF NOT EXISTS plot_type VARCHAR(100) DEFAULT \'Residential\'',
      'ALTER TABLE trs_plots ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT \'\'',
      'ALTER TABLE trs_plots ADD COLUMN IF NOT EXISTS image TEXT DEFAULT \'\''
    ];
    for (const aq of alterQueries) {
      try { await client.query(aq); } catch (e) {}
    }

    // Ensure layout doc seeded
    const docCheck = await client.query('SELECT id FROM trs_layout_docs WHERE id = $1', ['sowbhagya_nagar']);
    if (docCheck.rows.length === 0) {
      await client.query('INSERT INTO trs_layout_docs (id, data) VALUES ($1, $2)', ['sowbhagya_nagar', JSON.stringify(DEFAULT_LAYOUT_DOCUMENT)]);
    }

    // Ensure service panels seeded in PostgreSQL if empty
    const panelsCheck = await client.query('SELECT COUNT(*) FROM trs_service_panels');
    if (parseInt(panelsCheck.rows[0].count, 10) === 0) {
      for (const p of DEFAULT_SERVICE_PANELS) {
        await client.query(
          `INSERT INTO trs_service_panels (id, title, short_description, description, image, is_illustrative, button_text, button_link, category_filter, display_order, is_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [p.id, p.title, p.shortDescription, p.description, p.image, p.isIllustrative !== false, p.buttonText, p.buttonLink, p.categoryFilter, p.displayOrder, p.isEnabled !== false]
        );
      }
    }

    // Ensure social settings seeded in PostgreSQL if empty
    const socialCheck = await client.query('SELECT id FROM trs_social_settings WHERE id = $1', ['main']);
    if (socialCheck.rows.length === 0) {
      await client.query('INSERT INTO trs_social_settings (id, data) VALUES ($1, $2)', ['main', JSON.stringify(DEFAULT_SOCIAL_SETTINGS)]);
    }
  } finally {
    client.release();
  }
}

// ----------------- USERS API -----------------
async function getUsers() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT username, password_hash AS "passwordHash", created_at AS "createdAt" FROM trs_users');
    return res.rows;
  }
  if (!fs.existsSync(USERS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { return []; }
}

async function getUserByUsername(username) {
  const users = await getUsers();
  return users.find(u => u.username.toLowerCase() === (username || '').trim().toLowerCase()) || null;
}

async function createUser(username, passwordHash) {
  if (isPostgres) {
    await pgPool.query('INSERT INTO trs_users (username, password_hash) VALUES ($1, $2)', [username.trim(), passwordHash]);
    return;
  }
  const users = await getUsers();
  users.push({ username: username.trim(), passwordHash, createdAt: new Date().toISOString() });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

async function updateUser(oldUsername, newUsername, newPasswordHash) {
  if (isPostgres) {
    await pgPool.query(
      'UPDATE trs_users SET username = $1, password_hash = $2, updated_at = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER($3)',
      [newUsername.trim(), newPasswordHash, oldUsername.trim()]
    );
    return;
  }
  const users = await getUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === oldUsername.toLowerCase());
  if (idx !== -1) {
    users[idx].username = newUsername.trim();
    users[idx].passwordHash = newPasswordHash;
    users[idx].updatedAt = new Date().toISOString();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  }
}

// ----------------- SESSIONS API -----------------
async function getSession(token) {
  if (!token) return null;
  if (isPostgres) {
    const res = await pgPool.query('SELECT username, expires_at AS "expiresAt" FROM trs_sessions WHERE token = $1', [token]);
    if (res.rows.length === 0) return null;
    const session = res.rows[0];
    if (Date.now() > Number(session.expiresAt)) {
      await deleteSession(token);
      return null;
    }
    return session;
  }
  if (!fs.existsSync(SESSIONS_FILE)) return null;
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const session = sessions[token];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      delete sessions[token];
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
      return null;
    }
    return session;
  } catch (e) { return null; }
}

async function setSession(token, username, expiresAt) {
  if (isPostgres) {
    await pgPool.query(
      'INSERT INTO trs_sessions (token, username, expires_at) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET username = $2, expires_at = $3',
      [token, username, expiresAt]
    );
    return;
  }
  let sessions = {};
  if (fs.existsSync(SESSIONS_FILE)) {
    try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (e) {}
  }
  sessions[token] = { username, expiresAt };
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
}

async function deleteSession(token) {
  if (!token) return;
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_sessions WHERE token = $1', [token]);
    return;
  }
  if (!fs.existsSync(SESSIONS_FILE)) return;
  try {
    const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    delete sessions[token];
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {}
}

// ----------------- PROPERTIES & MULTI-LAYOUT API -----------------
async function getAllAdminProperties() {
  if (isPostgres) {
    const res = await pgPool.query(`
      SELECT id, title, category, price, location, image, masterplan_image AS "masterplanImage",
             sanction_number AS "sanctionNumber", owner_name AS "ownerName", owner_phone AS "ownerPhone",
             internal_price AS "internalPrice", plot_count AS "plotCount", is_published AS "isPublished",
             is_archived AS "isArchived", gallery, status, specs, description AS desc,
             COALESCE(client_name, '') AS "clientName",
             COALESCE(built_up_area, '') AS "builtUpArea",
             COALESCE(built_up_area_unit, 'sq.ft') AS "builtUpAreaUnit",
             COALESCE(gross_area, '') AS "grossArea",
             COALESCE(gross_area_unit, 'sq.ft') AS "grossAreaUnit",
             COALESCE(building_type, '') AS "buildingType",
             COALESCE(configuration, '') AS "configuration",
             COALESCE(car_parking, '') AS "carParking",
             COALESCE(floor_plan_image, '') AS "floorPlanImage",
             building_photos AS "buildingPhotos",
             amenities_photos AS "amenitiesPhotos",
             COALESCE(total_land_area, '') AS "totalLandArea",
             COALESCE(total_land_area_unit, 'acres') AS "totalLandAreaUnit",
             COALESCE(manage_plots, true) AS "managePlots",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM trs_properties ORDER BY id DESC
    `);
    return res.rows.map(p => ({
      ...p,
      gallery: Array.isArray(p.gallery) ? p.gallery : (p.gallery ? JSON.parse(p.gallery) : []),
      buildingPhotos: Array.isArray(p.buildingPhotos) ? p.buildingPhotos : (p.buildingPhotos ? JSON.parse(p.buildingPhotos) : []),
      amenitiesPhotos: Array.isArray(p.amenitiesPhotos) ? p.amenitiesPhotos : (p.amenitiesPhotos ? JSON.parse(p.amenitiesPhotos) : []),
      image: p.image || getDefaultImageForCategory(p.category),
      masterplanImage: p.masterplanImage || '',
      sanctionNumber: p.sanctionNumber || '',
      ownerName: p.ownerName || '',
      ownerPhone: p.ownerPhone || '',
      internalPrice: p.internalPrice || '',
      plotCount: parseInt(p.plotCount, 10) || 0,
      isPublished: p.isPublished !== false,
      isArchived: Boolean(p.isArchived)
    }));
  }
  if (!fs.existsSync(PROPS_FILE)) return [];
  try {
    const props = JSON.parse(fs.readFileSync(PROPS_FILE, 'utf8'));
    return props.map(p => ({
      ...p,
      gallery: Array.isArray(p.gallery) ? p.gallery : [],
      image: p.image || getDefaultImageForCategory(p.category),
      masterplanImage: p.masterplanImage || '',
      sanctionNumber: p.sanctionNumber || '',
      ownerName: p.ownerName || '',
      ownerPhone: p.ownerPhone || '',
      internalPrice: p.internalPrice || '',
      plotCount: parseInt(p.plotCount, 10) || 0,
      isPublished: p.isPublished !== false,
      isArchived: Boolean(p.isArchived)
    }));
  } catch (e) { return []; }
}

async function getProperties() {
  // Public-facing: Returns only published, non-archived properties, stripping private landowner contact and internal prices
  const allProps = await getAllAdminProperties();
  return allProps
    .filter(p => p.isPublished && !p.isArchived)
    .map(p => {
      const sanitized = { ...p };
      delete sanitized.ownerName;
      delete sanitized.ownerPhone;
      delete sanitized.internalPrice;
      sanitized.price = 'To be Negotiable';
      return sanitized;
    });
}

async function getPropertyById(id) {
  const all = await getAllAdminProperties();
  return all.find(p => p.id === id) || null;
}

async function addProperty(prop) {
  const defaultImg = getDefaultImageForCategory(prop.category);
  const finalImage = prop.image && prop.image.trim() !== '' ? prop.image.trim() : defaultImg;
  const gallery = Array.isArray(prop.gallery) ? prop.gallery : [];
  const masterplanImage = prop.masterplanImage ? String(prop.masterplanImage).trim() : '';
  const sanctionNumber = prop.sanctionNumber ? String(prop.sanctionNumber).trim() : '';
  const ownerName = prop.ownerName ? String(prop.ownerName).trim() : '';
  const ownerPhone = prop.ownerPhone ? String(prop.ownerPhone).trim() : '';
  const internalPrice = prop.internalPrice ? String(prop.internalPrice).trim() : '';
  const plotCount = parseInt(prop.plotCount, 10) || 0;
  const isPublished = prop.isPublished !== false;
  const isArchived = Boolean(prop.isArchived);

  if (isPostgres) {
    const res = await pgPool.query(
      `INSERT INTO trs_properties 
       (title, category, price, location, image, masterplan_image, sanction_number, owner_name, owner_phone, internal_price, plot_count, is_published, is_archived, gallery, status, specs, description,
        client_name, built_up_area, built_up_area_unit, gross_area, gross_area_unit, building_type, configuration, car_parking, floor_plan_image, building_photos, amenities_photos, total_land_area, total_land_area_unit, manage_plots) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31) 
       RETURNING id, title, category, price, location, image, masterplan_image AS "masterplanImage", sanction_number AS "sanctionNumber", owner_name AS "ownerName", owner_phone AS "ownerPhone", internal_price AS "internalPrice", plot_count AS "plotCount", is_published AS "isPublished", is_archived AS "isArchived", gallery, status, specs, description AS desc,
                 COALESCE(client_name, '') AS "clientName", COALESCE(built_up_area, '') AS "builtUpArea", COALESCE(built_up_area_unit, 'sq.ft') AS "builtUpAreaUnit",
                 COALESCE(gross_area, '') AS "grossArea", COALESCE(gross_area_unit, 'sq.ft') AS "grossAreaUnit", COALESCE(building_type, '') AS "buildingType",
                 COALESCE(configuration, '') AS "configuration", COALESCE(car_parking, '') AS "carParking", COALESCE(floor_plan_image, '') AS "floorPlanImage",
                 building_photos AS "buildingPhotos", amenities_photos AS "amenitiesPhotos",
                 COALESCE(total_land_area, '') AS "totalLandArea", COALESCE(total_land_area_unit, 'acres') AS "totalLandAreaUnit",
                 COALESCE(manage_plots, true) AS "managePlots"`,
      [
        prop.title, prop.category, 'To be Negotiable', prop.location, finalImage, masterplanImage, sanctionNumber, ownerName, ownerPhone, internalPrice, plotCount, isPublished, isArchived, JSON.stringify(gallery), prop.status || 'Active', prop.specs, prop.desc,
        prop.clientName || '', prop.builtUpArea || '', prop.builtUpAreaUnit || 'sq.ft', prop.grossArea || '', prop.grossAreaUnit || 'sq.ft',
        prop.buildingType || '', prop.configuration || '', prop.carParking || '', prop.floorPlanImage || '',
        JSON.stringify(Array.isArray(prop.buildingPhotos) ? prop.buildingPhotos : []),
        JSON.stringify(Array.isArray(prop.amenitiesPhotos) ? prop.amenitiesPhotos : []),
        prop.totalLandArea || '', prop.totalLandAreaUnit || 'acres', prop.managePlots !== false
      ]
    );
    const row = res.rows[0];
    return {
      ...row,
      gallery: typeof row.gallery === 'string' ? JSON.parse(row.gallery) : (row.gallery || []),
      buildingPhotos: typeof row.buildingPhotos === 'string' ? JSON.parse(row.buildingPhotos) : (row.buildingPhotos || []),
      amenitiesPhotos: typeof row.amenitiesPhotos === 'string' ? JSON.parse(row.amenitiesPhotos) : (row.amenitiesPhotos || [])
    };
  }
  const properties = await getAllAdminProperties();
  const newId = properties.length ? Math.max(...properties.map(p => p.id)) + 1 : 1;
  const newProp = {
    id: newId,
    title: prop.title,
    category: prop.category,
    price: 'To be Negotiable',
    location: prop.location,
    image: finalImage,
    masterplanImage,
    sanctionNumber,
    ownerName,
    ownerPhone,
    internalPrice,
    plotCount,
    isPublished,
    isArchived,
    gallery: gallery,
    status: prop.status || 'Active',
    specs: prop.specs,
    desc: prop.desc,
    totalLandArea: prop.totalLandArea || '',
    totalLandAreaUnit: prop.totalLandAreaUnit || 'acres',
    builtUpArea: prop.builtUpArea || '',
    builtUpAreaUnit: prop.builtUpAreaUnit || 'sq.ft',
    grossArea: prop.grossArea || '',
    grossAreaUnit: prop.grossAreaUnit || 'sq.ft',
    clientName: prop.clientName || '',
    buildingType: prop.buildingType || '',
    configuration: prop.configuration || '',
    carParking: prop.carParking || '',
    floorPlanImage: prop.floorPlanImage || '',
    buildingPhotos: Array.isArray(prop.buildingPhotos) ? prop.buildingPhotos : [],
    amenitiesPhotos: Array.isArray(prop.amenitiesPhotos) ? prop.amenitiesPhotos : [],
    managePlots: prop.managePlots !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  properties.unshift(newProp);
  fs.writeFileSync(PROPS_FILE, JSON.stringify(properties, null, 2), 'utf8');
  return newProp;
}

async function updateProperty(id, updates) {
  if (isPostgres) {
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(updates)) {
      let colName = key;
      if (key === 'desc') colName = 'description';
      if (key === 'masterplanImage') colName = 'masterplan_image';
      if (key === 'sanctionNumber') colName = 'sanction_number';
      if (key === 'ownerName') colName = 'owner_name';
      if (key === 'ownerPhone') colName = 'owner_phone';
      if (key === 'internalPrice') colName = 'internal_price';
      if (key === 'plotCount') colName = 'plot_count';
      if (key === 'isPublished') colName = 'is_published';
      if (key === 'isArchived') colName = 'is_archived';
      if (key === 'clientName') colName = 'client_name';
      if (key === 'builtUpArea') colName = 'built_up_area';
      if (key === 'builtUpAreaUnit') colName = 'built_up_area_unit';
      if (key === 'grossArea') colName = 'gross_area';
      if (key === 'grossAreaUnit') colName = 'gross_area_unit';
      if (key === 'buildingType') colName = 'building_type';
      if (key === 'configuration') colName = 'configuration';
      if (key === 'carParking') colName = 'car_parking';
      if (key === 'floorPlanImage') colName = 'floor_plan_image';
      if (key === 'buildingPhotos') colName = 'building_photos';
      if (key === 'amenitiesPhotos') colName = 'amenities_photos';
      if (key === 'totalLandArea') colName = 'total_land_area';
      if (key === 'totalLandAreaUnit') colName = 'total_land_area_unit';
      if (key === 'managePlots') colName = 'manage_plots';

      const finalVal = (key === 'gallery' || key === 'buildingPhotos' || key === 'amenitiesPhotos')
        ? JSON.stringify(Array.isArray(val) ? val : [])
        : val;
      fields.push(`${colName} = $${idx++}`);
      values.push(finalVal);
    }
    values.push(id);
    const res = await pgPool.query(
      `UPDATE trs_properties SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} 
       RETURNING id, title, category, price, location, image, masterplan_image AS "masterplanImage", sanction_number AS "sanctionNumber", owner_name AS "ownerName", owner_phone AS "ownerPhone", internal_price AS "internalPrice", plot_count AS "plotCount", is_published AS "isPublished", is_archived AS "isArchived", gallery, status, specs, description AS desc,
                 COALESCE(client_name, '') AS "clientName", COALESCE(built_up_area, '') AS "builtUpArea", COALESCE(built_up_area_unit, 'sq.ft') AS "builtUpAreaUnit",
                 COALESCE(gross_area, '') AS "grossArea", COALESCE(gross_area_unit, 'sq.ft') AS "grossAreaUnit", COALESCE(building_type, '') AS "buildingType",
                 COALESCE(configuration, '') AS "configuration", COALESCE(car_parking, '') AS "carParking", COALESCE(floor_plan_image, '') AS "floorPlanImage",
                 building_photos AS "buildingPhotos", amenities_photos AS "amenitiesPhotos",
                 COALESCE(total_land_area, '') AS "totalLandArea", COALESCE(total_land_area_unit, 'acres') AS "totalLandAreaUnit",
                 COALESCE(manage_plots, true) AS "managePlots"`,
      values
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      ...row,
      gallery: typeof row.gallery === 'string' ? JSON.parse(row.gallery) : (row.gallery || []),
      buildingPhotos: typeof row.buildingPhotos === 'string' ? JSON.parse(row.buildingPhotos) : (row.buildingPhotos || []),
      amenitiesPhotos: typeof row.amenitiesPhotos === 'string' ? JSON.parse(row.amenitiesPhotos) : (row.amenitiesPhotos || [])
    };
  }
  const properties = await getAllAdminProperties();
  const index = properties.findIndex(p => p.id === id);
  if (index === -1) return null;
  properties[index] = { ...properties[index], ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PROPS_FILE, JSON.stringify(properties, null, 2), 'utf8');
  return properties[index];
}

async function duplicateProperty(id) {
  const original = await getPropertyById(id);
  if (!original) return null;

  const duplicateData = {
    ...original,
    title: `${original.title} (Copy)`,
    isPublished: false // start as unpublished draft
  };
  delete duplicateData.id;
  delete duplicateData.createdAt;
  delete duplicateData.updatedAt;

  const newProp = await addProperty(duplicateData);

  // If original had plots, duplicate them linked to the new layout ID
  const origPlots = await getPlotsByLayoutId(id);
  for (const pl of origPlots) {
    await addPlot({
      layoutId: newProp.id,
      number: pl.number,
      layout: newProp.title,
      dimension: pl.dimension,
      facing: pl.facing,
      price: pl.price || 'To be Negotiable',
      status: pl.status || 'Active'
    });
  }

  return newProp;
}

async function deleteProperty(id) {
  if (isPostgres) {
    // Delete linked plots first
    await pgPool.query('DELETE FROM trs_plots WHERE layout_id = $1', [id]);
    await pgPool.query('DELETE FROM trs_properties WHERE id = $1', [id]);
    return true;
  }
  let properties = await getAllAdminProperties();
  properties = properties.filter(p => p.id !== id);
  fs.writeFileSync(PROPS_FILE, JSON.stringify(properties, null, 2), 'utf8');

  // Also remove plots linked to this layout
  let plots = await getPlots();
  plots = plots.filter(pl => pl.layoutId !== id && pl.layoutId !== parseInt(id, 10));
  fs.writeFileSync(PLOTS_FILE, JSON.stringify(plots, null, 2), 'utf8');
  return true;
}

// ----------------- PLOTS API -----------------
async function getPlots() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT id, layout_id AS "layoutId", number, layout, dimension, facing, price, status, COALESCE(area_sqft, 0) AS "areaSqft", COALESCE(plot_type, \'Residential\') AS "plotType", COALESCE(notes, \'\') AS "notes", COALESCE(image, \'\') AS "image" FROM trs_plots ORDER BY id ASC');
    return res.rows.map(r => ({
      ...r,
      layoutId: parseInt(r.layoutId, 10) || 1,
      areaSqft: parseInt(r.areaSqft, 10) || 0,
      image: r.image || '',
      status: (r.status === 'Active' ? 'Available' : (r.status || 'Available'))
    }));
  }
  if (!fs.existsSync(PLOTS_FILE)) return [];
  try {
    const plots = JSON.parse(fs.readFileSync(PLOTS_FILE, 'utf8'));
    return plots.map(r => ({
      ...r,
      layoutId: parseInt(r.layoutId, 10) || 1,
      areaSqft: parseInt(r.areaSqft, 10) || 0,
      plotType: r.plotType || 'Residential',
      notes: r.notes || '',
      image: r.image || '',
      status: (r.status === 'Active' ? 'Available' : (r.status || 'Available'))
    }));
  } catch (e) { return []; }
}

async function getPlotsByLayoutId(layoutId) {
  const plots = await getPlots();
  const targetId = parseInt(layoutId, 10);
  return plots.filter(p => p.layoutId === targetId);
}

async function addPlot(plot) {
  const targetLayoutId = parseInt(plot.layoutId, 10) || 1;
  const areaSqftVal = parseInt(plot.areaSqft, 10) || 0;
  const plotTypeVal = plot.plotType ? String(plot.plotType).trim() : 'Residential';
  const notesVal = plot.notes ? String(plot.notes).trim() : '';
  const imageVal = plot.image ? String(plot.image).trim() : '';
  const rawStatus = plot.status || 'Available';
  const statusVal = rawStatus === 'Active' ? 'Available' : rawStatus;

  if (isPostgres) {
    const res = await pgPool.query(
      'INSERT INTO trs_plots (layout_id, number, layout, dimension, facing, price, status, area_sqft, plot_type, notes, image) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, layout_id AS "layoutId", number, layout, dimension, facing, price, status, area_sqft AS "areaSqft", plot_type AS "plotType", notes, image',
      [targetLayoutId, plot.number, plot.layout || 'Sowbhagya Nagar Layout', plot.dimension, plot.facing, plot.price || 'To be Negotiable', statusVal, areaSqftVal, plotTypeVal, notesVal, imageVal]
    );
    return res.rows[0];
  }
  const plots = await getPlots();
  const newId = plots.length ? Math.max(...plots.map(p => p.id)) + 1 : 1;
  const newPlot = {
    id: newId,
    layoutId: targetLayoutId,
    number: plot.number,
    layout: plot.layout || 'Sowbhagya Nagar Layout',
    dimension: plot.dimension,
    facing: plot.facing,
    price: plot.price || 'To be Negotiable',
    status: statusVal,
    areaSqft: areaSqftVal,
    plotType: plotTypeVal,
    notes: notesVal,
    image: imageVal
  };
  plots.push(newPlot);
  fs.writeFileSync(PLOTS_FILE, JSON.stringify(plots, null, 2), 'utf8');
  return newPlot;
}

async function updatePlot(id, updates) {
  if (updates.status === 'Active') updates.status = 'Available';
  if (isPostgres) {
    const fields = [];
    const values = [];
    let idx = 1;
    for (const [key, val] of Object.entries(updates)) {
      let colName = key;
      if (key === 'layoutId') colName = 'layout_id';
      else if (key === 'areaSqft') colName = 'area_sqft';
      else if (key === 'plotType') colName = 'plot_type';
      fields.push(`${colName} = $${idx++}`);
      values.push(val);
    }
    values.push(id);
    const res = await pgPool.query(`UPDATE trs_plots SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING id, layout_id AS "layoutId", number, layout, dimension, facing, price, status, area_sqft AS "areaSqft", plot_type AS "plotType", notes, image`, values);
    return res.rows[0] || null;
  }
  const plots = await getPlots();
  const index = plots.findIndex(p => p.id === id);
  if (index === -1) return null;
  plots[index] = { ...plots[index], ...updates };
  fs.writeFileSync(PLOTS_FILE, JSON.stringify(plots, null, 2), 'utf8');
  return plots[index];
}

async function deletePlot(id) {
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_plots WHERE id = $1', [id]);
    return true;
  }
  let plots = await getPlots();
  plots = plots.filter(p => p.id !== id);
  fs.writeFileSync(PLOTS_FILE, JSON.stringify(plots, null, 2), 'utf8');
  return true;
}

// ----------------- LAYOUT MASTERPLAN DOCUMENTS -----------------
async function getLayoutDocument() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT data FROM trs_layout_docs WHERE id = $1', ['sowbhagya_nagar']);
    if (res.rows.length > 0) {
      return typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    }
    return DEFAULT_LAYOUT_DOCUMENT;
  }
  if (!fs.existsSync(LAYOUT_DOCS_FILE)) {
    return DEFAULT_LAYOUT_DOCUMENT;
  }
  try {
    return JSON.parse(fs.readFileSync(LAYOUT_DOCS_FILE, 'utf8'));
  } catch (e) {
    return DEFAULT_LAYOUT_DOCUMENT;
  }
}

async function updateLayoutDocument(updates) {
  const current = await getLayoutDocument();
  const updated = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString()
  };

  if (isPostgres) {
    await pgPool.query(
      'INSERT INTO trs_layout_docs (id, data, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP',
      ['sowbhagya_nagar', JSON.stringify(updated)]
    );
    return updated;
  }

  fs.writeFileSync(LAYOUT_DOCS_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

// ----------------- CUSTOMER REVIEWS API -----------------
async function getAllReviews() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT id, customer_name AS "customerName", review_text AS "reviewText", rating, location, profile_image AS "profileImage", is_published AS "isPublished", created_at AS "createdAt" FROM trs_reviews ORDER BY id DESC');
    return res.rows;
  }
  if (!fs.existsSync(REVIEWS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8')); } catch (e) { return []; }
}

async function getPublishedReviews() {
  const reviews = await getAllReviews();
  return reviews.filter(r => r.isPublished === true);
}

async function addReview(reviewData) {
  const rating = Math.min(5, Math.max(1, parseInt(reviewData.rating, 10) || 5));
  const isPublished = reviewData.isPublished !== undefined ? Boolean(reviewData.isPublished) : (reviewData.published !== undefined ? Boolean(reviewData.published) : true);
  const custName = (reviewData.customerName || reviewData.name || '').trim();
  const text = (reviewData.reviewText || reviewData.review || '').trim();
  const loc = (reviewData.location || '').trim();
  const img = reviewData.profileImage || reviewData.avatar || null;
  const srv = (reviewData.service || 'Property Purchase').trim();

  if (isPostgres) {
    const res = await pgPool.query(
      'INSERT INTO trs_reviews (customer_name, review_text, rating, location, profile_image, is_published) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, customer_name AS "customerName", review_text AS "reviewText", rating, location, profile_image AS "profileImage", is_published AS "isPublished", created_at AS "createdAt"',
      [custName, text, rating, loc || null, img, isPublished]
    );
    const row = res.rows[0];
    row.name = row.customerName;
    row.review = row.reviewText;
    row.avatar = row.profileImage;
    row.published = row.isPublished;
    return row;
  }

  const reviews = await getAllReviews();
  const newId = reviews.length ? Math.max(...reviews.map(r => r.id)) + 1 : 1;
  const newReview = {
    id: newId,
    customerName: custName,
    name: custName,
    reviewText: text,
    review: text,
    rating: rating,
    location: loc || 'Guduvanchery',
    service: srv,
    profileImage: img,
    avatar: img,
    isPublished: isPublished,
    published: isPublished,
    date: reviewData.date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };
  reviews.unshift(newReview);
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf8');
  return newReview;
}

async function updateReview(id, updates) {
  const publishedVal = updates.published !== undefined ? updates.published : updates.isPublished;
  if (isPostgres) {
    const fields = [];
    const values = [];
    let idx = 1;
    const mapping = {
      customerName: 'customer_name',
      name: 'customer_name',
      reviewText: 'review_text',
      review: 'review_text',
      rating: 'rating',
      location: 'location',
      profileImage: 'profile_image',
      avatar: 'profile_image',
      isPublished: 'is_published',
      published: 'is_published'
    };

    for (const [key, val] of Object.entries(updates)) {
      if (mapping[key]) {
        fields.push(`${mapping[key]} = $${idx++}`);
        values.push(val);
      }
    }
    values.push(id);
    const res = await pgPool.query(
      `UPDATE trs_reviews SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING id, customer_name AS "customerName", review_text AS "reviewText", rating, location, profile_image AS "profileImage", is_published AS "isPublished"`,
      values
    );
    if (!res.rows[0]) return null;
    const row = res.rows[0];
    row.name = row.customerName;
    row.review = row.reviewText;
    row.avatar = row.profileImage;
    row.published = row.isPublished;
    return row;
  }

  const reviews = await getAllReviews();
  const index = reviews.findIndex(r => r.id === id);
  if (index === -1) return null;
  reviews[index] = { 
    ...reviews[index], 
    ...updates,
    ...(publishedVal !== undefined ? { isPublished: publishedVal, published: publishedVal } : {})
  };
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf8');
  return reviews[index];
}

async function deleteReview(id) {
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_reviews WHERE id = $1', [id]);
    return true;
  }
  let reviews = await getAllReviews();
  reviews = reviews.filter(r => r.id !== id);
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2), 'utf8');
  return true;
}

// ----------------- HAPPY CUSTOMER GALLERY API -----------------
async function getAllHappyCustomers() {
  if (isPostgres) {
    const res = await pgPool.query('SELECT id, image_url AS "imageUrl", caption, display_order AS "displayOrder", is_cover AS "isCover", is_published AS "isPublished", created_at AS "createdAt" FROM trs_happy_customers ORDER BY is_cover DESC, display_order ASC, id DESC');
    return res.rows;
  }
  if (!fs.existsSync(HAPPY_CUSTOMERS_FILE)) return [];
  try {
    const items = JSON.parse(fs.readFileSync(HAPPY_CUSTOMERS_FILE, 'utf8'));
    return items.sort((a, b) => (b.isCover ? 1 : 0) - (a.isCover ? 1 : 0) || (a.displayOrder || 0) - (b.displayOrder || 0));
  } catch (e) { return []; }
}

async function getPublishedHappyCustomers() {
  const items = await getAllHappyCustomers();
  return items.filter(item => item.isPublished === true);
}

async function addHappyCustomerPhoto(photoData) {
  const isCover = Boolean(photoData.isCover);
  const isPublished = photoData.isPublished !== undefined ? Boolean(photoData.isPublished) : (photoData.published !== undefined ? Boolean(photoData.published) : true);
  const displayOrder = parseInt(photoData.displayOrder !== undefined ? photoData.displayOrder : photoData.order, 10) || 0;
  const imgUrl = (photoData.imageUrl || photoData.image || '').trim();
  const cap = (photoData.caption || '').trim();
  const loc = (photoData.location || 'Chengalpattu Dist.').trim();

  if (isPostgres) {
    if (isCover) {
      await pgPool.query('UPDATE trs_happy_customers SET is_cover = false');
    }
    const res = await pgPool.query(
      'INSERT INTO trs_happy_customers (image_url, caption, display_order, is_cover, is_published) VALUES ($1, $2, $3, $4, $5) RETURNING id, image_url AS "imageUrl", caption, display_order AS "displayOrder", is_cover AS "isCover", is_published AS "isPublished", created_at AS "createdAt"',
      [imgUrl, cap || null, displayOrder, isCover, isPublished]
    );
    const row = res.rows[0];
    row.image = row.imageUrl;
    row.order = row.displayOrder;
    row.published = row.isPublished;
    row.location = loc;
    return row;
  }

  const items = await getAllHappyCustomers();
  if (isCover) {
    items.forEach(i => i.isCover = false);
  }
  const newId = items.length ? Math.max(...items.map(i => i.id)) + 1 : 1;
  const newItem = {
    id: newId,
    imageUrl: imgUrl,
    image: imgUrl,
    caption: cap,
    location: loc,
    displayOrder: displayOrder,
    order: displayOrder,
    isCover: isCover,
    isPublished: isPublished,
    published: isPublished,
    hasConsent: photoData.hasConsent !== false,
    createdAt: new Date().toISOString()
  };
  items.push(newItem);
  fs.writeFileSync(HAPPY_CUSTOMERS_FILE, JSON.stringify(items, null, 2), 'utf8');
  return newItem;
}

async function updateHappyCustomerPhoto(id, updates) {
  if (isPostgres) {
    if (updates.isCover) {
      await pgPool.query('UPDATE trs_happy_customers SET is_cover = false WHERE id != $1', [id]);
    }
    const fields = [];
    const values = [];
    let idx = 1;
    const mapping = {
      imageUrl: 'image_url',
      image: 'image_url',
      caption: 'caption',
      displayOrder: 'display_order',
      order: 'display_order',
      isCover: 'is_cover',
      isPublished: 'is_published',
      published: 'is_published'
    };
    for (const [key, val] of Object.entries(updates)) {
      if (mapping[key]) {
        fields.push(`${mapping[key]} = $${idx++}`);
        values.push(val);
      }
    }
    values.push(id);
    const res = await pgPool.query(
      `UPDATE trs_happy_customers SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${idx} RETURNING id, image_url AS "imageUrl", caption, display_order AS "displayOrder", is_cover AS "isCover", is_published AS "isPublished"`,
      values
    );
    return res.rows[0] || null;
  }

  const items = await getAllHappyCustomers();
  const index = items.findIndex(i => i.id === id);
  if (index === -1) return null;
  if (updates.isCover) {
    items.forEach(i => i.isCover = false);
  }
  const publishedVal = updates.published !== undefined ? updates.published : updates.isPublished;
  const orderVal = updates.order !== undefined ? updates.order : updates.displayOrder;
  const imgVal = updates.image !== undefined ? updates.image : updates.imageUrl;

  items[index] = { 
    ...items[index], 
    ...updates,
    ...(publishedVal !== undefined ? { isPublished: publishedVal, published: publishedVal } : {}),
    ...(orderVal !== undefined ? { displayOrder: orderVal, order: orderVal } : {}),
    ...(imgVal !== undefined ? { imageUrl: imgVal, image: imgVal } : {})
  };
  fs.writeFileSync(HAPPY_CUSTOMERS_FILE, JSON.stringify(items, null, 2), 'utf8');
  return items[index];
}

async function deleteHappyCustomerPhoto(id) {
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_happy_customers WHERE id = $1', [id]);
    return true;
  }
  let items = await getAllHappyCustomers();
  items = items.filter(i => i.id !== id);
  fs.writeFileSync(HAPPY_CUSTOMERS_FILE, JSON.stringify(items, null, 2), 'utf8');
  return true;
}

// ----------------- SERVICE PANELS API -----------------
async function getAllServicePanels() {
  if (isPostgres) {
    const res = await pgPool.query(
      `SELECT id, title, short_description AS "shortDescription", description, image, 
              is_illustrative AS "isIllustrative", button_text AS "buttonText", button_link AS "buttonLink", 
              category_filter AS "categoryFilter", display_order AS "displayOrder", is_enabled AS "isEnabled", 
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM trs_service_panels 
       ORDER BY display_order ASC, id ASC`
    );
    return res.rows;
  }
  if (!fs.existsSync(SERVICE_PANELS_FILE)) {
    fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(DEFAULT_SERVICE_PANELS, null, 2), 'utf8');
    return DEFAULT_SERVICE_PANELS;
  }
  try {
    const panels = JSON.parse(fs.readFileSync(SERVICE_PANELS_FILE, 'utf8'));
    return panels.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  } catch (e) {
    return DEFAULT_SERVICE_PANELS;
  }
}

async function getPublishedServicePanels() {
  const panels = await getAllServicePanels();
  return panels.filter(p => p.isEnabled !== false);
}

async function addServicePanel(panelData) {
  const panels = await getAllServicePanels();
  const id = panelData.id || `panel_${Date.now()}`;
  const title = (panelData.title || '').trim();
  const shortDescription = (panelData.shortDescription || '').trim();
  const description = (panelData.description || '').trim();
  const image = (panelData.image || '').trim() || DEFAULT_SERVICE_PANELS[0].image;
  const isIllustrative = panelData.isIllustrative !== false;
  const buttonText = (panelData.buttonText || 'View Details').trim();
  const buttonLink = (panelData.buttonLink || '#listings').trim();
  const categoryFilter = (panelData.categoryFilter || '').trim();
  const displayOrder = parseInt(panelData.displayOrder, 10) || (panels.length + 1);
  const isEnabled = panelData.isEnabled !== false;

  if (isPostgres) {
    const res = await pgPool.query(
      `INSERT INTO trs_service_panels (id, title, short_description, description, image, is_illustrative, button_text, button_link, category_filter, display_order, is_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, title, short_description AS "shortDescription", description, image, 
                 is_illustrative AS "isIllustrative", button_text AS "buttonText", button_link AS "buttonLink", 
                 category_filter AS "categoryFilter", display_order AS "displayOrder", is_enabled AS "isEnabled"`,
      [id, title, shortDescription, description, image, isIllustrative, buttonText, buttonLink, categoryFilter, displayOrder, isEnabled]
    );
    return res.rows[0];
  }

  const newPanel = {
    id,
    title,
    shortDescription,
    description,
    image,
    isIllustrative,
    buttonText,
    buttonLink,
    categoryFilter,
    displayOrder,
    isEnabled,
    createdAt: new Date().toISOString()
  };

  panels.push(newPanel);
  fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(panels, null, 2), 'utf8');
  return newPanel;
}

async function updateServicePanel(id, updates) {
  if (isPostgres) {
    const fields = [];
    const values = [];
    let idx = 1;
    const mapping = {
      title: 'title',
      shortDescription: 'short_description',
      description: 'description',
      image: 'image',
      isIllustrative: 'is_illustrative',
      buttonText: 'button_text',
      buttonLink: 'button_link',
      categoryFilter: 'category_filter',
      displayOrder: 'display_order',
      isEnabled: 'is_enabled'
    };
    for (const [key, val] of Object.entries(updates)) {
      if (mapping[key] !== undefined) {
        fields.push(`${mapping[key]} = $${idx++}`);
        values.push(val);
      }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const res = await pgPool.query(
      `UPDATE trs_service_panels SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $${idx} 
       RETURNING id, title, short_description AS "shortDescription", description, image, 
                 is_illustrative AS "isIllustrative", button_text AS "buttonText", button_link AS "buttonLink", 
                 category_filter AS "categoryFilter", display_order AS "displayOrder", is_enabled AS "isEnabled"`,
      values
    );
    return res.rows[0] || null;
  }

  const panels = await getAllServicePanels();
  const index = panels.findIndex(p => p.id === id);
  if (index === -1) return null;

  panels[index] = {
    ...panels[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(panels, null, 2), 'utf8');
  return panels[index];
}

async function deleteServicePanel(id) {
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_service_panels WHERE id = $1', [id]);
    return true;
  }
  let panels = await getAllServicePanels();
  panels = panels.filter(p => p.id !== id);
  fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(panels, null, 2), 'utf8');
  return true;
}

async function resetServicePanelsToDefault() {
  if (isPostgres) {
    await pgPool.query('DELETE FROM trs_service_panels');
    for (const p of DEFAULT_SERVICE_PANELS) {
      await pgPool.query(
        `INSERT INTO trs_service_panels (id, title, short_description, description, image, is_illustrative, button_text, button_link, category_filter, display_order, is_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [p.id, p.title, p.shortDescription, p.description, p.image, p.isIllustrative !== false, p.buttonText, p.buttonLink, p.categoryFilter, p.displayOrder, p.isEnabled !== false]
      );
    }
    return DEFAULT_SERVICE_PANELS;
  }
  fs.writeFileSync(SERVICE_PANELS_FILE, JSON.stringify(DEFAULT_SERVICE_PANELS, null, 2), 'utf8');
  return DEFAULT_SERVICE_PANELS;
}

async function getSocialSettings() {
  let settings = DEFAULT_SOCIAL_SETTINGS;
  if (isPostgres) {
    const res = await pgPool.query('SELECT data FROM trs_social_settings WHERE id = $1', ['main']);
    if (res.rows.length > 0) {
      settings = typeof res.rows[0].data === 'string' ? JSON.parse(res.rows[0].data) : res.rows[0].data;
    }
  } else if (fs.existsSync(SOCIAL_SETTINGS_FILE)) {
    try {
      settings = JSON.parse(fs.readFileSync(SOCIAL_SETTINGS_FILE, 'utf8'));
    } catch (e) {
      settings = DEFAULT_SOCIAL_SETTINGS;
    }
  }

  // Ensure office sub-object exists with safe fallbacks
  if (!settings.office) {
    settings.office = DEFAULT_SOCIAL_SETTINGS.office;
  }
  return settings;
}

async function updateSocialSettings(newSettings) {
  const current = await getSocialSettings();
  const currentOffice = (current && current.office) || DEFAULT_SOCIAL_SETTINGS.office;
  const newOffice = newSettings.office || {};

  const updated = {
    office: {
      addressLine1: newOffice.addressLine1 !== undefined ? String(newOffice.addressLine1).trim() : currentOffice.addressLine1,
      addressLine2: newOffice.addressLine2 !== undefined ? String(newOffice.addressLine2).trim() : currentOffice.addressLine2,
      phone1: newOffice.phone1 !== undefined ? String(newOffice.phone1).trim() : currentOffice.phone1,
      phone2: newOffice.phone2 !== undefined ? String(newOffice.phone2).trim() : currentOffice.phone2,
      email1: newOffice.email1 !== undefined ? String(newOffice.email1).trim() : currentOffice.email1,
      email2: newOffice.email2 !== undefined ? String(newOffice.email2).trim() : currentOffice.email2
    },
    facebook: {
      url: newSettings.facebook && newSettings.facebook.url !== undefined ? String(newSettings.facebook.url).trim() : (current.facebook ? current.facebook.url : ''),
      isEnabled: newSettings.facebook && newSettings.facebook.isEnabled !== undefined ? Boolean(newSettings.facebook.isEnabled) : (current.facebook ? Boolean(current.facebook.isEnabled) : false)
    },
    instagram: {
      url: newSettings.instagram && newSettings.instagram.url !== undefined ? String(newSettings.instagram.url).trim() : (current.instagram ? current.instagram.url : ''),
      isEnabled: newSettings.instagram && newSettings.instagram.isEnabled !== undefined ? Boolean(newSettings.instagram.isEnabled) : (current.instagram ? Boolean(current.instagram.isEnabled) : false)
    },
    updatedAt: new Date().toISOString()
  };

  if (isPostgres) {
    await pgPool.query(
      `INSERT INTO trs_social_settings (id, data, updated_at) 
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP`,
      ['main', JSON.stringify(updated)]
    );
    return updated;
  }

  fs.writeFileSync(SOCIAL_SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

module.exports = {
  initDB,
  getUsers,
  getUserByUsername,
  createUser,
  updateUser,
  getSession,
  setSession,
  deleteSession,
  getProperties,
  getAllAdminProperties,
  getPropertyById,
  addProperty,
  updateProperty,
  duplicateProperty,
  deleteProperty,
  getPlots,
  getPlotsByLayoutId,
  addPlot,
  updatePlot,
  deletePlot,
  getLayoutDocument,
  updateLayoutDocument,
  getAllReviews,
  getPublishedReviews,
  addReview,
  updateReview,
  deleteReview,
  getAllHappyCustomers,
  getPublishedHappyCustomers,
  addHappyCustomerPhoto,
  updateHappyCustomerPhoto,
  deleteHappyCustomerPhoto,
  getAllServicePanels,
  getPublishedServicePanels,
  addServicePanel,
  updateServicePanel,
  deleteServicePanel,
  resetServicePanelsToDefault,
  getSocialSettings,
  updateSocialSettings
};
