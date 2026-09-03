(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FewerCuntsCategories = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "fewercunts-categories-v1";
  const DB_VERSION = 1;
  const UNCATEGORISED = "uncategorised";
  const TAXONOMY = [
    [UNCATEGORISED, "Uncategorised"],
    ["current-affairs", "Current affairs"],
    ["current-affairs/uk-politics", "Current affairs › UK politics"],
    ["current-affairs/us-politics", "Current affairs › US politics"],
    ["current-affairs/world-politics", "Current affairs › World politics"],
    ["current-affairs/war-geopolitics", "Current affairs › War and geopolitics"],
    ["current-affairs/economy-business", "Current affairs › Economy and business"],
    ["current-affairs/climate-environment", "Current affairs › Climate and environment"],
    ["current-affairs/news-public-figures", "Current affairs › News and public figures"],
    ["music-audio", "Music and audio"],
    ["music-audio/listening-recommendations", "Music and audio › Listening and recommendations"],
    ["music-audio/artists-releases", "Music and audio › Artists and releases"],
    ["music-audio/djs-mixes-radio", "Music and audio › DJs, mixes and radio"],
    ["music-audio/gigs-festivals", "Music and audio › Gigs and festivals"],
    ["music-audio/production-equipment", "Music and audio › Production and equipment"],
    ["music-audio/collecting-physical-media", "Music and audio › Physical media"],
    ["screen-culture", "Film, television and culture"],
    ["screen-culture/film", "Film, television and culture › Film"],
    ["screen-culture/television-streaming", "Film, television and culture › Television and streaming"],
    ["screen-culture/books-writing", "Film, television and culture › Books and writing"],
    ["screen-culture/art-photography", "Film, television and culture › Art and photography"],
    ["screen-culture/comedy", "Film, television and culture › Comedy"],
    ["screen-culture/celebrities-media", "Film, television and culture › Celebrities and media"],
    ["technology-gaming", "Technology and gaming"],
    ["technology-gaming/computers-mobile", "Technology and gaming › Computers and mobile"],
    ["technology-gaming/internet-social-media", "Technology and gaming › Internet and social media"],
    ["technology-gaming/ai-science", "Technology and gaming › AI and science"],
    ["technology-gaming/video-games", "Technology and gaming › Video games"],
    ["technology-gaming/retro-technology", "Technology and gaming › Retro technology"],
    ["technology-gaming/technical-help", "Technology and gaming › Technical help"],
    ["sports", "Sports"],
    ["sports/basketball", "Sports › Basketball"],
    ["sports/basketball/mens", "Sports › Basketball › Men's"],
    ["sports/basketball/mixed", "Sports › Basketball › Mixed"],
    ["sports/cricket", "Sports › Cricket"],
    ["sports/cricket/mens", "Sports › Cricket › Men's"],
    ["sports/cricket/mixed", "Sports › Cricket › Mixed"],
    ["sports/tennis", "Sports › Tennis"],
    ["sports/tennis/mens", "Sports › Tennis › Men's"],
    ["sports/tennis/mixed", "Sports › Tennis › Mixed"],
    ["sports/football", "Sports › Football"],
    ["sports/football/mens", "Sports › Football › Men's"],
    ["sports/football/mixed", "Sports › Football › Mixed"],
    ["sports/other", "Sports › Other sports"],
    ["sports/other/mens", "Sports › Other sports › Men's"],
    ["sports/other/mixed", "Sports › Other sports › Mixed"],
    ["life-people", "Life and people"],
    ["life-people/personal-updates", "Life and people › Personal updates"],
    ["life-people/advice-questions", "Life and people › Advice and questions"],
    ["life-people/relationships-family", "Life and people › Relationships and family"],
    ["life-people/work-money", "Life and people › Work and money"],
    ["life-people/health-wellbeing", "Life and people › Health and wellbeing"],
    ["life-people/birthdays-remembrance", "Life and people › Birthdays and remembrance"],
    ["food-drink", "Food and drink"],
    ["food-drink/cooking-recipes", "Food and drink › Cooking and recipes"],
    ["food-drink/restaurants-takeaways", "Food and drink › Restaurants and takeaways"],
    ["food-drink/drinks", "Food and drink › Drinks"],
    ["food-drink/products", "Food and drink › Food products"],
    ["places-travel-events", "Places, travel and events"],
    ["places-travel-events/uk-places", "Places, travel and events › UK places"],
    ["places-travel-events/international-travel", "Places, travel and events › International travel"],
    ["places-travel-events/transport", "Places, travel and events › Transport"],
    ["places-travel-events/local-events", "Places, travel and events › Local events"],
    ["places-travel-events/weather", "Places, travel and events › Weather"],
    ["home-products-hobbies", "Home, products and hobbies"],
    ["home-products-hobbies/buying-advice-deals", "Home, products and hobbies › Buying advice and deals"],
    ["home-products-hobbies/clothing-personal", "Home, products and hobbies › Clothing and personal items"],
    ["home-products-hobbies/home-diy", "Home, products and hobbies › Home and DIY"],
    ["home-products-hobbies/collecting", "Home, products and hobbies › Collecting"],
    ["home-products-hobbies/creative-projects", "Home, products and hobbies › Creative projects"],
    ["forum-community", "Forum and community"],
    ["forum-community/administration-features", "Forum and community › Administration and features"],
    ["forum-community/members-meetups", "Forum and community › Members and meetups"],
    ["forum-community/games", "Forum and community › Recurring games"],
    ["forum-community/history", "Forum and community › History"],
    ["forum-community/in-jokes", "Forum and community › In-jokes"],
    ["humour-miscellany", "Humour and miscellany"],
    ["humour-miscellany/humour-absurdity", "Humour and miscellany › Humour and absurdity"],
    ["humour-miscellany/memes-viral", "Humour and miscellany › Memes and viral material"],
    ["humour-miscellany/polls-questions", "Humour and miscellany › Polls and questions"],
    ["humour-miscellany/other", "Humour and miscellany › Other"],
  ];
  const IDS = new Set(TAXONOMY.map(item => item[0]));
  function resolve(value) {
    const wanted = String(value || "").trim().toLocaleLowerCase();
    const match = TAXONOMY.find(([id, label]) => id.toLocaleLowerCase() === wanted || label.toLocaleLowerCase() === wanted);
    return match ? match[0] : null;
  }

  function validDocKey(value) { return /^[tr]:[1-9]\d*$/.test(String(value || "")); }
  function validThreadId(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0; }
  function openDatabase(indexedDb) {
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("overrides")) db.createObjectStore("overrides", { keyPath: "docKey" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Category database unavailable"));
    });
  }

  class CategoryRepository {
    constructor(indexedDb, loadBase) { this.indexedDb = indexedDb; this.loadBase = loadBase; this.basePromise = null; }
    async base() {
      if (!this.basePromise) this.basePromise = Promise.resolve(this.loadBase()).then(value => {
        if (!value || value.version !== 1 || typeof value.threads !== "object") throw new Error("Invalid category base");
        return value;
      });
      return this.basePromise;
    }
    async overrides(keys) {
      const db = await openDatabase(this.indexedDb);
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("overrides", "readonly"); const store = tx.objectStore("overrides"); const found = {};
          for (const key of keys) { const request = store.get(key); request.onsuccess = () => { if (request.result) found[key] = request.result; }; }
          tx.oncomplete = () => resolve(found); tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
    }
    async get(items) {
      const clean = (Array.isArray(items) ? items : []).filter(item => validDocKey(item.docKey) && validThreadId(item.threadId)).slice(0, 500);
      const overrideKeys = [...new Set(clean.flatMap(item => item.docKey.startsWith("r:")
        ? [item.docKey, `t:${Number(item.threadId)}`] : [item.docKey]))];
      const [base, overrides] = await Promise.all([this.base(), this.overrides(overrideKeys)]);
      return clean.map(item => {
        const direct = overrides[item.docKey];
        const root = item.docKey.startsWith("r:") ? overrides[`t:${Number(item.threadId)}`] : direct;
        const categoryId = direct?.categoryId || root?.categoryId || base.threads[String(Number(item.threadId))] || UNCATEGORISED;
        return { docKey: item.docKey, threadId: Number(item.threadId), categoryId,
          source: direct ? "manual" : (root ? "thread-manual" : (categoryId === UNCATEGORISED ? "uncategorised" : "automatic")) };
      });
    }
    async set(docKey, threadId, categoryId) {
      if (!validDocKey(docKey) || !validThreadId(threadId) || !IDS.has(categoryId)) throw new Error("Invalid category override");
      const db = await openDatabase(this.indexedDb);
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction("overrides", "readwrite");
          tx.objectStore("overrides").put({ docKey, threadId: Number(threadId), categoryId, updatedUtc: new Date().toISOString() });
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        });
      } finally { db.close(); }
      return (await this.get([{ docKey, threadId }]))[0];
    }
    async inherit(docKey, threadId) {
      if (!String(docKey).startsWith("r:") || !validThreadId(threadId)) throw new Error("Only replies can inherit");
      const db = await openDatabase(this.indexedDb);
      try { await new Promise((resolve, reject) => { const tx = db.transaction("overrides", "readwrite");
        tx.objectStore("overrides").delete(docKey); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
      finally { db.close(); }
      return (await this.get([{ docKey, threadId }]))[0];
    }
  }
  return { DB_NAME, TAXONOMY, UNCATEGORISED, CategoryRepository, validDocKey, resolve };
});
