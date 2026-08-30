require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');

// ── Connexion PostgreSQL ─────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

// ── Initialisation du schéma ─────────────────────────────────
async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

// ── Helper : rows → plain objects ────────────────────────────
function rows(r) { return r.rows; }
function row(r)  { return r.rows[0] || null; }

// ── Collection — interface identique à l'ancienne ────────────
class Collection {
  constructor(table) { this._t = table; }

  async findOne(pred) {
    if (typeof pred === 'function') {
      const all = await this.find();
      return all.find(pred) || null;
    }
    return null;
  }

  async find(pred) {
    const r = rows(await pool.query(`SELECT * FROM ${this._t} ORDER BY id`));
    return pred ? r.filter(pred) : r;
  }

  async insert(doc) {
    const keys   = Object.keys(doc);
    const vals   = Object.values(doc);
    const cols   = keys.join(', ');
    const params = keys.map((_,i) => `$${i+1}`).join(', ');
    const r = await pool.query(
      `INSERT INTO ${this._t} (${cols}) VALUES (${params}) RETURNING *`, vals
    );
    return row(r);
  }

  async update(pred, changes) {
    if (typeof pred === 'function') {
      const all = await this.find();
      const targets = all.filter(pred);
      for (const t of targets) {
        const keys   = Object.keys(changes);
        const vals   = Object.values(changes);
        const sets   = keys.map((k,i) => `${k} = $${i+1}`).join(', ');
        await pool.query(`UPDATE ${this._t} SET ${sets} WHERE id = $${keys.length+1}`, [...vals, t.id]);
      }
      return targets.length;
    }
    return 0;
  }

  async delete(pred) {
    if (typeof pred === 'function') {
      const all = await this.find();
      const targets = all.filter(pred);
      for (const t of targets) {
        await pool.query(`DELETE FROM ${this._t} WHERE id = $1`, [t.id]);
      }
      return targets.length;
    }
    return 0;
  }

  async count(pred) {
    if (!pred) {
      const r = await pool.query(`SELECT COUNT(*) FROM ${this._t}`);
      return parseInt(r.rows[0].count);
    }
    const all = await this.find();
    return all.filter(pred).length;
  }
}

