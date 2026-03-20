# Stoke Voice Engine — Architecture

## Data flow
1. User taps mic button
2. Web Speech API captures audio → transcript string
3. Transcript + business context sent to Claude via /functions/generate
4. Claude returns structured JSON intent:
   {
     intent: 'invoice' | 'book' | 'social' | 'query' | 'confirm' | 'unknown',
     confidence: 0..1,
     entities: { customerName, customerId, jobId, amount, date, platform, ... },
     summary: "one sentence of what Claude understood",
     actions: [ { type, label, payload } ],
     response: "what to say back to the user"
   }
5. Command card renders — shows summary + confirm/cancel
6. On confirm → action dispatcher executes
7. Text-to-speech reads back result

## Context injected with every voice command
- Last 10 calendar events (id, title, type, customer, date, amount)
- Open leads (id, name, email, phone, service)  
- Last 3 campaigns (id, jobType, posts summary)
- Business settings (name, services, pricing)
- Current page (so "book for tomorrow" knows it's calendar context)

## Action handlers (v1)
- INVOICE: find job → build invoice → email customer
- SOCIAL: find job → navigate to generator → pre-fill with job context
- BOOK: parse date/time/type → open calendar modal pre-filled
- QUERY: read back schedule in natural language via TTS
- CONFIRM_EMAIL: find event → draft confirmation → send

## Voice UI states
- idle: mic button gray, pulse animation
- listening: mic button green, waveform animation
- processing: mic button spinning
- responding: command card visible, TTS playing
- error: mic button red, shake animation
