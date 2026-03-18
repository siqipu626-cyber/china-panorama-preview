export const metadata = {
  title: 'China Panorama Preview Assistant',
  description: 'AI teaching assistant for Chinese culture & trends',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  )
}