// ── Seed données initiales ───────────────────────────────────
const SEED_LISTINGS = [
  { title:"Villa pieds dans l'eau à Tipaza",  description:"Vue imprenable sur la Méditerranée, terrasse privée, accès direct à la plage. Parfait pour un séjour en famille ou entre amis à deux pas d'Alger.",        location:"Tipaza",           wilaya:"Tipaza",      category:"plage",    price:12500, guests:6,  beds:3, baths:2, image:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80", rating:4.97, reviews:128 },
  { title:"Camp de luxe sous les étoiles",    description:"Nuits féériques dans le Grand Erg Occidental. Bivouac équipé, dîner traditionnel targui, balade en dromadaire au lever du soleil.",                          location:"Tamanrasset",      wilaya:"Tamanrasset", category:"sahara",   price:18000, guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80", rating:5.0,  reviews:54  },
  { title:"Somptueuse villa avec piscine",    description:"Immense villa avec piscine chauffée, jardin méditerranéen et vue panoramique sur la baie d'Oran. Personnel de maison inclus sur demande.",                   location:"Oran, Aïn El Turk",wilaya:"Oran",        category:"villa",    price:22000, guests:10, beds:5, baths:3, image:"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80", rating:4.92, reviews:89  },
  { title:"Riad authentique en Médina",       description:"Riad traditionnel du XVIIe siècle, patio central avec fontaine, décoration zellige et bois sculpté. À deux pas de la Grande Mosquée de Tlemcen.",           location:"Tlemcen",          wilaya:"Tlemcen",     category:"riad",     price:8500,  guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80", rating:4.88, reviews:212 },
  { title:"Chalet en bois dans les Aurès",    description:"Chaleureux chalet niché au cœur du massif des Aurès, cheminée crépitante, forêt de cèdres millénaires. Randonnées et découverte berbère.",                  location:"Batna",            wilaya:"Batna",       category:"montagne", price:9800,  guests:8,  beds:4, baths:2, image:"https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80", rating:4.95, reviews:67  },
  { title:"Appartement vue mer à Skikda",     description:"Appartement moderne avec balcon face à la mer, accès direct à une plage de sable fin, proche du port de Skikda.",                                            location:"Skikda",           wilaya:"Skikda",      category:"plage",    price:7200,  guests:4,  beds:2, baths:1, image:"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80", rating:4.80, reviews:144 },
  { title:"Maison de charme à la campagne",   description:"Vaste ferme rénovée avec potager bio, vue sur les oliveraies et la montagne de l'Atlas blidéen. Idéal pour se ressourcer.",                                  location:"Médéa",            wilaya:"Médéa",       category:"maison",   price:5500,  guests:6,  beds:3, baths:2, image:"https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800&q=80", rating:4.76, reviews:33  },
  { title:"Villa piscine & jardin tropical",  description:"Luxueuse villa dotée d'une grande piscine à débordement, barbecue extérieur, jardin tropical et terrasse couverte avec vue sur la mer.",                    location:"Annaba",           wilaya:"Annaba",      category:"piscine",  price:16500, guests:8,  beds:4, baths:3, image:"https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80", rating:4.91, reviews:77  },
];
const SEED_COORDS = [
  { lat:36.5911, lng:2.4483  }, { lat:22.7851, lng:5.5228  },
  { lat:35.6974, lng:-0.6341 }, { lat:34.8800, lng:-1.3200 },
  { lat:35.5559, lng:6.1741  }, { lat:36.8767, lng:6.9053  },
  { lat:36.2638, lng:2.7529  }, { lat:36.9000, lng:7.7667  },
];
const SEED_PHOTOS = [
  ["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80","https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&q=80","https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=80","https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&q=80"],
  ["https://images.unsplash.com/photo-1451337516015-6b6e9a44a8a3?w=800&q=80","https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=800&q=80","https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&q=80","https://images.unsplash.com/photo-1494783367193-149034c05e8f?w=800&q=80"],
  ["https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800&q=80","https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&q=80","https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80"],
  ["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80","https://images.unsplash.com/photo-1555993539-1732b0258235?w=800&q=80","https://images.unsplash.com/photo-1585543805890-6051f7829f98?w=800&q=80","https://images.unsplash.com/photo-1590381105924-c72589b9ef3f?w=800&q=80"],
  ["https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=80","https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=800&q=80","https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80","https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&q=80"],
  ["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80","https://images.unsplash.com/photo-1499678329028-101435549a4e?w=800&q=80","https://images.unsplash.com/photo-1495954484750-af469f2f9be5?w=800&q=80","https://images.unsplash.com/photo-1473496169904-658ba7574b0d?w=800&q=80"],
  ["https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800&q=80","https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&q=80","https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80","https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&q=80"],
  ["https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800&q=80","https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&q=80","https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800&q=80","https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=80"],
];

async function seed() {
  const hash = bcrypt.hashSync('demo1234', 10);
  await pool.query(
    `INSERT INTO users (name, email, password, is_host, is_admin, verified)
     VALUES ($1,$2,$3,true,true,true) ON CONFLICT (email) DO NOTHING`,
    ['Locavac Demo', 'demo@locavac.dz', hash]
  );
  const hostRow = await pool.query(`SELECT id FROM users WHERE email = 'demo@locavac.dz'`);
  const hostId  = hostRow.rows[0].id;

  const listingCount = await pool.query(`SELECT COUNT(*) FROM listings`);
  if (parseInt(listingCount.rows[0].count) === 0) {
    for (let i = 0; i < SEED_LISTINGS.length; i++) {
      const s = SEED_LISTINGS[i];
      await pool.query(
        `INSERT INTO listings (host_id,title,description,location,wilaya,category,price,guests,beds,baths,image,photos,lat,lng,rating,reviews,available)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)`,
        [hostId, s.title, s.description, s.location, s.wilaya, s.category, s.price,
         s.guests, s.beds, s.baths, s.image, JSON.stringify(SEED_PHOTOS[i]),
         SEED_COORDS[i].lat, SEED_COORDS[i].lng, s.rating, s.reviews]
      );
    }
    console.log('✅ Base de données initialisée.');
  }
}

// ── Export — interface compatible avec toutes les routes ─────
const users        = new Collection('users');
const listings     = new Collection('listings');
const reservations = new Collection('reservations');
const reviews      = new Collection('reviews');
const payments     = new Collection('payments');
const messages     = new Collection('messages');

async function connect() {
  await pool.query('SELECT 1'); // test connexion
  await initSchema();
  await seed();
  console.log('🐘 PostgreSQL connecté');
}

module.exports = { users, listings, reservations, reviews, payments, messages, connect, pool };
