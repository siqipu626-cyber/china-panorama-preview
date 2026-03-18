import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  if (!query) return NextResponse.json({ url: null })

  // 1. Try Wikipedia article thumbnail
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(query)}&prop=pageimages&pithumbsize=400&format=json&origin=*`
    )
    const data = await res.json()
    const pages = Object.values(data?.query?.pages || {})
    const thumb = pages[0]?.thumbnail?.source
    if (thumb) return NextResponse.json({ url: thumb })
  } catch {}

  // 2. Try Commons file search
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query + ' china')}&srnamespace=6&srlimit=5&format=json&origin=*`
    )
    const searchData = await searchRes.json()
    const titles = searchData?.query?.search?.map((r) => r.title) || []
    for (const title of titles) {
      const imgRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=400&format=json&origin=*`
      )
      const imgData = await imgRes.json()
      const pages = Object.values(imgData?.query?.pages || {})
      const url = pages[0]?.imageinfo?.[0]?.url
      if (url && /\.(jpg|jpeg|png|webp)/i.test(url)) return NextResponse.json({ url })
    }
  } catch {}

  return NextResponse.json({ url: null })
}
