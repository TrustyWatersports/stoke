-- Stoke Seed Data — Trusty Sail & Paddle
-- Run via: wrangler d1 execute stoke-db --file=seed.sql

INSERT OR IGNORE INTO businesses (id, name, city, area, website, phone, plan, created_at)
VALUES ('biz_trustysail','Trusty Sail & Paddle','Morehead City, NC','Crystal Coast','trustysailandpaddle.com','(252) 499-9911','active',strftime('%s','now'));

INSERT OR IGNORE INTO users (id, business_id, email, name, role, created_at)
VALUES ('usr_andrew','biz_trustysail','trustywatersports@gmail.com','Andrew Fournel','owner',strftime('%s','now'));

INSERT OR IGNORE INTO users (id, business_id, email, name, role, created_at)
VALUES ('usr_heather','biz_trustysail','heather@trustysailandpaddle.com','Heather Fournel','owner',strftime('%s','now'));

INSERT OR IGNORE INTO settings (business_id, data, updated_at)
VALUES ('biz_trustysail', '{"business":{"name":"Trusty Sail & Paddle","tagline":"Crystal Coast kayak and sailboat experts","city":"Morehead City, NC","area":"Crystal Coast","specialty":"Custom kayak rigging, US distributor for Topper & Topaz sailboats, tournament fishing","phone":"(252) 499-9911","phone2":"(252) 515-4866","website":"trustysailandpaddle.com","address":"5300 Highway 70 W, Morehead City, NC"},"hashtags":["#TrustySailPaddle","#CrystalCoast","#MoreheadCity","#KayakFishing","#Sailing"],"voice":{"generalDesc":"Write clearly and directly. Lead with the most compelling specific fact or result. Use concrete details — numbers, names, products, real outcomes. Professional but warm. No emoji.","authorName":"Heather Fournel","personalDesc":"Write in Heather Fournel''s full authentic voice. Open with the reader''s emotional world or a vivid human scene — NEVER with a product or price. Alternate short punchy sentences with longer flowing sentences. End with a crystallized memorable line. No emoji. Commerce is always the vehicle, never the point.","emoji":false,"prices":true,"phone":true,"names":true},"content":{"jobTypes":["Custom Rigging Build","Kayak Sale","Demo Day Event","Rental or Tour","Sailboat Sale or Lesson","Repair or Service"],"angles":["Action & Energy","Product Detail","Customer Story","Values & Why","Community Call","Throwback & Reflect"],"defaultDays":3,"defaultChannels":["INSTAGRAM","FACEBOOK","GOOGLE","EMAIL"]}}',
strftime('%s','now'));
