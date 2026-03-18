'use client'
import { useState, useRef, useEffect, useCallback } from 'react'

// ─── SYSTEM PROMPT FACTORY ────────────────────────────────────────────────────
const buildSystemPrompt = (articleText) => `
You are the "China Panorama Preview Assistant" 🐼 — a warm, witty teaching assistant for the course "Overview of China." Your students are international students from diverse global backgrounds preparing for class discussion.

<Article_Context>
${articleText}
</Article_Context>

════════════════════════════════════════
YOUR CORE RULES
════════════════════════════════════════
1. ALWAYS ground your answers in the <Article_Context> above. Do not invent facts.
2. If a concept is NOT in the Article_Context, say: "That's not in today's reading — but here's a quick note!" then give a brief general answer.
3. Language level: HSK-4 English — short sentences, common vocabulary, max 18 words per sentence.
4. Be warm, encouraging, and fun. Use emojis naturally 🎉

════════════════════════════════════════
INTENT DETECTION & RESPONSE FORMAT
════════════════════════════════════════

── INTENT 1: Visual / Concrete Noun ──
Triggered when the student asks "What is [noun]?" about a tangible thing (clothing, food, place, object, person).

Format:
**[Term]** — [1–2 sentence plain-English definition from the article]

📖 *From the article:* [close paraphrase of the relevant passage]

🌍 *Cultural Comparison:* [Compare to a Western or global equivalent the student likely knows]

[SHOW_IMAGE: specific English search query for this visual concept]

📝 *Quick Quiz:*
According to the article, [question about this term]?
A. [plausible option]
B. [correct option]
C. [plausible option]

── INTENT 2: Abstract / How / Why ──
Triggered when the student asks "How…?", "Why…?", or about trends, social phenomena, or cultural forces.

Format:
**[Concept]** — [2–3 sentence explanation using the article]

🌍 *Cultural Comparison:* [Connect to something familiar in Western/global culture]

📝 *Quick Quiz:*
According to the article, [question]?
A. [option]
B. [correct option]
C. [option]

DO NOT include [SHOW_IMAGE:] for abstract concepts.

── INTENT 3: Quiz Answer (A / B / C) ──
Triggered when the student replies with exactly A, B, or C.

Look back at the most recent quiz question in the conversation. Evaluate:
- ✅ Correct: "🎉 That's right! [1-sentence reinforcement from the article]"
- ❌ Incorrect: "Not quite! According to the article, [correct explanation]. The answer is [X]. You've got this! 💪"

Then add: "Ready to explore another concept? Pick one below ↓"

════════════════════════════════════════
IMAGE RULE
════════════════════════════════════════
Use [SHOW_IMAGE: query] ONLY for concrete visual nouns:
✅ YES: specific clothing styles, fashion items, food dishes, named landmarks, cultural artifacts
❌ NO: abstract ideas like "consumer trends," "social pressure," "identity," "growth"

════════════════════════════════════════
FOLLOW-UP SUGGESTIONS
════════════════════════════════════════
After every response (except quiz grading), end with exactly this line:
SUGGESTIONS: ["[suggestion 1]", "[suggestion 2]"]
These should be natural follow-up questions a curious student might ask, drawn from the article.
`

