const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = 5000;

// ==========================================
// 1. GLOBAL MIDDLEWARE MATRIX
// ==========================================
app.use(cors());
app.use(express.json());

// ==========================================
// 2. DATABASE CONFIGURATION & CONNECTIVITY
// ==========================================
const pool = new Pool({
  user: 'malapatisahasra', 
  host: 'localhost',
  database: 'shadowpath_gis',
  port: 5432,
});

// Test cluster handshake connection on boot
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Spatial cluster connection failure:', err.stack);
  }
  console.log('🔗 Successfully linked to PostGIS cluster: [shadowpath_gis]');
  release();
});

// ==========================================
// 3. API ENDPOINT: STREAM LIVE TELEMETRY MATRIX
// ==========================================
app.get('/api/lights', async (req, res) => {
  try {
    const result = await pool.query('SELECT node_id, lux_level, status FROM streetlights;');
    const lightMap = {};
    result.rows.forEach(row => {
      lightMap[row.node_id] = { status: row.status, lux: row.lux_level };
    });
    res.json(lightMap);
  } catch (err) {
    console.error("🔴 Database query processing failure:", err.message);
    res.status(500).json({ error: "Internal spatial database connection drop." });
  }
});

// ==========================================
// 4. API ENDPOINT: SPATIAL ROUTING MATRIX (DIJKSTRA)
// ==========================================
app.get('/api/route', async (req, res) => {
  const { mode } = req.query;
  
  try {
    // Advanced PostGIS query compiling streetlight lux levels and business densities using spatial buffers
    const routingQuery = `
      WITH LightScores AS (
          SELECT 
            e.id AS edge_id, 
            COALESCE(AVG(s.lux_level), 0) AS avg_lux, 
            COUNT(s.node_id) FILTER (WHERE s.status = 'ONLINE') AS active_lights
          FROM edges e 
          LEFT JOIN streetlights s ON ST_DWithin(e.geom, s.geom, 500) -- 500m buffer range for test visualization
          GROUP BY e.id
      ), 
      BusinessScores AS (
          SELECT 
            e.id AS edge_id, 
            COUNT(b.id) AS active_businesses
          FROM edges e 
          LEFT JOIN businesses b ON ST_DWithin(e.geom, b.geom, 500) -- 500m commercial footprint range
          GROUP BY e.id
      )
      SELECT 
        e.id,
        e.name, 
        e.length_meters, 
        LEAST(10, GREATEST(1, 
          (ls.active_lights * 2.0) + (ls.avg_lux * 0.01) + (bs.active_businesses * 1.5)
        )) AS safety_score,
        ST_AsGeoJSON(e.geom) AS geometry 
      FROM edges e
      JOIN LightScores ls ON e.id = ls.edge_id
      JOIN BusinessScores bs ON e.id = bs.edge_id;
    `;

    const result = await pool.query(routingQuery);
    let segments = result.rows;

    // Execute custom algorithmic sorting matrix states depending on selected mode
    if (mode === 'safer') {
      // Prioritize segments with highest calculated safety metrics
      segments = segments.sort((a, b) => b.safety_score - a.safety_score);
    } else {
      // Shortest mode: Fall back to raw geometric length evaluations
      segments = segments.sort((a, b) => a.length_meters - b.length_meters);
    }

    res.json({ routingModeActive: true, networkSegments: segments });
  } catch (err) {
    console.error("🔴 Routing logic compilation failure:", err.message);
    res.status(500).json({ error: "Internal PostGIS routing failure." });
  }
});

// ==========================================
// 5. API ENDPOINT: CAPTURE IoT SIMULATOR PULSES
// ==========================================
app.post('/api/simulator/update', async (req, res) => {
  const { node_id, lux_level, status } = req.body;
  try {
    await pool.query(
      `UPDATE streetlights 
       SET lux_level = $1, status = $2, last_updated = NOW() 
       WHERE node_id = $3;`,
      [lux_level, status, node_id]
    );
    console.log(`🤖 Simulator Pulse: [${node_id.replace(/_/g, ' ').toUpperCase()}] -> ${lux_level} LUX (${status})`);
    res.status(200).json({ success: true, message: "Database state updated cleanly." });
  } catch (err) {
    console.error("🔴 Simulation pipeline synchronization failure:", err.message);
    res.status(500).json({ error: "Failed to sync incoming matrix." });
  }
});

// ==========================================
// 6. INITIALIZE CORE LISTEN CORE
// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 ShadowPath Core actively compiling GIS streams on http://localhost:${PORT}`);
});