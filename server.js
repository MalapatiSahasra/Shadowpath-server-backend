const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
// 🌐 CRITICAL FIX: Cloud providers assign dynamic ports using process.env.PORT. Fall back to 5000 locally.
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Mock local datasets array to ensure your presentation works perfectly if localhost is unreachable in the cloud
const mockNetworkSegments = [
  { id: 1, name: "Maruthi Nagar Main Corridor", length_meters: 450, safety_score: 9.5 },
  { id: 2, name: "Clock Tower Crossing Sector", length_meters: 310, safety_score: 8.8 },
  { id: 3, name: "Adimurthy Nagar Link Road", length_meters: 600, safety_score: 4.2 },
  { id: 4, name: "Anantapur Old Town Bypass", length_meters: 850, safety_score: 3.1 }
];

const pool = new Pool({
  user: 'malapatisahasra', 
  host: 'localhost',
  database: 'shadowpath_gis',
  port: 5432,
  connectionTimeoutMillis: 3000 // Fails fast to trigger safe dataset layer if running in cloud environment
});

let isDatabaseOnline = false;

pool.connect((err, client, release) => {
  if (err) {
    console.log('⚠️ Running in Cloud/Isolated sandbox environment. Activating fallback spatial data arrays.');
    isDatabaseOnline = false;
  } else {
    console.log('🔗 Successfully linked to PostGIS cluster: [shadowpath_gis]');
    isDatabaseOnline = true;
    release();
  }
});

// ==========================================
// API ENDPOINTS WITH FAILSAFE FALLBACKS
// ==========================================

app.get('/api/lights', async (req, res) => {
  if (!isDatabaseOnline) {
    return res.json({ "node_01": { status: "ONLINE", lux: 85 }, "node_02": { status: "ONLINE", lux: 94 } });
  }
  try {
    const result = await pool.query('SELECT node_id, lux_level, status FROM streetlights;');
    const lightMap = {};
    result.rows.forEach(row => {
      lightMap[row.node_id] = { status: row.status, lux: row.lux_level };
    });
    res.json(lightMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/route', async (req, res) => {
  const { mode } = req.query;

  if (!isDatabaseOnline) {
    let segments = [...mockNetworkSegments];
    if (mode === 'safer') {
      segments.sort((a, b) => b.safety_score - a.safety_score);
    } else {
      segments.sort((a, b) => a.length_meters - b.length_meters);
    }
    return res.json({ routingModeActive: true, networkSegments: segments, cloudSandboxActive: true });
  }

  try {
    const routingQuery = `
      WITH LightScores AS (
          SELECT e.id AS edge_id, COALESCE(AVG(s.lux_level), 0) AS avg_lux, COUNT(s.node_id) FILTER (WHERE s.status = 'ONLINE') AS active_lights
          FROM edges e LEFT JOIN streetlights s ON ST_DWithin(e.geom, s.geom, 500) GROUP BY e.id
      ), 
      BusinessScores AS (
          SELECT e.id AS edge_id, COUNT(b.id) AS active_businesses
          FROM edges e LEFT JOIN businesses b ON ST_DWithin(e.geom, b.geom, 500) GROUP BY e.id
      )
      SELECT e.id, e.name, e.length_meters, LEAST(10, GREATEST(1, (ls.active_lights * 2.0) + (ls.avg_lux * 0.01) + (bs.active_businesses * 1.5))) AS safety_score, ST_AsGeoJSON(e.geom) AS geometry 
      FROM edges e JOIN LightScores ls ON e.id = ls.edge_id JOIN BusinessScores bs ON e.id = bs.edge_id;
    `;
    const result = await pool.query(routingQuery);
    let segments = result.rows;

    if (mode === 'safer') {
      segments.sort((a, b) => b.safety_score - a.safety_score);
    } else {
      segments.sort((a, b) => a.length_meters - b.length_meters);
    }
    res.json({ routingModeActive: true, networkSegments: segments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/simulator/update', async (req, res) => {
  const { node_id, lux_level, status } = req.body;
  if (!isDatabaseOnline) {
    console.log(`🤖 Simulator Pulse Capture (Cloud Mock Frame): [${node_id.toUpperCase()}] -> ${lux_level} LUX`);
    return res.status(200).json({ success: true, message: "Sandbox simulation vector synced." });
  }
  try {
    await pool.query('UPDATE streetlights SET lux_level = $1, status = $2, last_updated = NOW() WHERE node_id = $3;', [lux_level, status, node_id]);
    res.status(200).json({ success: true, message: "Database state updated cleanly." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 ShadowPath Core routing stream actively processing on production port: ${PORT}`);
});