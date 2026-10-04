/**
 * migrate-from-agent-genaie.mjs
 *
 * One-time Firestore data migration: copies Webetu-related documents from the
 * agent_genaie Firebase project into the new standalone webetu-web project.
 *
 * Usage:
 *   node scripts/migrate-from-agent-genaie.mjs            # dry-run (default)
 *   node scripts/migrate-from-agent-genaie.mjs --commit   # actually writes
 *
 * Required env vars:
 *   SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
 *   DEST_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------
const isDryRun = !process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// Initialise two Firebase Admin apps from base64-encoded service account JSON
// ---------------------------------------------------------------------------
function appFromBase64Env(envVar, appName) {
  const raw = process.env[envVar];
  if (!raw || !raw.trim()) {
    throw new Error(`Missing required env var: ${envVar}`);
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8"));
  } catch (err) {
    throw new Error(`Failed to decode/parse ${envVar}: ${err.message}`);
  }
  return initializeApp({ credential: cert(serviceAccount) }, appName);
}

const sourceApp = appFromBase64Env("SOURCE_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64", "source");
const destApp   = appFromBase64Env("DEST_FIREBASE_SERVICE_ACCOUNT_JSON_BASE64",   "dest");

const srcDb  = getFirestore(sourceApp);
const destDb = getFirestore(destApp);

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
function log(...args) {
  console.log("[migrate]", ...args);
}

function logDoc(collection, id, action) {
  log(`  ${action}: ${collection}/${id}`);
}

// ---------------------------------------------------------------------------
// Core copy primitive: copy one snapshot → dest collection (idempotent set)
// ---------------------------------------------------------------------------
async function copySnapshot(snap, destCollection, label) {
  const destColRef = destDb.collection(destCollection);
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (isDryRun) {
      logDoc(label ?? destCollection, doc.id, "WOULD COPY");
    } else {
      await destColRef.doc(doc.id).set(data); // full overwrite — idempotent by doc id
      logDoc(label ?? destCollection, doc.id, "copied");
    }
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Fetch helpers with graceful empty-collection handling
// ---------------------------------------------------------------------------
async function getCollection(db, collectionName) {
  try {
    const snap = await db.collection(collectionName).get();
    return snap;
  } catch (err) {
    log(`WARNING: could not read collection "${collectionName}": ${err.message}`);
    return { docs: [], empty: true };
  }
}

async function getFilteredCollection(db, collectionName, field, op, value) {
  try {
    const snap = await db.collection(collectionName).where(field, op, value).get();
    return snap;
  } catch (err) {
    log(`WARNING: could not query collection "${collectionName}": ${err.message}`);
    return { docs: [], empty: true };
  }
}

// ---------------------------------------------------------------------------
// Main migration
// ---------------------------------------------------------------------------
async function migrate() {
  log("=".repeat(60));
  log(isDryRun ? "DRY-RUN mode — nothing will be written" : "COMMIT mode — writing to destination Firestore");
  log("=".repeat(60));

  const summary = {};

  // -------------------------------------------------------------------------
  // 1. credentialRefs — only docs where service === "webetu"
  //    Doc IDs follow the pattern: webetu_username_password_<uid>
  // -------------------------------------------------------------------------
  log("\n[1/5] credentialRefs (filter: service == 'webetu')");
  const credSnap = await getFilteredCollection(srcDb, "credentialRefs", "service", "==", "webetu");
  const credCount = await copySnapshot(credSnap, "credentialRefs", "credentialRefs");
  summary.credentialRefs = credCount;
  log(`  -> ${credCount} doc(s)`);

  // Collect the set of userIds present in webetu credentialRefs so we can
  // use it when filtering the users collection below.
  const webetuUserIds = new Set(
    credSnap.docs.map((d) => d.data()?.userId).filter(Boolean)
  );

  // -------------------------------------------------------------------------
  // 2. webetuPreferences — all docs
  // -------------------------------------------------------------------------
  log("\n[2/5] webetuPreferences (all docs)");
  const prefSnap = await getCollection(srcDb, "webetuPreferences");
  const prefCount = await copySnapshot(prefSnap, "webetuPreferences");
  summary.webetuPreferences = prefCount;
  log(`  -> ${prefCount} doc(s)`);

  // -------------------------------------------------------------------------
  // 3. webetuOverrides — all docs
  // -------------------------------------------------------------------------
  log("\n[3/5] webetuOverrides (all docs)");
  const overSnap = await getCollection(srcDb, "webetuOverrides");
  const overCount = await copySnapshot(overSnap, "webetuOverrides");
  summary.webetuOverrides = overCount;
  log(`  -> ${overCount} doc(s)`);

  // -------------------------------------------------------------------------
  // 4. webetuRestaurants — all docs
  // -------------------------------------------------------------------------
  log("\n[4/5] webetuRestaurants (all docs)");
  const restSnap = await getCollection(srcDb, "webetuRestaurants");
  const restCount = await copySnapshot(restSnap, "webetuRestaurants");
  summary.webetuRestaurants = restCount;
  log(`  -> ${restCount} doc(s)`);

  // -------------------------------------------------------------------------
  // 4b. webetuCatalogMeta — all docs
  // -------------------------------------------------------------------------
  log("\n[4b] webetuCatalogMeta (all docs)");
  const metaSnap = await getCollection(srcDb, "webetuCatalogMeta");
  const metaCount = await copySnapshot(metaSnap, "webetuCatalogMeta");
  summary.webetuCatalogMeta = metaCount;
  log(`  -> ${metaCount} doc(s)`);

  // -------------------------------------------------------------------------
  // 4c. webetuMetadata — all docs. Each holds a user's discovered ONOU location
  //     (wilaya/residence). Not copying it is recoverable — the next restaurant
  //     lookup re-discovers — but it costs every user the enrichment round-trips
  //     again, so bring it along.
  // -------------------------------------------------------------------------
  log("\n[4c] webetuMetadata (all docs)");
  const locSnap = await getCollection(srcDb, "webetuMetadata");
  const locCount = await copySnapshot(locSnap, "webetuMetadata");
  summary.webetuMetadata = locCount;
  log(`  -> ${locCount} doc(s)`);

  // -------------------------------------------------------------------------
  // 5. users — only those with a webetu credentialRef OR services.webetu set
  //    Strategy: we have the uid set from step 1; additionally query users
  //    where services.webetu is not "not_subscribed" / "not_connected".
  //    Because Firestore doesn't support "!= null" cleanly across multiple
  //    values, we fetch by the two non-absent statuses plus the uid set.
  // -------------------------------------------------------------------------
  log("\n[5/5] users (filter: webetu credentialRef or services.webetu set)");

  // Query by services.webetu values that indicate the feature is or was active.
  const webetuActiveStatuses = ["connected", "not_connected", "active", "revoked"];
  const userSnapsByStatus = await Promise.all(
    webetuActiveStatuses.map((status) =>
      getFilteredCollection(srcDb, "users", "services.webetu", "==", status)
    )
  );

  // Merge all matched user docs into a map keyed by doc id (dedup)
  const userDocsMap = new Map();
  for (const snap of userSnapsByStatus) {
    for (const doc of snap.docs) {
      userDocsMap.set(doc.id, doc);
      webetuUserIds.add(doc.id); // ensure uid set is complete
    }
  }

  // Also fetch any remaining uids captured from credentialRefs that didn't
  // show up in the services.webetu queries (e.g. if services field is missing)
  const missingUids = [...webetuUserIds].filter((uid) => !userDocsMap.has(uid));
  if (missingUids.length > 0) {
    log(`  Fetching ${missingUids.length} user(s) found via credentialRefs but not services.webetu query...`);
    await Promise.all(
      missingUids.map(async (uid) => {
        try {
          const doc = await srcDb.collection("users").doc(uid).get();
          if (doc.exists) {
            userDocsMap.set(doc.id, doc);
          } else {
            log(`  NOTE: user doc missing for uid ${uid} (credentialRef exists but no users doc)`);
          }
        } catch (err) {
          log(`  WARNING: could not fetch user ${uid}: ${err.message}`);
        }
      })
    );
  }

  // Write the collected user docs
  const destUsersRef = destDb.collection("users");
  let userCount = 0;
  for (const [uid, doc] of userDocsMap) {
    const data = doc.data();
    if (isDryRun) {
      logDoc("users", uid, "WOULD COPY");
    } else {
      await destUsersRef.doc(uid).set(data); // idempotent full overwrite
      logDoc("users", uid, "copied");
    }
    userCount++;
  }
  summary.users = userCount;
  log(`  -> ${userCount} doc(s)`);

  // -------------------------------------------------------------------------
  // SKIPPED collections (phone-path, not needed in web-only app)
  // -------------------------------------------------------------------------
  const skipped = [
    "phoneLinksByUser",
    "phoneLinksByPhone",
    "accountLinkInvites",
    "webetuDeliveryByPhone",
  ];
  log(`\nSKIPPED collections (phone-path, web-only app): ${skipped.join(", ")}`);

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  log("\n" + "=".repeat(60));
  log(isDryRun ? "DRY-RUN complete — no data written" : "Migration complete");
  log("Collections copied:");
  for (const [col, count] of Object.entries(summary)) {
    log(`  ${col.padEnd(24)} ${count} doc(s)`);
  }
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  log(`  ${"TOTAL".padEnd(24)} ${total} doc(s)`);
  log("=".repeat(60));

  if (isDryRun) {
    log("\nTo write for real, rerun with --commit:");
    log("  node scripts/migrate-from-agent-genaie.mjs --commit");
  }
}

migrate().catch((err) => {
  console.error("[migrate] FATAL:", err);
  process.exit(1);
});
