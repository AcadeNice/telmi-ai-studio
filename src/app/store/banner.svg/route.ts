export function GET() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320"><rect width="1200" height="320" rx="36" fill="#efe7ff"/><circle cx="155" cy="160" r="92" fill="#7451d8"/><path d="M112 180c28-74 63-74 88 0" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round"/><circle cx="132" cy="140" r="9" fill="#fff"/><circle cx="180" cy="140" r="9" fill="#fff"/><text x="295" y="150" font-family="sans-serif" font-size="62" font-weight="700" fill="#2d2250">Telmi AI Studio</text><text x="298" y="210" font-family="sans-serif" font-size="30" fill="#5d5275">Les histoires de votre famille</text></svg>`;
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=86400",
    },
  });
}