// ─── IMAGE FETCH (via our secure API route) ───────────────────────────────────
const fetchImageUrl = async (query) => {
  try {
    const res = await fetch(`/api/images?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    return data.url || null
  } catch {
    return null
  }
}

// ─── PARSE SHOW_IMAGE TAGS ────────────────────────────────────────────────────
const parseResponse = (text) => {
  const imageRegex = /\[SHOW_IMAGE:\s*(.+?)\]/gi
  const suggestionRegex = /SUGGESTIONS:\s*(\[.*?\])/s
  let images = []
  let match
  while ((match = imageRegex.exec(text)) !== null) images.push(match[1].trim())
  let suggestions = []
  const sugMatch = text.match(suggestionRegex)
  if (sugMatch) { try { suggestions = JSON.parse(sugMatch[1]) } catch {} }
  const cleanText = text.replace(imageRegex, '').replace(suggestionRegex, '').trim()
  return { cleanText, images, suggestions }
}

// ─── MARKDOWN-LITE RENDERER ───────────────────────────────────────────────────
const renderMarkdown = (text) => {
  const lines = text.split('\n')
  const elements = []
  let key = 0
  for (const line of lines) {
    if (!line.trim()) { elements.push(<br key={key++} />); continue }
    const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, pi) => {
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={pi} style={{ color: '#c0392b' }}>{part.slice(2, -2)}</strong>
      if (part.startsWith('*') && part.endsWith('*'))
        return <em key={pi} style={{ color: '#7f8c8d' }}>{part.slice(1, -1)}</em>
      return part
    })
    elements.push(<span key={key++} style={{ display: 'block', marginBottom: '4px' }}>{parts}</span>)
  }
  return elements
}

const hasQuiz = (text) => /📝.*Quick Quiz/s.test(text) || /A\.\s.+\nB\.\s.+\nC\.\s/s.test(text)

const TypingDots = () => (
  <div style={{ display: 'flex', gap: '5px', padding: '8px 4px', alignItems: 'center' }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{
        width: 8, height: 8, borderRadius: '50%', background: '#c0392b',
        animation: 'bounce 1.2s infinite', animationDelay: `${i * 0.2}s`, opacity: 0.7,
      }} />
    ))}
  </div>
)

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function ChinaPanoramaAssistant() {
  const [screen, setScreen] = useState('upload')
  const [articleText, setArticleText] = useState('')
  const [pasteValue, setPasteValue] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [articleTitle, setArticleTitle] = useState('')
  const [starterQuestions, setStarterQuestions] = useState([])
  const chatEndRef = useRef(null)

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const extractStarters = useCallback(async (text) => {
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 300,
          messages: [{ role: 'user', content: `From this article, extract 4 key cultural nouns or concepts a student would want to know. Return ONLY a JSON array of 4 short questions like: ["What is X?", "Why do young people Y?", "What does Z mean?", "How does A work?"]. Article: ${text.slice(0, 3000)}` }]
        })
      })
      const data = await res.json()
      const raw = data.content?.[0]?.text || '[]'
      return JSON.parse(raw.replace(/```json|```/g, '').trim())
    } catch {
      return ['What is the main topic?', 'Who is involved?', 'Why is this trend popular?', 'How does this compare to the West?']
    }
  }, [])

  const handleStart = async () => {
    if (!pasteValue.trim() || pasteValue.trim().length < 50) return
    const text = pasteValue.trim().slice(0, 14000)
    setArticleText(text)
    const firstLine = text.split('\n').find((l) => l.trim().length > 5) || 'Today\'s Article'
    setArticleTitle(firstLine.slice(0, 80))
    setScreen('chat')
    setLoading(true)
    const starters = await extractStarters(text)
    setStarterQuestions(starters)
    const welcome = `🐼 Nǐ hǎo! I'm your **China Panorama Preview Assistant**!

I've read today's article. I'm ready to help you understand key ideas before class.

Here's how I work:
• Ask me **"What is [term]?"** for keyword explanations + images
• Ask me **"Why / How…?"** for cultural analysis
• After each explanation, I'll give you a **quick quiz** — just reply A, B, or C!

Let's get started! 🚀 Pick a question below, or type your own.`
    setMessages([{ role: 'assistant', content: welcome, images: [], suggestions: starters }])
    setLoading(false)
  }

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return
    const userMsg = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    try {
      const apiMessages = newMessages.slice(-12).map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, system: buildSystemPrompt(articleText), messages: apiMessages })
      })
      const data = await res.json()
      const rawText = data.content?.[0]?.text || 'I had trouble thinking. Please try again 🔄'
      const { cleanText, images, suggestions } = parseResponse(rawText)
      const resolvedImages = await Promise.all(images.map(async (q) => ({ query: q, url: await fetchImageUrl(q) })))
      setMessages((prev) => [...prev, { role: 'assistant', content: cleanText, images: resolvedImages, suggestions }])
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Oops! I had trouble thinking. Please try again 🔄', images: [], suggestions: [] }])
    }
    setLoading(false)
  }, [messages, articleText, loading])

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }

  if (screen === 'upload') return (
    <div style={S.uploadRoot}>
      <style>{CSS}</style>
      <div style={S.uploadCard}>
        <div style={S.uploadHeader}>
          <div style={S.lanternRow}><span style={S.lantern}>🏮</span><span style={S.lantern}>🏮</span></div>
          <h1 style={S.uploadTitle}>China Panorama</h1>
          <h2 style={S.uploadSubtitle}>Preview Assistant</h2>
          <p style={S.uploadTagline}>Paste today's article → Get an instant AI study companion</p>
        </div>
        <div style={S.pasteSection}>
          <label style={S.pasteLabel}>📋 Paste your article text below</label>
          <textarea value={pasteValue} onChange={(e) => setPasteValue(e.target.value)}
            placeholder={"Paste your Chinese culture / trends article here...\n\nThe assistant will read it and be ready to explain keywords,\nmake cultural comparisons, and quiz you! 🐼"}
            style={S.pasteArea} rows={10} />
          <div style={S.charCount}>
            {pasteValue.length > 0 && (
              <span style={{ color: pasteValue.length > 100 ? '#27ae60' : '#e67e22' }}>
                {pasteValue.length.toLocaleString()} characters {pasteValue.length > 100 ? '✓ Ready!' : '— needs more text'}
              </span>
            )}
          </div>
        </div>
        <button onClick={handleStart} disabled={pasteValue.trim().length < 50}
          style={{ ...S.startBtn, opacity: pasteValue.trim().length < 50 ? 0.4 : 1, cursor: pasteValue.trim().length < 50 ? 'not-allowed' : 'pointer' }}>
          Start Learning →
        </button>
        <p style={S.tipText}>💡 Tip: Works best with articles 300–3,000 words about Chinese culture, trends, or society.</p>
      </div>
    </div>
  )

  return (
    <div style={S.chatRoot}>
      <style>{CSS}</style>
      <div style={S.topBar}>
        <div style={S.topBarLeft}>
          <span style={{ fontSize: 22 }}>🐼</span>
          <div>
            <div style={S.topBarTitle}>China Panorama Preview Assistant</div>
            <div style={S.topBarArticle}>📄 {articleTitle.length > 55 ? articleTitle.slice(0, 55) + '…' : articleTitle}</div>
          </div>
        </div>
        <button onClick={() => { setScreen('upload'); setMessages([]); setPasteValue(''); setArticleText('') }} style={S.changeBtn}>
          Change Article
        </button>
      </div>

      <div style={S.messageArea}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 8 }}>
              <div style={msg.role === 'assistant' ? S.avatarBot : S.avatarUser}>{msg.role === 'assistant' ? '🐼' : '👤'}</div>
              <div style={msg.role === 'assistant' ? S.bubbleBot : S.bubbleUser}>
                <div style={S.bubbleText}>{renderMarkdown(msg.content)}</div>
                {msg.images?.filter((i) => i.url).length > 0 && (
                  <div style={S.imageGrid}>
                    {msg.images.filter((i) => i.url).map((img, ii) => (
                      <div key={ii} style={S.imageCard}>
                        <img src={img.url} alt={img.query} style={S.img} onError={(e) => { e.target.parentNode.style.display = 'none' }} />
                        <div style={S.imageCaption}>{img.query}</div>
                      </div>
                    ))}
                  </div>
                )}
                {msg.role === 'assistant' && hasQuiz(msg.content) && idx === messages.length - 1 && (
                  <div style={S.quizBtnRow}>
                    {['A', 'B', 'C'].map((opt) => (
                      <button key={opt} onClick={() => sendMessage(opt)} style={S.quizBtn}>{opt}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {msg.role === 'assistant' && msg.suggestions?.length > 0 && idx === messages.length - 1 && (
              <div style={S.chipsRow}>
                {msg.suggestions.map((s, si) => <button key={si} onClick={() => sendMessage(s)} style={S.chip}>{s}</button>)}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 18 }}>
            <div style={S.avatarBot}>🐼</div>
            <div style={{ ...S.bubbleBot, padding: '10px 16px' }}><TypingDots /></div>
          </div>
        )}
        {messages.length === 1 && !loading && starterQuestions.length > 0 && (
          <div style={S.chipsRow}>
            {starterQuestions.map((q, qi) => <button key={qi} onClick={() => sendMessage(q)} style={S.chip}>{q}</button>)}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={S.inputBar}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
          placeholder="Ask about a keyword, concept, or type A / B / C to answer a quiz…"
          style={S.inputField} rows={1} disabled={loading} />
        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}
          style={{ ...S.sendBtn, opacity: loading || !input.trim() ? 0.4 : 1 }}>➤</button>
      </div>
    </div>
  )
}

const S = {
  uploadRoot: { minHeight: '100vh', background: 'linear-gradient(145deg, #1a0a00 0%, #3d0e00 40%, #1a0a00 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Georgia', serif", padding: '24px 16px' },
  uploadCard: { background: 'rgba(255,248,235,0.97)', borderRadius: 20, padding: '40px 36px', maxWidth: 560, width: '100%', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', border: '2px solid #c0392b' },
  uploadHeader: { textAlign: 'center', marginBottom: 28 },
  lanternRow: { display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 8, fontSize: 32 },
  lantern: { display: 'inline-block', animation: 'sway 3s ease-in-out infinite' },
  uploadTitle: { margin: 0, fontSize: 36, fontWeight: 700, color: '#c0392b' },
  uploadSubtitle: { margin: '2px 0 8px', fontSize: 22, fontWeight: 400, color: '#8b2500' },
  uploadTagline: { margin: 0, fontSize: 14, color: '#666', fontFamily: 'system-ui, sans-serif' },
  pasteSection: { marginBottom: 16 },
  pasteLabel: { display: 'block', fontFamily: 'system-ui, sans-serif', fontSize: 14, fontWeight: 600, color: '#555', marginBottom: 8 },
  pasteArea: { width: '100%', padding: '14px', borderRadius: 10, border: '2px solid #e8c4a0', background: '#fffaf4', fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#333', resize: 'vertical', outline: 'none', lineHeight: 1.6, boxSizing: 'border-box' },
  charCount: { textAlign: 'right', fontSize: 12, fontFamily: 'system-ui, sans-serif', marginTop: 4, minHeight: 18 },
  startBtn: { width: '100%', padding: '16px', background: 'linear-gradient(135deg, #c0392b, #96281b)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 18, fontWeight: 700, fontFamily: 'system-ui, sans-serif', boxShadow: '0 4px 20px rgba(192,57,43,0.4)' },
  tipText: { textAlign: 'center', fontSize: 12, color: '#999', fontFamily: 'system-ui, sans-serif', marginTop: 14, marginBottom: 0 },
  chatRoot: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#fdf6ee', fontFamily: 'system-ui, sans-serif' },
  topBar: { background: 'linear-gradient(135deg, #c0392b, #96281b)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(0,0,0,0.2)', flexShrink: 0 },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  topBarTitle: { color: '#fff', fontWeight: 700, fontSize: 15 },
  topBarArticle: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 1 },
  changeBtn: { background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  messageArea: { flex: 1, overflowY: 'auto', padding: '20px 16px 8px', display: 'flex', flexDirection: 'column' },
  avatarBot: { width: 34, height: 34, borderRadius: '50%', background: '#fff', border: '2px solid #c0392b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 },
  avatarUser: { width: 34, height: 34, borderRadius: '50%', background: '#c0392b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 },
  bubbleBot: { background: '#fff', border: '1px solid #ead5c5', borderRadius: '18px 18px 18px 4px', padding: '12px 16px', maxWidth: '78%', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' },
  bubbleUser: { background: 'linear-gradient(135deg, #c0392b, #96281b)', borderRadius: '18px 18px 4px 18px', padding: '12px 16px', maxWidth: '70%', color: '#fff' },
  bubbleText: { fontSize: 14, lineHeight: 1.65, color: 'inherit' },
  imageGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  imageCard: { borderRadius: 10, overflow: 'hidden', border: '1px solid #ddd', width: 160, background: '#f5f5f5' },
  img: { width: '100%', height: 110, objectFit: 'cover', display: 'block' },
  imageCaption: { fontSize: 11, color: '#666', padding: '4px 6px', textAlign: 'center', background: '#fff', borderTop: '1px solid #eee' },
  quizBtnRow: { display: 'flex', gap: 8, marginTop: 10 },
  quizBtn: { padding: '8px 20px', background: 'linear-gradient(135deg, #f39c12, #d68910)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  chipsRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingLeft: 42 },
  chip: { background: '#fff', border: '1.5px solid #c0392b', color: '#c0392b', borderRadius: 20, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500, maxWidth: 260, textAlign: 'left', lineHeight: 1.3 },
  inputBar: { display: 'flex', gap: 10, padding: '12px 16px', background: '#fff', borderTop: '1px solid #ead5c5', alignItems: 'flex-end', flexShrink: 0 },
  inputField: { flex: 1, padding: '10px 14px', borderRadius: 12, border: '1.5px solid #ddd', fontSize: 14, fontFamily: 'system-ui, sans-serif', outline: 'none', resize: 'none', lineHeight: 1.5, maxHeight: 100, background: '#fdf6ee', overflowY: 'auto' },
  sendBtn: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #c0392b, #96281b)', color: '#fff', border: 'none', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
}

const CSS = `
  @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
  @keyframes sway { 0%,100%{transform:rotate(-5deg)} 50%{transform:rotate(5deg)} }
  button:hover:not(:disabled){transform:translateY(-1px)!important;opacity:0.92}
  textarea:focus{border-color:#c0392b!important}
`
