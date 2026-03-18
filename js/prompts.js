/**
 * prompts.js — All AI prompt templates for Stoke
 *
 * Separating prompts from UI logic means:
 *   - Voice refinements don't require touching UI code
 *   - A/B testing prompts is possible without deploys
 *   - Heather's voice guide lives in one auditable place
 *
 * VOICE GUIDE — Heather Fournel, Trusty Sail & Paddle
 * Built from analysis of 5 blog posts (March 2026)
 *
 * Core identity:
 *   Writes as a deeply present human being who runs a business —
 *   not a business owner who occasionally writes. Commerce is always
 *   the vehicle, never the point.
 *
 * Structural signature:
 *   Opens with the reader's emotional world or a vivid human scene.
 *   Ends with crystallized memorable line — short, declarative, real.
 *   Short punchy sentences for emotional impact.
 *   Longer flowing sentences for scene-building.
 *
 * Values:
 *   Community over transaction. Human connection as purpose.
 *   Courage to say what others only think.
 *   Advocacy for the underdog — small dealers, local businesses.
 *
 * Phrases she uses:
 *   "on the water", "lit up from the inside", "the heart of the matter",
 *   "chart a course", "every single"
 *
 * Never:
 *   Generic outdoor brand language. Corporate superlatives.
 *   Aggressive CTAs. Emoji (unless specifically requested).
 *   Leading with product or price.
 */

const TONE_INSTRUCTIONS = {
  general: `WRITING STYLE — General:
Write clearly and directly. Lead with the most compelling specific fact or result.
Use concrete details — numbers, names, products, real outcomes.
Make it immediately scannable for someone discovering Trusty Sail & Paddle for the first time.
Professional but warm. Stop-the-scroll energy without being salesy.
No emoji.`,

  personal: `WRITING STYLE — Personal (Heather's voice):
Write in Heather Fournel's full authentic voice.
Open with the reader's emotional world or a vivid human scene — NEVER with a product or price.
Alternate short punchy sentences (emotional impact) with longer flowing sentences (scene-building).
Use rhetorical questions naturally — genuine processing out loud with the reader.
Address the reader as "you" — intimate, not broadcast.
End with a crystallized memorable line — short, declarative, a real conviction simply stated.
No emoji. Never lead with product or price. Commerce is always the vehicle, never the point.`
};

const CHANNEL_INSTRUCTIONS = {
  INSTAGRAM: (angle) => `INSTAGRAM
[${angle} angle. Caption 150-250 words + relevant hashtags. Hook in first line — make them stop scrolling. Ends with soft CTA or engaging question. No **bold markers** in the output.]`,

  FACEBOOK: (angle) => `FACEBOOK
[${angle} angle. Post 200-300 words. More conversational and fuller story than Instagram. No hashtags needed. No **bold markers** in the output.]`,

  TIKTOK: (angle) => `TIKTOK
[${angle} angle. Video script 30-45 seconds when read aloud. Format: Hook (3 sec to stop scroll) | Middle (show the story/process/result) | CTA. Include [on-screen text] cues in brackets. No **bold markers**.]`,

  GOOGLE: (angle) => `GOOGLE
[${angle} angle. Google Business update 80-120 words. Professional but warm. Specific result. Ends with soft CTA to visit or call. No **bold markers**.]`,

  EMAIL: (angle) => `EMAIL
[${angle} angle. Customer follow-up email. First line must be exactly: Subject: [subject line here]
Then the email body — warm, specific to this job. Ends with genuine invitation to return, share, or tag. No **bold markers**.]`,

  YOUTUBE: (angle) => `YOUTUBE
[${angle} angle. YouTube Shorts script 45-60 seconds. Hook | Educational value (teach something about the product/process) | CTA to visit shop or website. Include [visual cut] cues. No **bold markers**.]`
};

const ANGLES = [
  'Action & Energy',
  'Product Detail',
  'Customer Story',
  'Values & Why',
  'Community Call',
  'Throwback & Reflect'
];

const DAY_SCHEDULES = {
  1:  [1],
  3:  [1, 3],
  7:  [1, 3, 5, 7],
  14: [1, 3, 5, 7, 10, 14]
};

/**
 * buildCampaignPrompt
 *
 * Shadow paths:
 *   - jobType empty → defaults to 'General job'
 *   - channels empty → defaults to ['INSTAGRAM','FACEBOOK']
 *   - validPhotoCount 0 → photo instruction omitted
 *   - campaignDays not in DAY_SCHEDULES → defaults to 3-day
 */
function buildCampaignPrompt({
  jobType,
  customerMoment,
  productsUsed,
  problemSolved,
  extraDetails,
  startDate,
  channels,
  tone,
  campaignDays,
  validPhotoCount
}) {
  const safeChannels = (channels && channels.length > 0) ? channels : ['INSTAGRAM', 'FACEBOOK'];
  const safeJobType = jobType || 'General job';
  const safeTone = tone || 'general';
  const schedule = DAY_SCHEDULES[campaignDays] || DAY_SCHEDULES[3];

  const photoInstruction = validPhotoCount > 0
    ? `\nPHOTOS: You have been provided ${validPhotoCount} image(s) of this job.
Carefully analyze what you see — boats, rigging components, water conditions, setting, people, gear, light, expressions.
Weave specific visual observations naturally into posts. Reference different visual elements across different posts.
Make the reader feel they can see exactly what happened.`
    : '';

  // Build day blocks
  // Day 1 gets all selected channels. Subsequent days rotate through 2 channels for variety.
  let dayBlocks = '';
  schedule.forEach((dayNum, idx) => {
    const angle = ANGLES[idx % ANGLES.length];
    let dayChannels;
    if (idx === 0) {
      dayChannels = safeChannels;
    } else {
      const start = (idx * 2) % safeChannels.length;
      dayChannels = [
        safeChannels[start % safeChannels.length],
        safeChannels[(start + 1) % safeChannels.length]
      ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 2);
    }

    dayBlocks += `\n===DAY${dayNum}===\nANGLE: ${angle}\n`;
    dayChannels.forEach(ch => {
      const instr = CHANNEL_INSTRUCTIONS[ch];
      if (instr) dayBlocks += `---${ch}---\n${instr(angle)}\n`;
    });
  });

  return `You are generating a social media content campaign for Trusty Sail & Paddle, a family-owned kayak and sailboat shop in Morehead City, NC on the Crystal Coast. Campaign starts: ${startDate || 'today'}.

${TONE_INSTRUCTIONS[safeTone]}${photoInstruction}

JOB DETAILS:
Type: ${safeJobType}
Customer moment: ${customerMoment || 'See photos'}
Products/components: ${productsUsed || 'See photos'}
Problem solved: ${problemSolved || 'Not specified'}
Additional context: ${extraDetails || 'None'}

Generate EXACTLY the following campaign structure. Use the exact ===DAYn=== and ---CHANNEL--- markers shown.
Each day has a different ANGLE — different emotional focus, different opening, different content.
CRITICAL: Do NOT include platform name headers (like **INSTAGRAM** or INSTAGRAM:) in the post body text.
No preamble or explanation — just the posts.
${dayBlocks}
Write all posts. Make each feel distinct. Stay in the specified voice.`;
}

// Export for use in stoke.js
window.StokePrompts = { buildCampaignPrompt, ANGLES, DAY_SCHEDULES, TONE_INSTRUCTIONS };
