import { Router } from "express";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

console.debug("[PasusDebug:backend/src/routes/discovery] Loaded");

const router = Router();

// Minimal table bootstrap to avoid separate migration step in dev containers.
const ensureTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS verified_server_listings (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      isVerified BOOLEAN NOT NULL DEFAULT TRUE,
      verifiedSince DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      featuredRank INT NULL,
      categories TEXT,
      tags TEXT,
      language VARCHAR(16) DEFAULT 'en',
      region VARCHAR(32) DEFAULT 'NA',
      descriptionShort VARCHAR(200),
      bannerUrl VARCHAR(512),
      iconUrl VARCHAR(512),
      memberCount INT DEFAULT 0,
      onlineCount INT NULL,
      activityScore INT DEFAULT 0,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE verified_server_listings ADD COLUMN IF NOT EXISTS name VARCHAR(255) NOT NULL DEFAULT ''`);
};

// Dev seeding (safe idempotent) to give the discovery page data.
const seedIfEmpty = async () => {
  const seed = [
    {
      id: "s_pasus",
      name: "Pasus Community",
      categories: "official,community",
      tags: "pasus,updates,voice,ai",
      language: "en",
      region: "EU",
      descriptionShort: "Official Pasus community with product updates, support, and sneak peeks.",
      iconUrl: "https://image2url.com/images/1765010310241-17e2efca-2db4-46cb-8aa2-8a323aca255c.png",
      bannerUrl: "https://image2url.com/images/1765756037081-9e192fe3-bc9a-4afe-a7c0-cdd633acc8b6.png",
      memberCount: 42800,
      onlineCount: 8200,
      activityScore: 95,
      featuredRank: 1,
    }
  ];

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const values = seed.map((s) => [
    s.id,
    s.name,
    1,
    now,
    s.featuredRank,
    s.categories,
    s.tags,
    s.language,
    s.region,
    s.descriptionShort,
    s.bannerUrl,
    s.iconUrl,
    s.memberCount,
    s.onlineCount,
    s.activityScore,
    now,
    now,
  ]);
  // Always upsert Pasus Community so banner/icon stay up to date
  await pool.query(
    `INSERT INTO verified_server_listings
      (id,name,isVerified,verifiedSince,featuredRank,categories,tags,language,region,descriptionShort,bannerUrl,iconUrl,memberCount,onlineCount,activityScore,createdAt,updatedAt)
     VALUES ?
     ON DUPLICATE KEY UPDATE
      name=VALUES(name),
      isVerified=VALUES(isVerified),
      featuredRank=VALUES(featuredRank),
      categories=VALUES(categories),
      tags=VALUES(tags),
      language=VALUES(language),
      region=VALUES(region),
      descriptionShort=VALUES(descriptionShort),
      bannerUrl=VALUES(bannerUrl),
      iconUrl=VALUES(iconUrl),
      memberCount=VALUES(memberCount),
      onlineCount=VALUES(onlineCount),
      activityScore=VALUES(activityScore)`
    , [values]);
};

ensureTable().then(seedIfEmpty).catch((err) => console.error('Discovery bootstrap failed', err));

const mapSort = (sort?: string) => {
  switch ((sort || '').toLowerCase()) {
    case 'members': return 'memberCount DESC';
    case 'newest': return 'createdAt DESC';
    case 'active': return 'COALESCE(onlineCount, activityScore) DESC';
    case 'trending':
    default:
      return 'activityScore DESC';
  }
};

const toLike = (value?: string) => value ? `%${value.toLowerCase()}%` : null;

router.get("/featured", requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `WITH member_counts AS (
         SELECT sm.serverId,
                COUNT(*) AS mc,
                SUM(CASE WHEN u.status = 'online' THEN 1 ELSE 0 END) AS oc
         FROM server_memberships sm
         LEFT JOIN users u ON u.id = sm.userId
         GROUP BY sm.serverId
       )
       SELECT v.*,
              COALESCE(mc.mc, v.memberCount)  AS memberCount,
              COALESCE(mc.oc, v.onlineCount)  AS onlineCount
             ,CASE WHEN v.id='s_pasus' THEN 'https://image2url.com/images/1765756037081-9e192fe3-bc9a-4afe-a7c0-cdd633acc8b6.png' ELSE v.bannerUrl END AS bannerUrl
             ,CASE WHEN v.id='s_pasus' THEN 'https://image2url.com/images/1765010310241-17e2efca-2db4-46cb-8aa2-8a323aca255c.png' ELSE v.iconUrl END AS iconUrl
       FROM verified_server_listings v
       LEFT JOIN member_counts mc ON mc.serverId = v.id
       WHERE v.isVerified = 1 AND v.featuredRank IS NOT NULL
       ORDER BY v.featuredRank ASC LIMIT 12`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Discovery featured error", err);
    res.status(500).json({ success: false, error: "Failed to load featured servers" });
  }
});

router.get("/servers", requireAuth, async (req, res) => {
  const {
    q,
    category,
    tags,
    language,
    region,
    sort,
    page = "1",
    pageSize = "12",
  } = req.query as Record<string, string>;

  const p = Math.max(1, parseInt(page || "1", 10));
  const size = Math.min(50, Math.max(1, parseInt(pageSize || "12", 10)));
  const offset = (p - 1) * size;
  const where: string[] = ["isVerified = 1"];
  const params: any[] = [];

  if (q) {
    where.push("(LOWER(name) LIKE ? OR LOWER(descriptionShort) LIKE ? OR LOWER(tags) LIKE ?)");
    const lk = toLike(q)!;
    params.push(lk, lk, lk);
  }
  if (category) {
    where.push("LOWER(categories) LIKE ?");
    params.push(`%${category.toLowerCase()}%`);
  }
  if (tags) {
    const tagList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    tagList.forEach((t) => {
      where.push("LOWER(tags) LIKE ?");
      params.push(`%${t}%`);
    });
  }
  if (language) {
    where.push("LOWER(language) = ?");
    params.push(language.toLowerCase());
  }
  if (region) {
    where.push("LOWER(region) = ?");
    params.push(region.toLowerCase());
  }

  const orderBy = mapSort(sort);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  try {
    const [items] = await pool.query(
      `WITH member_counts AS (
         SELECT sm.serverId,
                COUNT(*) AS mc,
                SUM(CASE WHEN u.status = 'online' THEN 1 ELSE 0 END) AS oc
         FROM server_memberships sm
         LEFT JOIN users u ON u.id = sm.userId
         GROUP BY sm.serverId
       )
       SELECT v.*,
              COALESCE(mc.mc, v.memberCount)  AS memberCount,
              COALESCE(mc.oc, v.onlineCount)  AS onlineCount
             ,CASE WHEN v.id='s_pasus' THEN 'https://image2url.com/images/1765756037081-9e192fe3-bc9a-4afe-a7c0-cdd633acc8b6.png' ELSE v.bannerUrl END AS bannerUrl
             ,CASE WHEN v.id='s_pasus' THEN 'https://image2url.com/images/1765010310241-17e2efca-2db4-46cb-8aa2-8a323aca255c.png' ELSE v.iconUrl END AS iconUrl
       FROM verified_server_listings v
       LEFT JOIN member_counts mc ON mc.serverId = v.id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, size, offset]
    );
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as cnt FROM verified_server_listings v ${whereSql}`,
      params
    );
    const total = (countRows as any[])[0]?.cnt || 0;

    // Simple facets
    const [facetRows] = await pool.query(
      `SELECT categories, tags, language, region FROM verified_server_listings WHERE isVerified = 1`
    );
    const catSet = new Set<string>();
    const tagSet = new Set<string>();
    const langSet = new Set<string>();
    const regionSet = new Set<string>();
    (facetRows as any[]).forEach((row) => {
      (row.categories || "").split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean).forEach((c: string) => catSet.add(c));
      (row.tags || "").split(",").map((x: string) => x.trim().toLowerCase()).filter(Boolean).forEach((t: string) => tagSet.add(t));
      if (row.language) langSet.add((row.language as string).toLowerCase());
      if (row.region) regionSet.add((row.region as string).toUpperCase());
    });

    res.json({
      success: true,
      data: {
        items,
        page: p,
        pageSize: size,
        total,
        facets: {
          categories: Array.from(catSet),
          tags: Array.from(tagSet),
          languages: Array.from(langSet),
          regions: Array.from(regionSet),
        },
      },
    });
  } catch (err) {
    console.error("Discovery search error", err);
    res.status(500).json({ success: false, error: "Failed to load discovery results" });
  }
});

// Admin: mark server as verified/update listing
router.post("/verify", requireAuth, requireAdmin, async (req, res) => {
  const {
    id,
    name,
    featuredRank = null,
    categories = "",
    tags = "",
    language = "en",
    region = "NA",
    descriptionShort = "",
    bannerUrl = null,
    iconUrl = null,
    memberCount = 0,
    onlineCount = null,
    activityScore = 0,
  } = req.body || {};

  if (!id || !name) return res.status(400).json({ success: false, error: "id and name required" });

  try {
    await pool.query(
      `INSERT INTO verified_server_listings
        (id,name,isVerified,verifiedSince,featuredRank,categories,tags,language,region,descriptionShort,bannerUrl,iconUrl,memberCount,onlineCount,activityScore)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        name=VALUES(name),
        isVerified=VALUES(isVerified),
        verifiedSince=COALESCE(verifiedSince, NOW()),
        featuredRank=VALUES(featuredRank),
        categories=VALUES(categories),
        tags=VALUES(tags),
        language=VALUES(language),
        region=VALUES(region),
        descriptionShort=VALUES(descriptionShort),
        bannerUrl=VALUES(bannerUrl),
        iconUrl=VALUES(iconUrl),
        memberCount=VALUES(memberCount),
        onlineCount=VALUES(onlineCount),
        activityScore=VALUES(activityScore)`
      ,
      [id, name, 1, new Date(), featuredRank, categories, tags, language, region, descriptionShort, bannerUrl, iconUrl, memberCount, onlineCount, activityScore]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Discovery verify error", err);
    res.status(500).json({ success: false, error: "Failed to verify server" });
  }
});

export default router;
