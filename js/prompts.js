/**
 * prompts.js — All AI prompt templates for Stoke v8.2
 * Updated: photo-to-post matching instructions
 */

const TONE_INSTRUCTIONS = {
  general: `WRITING STYLE — General:
Write clearly and directly. Lead with the most compelling specific fact or result.
Use concrete details — numbers, names, products, real outcomes.
Make it immediately scannable for someone discovering the business for the first time.
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
  INSTAGRAM: (angle, hashtags) => `INSTAGRAM
[${angle} angle. Caption 150-250 words. Hook in first line. Ends with soft CTA or question. Include these default hashtags: ${hashtags || '#CrystalCoast'}. No **bold markers** in the output.]`,

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

function buildCampaignPrompt({
  jobType, customerMoment, productsUsed, problemSolved, extraDetails, startDate,
  channels, tone, campaignDays, validPhotoCount, photoLabels,
  businessName, businessArea, businessCity, businessPhone, businessWebsite, specialty,
  defaultHashtags, voiceGeneral, voicePersonal, voiceAuthor, useEmoji, angles: customAngles,
}) {
  const safeChannels  = (channels && channels.length > 0) ? channels : ['INSTAGRAM', 'FACEBOOK'];
  const safeJobType   = jobType || 'General job';
  const safeTone      = tone || 'general';
  const schedule      = DAY_SCHEDULES[campaignDays] || DAY_SCHEDULES[3];
  const safeAngles    = (customAngles && customAngles.length > 0) ? customAngles : ANGLES;
  const bizName       = businessName   || 'Trusty Sail & Paddle';
  const bizArea       = businessArea   || 'Crystal Coast';
  const bizCity       = businessCity   || 'Morehead City, NC';
  const bizWebsite    = businessWebsite || 'trustysailandpaddle.com';
  const hashtagStr    = (defaultHashtags && defaultHashtags.length > 0) ? defaultHashtags.join(' ') : '#CrystalCoast #KayakFishing';

  const generalVoice  = voiceGeneral  || TONE_INSTRUCTIONS.general;
  const personalVoice = voicePersonal
    ? `WRITING STYLE — Personal (${voiceAuthor || 'Personal'} voice):\n${voicePersonal}`
    : TONE_INSTRUCTIONS.personal;

  // Photo matching instructions
  let photoInstruction = '';
  if (validPhotoCount > 0) {
    const labels = photoLabels && photoLabels.length > 0
      ? photoLabels
      : Array.from({ length: validPhotoCount }, (_, i) => `Photo ${i + 1}`);

    if (validPhotoCount === 1) {
      photoInstruction = `\nPHOTO: You have been provided 1 image (Photo 1).
Carefully analyze what you see — boats, rigging, water, people, gear, setting, light.
Weave specific visual details from this photo into every post naturally.`;
    } else {
      // Multiple photos — match each to a day
      const photoAssignments = schedule.map((dayNum, idx) => {
        const photoIdx = idx % validPhotoCount;
        return `Day ${dayNum} → ${labels[photoIdx]}`;
      }).join(', ');

      photoInstruction = `\nPHOTOS: You have been provided ${validPhotoCount} images: ${labels.join(', ')}.
Each image has been uploaded in order. Analyze each one carefully.

PHOTO ASSIGNMENT — write each day's primary post specifically about the assigned photo:
${photoAssignments}

For each day, start with a PHOTO: N line (e.g., PHOTO: 1) before the first ---CHANNEL--- marker.
Write as if that photo is the one being posted — describe specific visual details you see in it.
Secondary posts on the same day may reference the same photo or complement it with other details.`;
    }
  }

  let dayBlocks = '';
  schedule.forEach((dayNum, idx) => {
    const angle = safeAngles[idx % safeAngles.length];
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
    if (validPhotoCount > 1) {
      const photoIdx = (idx % validPhotoCount) + 1;
      dayBlocks += `PHOTO: ${photoIdx}\n`;
    }
    dayChannels.forEach(ch => {
      const instr = CHANNEL_INSTRUCTIONS[ch];
      if (instr) dayBlocks += `---${ch}---\n${ch === 'INSTAGRAM' ? instr(angle, hashtagStr) : instr(angle)}\n`;
    });
  });

  const activeTone = safeTone === 'personal' ? personalVoice : generalVoice;
  return `You are generating a social media content campaign for ${bizName}, located in ${bizCity} (${bizArea}). Website: ${bizWebsite}. Specialty: ${specialty || 'watersports'}. Campaign starts: ${startDate || 'today'}.

${activeTone}${photoInstruction}

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
